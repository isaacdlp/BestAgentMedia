import "server-only";
import { after } from "next/server";
import {
  AgentTaskStatus,
  ArticleStatus,
  IssueStatus,
  MessageDirection,
  Prisma,
  PromotionPackageKind,
  PromotionSaleStatus,
  UserRole,
} from "@prisma/client";
import { step, type TaskStep } from "@/lib/agent-task-runner";
import { copyBusinessImagesToAd, copyBusinessImagesToArticle } from "@/lib/business-image-copies";
import { prisma } from "@/lib/db";
import {
  generateSaleMessage,
  priceSaleMessage,
  type PricedSaleItem,
  type SaleIssueOption,
  type SaleMessage,
  type SaleMode,
  type SalePolicy,
} from "@/lib/marketer-sale";
import {
  getMarketerAgent,
  listPublicationPackages,
  MAX_PROMOTION_INSTRUCTIONS,
  pickMarketerSubAgent,
  PromotionReviewError,
  publicationAudience,
} from "@/lib/promotion-deals";
import { formatCents, getPromotionSettings, type PromotionSettings } from "@/lib/promotion-packages";
import { sendSubAgentEmail } from "@/lib/sub-agent-email";
import type { RegistryTaskRef } from "@/lib/tasks";
import type { AwaitedUser } from "@/lib/types";

// "Promote" on the Businesses page: staff pick an issue and businesses in its publication's ZIP
// codes, and a Marketer sub agent emails each business to sell paid ads and sponsored articles.
// Each business is one AgentTask (Ongoing while the conversation is open, Success once they buy,
// Stopped when they decline) with a PromotionSale row. Replies arrive through the IMAP poller
// (handlePromotionSaleInboundMessage). When the business buys, the Marketer creates the purchased
// placements as draft ads and articles, priced as agreed.

const MS_PER_DAY = 86_400_000;
const MAX_UPCOMING_ISSUES = 6;
/** Attempts at an email whose offer passes the pricing rules before giving up on a message. */
const MAX_MESSAGE_ATTEMPTS = 2;
export const MAX_SALE_BUSINESSES = 100;

/** Result JSON stored on the AgentTask so the task page can pick the sale template. */
export type PromotionSaleTaskResult = { contentType: "sale"; saleId: number };

/** The offer on the table, stored on the sale as `proposal`. */
export type SaleProposal = {
  items: { packageId: number; packageName: string; kind: PromotionPackageKind; issueId: string; issueName: string; listPriceCents: number }[];
  discountPercent: number;
  totalCents: number;
  updatedAt: string;
};

function today(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/** Issues a Promote campaign can be launched for: not yet published and not in the past. */
export function promotableIssueWhere(): Prisma.IssueWhereInput {
  return { status: { not: IssueStatus.PUBLISHED }, publicationDate: { gte: today() } };
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

export type SaleLaunchResult = { tasks: RegistryTaskRef[]; skipped: { businessId: number; name: string; reason: string }[] };

/**
 * Validates a Promote request and records one sale task per eligible business, then sends the
 * first emails in the background. Businesses that cannot be contacted are skipped with a reason.
 */
export async function launchPromotionSales(
  user: AwaitedUser,
  input: { issueId: string; businessIds: number[]; instructions: string; articleId?: string },
): Promise<SaleLaunchResult> {
  if (user.role !== UserRole.ADMIN) throw new PromotionReviewError("Only administrators can launch promotions.", 403);
  const instructions = input.instructions.trim().slice(0, MAX_PROMOTION_INSTRUCTIONS);
  const agent = await getMarketerAgent();
  if (!process.env.CLAUDE_KEY) throw new PromotionReviewError("Promotions are not configured (missing CLAUDE_KEY).", 503);

  // Promote on an article page: sell that article to its own business as a paid sponsored feature.
  const article = input.articleId
    ? await prisma.article.findUnique({
        where: { id: input.articleId },
        select: {
          id: true,
          title: true,
          businessId: true,
          promotionPackageId: true,
          issues: { select: { issueId: true } },
          promotionSales: {
            where: { agentTask: { status: { in: [AgentTaskStatus.PENDING, AgentTaskStatus.RUNNING] } } },
            select: { id: true },
            take: 1,
          },
        },
      })
    : null;
  if (input.articleId) {
    if (!article) throw new PromotionReviewError("Article not found.", 404);
    if (!article.businessId) throw new PromotionReviewError("Link the article to a business before promoting it.", 400);
    if (article.promotionPackageId) throw new PromotionReviewError("This article already has a paid promotion style.", 409);
    if (article.promotionSales.length) throw new PromotionReviewError("A promotion conversation for this article is already open.", 409);
    if (input.businessIds.length !== 1 || input.businessIds[0] !== article.businessId) {
      throw new PromotionReviewError("An article can only be promoted to its own business.", 400);
    }
  }

  const issue = await prisma.issue.findFirst({
    where: { id: input.issueId, ...promotableIssueWhere() },
    select: {
      id: true,
      name: true,
      publicationDate: true,
      publication: { select: { id: true, name: true, zipCodes: { select: { code: true } } } },
    },
  });
  if (!issue) throw new PromotionReviewError("Choose an upcoming issue that has not been published.", 404);
  const { publication } = issue;
  const [adPackages, articlePackages] = await Promise.all([
    listPublicationPackages(publication.id, "ad"),
    listPublicationPackages(publication.id, "article"),
  ]);
  if (!adPackages.length && !articlePackages.length) {
    throw new PromotionReviewError(
      `${publication.name} has no promotion rates. Add them under Promotion rates on the publication page first.`,
      400,
    );
  }
  const zipCodes = new Set(publication.zipCodes.map((zip) => zip.code));
  // An article already slated for this issue may be sold to its business wherever the business is.
  const articleInIssue = Boolean(article?.issues.some((item) => item.issueId === issue.id));

  const businesses = await prisma.business.findMany({
    where: { id: { in: input.businessIds } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      postalCode: true,
      promotionSales: {
        where: {
          OR: [
            { optedOut: true },
            { issueId: issue.id, agentTask: { status: { in: [AgentTaskStatus.PENDING, AgentTaskStatus.RUNNING] } } },
            { issueId: issue.id, status: PromotionSaleStatus.PURCHASED },
          ],
        },
        select: { optedOut: true, status: true },
      },
      promotionDeals: { where: { optedOut: true }, select: { id: true }, take: 1 },
    },
  });

  const skipped: SaleLaunchResult["skipped"] = [];
  const eligible: typeof businesses = [];
  for (const business of businesses) {
    const reason = !business.email
      ? "no email address on record"
      : !articleInIssue && (!business.postalCode || !zipCodes.has(business.postalCode))
        ? `ZIP code not served by ${publication.name}`
        : business.promotionSales.some((sale) => sale.optedOut) || business.promotionDeals.length
          ? "asked not to be contacted"
          : !article && business.promotionSales.some((sale) => sale.status === PromotionSaleStatus.PURCHASED)
            ? "already bought promotions in this issue; the Marketer keeps answering on that conversation"
            : business.promotionSales.some((sale) => !sale.optedOut && sale.status !== PromotionSaleStatus.PURCHASED)
              ? "a promotion conversation for this issue is already open"
              : null;
    if (reason) skipped.push({ businessId: business.id, name: business.name, reason });
    else eligible.push(business);
  }
  if (!eligible.length) {
    throw new PromotionReviewError(
      skipped.length
        ? `None of the selected businesses can be contacted: ${skipped.map((item) => `${item.name} (${item.reason})`).join("; ")}.`
        : "Select at least one business.",
      409,
    );
  }

  const settings = getPromotionSettings(agent.settings);
  const rateCard = [...adPackages, ...articlePackages].map((item) => `${item.name} ${formatCents(item.priceCents)}`).join(", ");
  const sales: { saleId: number; agentTaskId: string }[] = [];
  for (const business of eligible) {
    const subAgent = await pickMarketerSubAgent(agent.id, business.id);
    if (!subAgent) {
      throw new PromotionReviewError("No Marketer sub agent has email sending configured. Configure one in the Agents section.", 503);
    }
    const initialSteps: TaskStep[] = [
      step("info", `Selling paid promotions in ${publication.name} · ${issue.name} (${issue.publicationDate.toISOString().slice(0, 10)}) to ${business.name}`),
      ...(article ? [step("info", `Leading with the article "${article.title}" as a paid sponsored feature`)] : []),
      step("info", `Assigned to ${subAgent.name} (Marketer) · recipient: ${business.email}`),
      step("info", `Rate card: ${rateCard}`),
      step(
        "info",
        settings.maxDiscountPercent > 0
          ? `Bundle discounts allowed up to ${settings.maxDiscountPercent}% (individual prices are firm${instructions ? " unless the instructions allow it" : ""})`
          : "No discounts allowed (promotion.maxDiscountPercent is 0)",
      ),
      step(
        "info",
        instructions ? `Custom instructions: "${instructions.slice(0, 200)}${instructions.length > 200 ? "…" : ""}"` : "No custom instructions",
      ),
    ];
    const created = await prisma.$transaction(async (tx) => {
      const agentTask = await tx.agentTask.create({
        data: {
          agentId: agent.id,
          subAgentId: subAgent.id,
          status: AgentTaskStatus.RUNNING,
          label: article
            ? `Promotion sale · ${issue.name} · ${business.name} · ${article.title}`
            : `Promotion sale · ${issue.name} · ${business.name}`,
          issueId: issue.id,
          triggeredById: user.id,
          startedAt: new Date(),
          steps: initialSteps as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      const sale = await tx.promotionSale.create({
        data: {
          agentTaskId: agentTask.id,
          businessId: business.id,
          issueId: issue.id,
          publicationId: publication.id,
          articleId: article?.id ?? null,
          subAgentId: subAgent.id,
          createdByUserId: user.id,
          instructions,
        },
        select: { id: true },
      });
      const result: PromotionSaleTaskResult = { contentType: "sale", saleId: sale.id };
      await tx.agentTask.update({ where: { id: agentTask.id }, data: { result: result as unknown as Prisma.InputJsonValue } });
      return { saleId: sale.id, agentTaskId: agentTask.id };
    });
    sales.push(created);
  }

  after(async () => {
    for (const sale of sales) await sendInitialSaleEmail(sale.saleId);
  });

  const tasks = await prisma.task.findMany({
    where: { agentTaskId: { in: sales.map((sale) => sale.agentTaskId) } },
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });
  return { tasks, skipped };
}

// ---------------------------------------------------------------------------
// Reading sales for pages
// ---------------------------------------------------------------------------

const promotionSaleSummarySelect = {
  id: true,
  status: true,
  proposal: true,
  instructions: true,
  optedOut: true,
  followUpSentAt: true,
  lastInboundAt: true,
  purchasedAt: true,
  threadId: true,
  createdAt: true,
  business: { select: { id: true, name: true, email: true } },
  issue: { select: { id: true, name: true, publicationDate: true } },
  publication: { select: { id: true, name: true } },
  article: { select: { id: true, title: true } },
  subAgent: { select: { id: true, name: true, agentId: true } },
  thread: { select: { _count: { select: { messages: true } } } },
  items: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      kind: true,
      packageName: true,
      listPriceCents: true,
      discountPercent: true,
      priceCents: true,
      advertisementId: true,
      articleId: true,
      createdAt: true,
      issue: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PromotionSaleSelect;

export type PromotionSaleSummary = Prisma.PromotionSaleGetPayload<{ select: typeof promotionSaleSummarySelect }>;

export function getPromotionSaleByTask(agentTaskId: string) {
  return prisma.promotionSale.findUnique({ where: { agentTaskId }, select: promotionSaleSummarySelect });
}

/** Reads a stored proposal, ignoring anything malformed. */
export function readSaleProposal(value: unknown): SaleProposal | null {
  if (!value || typeof value !== "object") return null;
  const proposal = value as Partial<SaleProposal>;
  return Array.isArray(proposal.items) && typeof proposal.discountPercent === "number" && typeof proposal.totalCents === "number"
    ? (proposal as SaleProposal)
    : null;
}

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

async function loadSale(saleId: number) {
  return prisma.promotionSale.findUnique({
    where: { id: saleId },
    include: {
      agentTask: { select: { id: true, status: true } },
      business: {
        select: {
          id: true,
          name: true,
          email: true,
          primaryCategory: true,
          categories: true,
          description: true,
          city: true,
          state: true,
          postalCode: true,
          website: true,
          _count: { select: { ads: true } },
        },
      },
      issue: { select: { id: true, name: true, publicationDate: true } },
      publication: { select: { id: true, name: true } },
      article: { select: { id: true, title: true, body: true, businessId: true, promotionPackageId: true, styleName: true } },
      subAgent: { select: { id: true, name: true, soul: true } },
      items: { orderBy: { id: "asc" }, include: { issue: { select: { name: true } } } },
    },
  });
}

/** Characters of the article body given to the Marketer: enough to sell it, not a whole feature. */
const MAX_ARTICLE_CONTEXT = 6000;

type LoadedSale = NonNullable<Awaited<ReturnType<typeof loadSale>>>;

/** Rate card and sellable issues, read live so rate changes apply to the next message. */
async function salePolicy(sale: LoadedSale, settings: PromotionSettings): Promise<SalePolicy> {
  const [adPackages, articlePackages, upcoming] = await Promise.all([
    listPublicationPackages(sale.publicationId, "ad"),
    listPublicationPackages(sale.publicationId, "article"),
    prisma.issue.findMany({
      where: { publicationId: sale.publicationId, ...promotableIssueWhere() },
      orderBy: { publicationDate: "asc" },
      take: MAX_UPCOMING_ISSUES,
      select: { id: true, name: true, publicationDate: true },
    }),
  ]);
  const issues: SaleIssueOption[] = [...upcoming];
  if (sale.issue && !issues.some((issue) => issue.id === sale.issue?.id)) issues.unshift(sale.issue);
  return {
    packages: [...adPackages, ...articlePackages],
    issues,
    defaultIssueId: sale.issue?.id ?? issues[0]?.id ?? null,
    maxDiscountPercent: settings.maxDiscountPercent,
    allowSingleItemDiscount: Boolean(sale.instructions.trim()),
  };
}

async function buildSaleContext(sale: LoadedSale): Promise<string[]> {
  const { business } = sale;
  const categories = [business.primaryCategory, ...business.categories].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );
  const location = [business.city, business.state, business.postalCode].filter(Boolean).join(", ");
  const audience = await publicationAudience(sale.publicationId);
  const lines = [
    `Business: ${business.name}${categories.length ? ` (${categories.slice(0, 4).join(", ")})` : ""}${location ? ` in ${location}` : ""}.`,
    business.description ? `What we have on record about them: ${business.description}` : "",
    business.website ? `Their website: ${business.website}` : "",
    business._count.ads
      ? `They have ${business._count.ads} ad${business._count.ads === 1 ? "" : "s"} on record with Best Version Media, so treat them as a returning advertiser.`
      : "As far as we know they have not advertised with the publication before.",
    `Publication: ${sale.publication.name}. It is mailed free to the households in its ZIP codes.`,
    audience
      ? `${sale.publication.name} covers ZIP codes with about ${audience.toLocaleString("en-US")} residents (U.S. Census estimate). That is the area's population, not the print circulation; never present it as circulation or readership.`
      : "",
    sale.issue
      ? `This campaign is about the forthcoming issue ${sale.issue.name}, publication date ${sale.issue.publicationDate.toISOString().slice(0, 10)}.`
      : "The issue this campaign was launched for no longer exists; sell placements in the upcoming issues listed.",
  ];
  if (sale.article && !sale.article.promotionPackageId) {
    const body = sale.article.body.trim();
    lines.push(
      `This campaign is about an article the publication team has written about ${business.name}, titled "${sale.article.title}". Your main goal is to sign them up to run it as a paid sponsored feature: recommend the sponsored-article package from the rate card that fits it best first (an ad alongside it is a natural bundle). Refer to the article by its title, summarize what it says about them in a sentence or two so they can picture it in print, and never paste the whole text. Do not promise it runs for free if they decline; say the team decides editorial coverage separately. When they buy a sponsored article for this issue, it is this article (give it this title).`,
      `The article as drafted (Markdown${body.length > MAX_ARTICLE_CONTEXT ? ", truncated" : ""}):\n"""\n${body.slice(0, MAX_ARTICLE_CONTEXT)}\n"""`,
    );
  } else if (sale.article) {
    lines.push(`They have since signed up the article "${sale.article.title}" as a paid ${sale.article.styleName ?? "sponsored feature"}; do not sell it again.`);
  }
  if (sale.items.length) {
    lines.push(
      `Already purchased in this conversation (include these in items on any further purchase): ${sale.items
        .map(
          (item) =>
            `${item.packageName} in ${item.issue?.name ?? "an issue"} (package_key "${item.packageId ?? "?"}", issue_key "${item.issueId ?? ""}") at ${formatCents(item.priceCents)}${item.discountPercent ? ` after ${item.discountPercent}% bundle discount` : ""}`,
        )
        .join("; ")}.`,
    );
  }
  const proposal = readSaleProposal(sale.proposal);
  if (proposal?.items.length) {
    lines.push(
      `The offer you last made: ${proposal.items.map((item) => `${item.packageName} in ${item.issueName} (list ${formatCents(item.listPriceCents)})`).join(", ")}${proposal.discountPercent ? ` with a ${proposal.discountPercent}% bundle discount` : ""}, total ${formatCents(proposal.totalCents)}.`,
    );
  }
  lines.push(`Sale status so far: ${sale.status.toLowerCase()}.`);
  if (sale.optedOut) lines.push("They previously asked not to be contacted; only answer what they ask now and do not sell.");
  if (sale.instructions.trim()) {
    lines.push(
      `Instructions from the publication team for this conversation (follow them, but never invent facts, quote prices off the rate card or exceed your discount limit): ${sale.instructions.trim()}`,
    );
  }
  return lines.filter(Boolean);
}

/** Writes a message whose offer passes the pricing rules, asking the model to correct itself once. */
async function writeSaleMessage(
  sale: LoadedSale,
  mode: SaleMode,
  settings: PromotionSettings,
  policy: SalePolicy,
  messages: Parameters<typeof generateSaleMessage>[0]["messages"],
  log: TaskStep[],
): Promise<{ message: SaleMessage; items: PricedSaleItem[] }> {
  if (!sale.subAgent) throw new Error("The assigned Marketer sub agent no longer exists.");
  const context = await buildSaleContext(sale);
  let correction: string | undefined;
  for (let attempt = 1; attempt <= MAX_MESSAGE_ATTEMPTS; attempt++) {
    const message = await generateSaleMessage({
      mode,
      model: settings.model,
      agent: sale.subAgent,
      recipientName: sale.business.name,
      context,
      policy,
      messages,
      correction,
    });
    if (!message) throw new Error("AI email failed: CLAUDE_KEY not set or the model returned no usable email.");
    const priced = priceSaleMessage(message, policy);
    if (priced.ok) return { message, items: priced.items };
    correction = priced.problem;
    log.push(step("info", `Draft rejected by the pricing rules (${priced.problem.replace(/\.$/, "")}) — asking the Marketer to rewrite it`));
  }
  throw new Error(`The Marketer's email kept breaking the pricing rules (${correction}). Nothing was sent.`);
}

function proposalFrom(items: PricedSaleItem[], discountPercent: number): SaleProposal {
  return {
    items: items.map((item) => ({
      packageId: item.package.id,
      packageName: item.package.name,
      kind: item.package.kind,
      issueId: item.issue.id,
      issueName: item.issue.name,
      listPriceCents: item.listPriceCents,
    })),
    discountPercent,
    totalCents: items.reduce((sum, item) => sum + item.priceCents, 0),
    updatedAt: new Date().toISOString(),
  };
}

function describeOffer(items: PricedSaleItem[], discountPercent: number): string {
  const total = items.reduce((sum, item) => sum + item.priceCents, 0);
  return `${items.map((item) => `${item.package.name} in ${item.issue.name}`).join(" + ")}${discountPercent ? ` with ${discountPercent}% bundle discount` : ""} — ${formatCents(total)}`;
}

async function appendSteps(agentTaskId: string, newSteps: TaskStep[], data: Prisma.AgentTaskUpdateInput = {}): Promise<void> {
  const task = await prisma.agentTask.findUnique({ where: { id: agentTaskId }, select: { steps: true } });
  if (!task) return;
  const steps = Array.isArray(task.steps) ? (task.steps as unknown[]) : [];
  await prisma.agentTask.update({
    where: { id: agentTaskId },
    data: { ...data, steps: [...steps, ...newSteps] as unknown as Prisma.InputJsonValue },
  });
}

// ---------------------------------------------------------------------------
// First email
// ---------------------------------------------------------------------------

export async function sendInitialSaleEmail(saleId: number): Promise<void> {
  const sale = await loadSale(saleId);
  if (!sale) return;
  const agentTaskId = sale.agentTask.id;
  const newSteps: TaskStep[] = [];
  try {
    if (sale.agentTask.status !== AgentTaskStatus.RUNNING) return;
    if (!sale.subAgent) throw new Error("The assigned Marketer sub agent no longer exists.");
    if (!sale.business.email) throw new Error(`${sale.business.name} has no email address on record.`);

    const agent = await getMarketerAgent();
    const settings = getPromotionSettings(agent.settings);
    const policy = await salePolicy(sale, settings);
    newSteps.push(step("info", `Calling ${settings.model} to write the sales email`));
    const { message, items } = await writeSaleMessage(sale, "initial", settings, policy, [], newSteps);

    const sent = await sendSubAgentEmail({
      subAgentId: sale.subAgent.id,
      taskId: agentTaskId,
      toEmail: sale.business.email,
      toName: sale.business.name,
      subject: message.subject || `${sale.business.name} in the next issue of ${sale.publication.name}`,
      bodyText: message.body,
    });
    await prisma.promotionSale.update({
      where: { id: sale.id },
      data: {
        threadId: sent.threadId,
        ...(items.length ? { proposal: proposalFrom(items, message.discountPercent) as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    newSteps.push(
      step(
        "success",
        `Sales email sent to ${sent.sentTo}${sent.sentTo !== sale.business.email ? ` (DUMMY_EMAIL override for ${sale.business.email})` : ""}`,
      ),
      ...(items.length ? [step("info", `Offer: ${describeOffer(items, message.discountPercent)}`)] : []),
      step("info", "Waiting for the business's reply — the Marketer answers automatically and closes the sale"),
    );
    await appendSteps(agentTaskId, newSteps);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.error(`[PromotionSale] first email for sale ${saleId} failed:`, error);
    await appendSteps(agentTaskId, [...newSteps, step("error", `Failed: ${messageText}`)], {
      status: AgentTaskStatus.FAILED,
      error: messageText,
      completedAt: new Date(),
    }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

/**
 * Answers the business's latest message on a Promote thread and records where the sale stands.
 * On a purchase, creates the purchased placements as draft ads and articles.
 */
export async function handlePromotionSaleInboundMessage(threadId: string): Promise<void> {
  const found = await prisma.promotionSale.findUnique({ where: { threadId }, select: { id: true } });
  if (!found) return;
  const sale = await loadSale(found.id);
  if (!sale) return;
  const agentTaskId = sale.agentTask.id;
  const newSteps: TaskStep[] = [];

  try {
    const taskStatus = sale.agentTask.status;
    // Staff stopped the conversation (a decline also stops it, but the business may come back).
    if (taskStatus === AgentTaskStatus.FAILED) return;
    if (taskStatus === AgentTaskStatus.STOPPED && sale.status !== PromotionSaleStatus.DECLINED) return;

    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      select: { toEmail: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    const last = thread?.messages[thread.messages.length - 1];
    if (!thread || !last || last.direction !== MessageDirection.INBOUND) return;

    await prisma.promotionSale.update({ where: { id: sale.id }, data: { lastInboundAt: last.receivedAt ?? last.createdAt } });
    newSteps.push(step("info", `Reply received from ${thread.toEmail}`));
    if (!sale.subAgent) {
      await appendSteps(agentTaskId, [...newSteps, step("error", "Not answered — the assigned Marketer sub agent no longer exists")]);
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { slug: "marketer" }, select: { settings: true } });
    const settings = getPromotionSettings(agent?.settings);
    const policy = await salePolicy(sale, settings);
    let written: Awaited<ReturnType<typeof writeSaleMessage>>;
    try {
      written = await writeSaleMessage(sale, "reply", settings, policy, thread.messages, newSteps);
    } catch (error) {
      // A canned answer that ignores what they said does more harm than no answer.
      await appendSteps(agentTaskId, [
        ...newSteps,
        step("error", `Not answered — ${error instanceof Error ? error.message : String(error)}`),
      ]);
      return;
    }
    const { message, items } = written;

    await sendSubAgentEmail({
      subAgentId: sale.subAgent.id,
      toEmail: thread.toEmail,
      toName: sale.business.name,
      bodyText: message.body,
      existingThreadId: threadId,
    });
    newSteps.push(step("success", `${sale.subAgent.name} replied`));

    const saleData: Prisma.PromotionSaleUpdateInput = {};
    let taskData: Prisma.AgentTaskUpdateInput = {};
    if (items.length) {
      saleData.proposal = proposalFrom(items, message.discountPercent) as unknown as Prisma.InputJsonValue;
      if (message.decision !== "purchased") newSteps.push(step("info", `Offer: ${describeOffer(items, message.discountPercent)}`));
    }

    if (message.optedOut || message.decision === "declined") {
      Object.assign(saleData, {
        ...(sale.status === PromotionSaleStatus.PURCHASED ? {} : { status: PromotionSaleStatus.DECLINED }),
        ...(message.optedOut ? { optedOut: true } : {}),
      });
      newSteps.push(step("info", message.optedOut ? "Business asked not to be contacted again — conversation stopped" : "Business declined the promotion"));
      if (taskStatus === AgentTaskStatus.RUNNING && sale.status !== PromotionSaleStatus.PURCHASED) {
        taskData = { status: AgentTaskStatus.STOPPED, completedAt: new Date() };
      }
    } else if (message.decision === "purchased") {
      const created = await createPurchasedDrafts(sale, items, newSteps);
      if (created) {
        Object.assign(saleData, { status: PromotionSaleStatus.PURCHASED, purchasedAt: new Date(), optedOut: false });
        taskData = { status: AgentTaskStatus.SUCCEEDED, completedAt: new Date(), error: null };
      }
    } else if (message.decision === "interested") {
      if (sale.status !== PromotionSaleStatus.PURCHASED) saleData.status = PromotionSaleStatus.NEGOTIATING;
      newSteps.push(step("info", "Business is interested — negotiating"));
      // A declined business who comes back reopens the conversation.
      if (taskStatus === AgentTaskStatus.STOPPED) taskData = { status: AgentTaskStatus.RUNNING, completedAt: null };
    }

    if (Object.keys(saleData).length) await prisma.promotionSale.update({ where: { id: sale.id }, data: saleData });
    await appendSteps(agentTaskId, newSteps, taskData);
  } catch (error) {
    console.error(`[PromotionSale] handlePromotionSaleInboundMessage failed for thread ${threadId}:`, error);
    await appendSteps(agentTaskId, [
      ...newSteps,
      step("error", `Reply handling failed: ${error instanceof Error ? error.message : String(error)}`),
    ]).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Purchase: draft ads and articles
// ---------------------------------------------------------------------------

/**
 * Creates a PromotionSaleItem and a draft ad or article for each purchased placement not already
 * recorded. The model lists the complete order on every purchase, so repeating a confirmation
 * creates nothing twice. Returns the number of placements created.
 */
async function createPurchasedDrafts(sale: LoadedSale, items: PricedSaleItem[], log: TaskStep[]): Promise<number> {
  const remaining = new Map<string, number>();
  for (const existing of sale.items) {
    const key = `${existing.packageId}|${existing.issueId}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const fresh = items.filter((item) => {
    const key = `${item.package.id}|${item.issue.id}`;
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      return false;
    }
    return true;
  });
  if (!fresh.length) {
    log.push(step("info", "Purchase confirmed again — every placement was already recorded"));
    return 0;
  }

  const total = fresh.reduce((sum, item) => sum + item.priceCents, 0);
  log.push(step("success", `Business purchased ${describeOffer(fresh, fresh[0].discountPercent)} — agreement and invoice to be sent by the publication team`));

  // On an article campaign, the first sponsored article bought becomes that article's paid style.
  let campaignArticle = sale.article && !sale.article.promotionPackageId ? sale.article : null;

  let created = 0;
  for (const item of fresh) {
    try {
      if (item.package.kind === PromotionPackageKind.ARTICLE && campaignArticle) {
        const target = campaignArticle;
        campaignArticle = null;
        const applied = await prisma.$transaction(async (tx) => {
          const claimed = await tx.article.updateMany({
            where: { id: target.id, promotionPackageId: null, saleItem: { is: null } },
            data: { promotionPackageId: item.package.id, styleName: item.package.name, costCents: item.priceCents },
          });
          if (!claimed.count) return false;
          await tx.articleIssue.upsert({
            where: { articleId_issueId: { articleId: target.id, issueId: item.issue.id } },
            create: { articleId: target.id, issueId: item.issue.id },
            update: {},
          });
          await tx.promotionSaleItem.create({
            data: {
              saleId: sale.id,
              kind: item.package.kind,
              packageId: item.package.id,
              packageName: item.package.name,
              issueId: item.issue.id,
              listPriceCents: item.listPriceCents,
              discountPercent: item.discountPercent,
              priceCents: item.priceCents,
              articleId: target.id,
            },
          });
          return true;
        });
        if (applied) {
          log.push(step("success", `Article "${target.title}" signed up as ${item.package.name} in ${item.issue.name}, price ${formatCents(item.priceCents)} — /articles/${target.id}`));
          created += 1;
          continue;
        }
        log.push(step("info", `Article "${target.title}" already has a paid style — creating a separate draft for ${item.package.name}`));
      }
      const itemData = {
        saleId: sale.id,
        kind: item.package.kind,
        packageId: item.package.id,
        packageName: item.package.name,
        issueId: item.issue.id,
        listPriceCents: item.listPriceCents,
        discountPercent: item.discountPercent,
        priceCents: item.priceCents,
      };
      if (item.package.kind === PromotionPackageKind.AD) {
        const ad = await prisma.$transaction(async (tx) => {
          const ad = await tx.advertisement.create({
            data: {
              title: item.title.slice(0, 200) || `${sale.business.name} — ${item.package.name}`,
              description: item.brief || sale.business.description || null,
              businessId: sale.business.id,
              promotionPackageId: item.package.id,
              styleName: item.package.name,
              costCents: item.priceCents,
              issues: { create: [{ issueId: item.issue.id }] },
            },
            select: { id: true },
          });
          await tx.promotionSaleItem.create({ data: { ...itemData, advertisementId: ad.id } });
          return ad;
        });
        const images = await copyBusinessImagesToAd(sale.business.id, ad.id);
        log.push(step("success", `Draft ad created: ${item.package.name} in ${item.issue.name}, cost ${formatCents(item.priceCents)}${images ? ` (${images} business image${images === 1 ? "" : "s"} attached)` : ""} — /ads/${ad.id}`));
      } else {
        const article = await prisma.$transaction(async (tx) => {
          const article = await tx.article.create({
            data: {
              title: item.title.slice(0, 200) || `${sale.business.name} — sponsored feature`,
              body: [
                `Sponsored feature (${item.package.name}) purchased by ${sale.business.name} for ${formatCents(item.priceCents)}. Brief from the sales conversation — replace with the final copy:`,
                item.brief || "(No brief given; see the conversation.)",
              ].join("\n\n"),
              status: ArticleStatus.DRAFT,
              businessId: sale.business.id,
              createdByUserId: sale.createdByUserId,
              promotionPackageId: item.package.id,
              styleName: item.package.name,
              costCents: item.priceCents,
              issues: { create: [{ issueId: item.issue.id }] },
            },
            select: { id: true },
          });
          await tx.promotionSaleItem.create({ data: { ...itemData, articleId: article.id } });
          return article;
        });
        const images = await copyBusinessImagesToArticle(sale.business.id, article.id);
        log.push(step("success", `Draft article created: ${item.package.name} in ${item.issue.name}, price ${formatCents(item.priceCents)}${images ? ` (${images} business image${images === 1 ? "" : "s"} attached)` : ""} — /articles/${article.id}`));
      }
      created += 1;
    } catch (error) {
      log.push(step("error", `Could not create the draft for ${item.package.name} in ${item.issue.name}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  if (created) log.push(step("info", `Sale total recorded: ${formatCents(total)}`));
  return created;
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

/** Sends one follow-up to businesses that never answered the first sales email. */
export async function checkPromotionSaleFollowUps(): Promise<void> {
  const agent = await prisma.agent.findUnique({ where: { slug: "marketer" }, select: { enabled: true, settings: true } });
  if (!agent?.enabled) return;
  const settings = getPromotionSettings(agent.settings);
  if (settings.followUpDays <= 0) return;
  const cutoff = new Date(Date.now() - settings.followUpDays * MS_PER_DAY);

  const due = await prisma.promotionSale.findMany({
    where: {
      threadId: { not: null },
      optedOut: false,
      lastInboundAt: null,
      followUpSentAt: null,
      createdAt: { lte: cutoff },
      agentTask: { status: AgentTaskStatus.RUNNING },
    },
    select: { id: true },
  });

  for (const { id } of due) {
    const sale = await loadSale(id);
    if (!sale?.threadId || !sale.subAgent || !sale.business.email) continue;
    const newSteps: TaskStep[] = [];
    try {
      const thread = await prisma.emailThread.findUnique({
        where: { id: sale.threadId },
        select: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!thread?.messages.length || thread.messages.some((msg) => msg.direction === MessageDirection.INBOUND)) continue;

      const policy = await salePolicy(sale, settings);
      const { message, items } = await writeSaleMessage(sale, "follow_up", settings, policy, thread.messages, newSteps);
      await sendSubAgentEmail({
        subAgentId: sale.subAgent.id,
        toEmail: sale.business.email,
        toName: sale.business.name,
        bodyText: message.body,
        existingThreadId: sale.threadId,
      });
      await prisma.promotionSale.update({
        where: { id: sale.id },
        data: {
          followUpSentAt: new Date(),
          ...(items.length ? { proposal: proposalFrom(items, message.discountPercent) as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      await appendSteps(sale.agentTask.id, [...newSteps, step("info", `No reply after ${settings.followUpDays} day(s) — follow-up sent`)]);
    } catch (error) {
      // No canned nudge: without the model the follow-up waits for the next check.
      console.error(`[PromotionSale] follow-up for sale ${id} failed:`, error);
    }
  }
}

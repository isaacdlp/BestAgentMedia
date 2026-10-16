import "server-only";
import { resolve } from "node:path";
import { after } from "next/server";
import {
  AdReviewDecision,
  AdReviewSource,
  AdvertisementStatus,
  AgentTaskStatus,
  MessageDirection,
  Prisma,
  PromotionContentStatus,
  PromotionDealStatus,
  UserRole,
} from "@prisma/client";
import { getAdvertisementScope, getArticleScope } from "@/lib/access";
import { adCreativeDirectory } from "@/lib/ad-creative";
import {
  AD_REVIEW_DECISION_LABELS,
  MAX_REVIEW_COMMENTS,
  MAX_REVIEWER_NAME,
  MAX_REVIEWS_PER_DEAL,
  newReviewToken,
  recordAdReview,
  reviewLinkState,
  reviewUrl,
} from "@/lib/ad-reviews";
import { step, type TaskStep } from "@/lib/agent-task-runner";
import { articleImageDirectory } from "@/lib/article-images";
import { prisma } from "@/lib/db";
import { CONTENT_PLACEHOLDER, generateMarketerMessage, type MarketerMessage } from "@/lib/marketer-reply";
import {
  formatCents,
  getPromotionSettings,
  packageKindFor,
  type PromotionPackageOffer,
  type PromotionSettings,
  type PromotionTarget,
} from "@/lib/promotion-packages";
import { getSubAgentConfig, sendSubAgentEmail } from "@/lib/sub-agent-email";
import { getRegistryTask, type RegistryTaskRef } from "@/lib/tasks";
import type { AwaitedUser } from "@/lib/types";

// "Submit for Review" on an ad or article: a Marketer sub agent emails the advertiser the content
// for approval and sells a paid promotion package for the issue. The conversation is one AgentTask
// that stays Ongoing while it is open, succeeds when the advertiser signs up, and is stopped when
// they decline. Replies arrive through the IMAP poller (handlePromotionInboundMessage).

const MS_PER_DAY = 86_400_000;
const MAX_ARTICLE_ATTACHMENTS = 3;
export const MAX_PROMOTION_INSTRUCTIONS = 2000;

export class PromotionReviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Result JSON stored on the AgentTask so the task page can pick the promotion template. */
export type PromotionTaskResult = {
  contentType: "promotion";
  dealId: number;
  target: PromotionTarget;
  targetId: string;
};

/** Reads the optional `{ instructions }` body of a submit-review request. */
export async function readPromotionInstructions(request: Request): Promise<string> {
  const text = await request.text().catch(() => "");
  if (!text.trim()) return "";
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new PromotionReviewError("Invalid request body.", 400);
  }
  const instructions = (body as { instructions?: unknown } | null)?.instructions;
  if (instructions === undefined) return "";
  if (typeof instructions !== "string") throw new PromotionReviewError("Instructions must be text.", 400);
  if (instructions.length > MAX_PROMOTION_INSTRUCTIONS) {
    throw new PromotionReviewError(`Keep the instructions under ${MAX_PROMOTION_INSTRUCTIONS} characters.`, 400);
  }
  return instructions;
}

export async function getMarketerAgent() {
  const agent = await prisma.agent.findUnique({
    where: { slug: "marketer" },
    select: { id: true, enabled: true, settings: true },
  });
  if (!agent) throw new PromotionReviewError("Marketer agent is not configured. Run the database seed.", 503);
  if (!agent.enabled) {
    throw new PromotionReviewError("The Marketer agent is currently disabled. Enable it in the Agents section.", 503);
  }
  return agent;
}

function hasSmtp(config: unknown): boolean {
  const cfg = getSubAgentConfig(config);
  return Boolean(cfg.smtpHost && cfg.smtpUser && cfg.smtpPassword && cfg.smtpFromEmail);
}

/** Keeps a business with the Marketer who already talks to it; otherwise the first one that can send email. */
export async function pickMarketerSubAgent(agentId: number, businessId: number) {
  const subAgents = await prisma.subAgent.findMany({
    where: { agentId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, config: true },
  });
  const sendable = subAgents.filter((sa) => hasSmtp(sa.config));
  const sendableIds = sendable.map((sa) => sa.id);
  const [previousDeal, previousSale] = await Promise.all([
    prisma.promotionDeal.findFirst({
      where: { businessId, subAgentId: { in: sendableIds } },
      orderBy: { createdAt: "desc" },
      select: { subAgentId: true, createdAt: true },
    }),
    prisma.promotionSale.findFirst({
      where: { businessId, subAgentId: { in: sendableIds } },
      orderBy: { createdAt: "desc" },
      select: { subAgentId: true, createdAt: true },
    }),
  ]);
  const previous =
    previousDeal && previousSale
      ? previousDeal.createdAt > previousSale.createdAt ? previousDeal : previousSale
      : previousDeal ?? previousSale;
  return sendable.find((sa) => sa.id === previous?.subAgentId) ?? sendable[0] ?? null;
}

type IssueChoice = { id: string; name: string; publicationDate: Date; publication: { id: number; name: string } };

/** The publication's rate card for one kind of content, in display order. */
export function listPublicationPackages(publicationId: number | null, target: PromotionTarget): Promise<PromotionPackageOffer[]> {
  if (publicationId === null) return Promise.resolve([]);
  return prisma.promotionPackage.findMany({
    where: { publicationId, kind: packageKindFor(target) },
    orderBy: [{ position: "asc" }, { priceCents: "asc" }],
    select: { id: true, kind: true, name: true, description: true, priceCents: true },
  });
}

/** Census population of the publication's ZIP codes, or null when no estimates are loaded. */
export async function publicationAudience(publicationId: number): Promise<number | null> {
  const { _sum } = await prisma.zipCode.aggregate({
    where: { publications: { some: { id: publicationId } } },
    _sum: { estimatedPopulation: true },
  });
  return _sum.estimatedPopulation || null;
}

/** Publication covering a business's ZIP code, used when the content is not assigned to an issue. */
async function publicationForZip(postalCode: string | null) {
  if (!postalCode) return null;
  return prisma.publication.findFirst({
    where: { zipCodes: { some: { code: postalCode } } },
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });
}

/** The soonest upcoming assigned issue, or the most recent one when all are past. */
function chooseIssue(issues: IssueChoice[]): IssueChoice | null {
  if (!issues.length) return null;
  const today = new Date(new Date().toISOString().slice(0, 10));
  const sorted = [...issues].sort((a, b) => a.publicationDate.getTime() - b.publicationDate.getTime());
  return sorted.find((issue) => issue.publicationDate >= today) ?? sorted[sorted.length - 1];
}

// ---------------------------------------------------------------------------
// Reading deals for pages
// ---------------------------------------------------------------------------

const promotionDealSummarySelect = {
  id: true,
  contentStatus: true,
  status: true,
  requestedChanges: true,
  packageName: true,
  priceCents: true,
  optedOut: true,
  followUpSentAt: true,
  lastInboundAt: true,
  signedUpAt: true,
  threadId: true,
  instructions: true,
  reviewToken: true,
  createdAt: true,
  advertisementId: true,
  articleId: true,
  business: { select: { id: true, name: true, email: true } },
  issue: { select: { id: true, name: true } },
  publication: { select: { id: true, name: true } },
  subAgent: { select: { id: true, name: true, agentId: true } },
  thread: { select: { _count: { select: { messages: true } } } },
  agentTask: { select: { status: true, registry: { select: { id: true } } } },
} satisfies Prisma.PromotionDealSelect;

export type PromotionDealSummary = Prisma.PromotionDealGetPayload<{ select: typeof promotionDealSummarySelect }>;

/** The most recent review/promotion conversation for an ad or article. */
export function getLatestPromotionDeal(where: { advertisementId: string } | { articleId: string }) {
  return prisma.promotionDeal.findFirst({ where, orderBy: { createdAt: "desc" }, select: promotionDealSummarySelect });
}

export function getPromotionDealByTask(agentTaskId: string) {
  return prisma.promotionDeal.findUnique({ where: { agentTaskId }, select: promotionDealSummarySelect });
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/**
 * Validates and records a review/promotion task for an ad or article, then sends the first email
 * in the background. Returns the registry task to answer the request with.
 */
export async function launchPromotionReview(
  user: AwaitedUser,
  target: PromotionTarget,
  targetId: string,
  /** Staff instructions for the Marketer, applied to every message in the conversation. */
  rawInstructions = "",
): Promise<RegistryTaskRef> {
  const instructions = rawInstructions.trim().slice(0, MAX_PROMOTION_INSTRUCTIONS);
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    throw new PromotionReviewError("You cannot submit content for advertiser review.", 403);
  }
  const agent = await getMarketerAgent();
  if (!process.env.CLAUDE_KEY) {
    throw new PromotionReviewError("Advertiser review is not configured (missing CLAUDE_KEY).", 503);
  }

  const issueSelect = {
    select: { issue: { select: { id: true, name: true, publicationDate: true, publication: { select: { id: true, name: true } } } } },
  } as const;
  const businessSelect = { select: { id: true, name: true, email: true, postalCode: true } } as const;
  let title: string;
  let business: { id: number; name: string; email: string | null; postalCode: string | null } | null;
  let issues: IssueChoice[];

  if (target === "ad") {
    const scope = await getAdvertisementScope(user);
    const ad = scope
      ? await prisma.advertisement.findFirst({
          where: { id: targetId, ...scope },
          select: { title: true, business: businessSelect, issues: issueSelect },
        })
      : null;
    if (!ad) throw new PromotionReviewError("Advertisement not found.", 404);
    title = ad.title;
    business = ad.business;
    issues = ad.issues.map(({ issue }) => issue);
  } else {
    const scope = await getArticleScope(user);
    const article = await prisma.article.findFirst({
      where: { id: targetId, ...scope },
      select: { title: true, promotionPackageId: true, business: businessSelect, issues: issueSelect },
    });
    if (!article) throw new PromotionReviewError("Article not found.", 404);
    if (!article.business) {
      throw new PromotionReviewError("Link this article to a business before submitting it for review.", 400);
    }
    // Only paid promotions go to the business for review; an unpaid article is sold with Promote instead.
    if (!article.promotionPackageId) {
      throw new PromotionReviewError("Only an article with a paid promotion style can be submitted for review. Use Promote to sell it first.", 409);
    }
    title = article.title;
    business = article.business;
    issues = article.issues.map(({ issue }) => issue);
  }
  if (!business?.email) {
    throw new PromotionReviewError(`${business?.name ?? "The business"} has no email address on record.`, 400);
  }

  const open = await prisma.promotionDeal.findFirst({
    where: {
      ...(target === "ad" ? { advertisementId: targetId } : { articleId: targetId }),
      agentTask: { status: { in: [AgentTaskStatus.PENDING, AgentTaskStatus.RUNNING] } },
    },
    select: { agentTask: { select: { registry: { select: { id: true } } } } },
  });
  if (open) {
    const taskId = open.agentTask.registry?.id;
    throw new PromotionReviewError(
      `A review is already in progress for this ${target === "ad" ? "ad" : "article"}${taskId ? ` (task #${taskId})` : ""}.`,
      409,
    );
  }

  const subAgent = await pickMarketerSubAgent(agent.id, business.id);
  if (!subAgent) {
    throw new PromotionReviewError("No Marketer sub agent has email sending configured. Configure one in the Agents section.", 503);
  }

  const issue = chooseIssue(issues);
  const publication = issue?.publication ?? (await publicationForZip(business.postalCode));
  const packages = await listPublicationPackages(publication?.id ?? null, target);
  const kind = target === "ad" ? "Ad" : "Article";
  const initialSteps: TaskStep[] = [
    step("info", `Submitting ${kind.toLowerCase()} "${title}" to ${business.name} for review`),
    step("info", `Assigned to ${subAgent.name} (Marketer) · recipient: ${business.email}`),
    step(
      "info",
      issue
        ? `Promotion target: ${issue.publication.name} · ${issue.name}`
        : `Not assigned to an issue — pitching the next issue of ${publication?.name ?? "the local publication"}`,
    ),
    packages.length
      ? step("info", `Rate card (${publication?.name}): ${packages.map((item) => `${item.name} ${formatCents(item.priceCents)}`).join(", ")}`)
      : step("error", `${publication?.name ?? "No publication"} has no ${kind.toLowerCase()} rates — the Marketer will not quote prices`),
    step(
      "info",
      instructions
        ? `Custom instructions: "${instructions.slice(0, 200)}${instructions.length > 200 ? "…" : ""}"`
        : "No custom instructions",
    ),
  ];
  // Ads get a public review page; the advertiser can also just reply by email.
  const reviewToken = target === "ad" ? newReviewToken() : null;
  if (reviewToken) initialSteps.push(step("info", "Online review link created for the advertiser (no login needed)"));

  const { agentTask, deal } = await prisma.$transaction(async (tx) => {
    const agentTask = await tx.agentTask.create({
      data: {
        agentId: agent.id,
        subAgentId: subAgent.id,
        status: AgentTaskStatus.RUNNING,
        label: `Advertiser review · ${kind} · ${title} · ${business.name}`,
        issueId: issue?.id ?? null,
        triggeredById: user.id,
        startedAt: new Date(),
        steps: initialSteps as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    const deal = await tx.promotionDeal.create({
      data: {
        agentTaskId: agentTask.id,
        businessId: business.id,
        advertisementId: target === "ad" ? targetId : null,
        articleId: target === "article" ? targetId : null,
        issueId: issue?.id ?? null,
        publicationId: publication?.id ?? null,
        subAgentId: subAgent.id,
        createdByUserId: user.id,
        instructions,
        reviewToken,
      },
      select: { id: true },
    });
    if (target === "ad") {
      // The review starts now, so a draft ad moves into review immediately
      await tx.advertisement.updateMany({
        where: { id: targetId, status: AdvertisementStatus.DRAFT },
        data: { status: AdvertisementStatus.IN_REVIEW },
      });
    }
    const result: PromotionTaskResult = { contentType: "promotion", dealId: deal.id, target, targetId };
    await tx.agentTask.update({ where: { id: agentTask.id }, data: { result: result as unknown as Prisma.InputJsonValue } });
    return { agentTask, deal };
  });

  after(() => sendInitialPromotionEmail(deal.id));

  return getRegistryTask({ agentTaskId: agentTask.id });
}

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

async function loadDeal(dealId: number) {
  return prisma.promotionDeal.findUnique({
    where: { id: dealId },
    include: {
      agentTask: { select: { id: true, status: true, steps: true } },
      business: { select: { id: true, name: true, email: true, primaryCategory: true, city: true, postalCode: true } },
      advertisement: {
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          creativeFileName: true,
          creativeMimeType: true,
          creativeOriginalName: true,
          styleName: true,
          costCents: true,
        },
      },
      article: {
        select: {
          id: true,
          title: true,
          body: true,
          promotionPackageId: true,
          styleName: true,
          images: {
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            take: MAX_ARTICLE_ATTACHMENTS,
            select: { fileName: true, originalName: true, mimeType: true },
          },
        },
      },
      issue: { select: { name: true, publicationDate: true } },
      publication: { select: { id: true, name: true } },
      subAgent: { select: { id: true, name: true, soul: true } },
    },
  });
}

type LoadedDeal = NonNullable<Awaited<ReturnType<typeof loadDeal>>>;

function publicationNameFor(deal: LoadedDeal): string {
  return deal.publication?.name ?? "your local publication";
}

function targetOf(deal: LoadedDeal): PromotionTarget {
  return deal.advertisement ? "ad" : "article";
}

/** A sponsored article already paid for (Promote sale, an earlier sign-up, or priced by staff). */
function isPaidArticle(deal: LoadedDeal): boolean {
  return Boolean(deal.article && (deal.article.promotionPackageId !== null || deal.article.styleName));
}

/** Ads and paid articles only need approval; other articles are reviewed and sold a package. */
function messageKindOf(deal: LoadedDeal): "ad" | "article" | "paid_article" {
  return deal.advertisement ? "ad" : isPaidArticle(deal) ? "paid_article" : "article";
}

/** Rates are read live from the publication so an updated rate card applies to the next message. */
function packagesOf(deal: LoadedDeal): Promise<PromotionPackageOffer[]> {
  // An ad's (or paid article's) price and placement are agreed before review, so nothing is offered.
  if (deal.advertisement || isPaidArticle(deal)) return Promise.resolve([]);
  return listPublicationPackages(deal.publicationId, targetOf(deal));
}

async function buildContext(deal: LoadedDeal, settings: PromotionSettings): Promise<string[]> {
  const publicationName = publicationNameFor(deal);
  const { business } = deal;
  const lines = [
    `Business: ${business.name}${business.primaryCategory ? ` (${business.primaryCategory})` : ""}${business.city ? ` in ${business.city}` : ""}.`,
    deal.issue
      ? `Issue: ${deal.issue.name} of ${publicationName}, publication date ${deal.issue.publicationDate.toISOString().slice(0, 10)}.`
      : `Issue: the next issue of ${publicationName} (no date set yet; do not promise one).`,
  ];
  if (deal.publicationId !== null && !deal.advertisement) {
    const audience = await publicationAudience(deal.publicationId);
    if (audience) {
      lines.push(
        `${publicationName} covers ZIP codes with about ${audience.toLocaleString("en-US")} residents (U.S. Census estimate). That is the area's population, not the print circulation; never present it as circulation or readership.`,
      );
    }
  }
  if (deal.advertisement) {
    lines.push(
      `Content under review: a display ad titled "${deal.advertisement.title}"${deal.advertisement.description ? `, copy: "${deal.advertisement.description}"` : ""}.`,
      "The sale is already agreed: the advertiser bought this ad's size, price and placement in the issue before the ad was created. Do not sell, quote prices or mention packages; your goal is their approval of the ad creative and a happy customer who advertises again.",
    );
    lines.push(
      deal.advertisement.styleName
        ? `The agreed ad size is "${deal.advertisement.styleName}". You may mention the size, never the price.`
        : "The ad size is agreed and on file with the publication team; do not name a size.",
      "The advertiser has nothing to choose or confirm about size, format, placement or price. Never list ad sizes or options, and never ask them to pick, confirm or change a size; if they ask to change it, say you will check with the publication team.",
    );
    lines.push(
      deal.advertisement.creativeFileName
        ? "The current ad artwork is attached to or shown with your message."
        : "The ad artwork is still being finalized; tell them it will be sent for approval as soon as it is ready.",
    );
  } else if (deal.article && isPaidArticle(deal)) {
    lines.push(
      `Content under review: a sponsored article about the business titled "${deal.article.title}".`,
      `The sale is already agreed: the business bought this sponsored feature${deal.article.styleName ? ` ("${deal.article.styleName}")` : ""} in the issue. Do not sell, quote prices or mention packages; your goal is their approval of the article.`,
    );
  } else if (deal.article) {
    lines.push(
      `Content under review: an article about the business titled "${deal.article.title}".`,
      "The paid option runs it as a sponsored feature with the business's logo and contact details.",
    );
  }
  if (deal.reviewToken) {
    lines.push(
      `Online review page for this ad (no login needed): ${reviewUrl(deal.reviewToken)} — the advertiser can approve the ad or request changes there, or simply reply by email. When your instructions say the review link is inserted automatically, do not write it yourself; otherwise give it exactly as written when you ask for their approval.`,
    );
  }
  // The ad-submission form is where new advertisers pick a size; an agreed ad never goes back there.
  if (settings.advertisingUrl && !deal.advertisement) {
    lines.push(`The ad-submission form for new or revised ad materials: ${settings.advertisingUrl}`);
  }
  lines.push(`Content review status so far: ${deal.contentStatus.toLowerCase().replace("_", " ")}.`);
  if (!deal.advertisement && !isPaidArticle(deal)) {
    lines.push(
      `Promotion status so far: ${deal.status.toLowerCase().replace("_", " ")}${deal.packageName ? ` (package: ${deal.packageName}${deal.priceCents != null ? `, ${formatCents(deal.priceCents)}` : ""})` : ""}.`,
    );
  }
  if (deal.optedOut) lines.push("They previously asked not to be contacted; only answer what they ask now.");
  if (deal.instructions.trim()) {
    lines.push(
      `Instructions from the publication team for this conversation (follow them, but never invent facts or break the rules above): ${deal.instructions.trim()}`,
    );
  }
  return lines;
}

/** Puts the content preview into the model's email, in place of the placeholder or at the end. */
function withContentPreview(deal: LoadedDeal, body: string, attached: number): string {
  // The review link goes in once: leave it out of the preview when the model already wrote it.
  const linkWritten = Boolean(deal.reviewToken && body.includes(reviewUrl(deal.reviewToken)));
  const preview = contentPreview(deal, attached, !linkWritten);
  return body.includes(CONTENT_PLACEHOLDER) ? body.replace(CONTENT_PLACEHOLDER, preview) : `${body}\n\n${preview}`;
}

function contentPreview(deal: LoadedDeal, attached: number, includeReviewLink: boolean): string {
  if (deal.advertisement) {
    const ad = deal.advertisement;
    return [
      `----- Your ad: "${ad.title}" -----`,
      `Headline: ${ad.title}`,
      ad.description ? `Copy: ${ad.description}` : null,
      attached ? "The ad artwork is attached to this email." : "The ad artwork is still being finalized; we'll send it for approval too.",
      deal.reviewToken && includeReviewLink
        ? `Review and approve your ad online, or request changes: ${reviewUrl(deal.reviewToken)}`
        : null,
      "-----",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const article = deal.article!;
  return [
    `----- Your article: "${article.title}" -----`,
    article.body.trim(),
    attached ? `${attached} photo${attached === 1 ? " is" : "s are"} attached to this email.` : null,
    "-----",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function attachmentsFor(deal: LoadedDeal) {
  if (deal.advertisement?.creativeFileName && deal.advertisement.creativeMimeType) {
    return [
      {
        filename: deal.advertisement.creativeOriginalName ?? deal.advertisement.creativeFileName,
        path: resolve(adCreativeDirectory, deal.advertisement.creativeFileName),
        contentType: deal.advertisement.creativeMimeType,
      },
    ];
  }
  return (deal.article?.images ?? []).map((image) => ({
    filename: image.originalName,
    path: resolve(articleImageDirectory, image.fileName),
    contentType: image.mimeType,
  }));
}

function statusLabel(status: AdvertisementStatus): string {
  return status === AdvertisementStatus.IN_REVIEW ? "In review" : status.charAt(0) + status.slice(1).toLowerCase();
}

/** Requested changes are kept newest last, each with a UTC timestamp. */
function appendRequestedChanges(previous: string | null, changes: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return [previous, `${stamp} UTC\n${changes}`].filter(Boolean).join("\n\n");
}

/** Appends steps to the task log and applies extra task fields in one write. */
async function updateTask(
  agentTaskId: string,
  newSteps: TaskStep[],
  data: Prisma.AgentTaskUpdateInput = {},
): Promise<void> {
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

export async function sendInitialPromotionEmail(dealId: number): Promise<void> {
  const deal = await loadDeal(dealId);
  if (!deal) return;
  const agentTaskId = deal.agentTask.id;
  try {
    if (deal.agentTask.status !== AgentTaskStatus.RUNNING) return;
    if (!deal.subAgent) throw new Error("The assigned Marketer sub agent no longer exists.");
    if (!deal.business.email) throw new Error(`${deal.business.name} has no email address on record.`);

    const agent = await getMarketerAgent();
    const settings = getPromotionSettings(agent.settings);
    const target = targetOf(deal);
    const emailKind = target === "ad" ? "Ad approval" : isPaidArticle(deal) ? "Article approval" : "Review and proposal";
    const attachments = attachmentsFor(deal);

    await updateTask(agentTaskId, [
      step("info", `Calling ${settings.model} to write the ${emailKind.toLowerCase()} email`),
    ]);
    const message = await generateMarketerMessage({
      mode: "initial",
      kind: messageKindOf(deal),
      model: settings.model,
      agent: deal.subAgent,
      recipientName: deal.business.name,
      context: await buildContext(deal, settings),
      packages: await packagesOf(deal),
      messages: [],
    });
    if (!message) throw new Error("The model returned no usable email.");

    const body = withContentPreview(deal, message.body, attachments.length);
    const title = deal.advertisement?.title ?? deal.article?.title ?? "your content";
    const subject =
      message.subject ||
      (target === "ad"
        ? `Your ad for ${publicationNameFor(deal)} is ready for your approval: "${title}"`
        : `Please review your feature for ${publicationNameFor(deal)}: "${title}"`);

    const sent = await sendSubAgentEmail({
      subAgentId: deal.subAgent.id,
      taskId: agentTaskId,
      toEmail: deal.business.email,
      toName: deal.business.name,
      subject,
      bodyText: body,
      attachments,
    });

    await prisma.promotionDeal.update({
      where: { id: deal.id },
      data: { threadId: sent.threadId, sentCreativeFileName: deal.advertisement?.creativeFileName ?? null },
    });
    if (deal.advertisement && deal.advertisement.status === AdvertisementStatus.DRAFT) {
      await prisma.advertisement.update({
        where: { id: deal.advertisement.id },
        data: { status: AdvertisementStatus.IN_REVIEW },
      });
    }
    await updateTask(agentTaskId, [
      step(
        "success",
        `${emailKind} email sent to ${sent.sentTo}${sent.sentTo !== deal.business.email ? ` (DUMMY_EMAIL override for ${deal.business.email})` : ""}${attachments.length ? ` with ${attachments.length} attachment(s)` : ""}`,
      ),
      ...(deal.advertisement?.status === AdvertisementStatus.DRAFT ? [step("info", "Ad status set to In review")] : []),
      step(
        "info",
        target === "ad"
          ? "Waiting for the advertiser's approval — on the review page or by email reply; the Marketer answers automatically until the ad is approved"
          : "Waiting for the advertiser's reply — the Marketer answers automatically",
      ),
    ]);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.error(`[PromotionDeal] first email for deal ${dealId} failed:`, error);
    await updateTask(agentTaskId, [step("error", `Failed: ${messageText}`)], {
      status: AgentTaskStatus.FAILED,
      error: messageText,
      completedAt: new Date(),
    }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

/** True when the IMAP poller should leave this thread to the promotion (review or Promote sale) handlers. */
export async function isPromotionThread(threadId: string): Promise<boolean> {
  const [deals, sales] = await Promise.all([
    prisma.promotionDeal.count({ where: { threadId } }),
    prisma.promotionSale.count({ where: { threadId } }),
  ]);
  return deals + sales > 0;
}

/**
 * Answers the advertiser's latest message on a promotion thread and records what they decided:
 * content approval or changes, interest, a package sign-up, or a decline.
 */
export async function handlePromotionInboundMessage(threadId: string): Promise<void> {
  const found = await prisma.promotionDeal.findUnique({ where: { threadId }, select: { id: true } });
  if (!found) return;
  const deal = await loadDeal(found.id);
  if (!deal) return;
  const agentTaskId = deal.agentTask.id;

  try {
    const taskStatus = deal.agentTask.status;
    const isAd = Boolean(deal.advertisement);
    // Ads and paid articles are already sold: approval completes the conversation and nothing is sold.
    const saleAgreed = isAd || isPaidArticle(deal);
    // Staff stopped the conversation (a decline also stops it, but the advertiser may come back).
    if (taskStatus === AgentTaskStatus.FAILED) return;
    if (taskStatus === AgentTaskStatus.STOPPED && deal.status !== PromotionDealStatus.DECLINED) return;

    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      select: { toEmail: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    const last = thread?.messages[thread.messages.length - 1];
    if (!thread || !last || last.direction !== MessageDirection.INBOUND) return;

    await prisma.promotionDeal.update({ where: { id: deal.id }, data: { lastInboundAt: last.receivedAt ?? last.createdAt } });
    const newSteps: TaskStep[] = [step("info", `Reply received from ${thread.toEmail}`)];

    if (!deal.subAgent) {
      await updateTask(agentTaskId, [...newSteps, step("error", "Not answered — the assigned Marketer sub agent no longer exists")]);
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { slug: "marketer" }, select: { settings: true } });
    const settings = getPromotionSettings(agent?.settings);
    const packages = await packagesOf(deal);

    let message: MarketerMessage | null = null;
    let failure = "CLAUDE_KEY not set or empty model response";
    try {
      message = await generateMarketerMessage({
        mode: "reply",
        kind: messageKindOf(deal),
        model: settings.model,
        agent: deal.subAgent,
        recipientName: deal.business.name,
        context: await buildContext(deal, settings),
        packages,
        messages: thread.messages,
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (!message) {
      // A canned answer that ignores what they said does more harm than no answer.
      await updateTask(agentTaskId, [...newSteps, step("error", `Not answered — AI reply failed: ${failure}`)]);
      return;
    }

    await sendSubAgentEmail({
      subAgentId: deal.subAgent.id,
      toEmail: thread.toEmail,
      toName: deal.business.name,
      bodyText: message.body,
      existingThreadId: threadId,
    });
    newSteps.push(step("success", `${deal.subAgent.name} replied`));

    const dealData: Prisma.PromotionDealUpdateInput = {};
    let taskData: Prisma.AgentTaskUpdateInput = {};

    // Ad verdicts are also kept as reviews on the ad (its Reviews tab), which move the ad's status.
    const recordEmailReview = async (decision: AdReviewDecision, comments: string) => {
      if (!deal.advertisement) return;
      const { statusChange } = await recordAdReview(prisma, {
        advertisementId: deal.advertisement.id,
        promotionDealId: deal.id,
        source: AdReviewSource.EMAIL,
        decision,
        comments,
      });
      if (statusChange) newSteps.push(step("info", `Ad status set to ${statusLabel(statusChange)}`));
    };

    if (message.contentFeedback === "approved" && deal.contentStatus !== PromotionContentStatus.APPROVED) {
      dealData.contentStatus = PromotionContentStatus.APPROVED;
      newSteps.push(step("success", "Advertiser approved the content"));
      await recordEmailReview(AdReviewDecision.APPROVED, message.requestedChanges);
      // The sale is already agreed, so approval is what completes the conversation.
      if (saleAgreed) {
        taskData = { status: AgentTaskStatus.SUCCEEDED, completedAt: new Date(), error: null };
        newSteps.push(step("success", `${isAd ? "Ad" : "Article"} approved — conversation complete (the Marketer keeps answering if they write again)`));
      }
    } else if (message.contentFeedback === "changes_requested") {
      dealData.contentStatus = PromotionContentStatus.CHANGES_REQUESTED;
      const changes = message.requestedChanges || "(see the conversation)";
      dealData.requestedChanges = appendRequestedChanges(deal.requestedChanges, changes);
      newSteps.push(step("info", `Advertiser requested changes: ${changes.replace(/\s+/g, " ").slice(0, 300)}`));
      await recordEmailReview(AdReviewDecision.CHANGES_REQUESTED, changes);
      // Changes after an approval reopen the conversation until the ad is approved again.
      if (saleAgreed && taskStatus === AgentTaskStatus.SUCCEEDED) {
        taskData = { status: AgentTaskStatus.RUNNING, completedAt: null };
        newSteps.push(step("info", `Conversation reopened — waiting for a revised ${isAd ? "ad" : "article"} to be approved`));
      }
    }

    const chosen = saleAgreed ? undefined : packages.find((item) => String(item.id) === message.packageKey);
    if (saleAgreed) {
      // No package sale on ads or paid articles. Only a cancellation or an opt-out changes the deal.
      if (message.dealDecision === "declined" || message.optedOut) {
        Object.assign(dealData, { status: PromotionDealStatus.DECLINED, ...(message.optedOut ? { optedOut: true } : {}) });
        newSteps.push(
          step(
            "info",
            message.optedOut
              ? "Advertiser asked not to be contacted again — conversation stopped"
              : `Advertiser wants to cancel the ${isAd ? "ad" : "sponsored article"} — conversation stopped; contact them from the publication team`,
          ),
        );
        taskData = { status: AgentTaskStatus.STOPPED, completedAt: new Date() };
      } else if (taskStatus === AgentTaskStatus.STOPPED && !taskData.status) {
        // A declined advertiser who writes again reopens the conversation.
        dealData.status = PromotionDealStatus.PROPOSED;
        if (message.contentFeedback !== "approved") taskData = { status: AgentTaskStatus.RUNNING, completedAt: null };
      }
    } else if (message.dealDecision === "signed_up" && chosen) {
      if (deal.status !== PromotionDealStatus.SIGNED_UP || deal.packageId !== chosen.id) {
        Object.assign(dealData, {
          status: PromotionDealStatus.SIGNED_UP,
          package: { connect: { id: chosen.id } },
          packageName: chosen.name,
          priceCents: chosen.priceCents,
          signedUpAt: new Date(),
          optedOut: false,
        });
        newSteps.push(step("success", `Advertiser signed up for ${chosen.name} at ${formatCents(chosen.priceCents)} — agreement and invoice to be sent by the publication team`));
        // The article now runs as the sponsored feature they bought, priced as agreed.
        if (deal.article) {
          await prisma.article.update({
            where: { id: deal.article.id },
            data: { promotionPackageId: chosen.id, styleName: chosen.name, costCents: chosen.priceCents },
          });
          newSteps.push(step("info", `Article marked as a paid promotion: ${chosen.name}, ${formatCents(chosen.priceCents)}`));
        }
        taskData = { status: AgentTaskStatus.SUCCEEDED, completedAt: new Date(), error: null };
      }
    } else if (message.dealDecision === "declined" || message.optedOut) {
      Object.assign(dealData, { status: PromotionDealStatus.DECLINED, ...(message.optedOut ? { optedOut: true } : {}) });
      newSteps.push(step("info", message.optedOut ? "Advertiser asked not to be contacted again — conversation stopped" : "Advertiser declined the promotion"));
      if (taskStatus === AgentTaskStatus.RUNNING) taskData = { status: AgentTaskStatus.STOPPED, completedAt: new Date() };
    } else if (message.dealDecision === "interested" || message.dealDecision === "signed_up") {
      if (deal.status !== PromotionDealStatus.SIGNED_UP) {
        dealData.status = PromotionDealStatus.INTERESTED;
        if (chosen) {
          Object.assign(dealData, { package: { connect: { id: chosen.id } }, packageName: chosen.name, priceCents: chosen.priceCents });
        }
        newSteps.push(step("info", `Advertiser is interested${chosen ? ` in ${chosen.name}` : ""}${message.dealDecision === "signed_up" ? " (no valid package confirmed yet)" : ""}`));
      }
      // A declined advertiser who comes back reopens the conversation.
      if (taskStatus === AgentTaskStatus.STOPPED) taskData = { status: AgentTaskStatus.RUNNING, completedAt: null };
    }

    if (Object.keys(dealData).length) await prisma.promotionDeal.update({ where: { id: deal.id }, data: dealData });
    await updateTask(agentTaskId, newSteps, taskData);
  } catch (error) {
    console.error(`[PromotionDeal] handlePromotionInboundMessage failed for thread ${threadId}:`, error);
    await updateTask(agentTaskId, [
      step("error", `Reply handling failed: ${error instanceof Error ? error.message : String(error)}`),
    ]).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Online review page
// ---------------------------------------------------------------------------

export class AdReviewSubmissionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Records a review the advertiser submitted on the public review page, without a login: the
 * token is the credential. The Marketer then acknowledges it by email in the background.
 */
export async function submitAdReviewFromPage(
  token: string,
  input: { decision: AdReviewDecision; comments: string; reviewerName: string },
): Promise<void> {
  const comments = input.comments.trim();
  const reviewerName = input.reviewerName.trim();
  if (comments.length > MAX_REVIEW_COMMENTS) {
    throw new AdReviewSubmissionError(`Keep your comments under ${MAX_REVIEW_COMMENTS} characters.`, 400);
  }
  if (reviewerName.length > MAX_REVIEWER_NAME) {
    throw new AdReviewSubmissionError(`Keep your name under ${MAX_REVIEWER_NAME} characters.`, 400);
  }
  if (input.decision === AdReviewDecision.CHANGES_REQUESTED && !comments) {
    throw new AdReviewSubmissionError("Describe the changes you would like.", 400);
  }

  const deal = await prisma.promotionDeal.findUnique({
    where: { reviewToken: token },
    select: {
      id: true,
      advertisementId: true,
      status: true,
      contentStatus: true,
      requestedChanges: true,
      agentTask: { select: { id: true, status: true } },
      _count: { select: { adReviews: true } },
    },
  });
  if (!deal?.advertisementId) throw new AdReviewSubmissionError("This review link is not valid.", 404);
  const state = await reviewLinkState(deal);
  if (state !== "open") {
    throw new AdReviewSubmissionError(
      state === "superseded"
        ? "A newer review link was sent for this ad. Please use the link in the latest email."
        : "This review is closed. Please reply to the email from the publication team instead.",
      410,
    );
  }
  if (deal._count.adReviews >= MAX_REVIEWS_PER_DEAL) {
    throw new AdReviewSubmissionError("This review link has reached its limit. Please reply by email instead.", 429);
  }

  const approved = input.decision === AdReviewDecision.APPROVED;
  const advertisementId = deal.advertisementId;
  const { reviewId, statusChange } = await prisma.$transaction(async (tx) => {
    const recorded = await recordAdReview(tx, {
      advertisementId,
      promotionDealId: deal.id,
      source: AdReviewSource.REVIEW_PAGE,
      decision: input.decision,
      comments,
      reviewerName,
    });
    await tx.promotionDeal.update({
      where: { id: deal.id },
      data: {
        contentStatus: approved ? PromotionContentStatus.APPROVED : PromotionContentStatus.CHANGES_REQUESTED,
        // A review is an answer, so no "no reply yet" follow-up is due.
        lastInboundAt: new Date(),
        ...(approved ? {} : { requestedChanges: appendRequestedChanges(deal.requestedChanges, comments) }),
      },
    });
    return recorded;
  });

  await updateTask(deal.agentTask.id, [
    approved
      ? step("success", `Advertiser approved the ad on the review page${reviewerName ? ` (${reviewerName})` : ""}${comments ? `: ${comments.replace(/\s+/g, " ").slice(0, 300)}` : ""}`)
      : step("info", `Advertiser requested changes on the review page${reviewerName ? ` (${reviewerName})` : ""}: ${comments.replace(/\s+/g, " ").slice(0, 300)}`),
    ...(statusChange ? [step("info", `Ad status set to ${statusLabel(statusChange)}`)] : []),
    ...(approved
      ? [step("success", "Ad approved — conversation complete (the Marketer keeps answering if they write again)")]
      : deal.agentTask.status === AgentTaskStatus.SUCCEEDED
        ? [step("info", "Conversation reopened — waiting for a revised ad to be approved")]
        : []),
  ], approved
    ? { status: AgentTaskStatus.SUCCEEDED, completedAt: new Date(), error: null }
    : deal.agentTask.status === AgentTaskStatus.SUCCEEDED || deal.agentTask.status === AgentTaskStatus.STOPPED
      ? { status: AgentTaskStatus.RUNNING, completedAt: null }
      : {});

  after(() => acknowledgeAdReview(deal.id, reviewId));
}

/** The Marketer's email answer to a review submitted on the review page. */
async function acknowledgeAdReview(dealId: number, reviewId: number): Promise<void> {
  const deal = await loadDeal(dealId);
  if (!deal) return;
  const agentTaskId = deal.agentTask.id;
  try {
    const review = await prisma.adReview.findUnique({
      where: { id: reviewId },
      select: { decision: true, comments: true, reviewerName: true },
    });
    if (!review) return;
    if (!deal.threadId || !deal.subAgent || !deal.business.email) {
      await updateTask(agentTaskId, [step("error", "Review not acknowledged by email — no conversation thread or Marketer to send from")]);
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { slug: "marketer" }, select: { settings: true } });
    const settings = getPromotionSettings(agent?.settings);
    const thread = await prisma.emailThread.findUnique({
      where: { id: deal.threadId },
      select: { messages: { orderBy: { createdAt: "asc" } } },
    });
    const event = [
      `Decision: ${AD_REVIEW_DECISION_LABELS[review.decision]}`,
      review.reviewerName ? `Name given: ${review.reviewerName}` : null,
      review.comments ? `Comments: ${review.comments}` : "Comments: (none)",
    ]
      .filter(Boolean)
      .join("\n");

    const message = await generateMarketerMessage({
      mode: "review_received",
      kind: "ad",
      model: settings.model,
      agent: deal.subAgent,
      recipientName: deal.business.name,
      context: await buildContext(deal, settings),
      packages: await packagesOf(deal),
      messages: thread?.messages ?? [],
      event,
    });
    // The review is already recorded; a canned acknowledgement adds nothing the page did not show.
    if (!message) throw new Error("AI reply failed: CLAUDE_KEY not set or empty model response");

    await sendSubAgentEmail({
      subAgentId: deal.subAgent.id,
      toEmail: deal.business.email,
      toName: deal.business.name,
      bodyText: message.body,
      existingThreadId: deal.threadId,
    });
    await updateTask(agentTaskId, [step("success", `${deal.subAgent.name} acknowledged the review by email`)]);
  } catch (error) {
    console.error(`[PromotionDeal] review acknowledgement for deal ${dealId} failed:`, error);
    await updateTask(agentTaskId, [
      step("error", `Review acknowledgement failed: ${error instanceof Error ? error.message : String(error)}`),
    ]).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Revised artwork
// ---------------------------------------------------------------------------

/**
 * Called after staff set a new creative on an ad: the Marketer emails the advertiser the revised
 * version on the same thread and asks for approval again. Runs in the background.
 */
export function scheduleAdArtworkNotification(advertisementId: string): void {
  after(() => notifyAdArtworkChanged(advertisementId));
}

async function notifyAdArtworkChanged(advertisementId: string): Promise<void> {
  const latest = await prisma.promotionDeal.findFirst({
    where: { advertisementId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return;
  const deal = await loadDeal(latest.id);
  if (!deal?.advertisement || !deal.threadId || !deal.subAgent || !deal.business.email) return;
  const ad = deal.advertisement;
  // Each artwork is sent once; the first email already carries the artwork of that time.
  if (!ad.creativeFileName || ad.creativeFileName === deal.sentCreativeFileName) return;
  const agentTaskId = deal.agentTask.id;
  const taskStatus = deal.agentTask.status;
  if (deal.optedOut || taskStatus === AgentTaskStatus.FAILED || taskStatus === AgentTaskStatus.STOPPED) return;

  try {
    const agent = await prisma.agent.findUnique({ where: { slug: "marketer" }, select: { enabled: true, settings: true } });
    if (!agent?.enabled) return;
    const settings = getPromotionSettings(agent.settings);
    const thread = await prisma.emailThread.findUnique({
      where: { id: deal.threadId },
      select: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!thread) return;

    const requested = await prisma.adReview.findMany({
      where: { advertisementId, decision: AdReviewDecision.CHANGES_REQUESTED },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      select: { comments: true },
    });
    const event =
      requested
        .reverse()
        .map((review, index) => `${index + 1}. ${review.comments.replace(/\s+/g, " ").slice(0, 600) || "(no details)"}`)
        .join("\n") ||
      "(They have not asked for changes. This is a new version of the artwork, so present it as their ad being ready for approval; do not say it was revised after feedback.)";

    const message = await generateMarketerMessage({
      mode: "revised",
      kind: "ad",
      model: settings.model,
      agent: deal.subAgent,
      recipientName: deal.business.name,
      context: await buildContext(deal, settings),
      packages: [],
      messages: thread.messages,
      event,
    });
    // Not marked as sent, so setting the creative again retries it.
    if (!message) throw new Error("AI email failed: CLAUDE_KEY not set or empty model response");

    const attachments = attachmentsFor(deal);
    const body = withContentPreview(deal, message.body, attachments.length);

    const sent = await sendSubAgentEmail({
      subAgentId: deal.subAgent.id,
      toEmail: deal.business.email,
      toName: deal.business.name,
      bodyText: body,
      existingThreadId: deal.threadId,
      attachments,
    });

    // The revised artwork needs a fresh approval, so the conversation is open again.
    await prisma.promotionDeal.update({
      where: { id: deal.id },
      data: { sentCreativeFileName: ad.creativeFileName, contentStatus: PromotionContentStatus.PENDING },
    });
    const adReopened = ad.status === AdvertisementStatus.APPROVED || ad.status === AdvertisementStatus.DRAFT;
    if (adReopened) {
      await prisma.advertisement.update({ where: { id: ad.id }, data: { status: AdvertisementStatus.IN_REVIEW } });
    }
    await updateTask(
      agentTaskId,
      [
        step(
          "success",
          `Revised ad sent to ${sent.sentTo}${sent.sentTo !== deal.business.email ? ` (DUMMY_EMAIL override for ${deal.business.email})` : ""} — waiting for approval`,
        ),
        ...(adReopened ? [step("info", "Ad status set to In review")] : []),
      ],
      taskStatus === AgentTaskStatus.SUCCEEDED ? { status: AgentTaskStatus.RUNNING, completedAt: null } : {},
    );
  } catch (error) {
    console.error(`[PromotionDeal] revised-ad email for deal ${deal.id} failed:`, error);
    await updateTask(agentTaskId, [
      step("error", `Revised ad could not be sent: ${error instanceof Error ? error.message : String(error)}`),
    ]).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

/** Unanswered emails in a row after which the Marketer stops nudging an ad conversation (first email + 2 nudges). */
const MAX_AD_OUTBOUND_IN_A_ROW = 3;

/**
 * Nudges advertisers who have not answered. Articles get one follow-up when they never replied.
 * Ads, whose goal is the approval, are nudged again after each unanswered email (a revised version
 * included), up to MAX_AD_OUTBOUND_IN_A_ROW unanswered emails, until the ad is approved.
 */
export async function checkPromotionFollowUps(): Promise<void> {
  const agent = await prisma.agent.findUnique({ where: { slug: "marketer" }, select: { enabled: true, settings: true } });
  if (!agent?.enabled) return;
  const settings = getPromotionSettings(agent.settings);
  if (settings.followUpDays <= 0) return;
  const cutoff = new Date(Date.now() - settings.followUpDays * MS_PER_DAY);

  const due = await prisma.promotionDeal.findMany({
    where: {
      threadId: { not: null },
      optedOut: false,
      agentTask: { status: AgentTaskStatus.RUNNING },
      OR: [
        { advertisementId: null, lastInboundAt: null, followUpSentAt: null, createdAt: { lte: cutoff } },
        { advertisementId: { not: null }, contentStatus: { not: PromotionContentStatus.APPROVED } },
      ],
    },
    select: { id: true },
  });

  for (const { id } of due) {
    const deal = await loadDeal(id);
    if (!deal?.threadId || !deal.subAgent || !deal.business.email) continue;
    try {
      const thread = await prisma.emailThread.findUnique({
        where: { id: deal.threadId },
        select: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!thread?.messages.length) continue;

      const isAd = Boolean(deal.advertisement);
      if (isAd) {
        const last = thread.messages[thread.messages.length - 1];
        if (last.direction !== MessageDirection.OUTBOUND) continue;
        if ((last.sentAt ?? last.createdAt) > cutoff) continue;
        let unanswered = 0;
        for (let i = thread.messages.length - 1; i >= 0 && thread.messages[i].direction === MessageDirection.OUTBOUND; i--) {
          unanswered += 1;
        }
        if (unanswered >= MAX_AD_OUTBOUND_IN_A_ROW) continue;
      } else if (thread.messages.some((msg) => msg.direction === MessageDirection.INBOUND)) {
        continue;
      }

      const message = await generateMarketerMessage({
        mode: "follow_up",
        kind: messageKindOf(deal),
        model: settings.model,
        agent: deal.subAgent,
        recipientName: deal.business.name,
        context: await buildContext(deal, settings),
        packages: await packagesOf(deal),
        messages: thread.messages,
      });
      // No canned nudge: without the model the follow-up waits for the next check.
      if (!message) {
        console.warn(`[PromotionDeal] follow-up for deal ${id} not sent: CLAUDE_KEY not set or empty model response`);
        continue;
      }

      await sendSubAgentEmail({
        subAgentId: deal.subAgent.id,
        toEmail: deal.business.email,
        toName: deal.business.name,
        bodyText: message.body,
        existingThreadId: deal.threadId,
      });
      await prisma.promotionDeal.update({ where: { id: deal.id }, data: { followUpSentAt: new Date() } });
      await updateTask(deal.agentTask.id, [
        step("info", `No reply after ${settings.followUpDays} day(s) — follow-up sent`),
      ]);
    } catch (error) {
      console.error(`[PromotionDeal] follow-up for deal ${id} failed:`, error);
    }
  }
}

import "server-only";
import { ReachoutTaskStatus } from "@prisma/client";
import { COMPANY_BRIEF, generateAssistantReply, INLINE_REPLY_NOTE, renderTranscript, type ThreadMessage } from "@/lib/assistant-reply";
import { draftContributorEmail } from "@/lib/contributor-email";
import { sendSubAgentEmail, getSubAgentConfig } from "@/lib/sub-agent-email";
import { prisma } from "@/lib/db";

const REMINDER_1_DAYS = 2;
const REMINDER_2_DAYS = 5;
const MS_PER_DAY = 86_400_000;
const DEFAULT_ONBOARDING_MODEL = "claude-sonnet-5-5";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAssistantSettings(): Promise<Record<string, unknown>> {
  const agent = await prisma.agent.findUnique({
    where: { slug: "assistant" },
    select: { settings: true },
  });
  return (agent?.settings as Record<string, unknown>) ?? {};
}

async function getOrCreateClaimToken(businessId: number): Promise<string> {
  const existing = await prisma.businessClaimToken.findFirst({
    where: { businessId, usedAt: null },
    select: { token: true },
  });
  if (existing) return existing.token;
  const created = await prisma.businessClaimToken.create({
    data: { businessId },
    select: { token: true },
  });
  return created.token;
}

function buildClaimUrl(token: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/register?claim=${encodeURIComponent(token)}`;
}

/** First Assistant sub agent with working SMTP, used to email submitters and businesses. */
export async function findAssistantSubAgent(): Promise<{ id: number; name: string; soul: string } | null> {
  const agent = await prisma.agent.findUnique({
    where: { slug: "assistant" },
    select: { subAgents: { select: { id: true, name: true, soul: true, config: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!agent) return null;
  for (const sa of agent.subAgents) {
    const cfg = getSubAgentConfig(sa.config);
    if (cfg.smtpHost && cfg.smtpUser && cfg.smtpPassword && cfg.smtpFromEmail) {
      return { id: sa.id, name: sa.name, soul: sa.soul };
    }
  }
  return null;
}

async function resolvePublicationName(postalCode: string | null): Promise<string> {
  if (!postalCode) return "your local publication";
  const pub = await prisma.publication.findFirst({
    where: { zipCodes: { some: { code: postalCode } } },
    select: { name: true },
  });
  return pub?.name ?? "your local publication";
}

/** What we know about a business and its history with us, as prompt lines for Claude. */
async function describeBusiness(businessId: number): Promise<string[]> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      primaryCategory: true,
      categories: true,
      description: true,
      city: true,
      stateCode: true,
      website: true,
      submissions: { orderBy: { createdAt: "desc" }, take: 3, select: { title: true } },
      articles: { orderBy: { createdAt: "desc" }, take: 3, select: { title: true, status: true } },
      _count: { select: { submissions: true, articles: true, ads: true } },
    },
  });
  if (!business) return [];
  const otherCategories = business.categories.filter((category) => category !== business.primaryCategory).slice(0, 6);
  return [
    `Business: ${business.name}`,
    business.primaryCategory ? `Main category: ${business.primaryCategory}` : "",
    otherCategories.length ? `Other categories: ${otherCategories.join(", ")}` : "",
    business.city ? `Location: ${[business.city, business.stateCode].filter(Boolean).join(", ")}` : "",
    business.website ? `Website: ${business.website}` : "",
    business.description ? `Description (from public sources): ${business.description.slice(0, 400)}` : "",
    business._count.submissions
      ? `Residents have sent ${business._count.submissions} community story submission(s) about them, e.g. ${business.submissions.map((s) => `"${s.title}"`).join(", ")}`
      : "",
    business._count.articles
      ? `Articles about them: ${business.articles.map((a) => `"${a.title}" (${a.status.toLowerCase()})`).join(", ")}`
      : "",
    business._count.ads ? `They have ${business._count.ads} advertisement record(s) with us.` : "",
    "Their information was gathered from public sources; there has been no other contact unless the conversation below shows it.",
  ].filter(Boolean);
}

type OnboardingEmailKind = "initial" | "reminder1" | "reminder2";

const ONBOARDING_GOALS: Record<OnboardingEmailKind, string> = {
  initial:
    "This is the first email to them. Introduce yourself and the publication, explain that their business is already listed in the local directory, and invite them to claim the listing for free. Make it clear why it could matter to this specific business.",
  reminder1:
    "This is a friendly follow-up a couple of days after your first email, which got no answer. Do not repeat the first email; add one new, relevant angle for this business and re-share the claim link.",
  reminder2:
    "This is your last follow-up; you will not email them again about this. Keep it short and gracious, make clear there is no obligation and their listing stays as is, and re-share the claim link once.",
};

/**
 * Has Claude write one onboarding email (first contact or reminder) to a business owner, in the
 * sub agent's persona, from the business details, its history with us and the thread so far.
 * Throws when Claude is not configured or returns nothing usable — no fixed text is sent instead.
 */
async function writeOnboardingEmail({
  kind,
  businessId,
  publicationName,
  registrationUrl,
  subAgent,
  thread,
}: {
  kind: OnboardingEmailKind;
  businessId: number;
  publicationName: string;
  registrationUrl: string;
  subAgent: { name: string; soul: string };
  thread?: ThreadMessage[];
}): Promise<{ subject: string; body: string }> {
  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) throw new Error("CLAUDE_KEY is not set — onboarding emails are written by Claude, so nothing was sent.");

  const settings = await getAssistantSettings();
  const onboarding = (settings.onboarding as Record<string, unknown> | undefined) ?? {};
  const model = typeof onboarding.model === "string" ? onboarding.model : DEFAULT_ONBOARDING_MODEL;
  const guidance = typeof onboarding.instructions === "string" ? onboarding.instructions.trim() : "";
  const facts = await describeBusiness(businessId);
  const firstName = subAgent.name.split(/\s+/)[0];

  const system = [
    `You are ${subAgent.name}, part of the local publication team at Best Version Media, writing to a local business owner.`,
    subAgent.soul ? `Your persona: ${subAgent.soul}` : "",
    COMPANY_BRIEF,
    "Write like a real neighbor from the publication team: plain words, short paragraphs, specific to this business, no marketing buzzwords or brochure bullet lists. Never invent prices, statistics, deadlines or facts about the business. Plain text only.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return draftContributorEmail({
    apiKey,
    model,
    system,
    requiredLink: registrationUrl,
    prompt: `Write an email to the owner of this business about their listing in ${publicationName}.

What we know about them:
${facts.map((line) => `- ${line}`).join("\n")}

${ONBOARDING_GOALS[kind]}
Their personal claim link (include it once, on its own line, exactly as written): ${registrationUrl}
${thread?.length ? `\nThe conversation so far, oldest first:\n${renderTranscript(thread, subAgent.name, "The business")}\n${INLINE_REPLY_NOTE}\n` : ""}${guidance ? `\nGuidance from the publication team (follow it):\n${guidance}\n` : ""}
Keep it under ${kind === "reminder2" ? 110 : 170} words. Sign off with a short closing and your first name, ${firstName}; your full email signature is added automatically.`,
  });
}

// ---------------------------------------------------------------------------
// Core: run a single reachout task
// ---------------------------------------------------------------------------

export async function runReachoutTask(taskId: string): Promise<void> {
  try {
    const task = await prisma.reachoutTask.findUnique({
      where: { id: taskId },
      include: {
        business: { select: { id: true, name: true, email: true, postalCode: true, ownerUserId: true } },
      },
    });
    if (!task || task.status !== ReachoutTaskStatus.PENDING) return;

    await prisma.reachoutTask.update({
      where: { id: taskId },
      data: { status: ReachoutTaskStatus.RUNNING, startedAt: new Date() },
    });

    const { business } = task;
    if (!business.email) {
      await prisma.reachoutTask.update({
        where: { id: taskId },
        data: {
          status: ReachoutTaskStatus.FAILED,
          message: "Business has no email address on record.",
          finishedAt: new Date(),
        },
      });
      return;
    }

    // Auto-link: if a user with this email already exists, link them and succeed
    const existingUser = await prisma.user.findUnique({
      where: { email: business.email },
      select: { id: true },
    });
    if (existingUser && !business.ownerUserId) {
      await prisma.business.update({
        where: { id: business.id },
        data: { ownerUserId: existingUser.id },
      });
      await prisma.reachoutTask.update({
        where: { id: taskId },
        data: {
          status: ReachoutTaskStatus.SUCCEEDED,
          message: `Account already exists for ${business.email} — business automatically linked.`,
          finishedAt: new Date(),
        },
      });
      return;
    }

    if (business.ownerUserId) {
      await prisma.reachoutTask.update({
        where: { id: taskId },
        data: {
          status: ReachoutTaskStatus.SUCCEEDED,
          message: "Business already claimed by its owner.",
          finishedAt: new Date(),
        },
      });
      return;
    }

    const subAgent = await findAssistantSubAgent();
    if (!subAgent) {
      await prisma.reachoutTask.update({
        where: { id: taskId },
        data: {
          status: ReachoutTaskStatus.FAILED,
          message: "No sub-agent with SMTP configured. Configure one in the Assistant settings.",
          finishedAt: new Date(),
        },
      });
      return;
    }

    const claimToken = await getOrCreateClaimToken(business.id);
    const registrationUrl = buildClaimUrl(claimToken);
    const publicationName = await resolvePublicationName(business.postalCode);
    const email = await writeOnboardingEmail({
      kind: "initial",
      businessId: business.id,
      publicationName,
      registrationUrl,
      subAgent,
    });

    const { threadId } = await sendSubAgentEmail({
      subAgentId: subAgent.id,
      toEmail: business.email,
      toName: business.name,
      subject: email.subject,
      bodyText: email.body,
    });

    await prisma.reachoutTask.update({
      where: { id: taskId },
      data: {
        subAgentId: subAgent.id,
        threadId,
        initialEmailSentAt: new Date(),
        message: `Initial onboarding email (written by Claude) sent to ${business.email}.`,
      },
    });
  } catch (err) {
    console.error(`[ReachoutTask] runReachoutTask ${taskId} failed:`, err);
    await prisma.reachoutTask.updateMany({
      where: { id: taskId, status: { in: [ReachoutTaskStatus.PENDING, ReachoutTaskStatus.RUNNING] } },
      data: {
        status: ReachoutTaskStatus.FAILED,
        message: `Error: ${err instanceof Error ? err.message : String(err)}`,
        finishedAt: new Date(),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Auto-link: connect a new business to its owner if an account exists (swallows errors)
// ---------------------------------------------------------------------------

export async function triggerReachoutOnboarding(businessId: number): Promise<void> {
  try {
    const agent = await prisma.agent.findUnique({
      where: { slug: "assistant" },
      select: { id: true, enabled: true, settings: true },
    });
    if (!agent?.enabled) return;

    const settings = (agent.settings as Record<string, unknown>) ?? {};
    const onboarding = (settings.onboarding as Record<string, unknown> | undefined) ?? {};
    if (onboarding.enabled === false) return;

    // Link only: connect to an existing account with the business email. No task, no email.
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, email: true, ownerUserId: true },
    });
    if (!business?.email || business.ownerUserId) return;

    const existingUser = await prisma.user.findUnique({
      where: { email: business.email },
      select: { id: true },
    });
    if (!existingUser) return;

    await prisma.business.update({
      where: { id: business.id },
      data: { ownerUserId: existingUser.id },
    });
  } catch {
    console.error("[ReachoutTask] triggerReachoutOnboarding failed for business", businessId);
  }
}

// ---------------------------------------------------------------------------
// Reminders: check all running tasks and send overdue reminders
// ---------------------------------------------------------------------------

export async function checkReachoutReminders(): Promise<void> {
  const now = Date.now();

  const runningTasks = await prisma.reachoutTask.findMany({
    where: { status: ReachoutTaskStatus.RUNNING, initialEmailSentAt: { not: null } },
    include: {
      business: { select: { id: true, name: true, email: true, postalCode: true, ownerUserId: true } },
      subAgent: { select: { name: true, soul: true } },
    },
  });

  for (const task of runningTasks) {
    // Check if business has been claimed since last check
    if (task.business.ownerUserId) {
      await prisma.reachoutTask.update({
        where: { id: task.id },
        data: {
          status: ReachoutTaskStatus.SUCCEEDED,
          message: "Business successfully claimed by its owner.",
          finishedAt: new Date(),
        },
      });
      continue;
    }

    if (!task.business.email || !task.subAgentId || !task.subAgent || !task.initialEmailSentAt) continue;

    const initialMs = task.initialEmailSentAt.getTime();
    const kind: OnboardingEmailKind | null =
      !task.reminder1SentAt && now - initialMs >= REMINDER_1_DAYS * MS_PER_DAY
        ? "reminder1"
        : task.reminder1SentAt && !task.reminder2SentAt && now - initialMs >= REMINDER_2_DAYS * MS_PER_DAY
          ? "reminder2"
          : null;
    if (!kind) continue;

    try {
      const claimToken = await getOrCreateClaimToken(task.business.id);
      const thread = task.threadId
        ? await prisma.emailThread.findUnique({
            where: { id: task.threadId },
            select: { messages: { orderBy: { createdAt: "asc" } } },
          })
        : null;
      const email = await writeOnboardingEmail({
        kind,
        businessId: task.business.id,
        publicationName: await resolvePublicationName(task.business.postalCode),
        registrationUrl: buildClaimUrl(claimToken),
        subAgent: task.subAgent,
        thread: thread?.messages,
      });
      await sendSubAgentEmail({
        subAgentId: task.subAgentId,
        toEmail: task.business.email,
        toName: task.business.name,
        subject: email.subject,
        bodyText: email.body,
        existingThreadId: task.threadId ?? undefined,
      });
      await prisma.reachoutTask.update({
        where: { id: task.id },
        data:
          kind === "reminder1"
            ? { reminder1SentAt: new Date(), message: `Reminder 1 (written by Claude) sent to ${task.business.email}.` }
            : {
                reminder2SentAt: new Date(),
                message: `Reminder 2 (written by Claude) sent to ${task.business.email}. Sequence complete.`,
              },
      });
    } catch (err) {
      // Not marked as sent, so the next check tries again
      console.error(`[ReachoutTask] ${kind} failed for task ${task.id}:`, err);
      await prisma.reachoutTask.update({
        where: { id: task.id },
        data: { message: `${kind === "reminder1" ? "Reminder 1" : "Reminder 2"} not sent: ${err instanceof Error ? err.message : String(err)}` },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Reply handler: called when an inbound message arrives on a reachout thread
// ---------------------------------------------------------------------------

export async function handleReachoutInboundMessage(threadId: string): Promise<void> {
  try {
    const task = await prisma.reachoutTask.findUnique({
      where: { threadId },
      include: {
        business: {
          select: { id: true, name: true, postalCode: true, ownerUserId: true, primaryCategory: true, city: true },
        },
        subAgent: { select: { name: true, soul: true } },
      },
    });
    if (!task || task.status !== ReachoutTaskStatus.RUNNING) return;
    if (!task.subAgentId) return;

    // If they've already claimed, mark complete
    if (task.business.ownerUserId) {
      await prisma.reachoutTask.update({
        where: { id: task.id },
        data: {
          status: ReachoutTaskStatus.SUCCEEDED,
          message: "Business claimed by its owner.",
          finishedAt: new Date(),
        },
      });
      return;
    }

    const claimToken = await getOrCreateClaimToken(task.business.id);
    const registrationUrl = buildClaimUrl(claimToken);
    const publicationName = await resolvePublicationName(task.business.postalCode);

    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      select: { toEmail: true, subject: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!thread) return;

    // Write a real answer to what the owner said. If Claude is unavailable, record why and send nothing:
    // a canned reply that ignores their question does more harm than no reply.
    let reply: { reply: string; optedOut: boolean } | null = null;
    let failureReason = "CLAUDE_KEY not set or empty model response";
    if (task.subAgent) {
      try {
        reply = await generateAssistantReply({
          agent: task.subAgent,
          messages: thread.messages,
          recipientName: task.business.name,
          context: [
            `You emailed ${task.business.name}${task.business.primaryCategory ? ` (${task.business.primaryCategory})` : ""}${task.business.city ? ` in ${task.business.city}` : ""} to let them know their business is listed in the directory for ${publicationName} and invite them to claim it.`,
            `Their personal claim link: ${registrationUrl}`,
            "They have not claimed the listing yet.",
          ],
        });
      } catch (err) {
        failureReason = err instanceof Error ? err.message : String(err);
        console.error(`[ReachoutTask] Claude reply failed for thread ${threadId}; no reply sent:`, err);
      }
    }

    if (!reply) {
      await prisma.reachoutTask.update({
        where: { id: task.id },
        data: { message: `Inbound message not answered — AI reply failed: ${failureReason}` },
      });
      return;
    }

    await sendSubAgentEmail({
      subAgentId: task.subAgentId,
      toEmail: thread.toEmail,
      toName: task.business.name,
      bodyText: reply.reply,
      existingThreadId: threadId,
    });

    // Stop reminders for owners who declined.
    await prisma.reachoutTask.update({
      where: { id: task.id },
      data: reply.optedOut
        ? { status: ReachoutTaskStatus.STOPPED, message: "Owner declined — replied and stopped reminders.", finishedAt: new Date() }
        : { message: "Replied to inbound message (Claude)." },
    });
  } catch (err) {
    console.error(`[ReachoutTask] handleReachoutInboundMessage failed for thread ${threadId}:`, err);
  }
}

import "server-only";
import { ReachoutTaskStatus } from "@prisma/client";
import { sendSubAgentEmail, getSubAgentConfig } from "@/lib/sub-agent-email";
import { prisma } from "@/lib/db";

const REMINDER_1_DAYS = 2;
const REMINDER_2_DAYS = 5;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

const INITIAL_SUBJECT = "Your business {businessName} has a new local media opportunity";
const INITIAL_BODY = `Hello,

Best Version Media publishes highly localized, community-focused publications that connect neighborhood businesses with the residents who matter most to them. Our readers are homeowners and community members actively looking to support local businesses like yours.

We've listed {businessName} in our local directory for {publicationName}, and we'd love for you to take ownership of your listing — update your details, explore advertising and highlight opportunities, and connect directly with your local publication team.

Claiming your business is free and takes just a minute:

{registrationUrl}

If you have any questions, simply reply to this email — we're happy to help.

Warm regards,
{agentName}
Best Version Media`;

const REMINDER_1_SUBJECT = "Following up: claim your listing in {publicationName}";
const REMINDER_1_BODY = `Hello,

We wanted to follow up on our earlier message about your listing in {publicationName}.

{businessName} is already visible to local readers in your area. Claiming your free business profile lets you keep your information accurate and learn about highlight and advertising opportunities tailored to your community.

Claim your listing here:
{registrationUrl}

Feel free to reply with any questions.

Warm regards,
{agentName}
Best Version Media`;

const REMINDER_2_SUBJECT = "Last reminder: {businessName} listing in {publicationName}";
const REMINDER_2_BODY = `Hello,

This is our final reminder about your complimentary business listing in {publicationName}.

We'd love to connect {businessName} with the community readers who are already seeing your listing. Creating your account is free and unlocks your full business profile:

{registrationUrl}

No action required if you'd prefer not to participate — your listing will remain as-is. But if you'd like to connect with your local publication team, we're just a reply away.

Warm regards,
{agentName}
Best Version Media`;

const AUTO_REPLY_BODY = `Hello,

Thank you for getting back to us! We appreciate your interest in {publicationName}.

Our team will be happy to help. In the meantime, you can get started right away by creating a free account to claim your {businessName} listing:

{registrationUrl}

Once you've created your account, you'll be able to update your business details and explore advertising and community highlight opportunities with your local publication team.

Feel free to reply to this email with any questions — we're here to help.

Warm regards,
{agentName}
Best Version Media`;

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

async function findSubAgentForOnboarding(): Promise<{ id: number; name: string } | null> {
  const agent = await prisma.agent.findUnique({
    where: { slug: "assistant" },
    select: { subAgents: { select: { id: true, name: true, config: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!agent) return null;
  for (const sa of agent.subAgents) {
    const cfg = getSubAgentConfig(sa.config);
    if (cfg.smtpHost && cfg.smtpUser && cfg.smtpPassword && cfg.smtpFromEmail) {
      return { id: sa.id, name: sa.name };
    }
  }
  return null;
}

function buildVars(
  businessName: string,
  publicationName: string,
  registrationUrl: string,
  agentName: string,
): Record<string, string> {
  return { businessName, publicationName, registrationUrl, agentName };
}

async function resolvePublicationName(postalCode: string | null): Promise<string> {
  if (!postalCode) return "your local publication";
  const pub = await prisma.publication.findFirst({
    where: { zipCodes: { some: { code: postalCode } } },
    select: { name: true },
  });
  return pub?.name ?? "your local publication";
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

    const subAgent = await findSubAgentForOnboarding();
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

    const settings = await getAssistantSettings();
    const claimToken = await getOrCreateClaimToken(business.id);
    const registrationUrl = buildClaimUrl(claimToken);
    const publicationName = await resolvePublicationName(business.postalCode);
    const vars = buildVars(business.name, publicationName, registrationUrl, subAgent.name);

    const onboardingSettings = (settings.onboarding as Record<string, unknown> | undefined) ?? {};
    const subjectTpl = typeof onboardingSettings.initialSubject === "string" ? onboardingSettings.initialSubject : INITIAL_SUBJECT;
    const bodyTpl = typeof onboardingSettings.initialBody === "string" ? onboardingSettings.initialBody : INITIAL_BODY;

    const { threadId } = await sendSubAgentEmail({
      subAgentId: subAgent.id,
      toEmail: business.email,
      toName: business.name,
      subject: interpolate(subjectTpl, vars),
      bodyText: interpolate(bodyTpl, vars),
    });

    await prisma.reachoutTask.update({
      where: { id: taskId },
      data: {
        subAgentId: subAgent.id,
        threadId,
        initialEmailSentAt: new Date(),
        message: `Initial onboarding email sent to ${business.email}.`,
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
// Auto-trigger: create a task for a business (swallows errors)
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

    // Skip if a non-stopped, non-failed task already exists for this business
    const existing = await prisma.reachoutTask.findFirst({
      where: {
        businessId,
        status: { in: [ReachoutTaskStatus.PENDING, ReachoutTaskStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (existing) return;

    const task = await prisma.reachoutTask.create({
      data: { businessId, autoTriggered: true },
      select: { id: true },
    });

    // Run in background via dynamic import to avoid bundling `after` at call sites
    const { after } = await import("next/server");
    after(async () => { await runReachoutTask(task.id); });
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
      subAgent: { select: { name: true } },
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

    if (!task.business.email || !task.subAgentId || !task.initialEmailSentAt) continue;

    const settings = await getAssistantSettings();
    const claimToken = await getOrCreateClaimToken(task.business.id);
    const registrationUrl = buildClaimUrl(claimToken);
    const publicationName = await resolvePublicationName(task.business.postalCode);
    const vars = buildVars(task.business.name, publicationName, registrationUrl, task.subAgent?.name ?? "");
    const onboarding = (settings.onboarding as Record<string, unknown> | undefined) ?? {};

    const initialMs = task.initialEmailSentAt.getTime();

    // Reminder 1
    if (!task.reminder1SentAt && now - initialMs >= REMINDER_1_DAYS * MS_PER_DAY) {
      try {
        const sub1Tpl = typeof onboarding.reminder1Subject === "string" ? onboarding.reminder1Subject : REMINDER_1_SUBJECT;
        const bod1Tpl = typeof onboarding.reminder1Body === "string" ? onboarding.reminder1Body : REMINDER_1_BODY;
        await sendSubAgentEmail({
          subAgentId: task.subAgentId,
          toEmail: task.business.email,
          toName: task.business.name,
          subject: interpolate(sub1Tpl, vars),
          bodyText: interpolate(bod1Tpl, vars),
          existingThreadId: task.threadId ?? undefined,
        });
        await prisma.reachoutTask.update({
          where: { id: task.id },
          data: { reminder1SentAt: new Date(), message: `Reminder 1 sent to ${task.business.email}.` },
        });
      } catch (err) {
        console.error(`[ReachoutTask] Reminder 1 failed for task ${task.id}:`, err);
      }
      continue;
    }

    // Reminder 2
    if (!task.reminder2SentAt && task.reminder1SentAt) {
      const totalDays = (now - initialMs) / MS_PER_DAY;
      if (totalDays >= REMINDER_2_DAYS) {
        try {
          const sub2Tpl = typeof onboarding.reminder2Subject === "string" ? onboarding.reminder2Subject : REMINDER_2_SUBJECT;
          const bod2Tpl = typeof onboarding.reminder2Body === "string" ? onboarding.reminder2Body : REMINDER_2_BODY;
          await sendSubAgentEmail({
            subAgentId: task.subAgentId,
            toEmail: task.business.email,
            toName: task.business.name,
            subject: interpolate(sub2Tpl, vars),
            bodyText: interpolate(bod2Tpl, vars),
            existingThreadId: task.threadId ?? undefined,
          });
          await prisma.reachoutTask.update({
            where: { id: task.id },
            data: {
              reminder2SentAt: new Date(),
              message: `Reminder 2 sent to ${task.business.email}. Sequence complete.`,
            },
          });
        } catch (err) {
          console.error(`[ReachoutTask] Reminder 2 failed for task ${task.id}:`, err);
        }
      }
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
        business: { select: { id: true, name: true, postalCode: true, ownerUserId: true } },
        subAgent: { select: { name: true } },
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
    const vars = buildVars(task.business.name, publicationName, registrationUrl, task.subAgent?.name ?? "");

    const thread = await prisma.emailThread.findUnique({ where: { id: threadId }, select: { toEmail: true } });
    await sendSubAgentEmail({
      subAgentId: task.subAgentId,
      toEmail: thread?.toEmail ?? "",
      toName: task.business.name,
      subject: `Re: Your listing in ${publicationName}`,
      bodyText: interpolate(AUTO_REPLY_BODY, vars),
      existingThreadId: threadId,
    });

    await prisma.reachoutTask.update({
      where: { id: task.id },
      data: { message: "Replied to inbound message." },
    });
  } catch (err) {
    console.error(`[ReachoutTask] handleReachoutInboundMessage failed for thread ${threadId}:`, err);
  }
}

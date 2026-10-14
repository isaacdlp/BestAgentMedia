import "server-only";
import { AgentTaskStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { triggerReachoutOnboarding } from "@/lib/reachout-tasks";

type TaskStep = { at: string; level: "info" | "success" | "error"; message: string };

function step(level: TaskStep["level"], message: string): TaskStep {
  return { at: new Date().toISOString(), level, message };
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

const DEFAULT_SUBMISSION_SUBJECT = "Thank you for your submission — join the community";
const DEFAULT_SUBMISSION_BODY =
  'Hi {submitterName},\n\nThank you for submitting your story "{submissionTitle}" to {publicationName}.\n\nCreate an account to track your submission status, receive updates from the editorial team, and stay connected with your community.\n\n{registrationUrl}\n\nBest regards,\nBest Version Media';

const DEFAULT_BUSINESS_SUBJECT = "Claim your listing in {publicationName}";
const DEFAULT_BUSINESS_BODY =
  "Hello,\n\nYour business {businessName} has been featured in {publicationName}'s business directory.\n\nCreate an account to claim your listing, keep your information up to date, and connect with your local community.\n\n{registrationUrl}\n\nBest regards,\nBest Version Media";

/**
 * Called after a new ContentSubmission is created.
 * Queues an invitation email draft for admin review — does NOT send anything.
 * Swallows all errors so the caller's response is never affected.
 */
export async function triggerSubmissionInvite(submissionId: string): Promise<void> {
  try {
    const agent = await prisma.agent.findUnique({
      where: { slug: "assistant" },
      select: { id: true, enabled: true, settings: true },
    });
    if (!agent?.enabled) return;

    const settings = (agent.settings as Record<string, unknown>) ?? {};
    const inviteSettings = (settings.submissionInvite as Record<string, unknown> | undefined) ?? {};
    if (inviteSettings.enabled === false) return;

    const submission = await prisma.contentSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        title: true,
        submitterName: true,
        submitterEmail: true,
        publication: { select: { name: true } },
      },
    });
    if (!submission?.submitterEmail) return;

    const vars: Record<string, string> = {
      submitterName: submission.submitterName ?? "there",
      publicationName: submission.publication.name,
      submissionTitle: submission.title,
      registrationUrl: typeof settings.registrationUrl === "string" ? settings.registrationUrl : "",
    };

    const subject = interpolate(
      typeof inviteSettings.subject === "string" ? inviteSettings.subject : DEFAULT_SUBMISSION_SUBJECT,
      vars,
    );
    const body = interpolate(
      typeof inviteSettings.body === "string" ? inviteSettings.body : DEFAULT_SUBMISSION_BODY,
      vars,
    );

    const steps: TaskStep[] = [
      step("info", `Trigger: new submission "${submission.title}" (id: ${submission.id})`),
      step("info", `Recipient: ${submission.submitterEmail} (${submission.submitterName ?? "unknown"})`),
      step("info", `Publication: ${submission.publication.name}`),
      step("info", "Email draft composed using submission invite template"),
      step("success", "Draft queued for review — no email sent yet"),
    ];

    await prisma.agentTask.create({
      data: {
        agentId: agent.id,
        status: AgentTaskStatus.SUCCEEDED,
        label: `Submission invite — ${submission.submitterName ?? submission.submitterEmail} · ${submission.publication.name}`,
        startedAt: new Date(),
        completedAt: new Date(),
        steps: steps as unknown as Prisma.InputJsonValue,
        result: {
          trigger: "submission",
          referenceId: submission.id,
          emailTo: submission.submitterEmail,
          emailSubject: subject,
          bodyPreview: body,
          status: "draft",
        } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Must not surface errors to the caller — this is a background side-effect
    console.error("[AssistantAgent] triggerSubmissionInvite failed for submission", submissionId);
  }
}

/**
 * Called after a new Business is created.
 * Queues an invitation email draft for admin review — does NOT send anything.
 * Only acts when the business has an email address on record.
 * Swallows all errors so the caller's response is never affected.
 */
export async function triggerBusinessInvite(businessId: number): Promise<void> {
  try {
    const agent = await prisma.agent.findUnique({
      where: { slug: "assistant" },
      select: { id: true, enabled: true, settings: true },
    });
    if (!agent?.enabled) return;

    const settings = (agent.settings as Record<string, unknown>) ?? {};
    const inviteSettings = (settings.businessInvite as Record<string, unknown> | undefined) ?? {};
    if (inviteSettings.enabled === false) return;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, email: true, postalCode: true },
    });
    if (!business?.email) return;

    let publicationName = "your local publication";
    if (business.postalCode) {
      const pub = await prisma.publication.findFirst({
        where: { zipCodes: { some: { code: business.postalCode } } },
        select: { name: true },
      });
      if (pub) publicationName = pub.name;
    }

    const vars: Record<string, string> = {
      businessName: business.name,
      publicationName,
      registrationUrl: typeof settings.registrationUrl === "string" ? settings.registrationUrl : "",
    };

    const subject = interpolate(
      typeof inviteSettings.subject === "string" ? inviteSettings.subject : DEFAULT_BUSINESS_SUBJECT,
      vars,
    );
    const body = interpolate(
      typeof inviteSettings.body === "string" ? inviteSettings.body : DEFAULT_BUSINESS_BODY,
      vars,
    );

    const steps: TaskStep[] = [
      step("info", `Trigger: new business "${business.name}" (id: ${business.id})`),
      step("info", `Recipient: ${business.email}`),
      step("info", `Publication: ${publicationName}`),
      step("info", "Email draft composed using business invite template"),
      step("success", "Draft queued for review — no email sent yet"),
    ];

    await prisma.agentTask.create({
      data: {
        agentId: agent.id,
        status: AgentTaskStatus.SUCCEEDED,
        label: `Business invite — ${business.name}`,
        startedAt: new Date(),
        completedAt: new Date(),
        steps: steps as unknown as Prisma.InputJsonValue,
        result: {
          trigger: "business",
          referenceId: business.id,
          emailTo: business.email,
          emailSubject: subject,
          bodyPreview: body,
          status: "draft",
        } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    console.error("[AssistantAgent] triggerBusinessInvite failed for business", businessId);
  }

  // Also kick off an onboarding reachout task if auto-onboarding is enabled
  await triggerReachoutOnboarding(businessId);
}

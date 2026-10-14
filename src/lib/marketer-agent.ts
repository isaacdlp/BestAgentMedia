import "server-only";
import { AgentTaskStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type PitchType = "sponsored_article" | "advertisement";

type TaskStep = { at: string; level: "info" | "success" | "error"; message: string };

function step(level: TaskStep["level"], message: string): TaskStep {
  return { at: new Date().toISOString(), level, message };
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

const DEFAULT_SPONSORED_SUBJECT = "Feature {businessName} in {publicationName}";
const DEFAULT_SPONSORED_BODY =
  "Hello,\n\nI'm reaching out from Best Version Media's sales team for {publicationName}.\n\nWe'd love to feature {businessName} as a sponsored article in our next issue — a professionally written community spotlight that puts your business in front of local homeowners and residents.\n\nReply to this email or visit our advertising page:\n\n{advertisingUrl}\n\nWarm regards,\n{agentName}\nBest Version Media";

const DEFAULT_AD_SUBJECT = "Advertise {businessName} in {publicationName}";
const DEFAULT_AD_BODY =
  "Hello,\n\nI'm reaching out from Best Version Media's sales team for {publicationName}.\n\nWe have advertising placement opportunities in our next issue — a great way to get {businessName} in front of local residents in your area.\n\nInterested? Reply to this email or visit:\n\n{advertisingUrl}\n\nWarm regards,\n{agentName}\nBest Version Media";

/**
 * Builds a sales pitch draft for a business and queues it for admin review.
 * Returns the created task id.
 * Throws on error — callers should handle failures.
 */
export async function createBusinessPitch(
  businessId: number,
  pitchType: PitchType,
  triggeredById?: string,
): Promise<string> {
  const agent = await prisma.agent.findUnique({
    where: { slug: "marketer" },
    select: { id: true, enabled: true, settings: true },
  });
  if (!agent) throw new Error("Marketer agent is not configured. Run the database seed.");
  if (!agent.enabled) throw new Error("The Marketer agent is currently disabled. Enable it in the Agents section.");

  const settings = (agent.settings as Record<string, unknown>) ?? {};

  const typeKey = pitchType === "sponsored_article" ? "sponsoredArticle" : "advertisement";
  const pitchSettings = (settings[typeKey] as Record<string, unknown> | undefined) ?? {};
  if (pitchSettings.enabled === false) {
    throw new Error(`${pitchType === "sponsored_article" ? "Sponsored article" : "Advertisement"} pitches are disabled in the Marketer settings.`);
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, email: true, postalCode: true },
  });
  if (!business) throw new Error("Business not found.");
  if (!business.email) throw new Error("This business has no email address on record.");

  let publicationName = "your local publication";
  if (business.postalCode) {
    const pub = await prisma.publication.findFirst({
      where: { zipCodes: { some: { code: business.postalCode } } },
      select: { name: true },
    });
    if (pub) publicationName = pub.name;
  }

  // Find a sub-agent name to personalise the sign-off
  const subAgent = await prisma.subAgent.findFirst({
    where: { agentId: agent.id },
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });
  const agentName = subAgent?.name ?? "Best Version Media Sales";

  const vars: Record<string, string> = {
    businessName: business.name,
    publicationName,
    agentName,
    advertisingUrl: typeof settings.advertisingUrl === "string" ? settings.advertisingUrl : "",
  };

  const subjectTpl =
    typeof pitchSettings.subject === "string"
      ? pitchSettings.subject
      : pitchType === "sponsored_article"
        ? DEFAULT_SPONSORED_SUBJECT
        : DEFAULT_AD_SUBJECT;

  const bodyTpl =
    typeof pitchSettings.body === "string"
      ? pitchSettings.body
      : pitchType === "sponsored_article"
        ? DEFAULT_SPONSORED_BODY
        : DEFAULT_AD_BODY;

  const subject = interpolate(subjectTpl, vars);
  const body = interpolate(bodyTpl, vars);

  const pitchLabel = pitchType === "sponsored_article" ? "Sponsored article pitch" : "Advertisement pitch";

  const steps: TaskStep[] = [
    step("info", `Trigger: ${pitchLabel} for "${business.name}" (id: ${business.id})`),
    step("info", `Recipient: ${business.email}`),
    step("info", `Publication: ${publicationName}`),
    step("info", `Pitch type: ${pitchLabel}`),
    step("info", "Email draft composed using marketer pitch template"),
    step("success", "Draft queued for review — no email sent yet"),
  ];

  const task = await prisma.agentTask.create({
    data: {
      agentId: agent.id,
      status: AgentTaskStatus.SUCCEEDED,
      label: `${pitchLabel} — ${business.name} · ${publicationName}`,
      startedAt: new Date(),
      completedAt: new Date(),
      triggeredById: triggeredById ?? null,
      steps: steps as unknown as Prisma.InputJsonValue,
      result: {
        trigger: "marketer",
        pitchType,
        referenceId: business.id,
        toName: business.name,
        emailTo: business.email,
        emailSubject: subject,
        bodyPreview: body,
        status: "draft",
      } as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return task.id;
}

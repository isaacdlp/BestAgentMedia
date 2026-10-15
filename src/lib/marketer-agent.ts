import "server-only";
import { MessageDirection, Prisma } from "@prisma/client";
import { launchAgentTask, step, type TaskStep } from "@/lib/agent-task-runner";
import { prisma } from "@/lib/db";
import { generateMarketerMessage, type MarketerMessage } from "@/lib/marketer-reply";
import { listPublicationPackages, publicationAudience } from "@/lib/promotion-deals";
import { formatCents, getPromotionSettings, type PromotionSettings } from "@/lib/promotion-packages";
import { sendSubAgentEmail } from "@/lib/sub-agent-email";
import type { RegistryTaskRef } from "@/lib/tasks";

export type PitchType = "sponsored_article" | "advertisement";

const PITCH_LABELS: Record<PitchType, string> = {
  sponsored_article: "Sponsored article pitch",
  advertisement: "Advertisement pitch",
};

const PITCH_FOCUS: Record<PitchType, string> = {
  sponsored_article:
    "Pitch focus: a sponsored article — a community spotlight feature about the business, written by the publication team and run with its logo and contact details.",
  advertisement: "Pitch focus: a display ad in the upcoming issue, designed with the business.",
};

async function getMarketer() {
  const agent = await prisma.agent.findUnique({
    where: { slug: "marketer" },
    select: { id: true, enabled: true, settings: true },
  });
  if (!agent) throw new Error("Marketer agent is not configured. Run the database seed.");
  if (!agent.enabled) throw new Error("The Marketer agent is currently disabled. Enable it in the Agents section.");
  return agent;
}

const pitchBusinessSelect = {
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
} satisfies Prisma.BusinessSelect;

type PitchBusiness = Prisma.BusinessGetPayload<{ select: typeof pitchBusinessSelect }>;

/** Facts and rate card the Marketer writes a pitch (or a reply to one) from. */
async function buildPitchContext(business: PitchBusiness, pitchType: PitchType | null, settings: PromotionSettings) {
  const publication = business.postalCode
    ? await prisma.publication.findFirst({
        where: { zipCodes: { some: { code: business.postalCode } } },
        orderBy: { id: "asc" },
        select: { id: true, name: true },
      })
    : null;
  const publicationName = publication?.name ?? "the local publication";
  const [articlePackages, adPackages, audience] = publication
    ? await Promise.all([
        listPublicationPackages(publication.id, "article"),
        listPublicationPackages(publication.id, "ad"),
        publicationAudience(publication.id),
      ])
    : [[], [], null];
  const packages =
    pitchType === "advertisement" ? [...adPackages, ...articlePackages] : [...articlePackages, ...adPackages];

  const categories = [business.primaryCategory, ...business.categories].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );
  const location = [business.city, business.state, business.postalCode].filter(Boolean).join(", ");
  const context = [
    `Business: ${business.name}${categories.length ? ` (${categories.slice(0, 4).join(", ")})` : ""}${location ? ` in ${location}` : ""}.`,
    business.description ? `What we have on record about them: ${business.description}` : "",
    business.website ? `Their website: ${business.website}` : "",
    `Publication: ${publicationName}${publication ? "" : " (no publication covers their ZIP code yet; do not name one)"}. Issue: the next issue (no date set; do not promise one).`,
    audience
      ? `${publicationName} covers ZIP codes with about ${audience.toLocaleString("en-US")} residents (U.S. Census estimate). That is the area's population, not the print circulation; never present it as circulation or readership.`
      : "",
    pitchType ? PITCH_FOCUS[pitchType] : "",
    settings.advertisingUrl ? `Ad-submission form for businesses who want to go ahead: ${settings.advertisingUrl}` : "",
  ].filter(Boolean);

  return { context, packages, publicationName };
}

/**
 * Launches a Marketer Task that writes a tailored sales pitch for a business with Claude and keeps
 * it as a draft on the task for review (Send is on the task page). Returns the registry task.
 */
export async function createBusinessPitch(
  businessId: number,
  pitchType: PitchType,
  triggeredById?: string,
): Promise<RegistryTaskRef> {
  const agent = await getMarketer();
  const settings = getPromotionSettings(agent.settings);
  const typeKey = pitchType === "sponsored_article" ? "sponsoredArticle" : "advertisement";
  const pitchSettings = ((agent.settings as Record<string, unknown> | null)?.[typeKey] as Record<string, unknown> | undefined) ?? {};
  if (pitchSettings.enabled === false) {
    throw new Error(`${PITCH_LABELS[pitchType]}es are disabled in the Marketer settings.`);
  }
  if (!process.env.CLAUDE_KEY) throw new Error("Marketer pitches are not configured (missing CLAUDE_KEY).");

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: pitchBusinessSelect });
  if (!business) throw new Error("Business not found.");
  if (!business.email) throw new Error("This business has no email address on record.");
  const email = business.email;

  // The sub agent who will send it writes it, so the voice matches the sender.
  const subAgent = await prisma.subAgent.findFirst({
    where: { agentId: agent.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, soul: true },
  });
  if (!subAgent) throw new Error("The Marketer has no sub agents. Add one in the Agents section.");

  const pitchLabel = PITCH_LABELS[pitchType];
  return launchAgentTask({
    agentId: agent.id,
    label: `${pitchLabel} — ${business.name}`,
    triggeredById,
    steps: [
      step("info", `Trigger: ${pitchLabel} for "${business.name}" (id: ${business.id})`),
      step("info", `Recipient: ${email} · written as ${subAgent.name}`),
    ],
    work: async ({ log }) => {
      const { context, packages, publicationName } = await buildPitchContext(business, pitchType, settings);
      log("info", `Publication: ${publicationName}`);
      log(
        packages.length ? "info" : "error",
        packages.length
          ? `Rate card: ${packages.map((item) => `${item.name} ${formatCents(item.priceCents)}`).join(", ")}`
          : "No rate card for this publication — the Marketer will not quote prices",
      );
      log("info", `Calling ${settings.model} to write the pitch`);
      const message = await generateMarketerMessage({
        mode: "initial",
        kind: "pitch",
        model: settings.model,
        agent: subAgent,
        recipientName: business.name,
        context,
        packages,
        messages: [],
      });
      if (!message) throw new Error("The model returned no usable email.");
      log("success", "Pitch written — draft kept for review, no email sent yet");
      return {
        trigger: "marketer",
        pitchType,
        referenceId: business.id,
        toName: business.name,
        emailTo: email,
        emailSubject: message.subject || `${business.name} in ${publicationName}`,
        bodyPreview: message.body,
        status: "draft",
      };
    },
  });
}

/** Appends steps to a task log, keeping its status. */
async function appendSteps(agentTaskId: string, newSteps: TaskStep[], result?: Record<string, unknown>) {
  const task = await prisma.agentTask.findUnique({ where: { id: agentTaskId }, select: { steps: true } });
  if (!task) return;
  const steps = Array.isArray(task.steps) ? (task.steps as unknown[]) : [];
  await prisma.agentTask.update({
    where: { id: agentTaskId },
    data: {
      steps: [...steps, ...newSteps] as unknown as Prisma.InputJsonValue,
      ...(result ? { result: result as Prisma.InputJsonValue } : {}),
    },
  });
}

/**
 * Answers the latest inbound message on a Marketer thread that is not an advertiser review
 * (a sent pitch, or a conversation a business started) with Claude, as the Marketer.
 * Returns false when nothing was sent.
 */
export async function handleMarketerInboundMessage(threadId: string): Promise<boolean> {
  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    include: {
      subAgent: { select: { id: true, name: true, soul: true, agent: { select: { settings: true } } } },
      task: { select: { id: true, result: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  const last = thread?.messages[thread.messages.length - 1];
  if (!thread || !last || last.direction !== MessageDirection.INBOUND) return false;

  const settings = getPromotionSettings(thread.subAgent.agent.settings);
  const result = (thread.task?.result as Record<string, unknown> | null) ?? null;
  const pitchType =
    result?.pitchType === "sponsored_article" || result?.pitchType === "advertisement" ? result.pitchType : null;
  const business =
    typeof result?.referenceId === "number"
      ? await prisma.business.findUnique({ where: { id: result.referenceId }, select: pitchBusinessSelect })
      : await prisma.business.findFirst({
          where: { email: { equals: thread.toEmail, mode: "insensitive" } },
          orderBy: { id: "asc" },
          select: pitchBusinessSelect,
        });

  const { context, packages } = business
    ? await buildPitchContext(business, pitchType, settings)
    : { context: [] as string[], packages: [] };
  context.push(`The email subject is "${thread.subject}".`);
  if (result?.optedOut === true) context.push("They previously asked not to be contacted; only answer what they ask now.");

  const recipientName = business?.name ?? thread.toName ?? "Them";
  const newSteps: TaskStep[] = [step("info", `Reply received from ${thread.toEmail}`)];
  let generated: MarketerMessage | null = null;
  let failure = "CLAUDE_KEY not set or empty model response";
  try {
    generated = await generateMarketerMessage({
      mode: "reply",
      kind: "pitch",
      model: settings.model,
      agent: thread.subAgent,
      recipientName,
      context,
      packages,
      messages: thread.messages,
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const message = generated;
  if (!message) {
    // A canned answer that ignores what they said does more harm than no answer.
    if (thread.task) await appendSteps(thread.task.id, [...newSteps, step("error", `Not answered — AI reply failed: ${failure}`)]);
    else console.warn(`[MarketerReply] thread ${threadId} not answered: ${failure}`);
    return false;
  }

  await sendSubAgentEmail({
    subAgentId: thread.subAgent.id,
    toEmail: thread.toEmail,
    toName: thread.toName ?? undefined,
    bodyText: message.body,
    existingThreadId: threadId,
  });
  if (!thread.task) return true;

  newSteps.push(step("success", `${thread.subAgent.name} replied`));
  const chosen = packages.find((item) => String(item.id) === message.packageKey);
  if (message.optedOut) newSteps.push(step("info", "Business asked not to be contacted again"));
  else if (message.dealDecision === "declined") newSteps.push(step("info", "Business declined"));
  else if (message.dealDecision === "interested") {
    newSteps.push(step("success", `Business is interested${chosen ? ` in ${chosen.name} (${formatCents(chosen.priceCents)})` : ""} — publication team to follow up`));
  }
  await appendSteps(
    thread.task.id,
    newSteps,
    message.optedOut || message.dealDecision !== "none"
      ? {
          ...result,
          ...(message.optedOut ? { optedOut: true } : {}),
          ...(message.dealDecision !== "none" ? { interest: message.dealDecision, interestPackage: chosen?.name ?? null } : {}),
        }
      : undefined,
  );
  return true;
}

import "server-only";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AgentTaskStatus, MessageDirection, Prisma } from "@prisma/client";
import { generateAssistantReply, INLINE_REPLY_NOTE, renderTranscript, stripQuotedText } from "@/lib/assistant-reply";
import { effortFor, MAX_OUTPUT_TOKENS } from "@/lib/claude-request";
import { draftContributorEmail } from "@/lib/contributor-email";
import { prisma } from "@/lib/db";
import {
  CONTRIBUTOR_ASK_POLICY,
  formatReceivedInfo,
  formatReviewFeedback,
  readReceivedInfo,
  submissionDatesNote,
  type ReceivedInfoItem,
} from "@/lib/submission-agent-requests";
import { submissionImageDirectory } from "@/lib/submission-images";
import { isSignaturePicture, sendSubAgentEmail } from "@/lib/sub-agent-email";
import { z } from "zod";

type TaskStep = { at: string; level: "info" | "success" | "error"; message: string };

function step(level: TaskStep["level"], message: string): TaskStep {
  return { at: new Date().toISOString(), level, message };
}

const emailAttachmentDirectory = resolve(process.cwd(), "media", "email-attachments");
const maxSubmissionImages = 5;

const ReceivedInfoSchema = z.object({
  received_info: z
    .array(
      z.object({
        topic: z.string().describe("What the information is about, in a few words (for example \"Event date\", \"Quote\", \"Organizer\")."),
        detail: z
          .string()
          .describe("The information itself, complete and self-contained; quotes and names exactly as the contributor wrote them."),
      }),
    )
    .describe("Each new fact or piece of text in the newest message(s) that belongs in the story; empty when there is none."),
  still_needed: z
    .array(z.string())
    .describe(
      "Only essential items the contributor alone can provide that they have neither answered, skipped nor declined; empty when the story can reasonably run without more from them.",
    ),
});

/**
 * Handles every new reply from a contributor on an info-request (clarification) thread: Claude
 * records the new information on the request (`receivedInfo`), where it is shown with the
 * editorial review that prompted it. The Assistant never edits the submission's title or body;
 * the Copywriter works the information in when a person applies the review. Image attachments are
 * added to the submission, and the Assistant's sub agent answers
 * with a reply written by Claude for this conversation. Nothing is sent when Claude is unavailable.
 */
export async function handleClarificationReply(threadId: string): Promise<void> {
  try {
    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        taskId: true,
        toEmail: true,
        toName: true,
        subject: true,
        subAgent: { select: { id: true, name: true, soul: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          select: { id: true, direction: true, bodyText: true, sentAt: true, receivedAt: true, createdAt: true },
        },
      },
    });
    if (!thread?.taskId) return;

    const task = await prisma.agentTask.findUnique({
      where: { id: thread.taskId },
      select: { id: true, status: true, result: true, steps: true },
    });
    if (!task) return;

    const result = (task.result ?? {}) as Record<string, unknown>;
    if (result.contentType !== "clarification") return;
    // Only ongoing requests are managed; a completed, stopped or failed one is left alone
    if (task.status !== AgentTaskStatus.RUNNING) return;
    if (result.status !== "sent" && result.status !== "incorporated") return;
    const submissionId = typeof result.referenceId === "string" ? result.referenceId : null;
    if (!submissionId) return;

    // Only answer when the contributor has the last word, and only messages not handled yet
    const lastMessage = thread.messages[thread.messages.length - 1];
    if (!lastMessage || lastMessage.direction !== MessageDirection.INBOUND) return;
    const processedIds = Array.isArray(result.processedMessageIds)
      ? (result.processedMessageIds as unknown[]).filter((value): value is string => typeof value === "string")
      : [];
    const newReplies = thread.messages.filter(
      (message) => message.direction === MessageDirection.INBOUND && !processedIds.includes(message.id),
    );
    if (newReplies.length === 0) return;

    const taskSteps = Array.isArray(task.steps) ? (task.steps as unknown[]) : [];
    const newSteps: TaskStep[] = [step("info", `Reply received from ${thread.toEmail}`)];
    const saveProgress = (extra: Record<string, unknown>, taskData: Prisma.AgentTaskUpdateInput = {}) =>
      prisma.agentTask.update({
        where: { id: task.id },
        data: {
          ...taskData,
          result: { ...result, ...extra } as unknown as Prisma.InputJsonValue,
          steps: [...taskSteps, ...newSteps] as unknown as Prisma.InputJsonValue,
        },
      });

    const apiKey = process.env.CLAUDE_KEY;
    if (!apiKey) {
      newSteps.push(step("error", "CLAUDE_KEY is not set — the reply was not processed and no answer was sent"));
      await saveProgress({});
      return;
    }

    // Claim these messages before the slow work so a parallel poll does not handle them twice
    const allProcessedIds = [...processedIds, ...newReplies.map((message) => message.id)];
    await saveProgress({ processedMessageIds: allProcessedIds });

    const submission = await prisma.contentSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        title: true,
        body: true,
        storyType: true,
        createdAt: true,
        publication: { select: { name: true } },
        _count: { select: { images: true } },
      },
    });
    if (!submission) return;

    const review =
      typeof result.reviewTaskId === "string"
        ? await prisma.agentTask.findUnique({ where: { id: result.reviewTaskId }, select: { result: true } })
        : null;
    const reviewFeedback = formatReviewFeedback(review?.result);
    const instructions = typeof result.instructions === "string" ? result.instructions : "";

    const previousInfo = readReceivedInfo(result.receivedInfo);
    const previousInfoText = formatReceivedInfo(previousInfo);

    // 1. Record the new information for the editorial team
    const assistant = await prisma.agent.findUnique({ where: { slug: "assistant" }, select: { settings: true } });
    const settings = (assistant?.settings as Record<string, unknown> | null) ?? {};
    const model = typeof settings.clarificationModel === "string" ? settings.clarificationModel : "claude-haiku-5-5";
    const contributor = thread.toName || "The contributor";
    const transcript = renderTranscript(thread.messages, thread.subAgent.name, contributor);
    const latestText = newReplies.map((message) => stripQuotedText(message.bodyText)).join("\n\n");

    newSteps.push(step("info", `Calling ${model} to extract the information in the reply`));
    const client = new Anthropic({ apiKey });
    const response = await client.messages.stream({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system:
        "You are an editorial assistant for a local community magazine. You pick out the information a story contributor supplied by email and record it for the editors, who will work it into the story. You never edit the story yourself and never invent facts that are not in the contributor's messages.",
      output_config: { format: zodOutputFormat(ReceivedInfoSchema), ...effortFor(model, "medium") },
      messages: [
        {
          role: "user",
          content: `Story title: "${submission.title}"
Story type: ${submission.storyType ?? "unspecified"}

Story body as submitted:
${submission.body}

${reviewFeedback ? `Editorial review that prompted the request for information:\n${reviewFeedback}\n` : ""}${previousInfoText ? `\nInformation already recorded from earlier replies:\n${previousInfoText}\n` : ""}${instructions ? `\nInstructions from the editorial team:\n${instructions}\n` : ""}
Email conversation with the contributor so far, oldest first:
${transcript}

The contributor's newest message(s):
${latestText}

${INLINE_REPLY_NOTE}

${submissionDatesNote(submission.createdAt)}

List in received_info each new fact or piece of text from the newest message(s) that belongs in the story, especially answers to the review's missing elements and suggestions. Make each item self-contained (an editor reads it without the email); where you are certain, give relative dates as the calendar date they refer to. Leave out what is already in the story body or already recorded, greetings, and small talk.

For still_needed, apply this policy (the same one the replies follow):
${CONTRIBUTOR_ASK_POLICY}
Anything the team can look up or work out does not belong in still_needed. Once they have replied, do not keep pressing for what they skipped: list only what would truly stop the story from running.`,
        },
      ],
    }).finalMessage();
    const update = response.parsed_output;
    if (!update) {
      // Without the model's assessment we cannot tell what is still missing: record it and keep waiting
      newSteps.push(
        step("error", `Could not process the reply (stop reason: ${response.stop_reason}) — nothing was changed or sent`),
      );
      await saveProgress({ processedMessageIds: allProcessedIds });
      return;
    }
    const clean = (items: string[]) => items.map((item) => item.trim()).filter(Boolean);
    const stillNeeded = clean(update.still_needed);
    const latestReply = newReplies[newReplies.length - 1];
    const newInfo: ReceivedInfoItem[] = update.received_info
      .map((item) => ({ topic: item.topic.trim().slice(0, 120), detail: item.detail.trim().slice(0, 4000) }))
      .filter((item) => item.detail)
      .map((item) => ({
        ...item,
        messageId: latestReply.id,
        receivedAt: (latestReply.receivedAt ?? latestReply.createdAt).toISOString(),
      }));
    const changes = newInfo.map((item) => (item.topic ? `${item.topic}: ${item.detail}` : item.detail));
    if (newInfo.length) {
      newSteps.push(step("success", `Information added to the review: ${changes.join("; ")}`));
    } else {
      newSteps.push(step("info", "No new story information in the reply"));
    }

    // 2. Add photos attached to the new replies
    const attachments = await prisma.emailAttachment.findMany({
      where: { emailMessageId: { in: newReplies.map((message) => message.id) } },
      select: { fileName: true, originalName: true, mimeType: true, size: true },
    });
    const imageAttachments: typeof attachments = [];
    for (const att of attachments) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(att.mimeType)) continue;
      // Skip our own signature picture quoted back by the contributor's mail client
      if (await isSignaturePicture(null, { fileName: att.originalName })) continue;
      const content = await readFile(resolve(emailAttachmentDirectory, att.fileName)).catch(() => null);
      if (await isSignaturePicture(content)) continue;
      imageAttachments.push(att);
    }
    const slotsAvailable = Math.max(0, maxSubmissionImages - submission._count.images);
    const addedImages: string[] = [];
    if (imageAttachments.length > 0 && slotsAvailable > 0) {
      await mkdir(submissionImageDirectory, { recursive: true });
      for (const att of imageAttachments.slice(0, slotsAvailable)) {
        try {
          const ext = att.mimeType === "image/jpeg" ? "jpg" : att.mimeType === "image/png" ? "png" : "webp";
          const newFileName = `${randomUUID()}.${ext}`;
          await copyFile(resolve(emailAttachmentDirectory, att.fileName), resolve(submissionImageDirectory, newFileName));
          await prisma.submissionImage.create({
            data: { submissionId, fileName: newFileName, originalName: att.originalName, mimeType: att.mimeType, size: att.size },
          });
          addedImages.push(att.originalName);
        } catch (imgErr) {
          newSteps.push(step("error", `Failed to copy "${att.originalName}": ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`));
        }
      }
      if (addedImages.length > 0) {
        newSteps.push(step("success", `Added ${addedImages.length} photo(s) to submission: ${addedImages.join(", ")}`));
      }
    }
    const skippedImages = imageAttachments.length - addedImages.length;
    if (skippedImages > 0 && slotsAvailable < imageAttachments.length) {
      newSteps.push(step("info", `${skippedImages} photo(s) not added — the submission already has ${maxSubmissionImages} images`));
    }

    // 3. Answer the contributor with a reply written for this conversation
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const editUrl = `${appUrl}/submissions/${submissionId}`;
    const generated = await generateAssistantReply({
      agent: thread.subAgent,
      messages: thread.messages,
      recipientName: thread.toName,
      context: [
        `You are writing to a resident who submitted a community story, "${submission.title}", to ${submission.publication.name}. They are a story contributor, not a business: do not mention directory listings, claim links or advertising unless they ask.`,
        `Your team earlier emailed them asking for more information based on an editorial review.${reviewFeedback ? ` The review said:\n${reviewFeedback}` : ""}`,
        newInfo.length
          ? `You have passed what they sent on to the editorial team, who will work it into the story: ${changes.join("; ")}.`
          : "Their latest message did not include new information for the story itself; respond to what they actually said.",
        addedImages.length
          ? `You added ${addedImages.length} photo(s) they attached (${addedImages.join(", ")}) to the submission.`
          : skippedImages > 0
            ? `${skippedImages} attached photo(s) could not be added because the submission already has the maximum of ${maxSubmissionImages} images.`
            : "",
        stillNeeded.length
          ? `Still needed from them (ask for these kindly, specifically and briefly, without repeating anything they already answered): ${stillNeeded.join("; ")}.
${CONTRIBUTOR_ASK_POLICY}`
          : "Nothing else is needed from them right now; the editorial team will take it from here. Do not promise publication or a date.",
        `They can view or edit their submission at ${editUrl} (include it only if it helps).`,
        instructions ? `Instructions from the editorial team for this conversation: ${instructions}` : "",
      ].filter(Boolean),
    });

    if (!generated) {
      newSteps.push(step("error", "The model returned no reply — nothing was sent to the contributor"));
    } else {
      await sendSubAgentEmail({
        subAgentId: thread.subAgent.id,
        toEmail: thread.toEmail,
        toName: thread.toName ?? undefined,
        bodyText: generated.reply,
        existingThreadId: threadId,
      });
      newSteps.push(
        step("success", generated.optedOut ? "Contributor declined — sent a gracious closing reply" : "Reply sent to the contributor"),
      );
    }

    // Keep the conversation going until nothing is missing; stop if they declined
    const optedOut = generated?.optedOut === true;
    const complete = !optedOut && stillNeeded.length === 0;
    if (optedOut) {
      newSteps.push(step("info", "Submitter declined to provide more information — request stopped"));
    } else if (complete) {
      newSteps.push(step("success", "All requested information received — request complete"));
    } else {
      newSteps.push(step("info", `Still waiting for: ${stillNeeded.join("; ")}`));
    }
    await saveProgress(
      {
        processedMessageIds: allProcessedIds,
        status: complete ? "complete" : "incorporated",
        incorporatedAt: new Date().toISOString(),
        lastReplyAt: new Date().toISOString(),
        followUpCount: 0,
        receivedInfo: [...previousInfo, ...newInfo],
        imagesAdded: (typeof result.imagesAdded === "number" ? result.imagesAdded : 0) + addedImages.length,
        stillNeeded,
        ...(optedOut ? { optedOut: true } : {}),
      },
      optedOut
        ? { status: AgentTaskStatus.STOPPED, completedAt: new Date() }
        : complete
          ? { status: AgentTaskStatus.SUCCEEDED, completedAt: new Date() }
          : {},
    );
  } catch (err) {
    console.error("[ClarificationReply] handleClarificationReply failed for thread", threadId, err);
  }
}

const FOLLOW_UP_AFTER_DAYS = 3;
// One gentle nudge only: more would be pushy
const MAX_FOLLOW_UPS = 1;
const GIVE_UP_AFTER_DAYS = 4;
const MS_PER_DAY = 86_400_000;

// The poller calls the check once per mailbox without awaiting it; overlapping runs could double-send.
let followUpCheckRunning = false;

/**
 * Keeps ongoing information requests moving when the submitter goes quiet: after
 * FOLLOW_UP_AFTER_DAYS without a reply, Claude writes a follow-up in the same thread (up to
 * MAX_FOLLOW_UPS); if there is still no reply GIVE_UP_AFTER_DAYS after the last one, the request
 * is stopped. Called periodically by the mail poller.
 */
export async function checkClarificationFollowUps(): Promise<void> {
  if (followUpCheckRunning) return;
  followUpCheckRunning = true;
  try {
    await runClarificationFollowUps();
  } finally {
    followUpCheckRunning = false;
  }
}

async function runClarificationFollowUps(): Promise<void> {
  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return;

  const tasks = await prisma.agentTask.findMany({
    where: { status: AgentTaskStatus.RUNNING, result: { path: ["contentType"], equals: "clarification" } },
    select: { id: true, result: true, steps: true, subAgent: { select: { id: true, name: true, soul: true } } },
  });

  for (const task of tasks) {
    try {
      const result = (task.result ?? {}) as Record<string, unknown>;
      if (result.status !== "sent" && result.status !== "incorporated") continue;
      const threadId = typeof result.threadId === "string" ? result.threadId : null;
      const submissionId = typeof result.referenceId === "string" ? result.referenceId : null;
      if (!threadId || !submissionId || !task.subAgent) continue;

      const thread = await prisma.emailThread.findUnique({
        where: { id: threadId },
        select: {
          toEmail: true,
          toName: true,
          messages: {
            orderBy: { createdAt: "asc" },
            select: { direction: true, bodyText: true, sentAt: true, receivedAt: true, createdAt: true },
          },
        },
      });
      const last = thread?.messages[thread.messages.length - 1];
      // Waiting on the submitter only when our message was the last one
      if (!thread || !last || last.direction !== MessageDirection.OUTBOUND) continue;

      const daysSinceLast = (Date.now() - (last.sentAt ?? last.createdAt).getTime()) / MS_PER_DAY;
      const followUpCount = typeof result.followUpCount === "number" ? result.followUpCount : 0;
      const steps = Array.isArray(task.steps) ? (task.steps as unknown[]) : [];

      if (followUpCount >= MAX_FOLLOW_UPS) {
        if (daysSinceLast < GIVE_UP_AFTER_DAYS) continue;
        await prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.STOPPED,
            completedAt: new Date(),
            result: { ...result, status: "no-response" } as unknown as Prisma.InputJsonValue,
            steps: [
              ...steps,
              step("info", `No reply after ${MAX_FOLLOW_UPS} follow-ups — request stopped`),
            ] as unknown as Prisma.InputJsonValue,
          },
        });
        continue;
      }
      if (daysSinceLast < FOLLOW_UP_AFTER_DAYS) continue;

      const submission = await prisma.contentSubmission.findUnique({
        where: { id: submissionId },
        select: { title: true, body: true, publication: { select: { name: true } } },
      });
      if (!submission) continue;
      const review =
        typeof result.reviewTaskId === "string"
          ? await prisma.agentTask.findUnique({ where: { id: result.reviewTaskId }, select: { result: true } })
          : null;
      const reviewFeedback = formatReviewFeedback(review?.result);
      const listOf = (value: unknown) =>
        Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
      // Before any reply, the request email itself shows what was asked (the full review list is too much)
      const stillNeeded = listOf(result.stillNeeded);
      const receivedInfoText = formatReceivedInfo(readReceivedInfo(result.receivedInfo));
      const instructions = typeof result.instructions === "string" ? result.instructions : "";
      const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
      const editUrl = `${appUrl}/submissions/${submissionId}`;
      const assistant = await prisma.agent.findUnique({ where: { slug: "assistant" }, select: { settings: true } });
      const settings = (assistant?.settings as Record<string, unknown> | null) ?? {};
      const model = typeof settings.clarificationModel === "string" ? settings.clarificationModel : "claude-haiku-5-5";
      const contributor = thread.toName || "The contributor";
      const isLast = followUpCount + 1 === MAX_FOLLOW_UPS;

      const draft = await draftContributorEmail({
        apiKey,
        model,
        requiredLink: editUrl,
        prompt: `You are ${task.subAgent.name}${task.subAgent.soul ? ` (your persona: ${task.subAgent.soul})` : ""}. You asked ${contributor} for more information about their community story "${submission.title}" for ${submission.publication.name}, and they have not replied for ${Math.floor(daysSinceLast)} days.

Current story:
${submission.body}

${reviewFeedback ? `Editorial review behind the request (internal; do not quote it):\n${reviewFeedback}\n` : ""}${receivedInfoText ? `\nInformation they already sent (do not ask for it again):\n${receivedInfoText}\n` : ""}
Still needed from them:
${stillNeeded.length ? stillNeeded.map((item, index) => `${index + 1}. ${item}`).join("\n") : "(the details asked for in the conversation below)"}
${instructions ? `\nInstructions from the editorial team (follow them):\n${instructions}\n` : ""}
${CONTRIBUTOR_ASK_POLICY}

The conversation so far, oldest first:
${renderTranscript(thread.messages, task.subAgent.name, contributor)}

Write a short, friendly follow-up in this conversation${isLast ? " — this is the last one, so make it easy for them: say even partial answers help, and that there's no pressure if they can't" : ""}. Do not repeat the earlier email; mention only the one or two most important things still needed, in a fresh way. Remind them they can reply here or update the story at this link, on its own line exactly: ${editUrl}
Under 120 words. Plain text; your signature is added automatically.`,
      });

      await sendSubAgentEmail({
        subAgentId: task.subAgent.id,
        toEmail: thread.toEmail,
        toName: thread.toName ?? undefined,
        bodyText: draft.body,
        existingThreadId: threadId,
      });
      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          result: { ...result, followUpCount: followUpCount + 1 } as unknown as Prisma.InputJsonValue,
          steps: [
            ...steps,
            step("success", `No reply for ${Math.floor(daysSinceLast)} days — follow-up ${followUpCount + 1} of ${MAX_FOLLOW_UPS} sent`),
          ] as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      console.error(`[ClarificationReply] follow-up failed for task ${task.id}:`, err);
    }
  }
}

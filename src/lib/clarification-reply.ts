import "server-only";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { submissionImageDirectory } from "@/lib/submission-images";
import { sendSubAgentEmail } from "@/lib/sub-agent-email";

type TaskStep = { at: string; level: "info" | "success" | "error"; message: string };

function step(level: TaskStep["level"], message: string): TaskStep {
  return { at: new Date().toISOString(), level, message };
}

const emailAttachmentDirectory = resolve(process.cwd(), "media", "email-attachments");

export async function handleClarificationReply(threadId: string): Promise<void> {
  try {
    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      select: { id: true, taskId: true, subAgentId: true, toEmail: true, toName: true, subject: true },
    });
    if (!thread?.taskId) return;

    const task = await prisma.agentTask.findUnique({
      where: { id: thread.taskId },
      select: { id: true, result: true, steps: true },
    });
    if (!task) return;

    const result = (task.result ?? {}) as Record<string, unknown>;
    if (result.contentType !== "clarification") return;
    // Only process once — task must be in "sent" state
    if (result.status !== "sent") return;

    const submissionId = typeof result.referenceId === "string" ? result.referenceId : null;
    if (!submissionId) return;

    // Find the latest inbound message on this thread
    const latestInbound = await prisma.emailMessage.findFirst({
      where: { threadId, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      select: { id: true, bodyText: true },
    });
    if (!latestInbound?.bodyText.trim()) return;

    const submission = await prisma.contentSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, title: true, body: true, images: { select: { id: true } } },
    });
    if (!submission) return;

    const taskSteps = Array.isArray(task.steps) ? (task.steps as unknown[]) : [];
    const newSteps: TaskStep[] = [
      step("info", `Reply received from ${thread.toEmail} — incorporating into submission`),
    ];

    // Get image attachments saved when the reply was polled
    const attachments = await prisma.emailAttachment.findMany({
      where: { emailMessageId: latestInbound.id },
      select: { id: true, fileName: true, originalName: true, mimeType: true, size: true },
    });
    const imageAttachments = attachments.filter((a) =>
      ["image/jpeg", "image/png", "image/webp"].includes(a.mimeType),
    );
    if (imageAttachments.length > 0) {
      newSteps.push(step("info", `${imageAttachments.length} image attachment(s) found`));
    }

    // Use Claude to incorporate the reply text into the submission body
    let updatedBody = submission.body;
    const apiKey = process.env.CLAUDE_KEY;

    if (apiKey) {
      const reviewItems: string[] = Array.isArray(result.reviewItems)
        ? (result.reviewItems as string[])
        : [];
      const itemList = reviewItems.length
        ? reviewItems.map((item, i) => `${i + 1}. ${item}`).join("\n")
        : "(general clarification request — no specific items listed)";

      const client = new Anthropic({ apiKey });
      newSteps.push(step("info", "Calling claude-haiku-5-5 to incorporate reply into submission body"));

      const message = await client.messages.create({
        model: "claude-haiku-5-5",
        max_tokens: 2000,
        system:
          "You are an editorial assistant. You incorporate new information provided by a story contributor into their existing submission. Write in the same tone and voice as the original. Never fabricate information not present in the reply.",
        messages: [
          {
            role: "user",
            content: `Story title: "${submission.title}"

Items the editorial team asked for clarification on:
${itemList}

Current submission body:
${submission.body}

The contributor's reply:
${latestInbound.bodyText}

Rewrite the submission body to incorporate the information from the contributor's reply, addressing each flagged item where they provided an answer. Keep all original content intact. Do not add information that was not provided in the reply. Return only the updated story body text — no preamble, no explanation.`,
          },
        ],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (textBlock?.type === "text" && textBlock.text.trim().length > 50) {
        updatedBody = textBlock.text.trim();
        newSteps.push(step("success", "Submission body updated with contributor reply"));
      } else {
        newSteps.push(step("info", "Model returned insufficient content — body left unchanged"));
      }
    } else {
      newSteps.push(step("info", "CLAUDE_KEY not set — submission body not updated"));
    }

    // Persist updated submission body
    if (updatedBody !== submission.body) {
      await prisma.contentSubmission.update({
        where: { id: submissionId },
        data: { body: updatedBody },
      });
    }

    // Copy image attachments into submission images
    const slotsAvailable = Math.max(0, 5 - submission.images.length);
    const imagesToAdd = imageAttachments.slice(0, slotsAvailable);
    const addedImages: string[] = [];

    if (imagesToAdd.length > 0) {
      await mkdir(submissionImageDirectory, { recursive: true });

      for (const att of imagesToAdd) {
        try {
          const ext = att.mimeType === "image/jpeg" ? "jpg" : att.mimeType === "image/png" ? "png" : "webp";
          const newFileName = `${randomUUID()}.${ext}`;
          await copyFile(
            resolve(emailAttachmentDirectory, att.fileName),
            resolve(submissionImageDirectory, newFileName),
          );
          await prisma.submissionImage.create({
            data: {
              submissionId,
              fileName: newFileName,
              originalName: att.originalName,
              mimeType: att.mimeType,
              size: att.size,
            },
          });
          addedImages.push(att.originalName);
        } catch (imgErr) {
          newSteps.push(
            step("error", `Failed to copy "${att.originalName}": ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`),
          );
        }
      }

      if (addedImages.length > 0) {
        newSteps.push(step("success", `Added ${addedImages.length} photo(s) to submission: ${addedImages.join(", ")}`));
      }
    }

    if (slotsAvailable < imageAttachments.length) {
      newSteps.push(
        step("info", `${imageAttachments.length - slotsAvailable} photo(s) skipped — submission already has 5 images`),
      );
    }

    // Mark task as incorporated
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        result: {
          ...result,
          status: "incorporated",
          incorporatedAt: new Date().toISOString(),
          bodyUpdated: updatedBody !== submission.body,
          imagesAdded: addedImages.length,
        } as unknown as Prisma.InputJsonValue,
        steps: [...taskSteps, ...newSteps] as unknown as Prisma.InputJsonValue,
      },
    });

    // Send confirmation reply to the contributor
    if (thread.subAgentId) {
      const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
      const editUrl = `${appUrl}/submissions/${submissionId}`;

      const lines = [
        "Thank you for sending that information! We've updated your submission with the details you provided.",
        ...(addedImages.length > 0
          ? [`We've also added ${addedImages.length} photo(s) to your submission.`]
          : []),
        `You can view your updated submission here:\n${editUrl}`,
      ];

      await sendSubAgentEmail({
        subAgentId: thread.subAgentId,
        toEmail: thread.toEmail,
        toName: thread.toName ?? undefined,
        subject: thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`,
        bodyText: lines.join("\n\n"),
        existingThreadId: threadId,
      });
    }
  } catch (err) {
    console.error("[ClarificationReply] handleClarificationReply failed for thread", threadId, err);
  }
}

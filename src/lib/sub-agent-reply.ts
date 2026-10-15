import "server-only";
import { MessageDirection, ReachoutTaskStatus } from "@prisma/client";
import { generateAssistantReply } from "@/lib/assistant-reply";
import { prisma } from "@/lib/db";
import { handleMarketerInboundMessage } from "@/lib/marketer-agent";
import { isPromotionThread } from "@/lib/promotion-deals";
import { sendSubAgentEmail } from "@/lib/sub-agent-email";

/**
 * Generates and sends an LLM reply for any inbound message on a thread that
 * is not already handled by the reachout-specific reply logic (which covers
 * RUNNING reachout tasks and adds the business's claim link as context).
 *
 * Requires CLAUDE_KEY in the environment. Silently no-ops if the key is absent.
 */
export async function handleGenericInboundMessage(threadId: string): Promise<void> {
  try {
    // Defer to the reachout handler for active onboarding threads
    const reachout = await prisma.reachoutTask.findUnique({
      where: { threadId },
      select: { status: true },
    });
    if (reachout?.status === ReachoutTaskStatus.RUNNING) return;
    // Advertiser review threads are answered by the Marketer's promotion handler
    if (await isPromotionThread(threadId)) return;

    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      include: {
        subAgent: { select: { id: true, name: true, soul: true, agent: { select: { slug: true } } } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!thread || thread.messages.length === 0) return;

    // Only reply when the last message is inbound (from the other party)
    const lastMessage = thread.messages[thread.messages.length - 1];
    if (lastMessage.direction !== MessageDirection.INBOUND) return;

    // Defer to handleClarificationReply for clarification threads
    if (thread.taskId) {
      const linkedTask = await prisma.agentTask.findUnique({
        where: { id: thread.taskId },
        select: { result: true },
      });
      const linkedResult = linkedTask?.result as Record<string, unknown> | null;
      if (linkedResult?.contentType === "clarification") return;
    }

    // Marketer threads (pitches and other business conversations) get the Marketer's own sales brief
    if (thread.subAgent.agent.slug === "marketer") {
      await handleMarketerInboundMessage(threadId);
      return;
    }

    const generated = await generateAssistantReply({
      agent: thread.subAgent,
      messages: thread.messages,
      recipientName: thread.toName,
      context: [`The email subject is "${thread.subject}".`],
    });
    if (!generated) return;
    const replyBody = generated.reply;

    await sendSubAgentEmail({
      subAgentId: thread.subAgent.id,
      toEmail: thread.toEmail,
      toName: thread.toName ?? undefined,
      bodyText: replyBody,
      existingThreadId: threadId,
    });
  } catch (err) {
    console.error(`[SubAgentReply] handleGenericInboundMessage failed for thread ${threadId}:`, err);
  }
}

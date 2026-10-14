import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MessageDirection, ReachoutTaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendSubAgentEmail } from "@/lib/sub-agent-email";

/**
 * Generates and sends an LLM reply for any inbound message on a thread that
 * is not already handled by the reachout-specific auto-reply logic (which
 * covers RUNNING reachout tasks with a hardcoded claim-URL template).
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

    const apiKey = process.env.CLAUDE_KEY;
    if (!apiKey) return;

    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      include: {
        subAgent: { select: { id: true, name: true, soul: true } },
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

    // Build the conversation history for Claude
    const claudeMessages: Anthropic.MessageParam[] = thread.messages.map((msg) => ({
      role: msg.direction === MessageDirection.OUTBOUND ? "assistant" : "user",
      content: msg.bodyText,
    }));

    const systemPrompt = [
      thread.subAgent.soul,
      "",
      "You are replying to an email conversation on behalf of Best Version Media.",
      "IMPORTANT: You may only discuss business-related matters — local advertising, publication listings, community stories, and business directory claims.",
      "If the sender raises any topic that is not directly related to these business purposes, politely acknowledge their message and redirect the conversation back to how you can help them with their local business or publication.",
      "Never discuss personal matters, politics, or topics unrelated to Best Version Media's services.",
      "Write a helpful, warm, and concise plain-text reply. Do not include a subject line, email headers, or metadata.",
      `Sign off with your name: ${thread.subAgent.name}.`,
    ]
      .filter(Boolean)
      .join("\n");

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: claudeMessages,
    });

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    const replyBody = textBlock?.text.trim();
    if (!replyBody) return;

    const subject = thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`;
    await sendSubAgentEmail({
      subAgentId: thread.subAgent.id,
      toEmail: thread.toEmail,
      toName: thread.toName ?? undefined,
      subject,
      bodyText: replyBody,
      existingThreadId: threadId,
    });
  } catch (err) {
    console.error(`[SubAgentReply] handleGenericInboundMessage failed for thread ${threadId}:`, err);
  }
}

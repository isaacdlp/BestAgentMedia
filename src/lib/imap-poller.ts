import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MessageDirection } from "@prisma/client";
import type { ImapFlow, FetchMessageObject } from "imapflow";
import { getSubAgentConfig } from "@/lib/sub-agent-email";
import { handleReachoutInboundMessage, checkReachoutReminders } from "@/lib/reachout-tasks";
import { handleClarificationReply } from "@/lib/clarification-reply";
import { handleGenericInboundMessage } from "@/lib/sub-agent-reply";
import { checkPromotionFollowUps, handlePromotionInboundMessage } from "@/lib/promotion-deals";
import { checkPromotionSaleFollowUps, handlePromotionSaleInboundMessage } from "@/lib/promotion-sales";
import { maximumSubmissionImageBytes } from "@/lib/submission-images";
import { prisma } from "@/lib/db";

const emailAttachmentDirectory = resolve(process.cwd(), "media", "email-attachments");

type PollerResult = { processed: number; errors: string[] };

async function importImapFlow(): Promise<typeof import("imapflow")> {
  return import("imapflow");
}

async function importMailparser(): Promise<typeof import("mailparser")> {
  return import("mailparser");
}

export async function pollSubAgentInbox(subAgentId: number): Promise<PollerResult> {
  const subAgent = await prisma.subAgent.findUnique({
    where: { id: subAgentId },
    select: { id: true, name: true, config: true },
  });
  if (!subAgent) throw new Error("Sub agent not found.");

  const config = getSubAgentConfig(subAgent.config);
  if (!config.imapHost || !config.imapUser || !config.imapPassword) {
    throw new Error("Sub agent IMAP is not fully configured (imapHost, imapUser, imapPassword required).");
  }

  const { ImapFlow: ImapFlowClass } = await importImapFlow();
  const { simpleParser } = await importMailparser();

  const client: ImapFlow = new ImapFlowClass({
    host: config.imapHost,
    port: config.imapPort ?? 993,
    secure: config.imapSecure ?? true,
    auth: { user: config.imapUser, pass: config.imapPassword },
    logger: false,
  });

  const result: PollerResult = { processed: 0, errors: [] };

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const messages: FetchMessageObject[] = [];
      for await (const msg of client.fetch({ seen: false }, { source: true, uid: true, flags: true })) {
        messages.push(msg);
      }

      for (const msg of messages) {
        try {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);

          // Extract common fields up front
          const fromAddr =
            typeof parsed.from?.value?.[0]?.address === "string"
              ? parsed.from.value[0].address
              : "unknown@unknown";

          const toAddr =
            typeof parsed.to === "object" && parsed.to !== null && "value" in parsed.to
              ? ((parsed.to as { value: { address?: string }[] }).value[0]?.address ?? config.imapUser ?? "unknown@unknown")
              : config.imapUser ?? "unknown@unknown";

          const bodyText =
            parsed.text ??
            (typeof parsed.html === "string" ? parsed.html.replace(/<[^>]*>/g, "") : "") ??
            "";

          const rawMessageId = (parsed.messageId ?? "").replace(/^<|>$/g, "").trim();

          // Deduplicate
          if (rawMessageId) {
            const exists = await prisma.emailMessage.findUnique({ where: { messageId: rawMessageId } });
            if (exists) {
              await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
              continue;
            }
          }

          const storedMessageId = rawMessageId || `imap-${subAgentId}-${Date.now()}-${Math.random()}`;

          const rawInReplyTo = parsed.inReplyTo ?? parsed.headers?.get("in-reply-to");
          const inReplyToRaw = typeof rawInReplyTo === "string" ? rawInReplyTo.trim() : null;
          const inReplyTo = inReplyToRaw ? inReplyToRaw.replace(/^<|>$/g, "").trim() : null;

          let threadId: string;

          if (!inReplyTo) {
            // Cold-start message: create a new thread for this sub-agent
            const thread = await prisma.emailThread.create({
              data: {
                subAgentId,
                toEmail: fromAddr,
                toName: parsed.from?.value?.[0]?.name ?? null,
                subject: parsed.subject ?? "(no subject)",
              },
              select: { id: true },
            });
            threadId = thread.id;
          } else {
            // Reply to one of our outbound messages — find the thread
            const original = await prisma.emailMessage.findUnique({
              where: { messageId: inReplyTo },
              select: { threadId: true },
            });

            if (!original) {
              // Doesn't match any of our sent messages — skip
              await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
              continue;
            }

            threadId = original.threadId;
          }

          const savedMessage = await prisma.emailMessage.create({
            data: {
              threadId,
              messageId: storedMessageId,
              inReplyTo,
              direction: MessageDirection.INBOUND,
              fromEmail: fromAddr,
              toEmail: toAddr,
              subject: parsed.subject ?? "(no subject)",
              bodyText,
              bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
              receivedAt: parsed.date ?? new Date(),
            },
            select: { id: true },
          });

          // Save image attachments from the inbound message
          const imageAttachments = (parsed.attachments ?? []).filter(
            (att) =>
              ["image/jpeg", "image/png", "image/webp"].includes(att.contentType) &&
              Buffer.isBuffer(att.content) &&
              att.content.length > 0 &&
              att.content.length <= maximumSubmissionImageBytes,
          );
          if (imageAttachments.length > 0) {
            try {
              await mkdir(emailAttachmentDirectory, { recursive: true });
              for (const att of imageAttachments) {
                const ext = att.contentType === "image/jpeg" ? "jpg"
                  : att.contentType === "image/png" ? "png"
                  : "webp";
                const fileName = `${randomUUID()}.${ext}`;
                try {
                  await writeFile(resolve(emailAttachmentDirectory, fileName), att.content as Buffer, { flag: "wx" });
                  await prisma.emailAttachment.create({
                    data: {
                      emailMessageId: savedMessage.id,
                      fileName,
                      originalName: (att.filename ?? `image.${ext}`).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || `image.${ext}`,
                      mimeType: att.contentType,
                      size: (att.content as Buffer).length,
                    },
                  });
                } catch {
                  // Skip this attachment if file write or DB create fails
                }
              }
            } catch {
              // Skip all attachments if directory creation fails
            }
          }

          await prisma.emailThread.update({
            where: { id: threadId },
            data: { updatedAt: new Date() },
          });

          await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
          result.processed++;

          // Reachout-specific reply (Claude, with the claim link as context; RUNNING tasks only)
          void handleReachoutInboundMessage(threadId);
          // Incorporate reply into submission for clarification threads
          void handleClarificationReply(threadId);
          // Marketer reply and deal tracking for ads/articles submitted for advertiser review
          void handlePromotionInboundMessage(threadId);
          // Marketer sales dialog for Promote campaigns (closes the sale and creates the purchased drafts)
          void handlePromotionSaleInboundMessage(threadId);
          // LLM-generated reply for all other threads
          void handleGenericInboundMessage(threadId);
        } catch (msgErr) {
          result.errors.push(msgErr instanceof Error ? msgErr.message : String(msgErr));
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  void checkReachoutReminders();
  void checkPromotionFollowUps().catch((err) => console.error("[PromotionDeal] follow-up check failed:", err));
  void checkPromotionSaleFollowUps().catch((err) => console.error("[PromotionSale] follow-up check failed:", err));

  return result;
}

/**
 * Deletes the messages with the given Message-IDs from the sub agent's INBOX (when IMAP is
 * configured). Returns how many mailbox messages were removed. Throws if the mailbox cannot be
 * reached so callers do not drop the local copy while the inbox still holds the messages.
 */
export async function deleteInboxMessages(subAgentId: number, messageIds: string[]): Promise<number> {
  const ids = messageIds.map((id) => id.replace(/^<|>$/g, "").trim()).filter(Boolean);
  if (!ids.length) return 0;

  const subAgent = await prisma.subAgent.findUnique({ where: { id: subAgentId }, select: { config: true } });
  if (!subAgent) throw new Error("Sub agent not found.");
  const config = getSubAgentConfig(subAgent.config);
  if (!config.imapHost || !config.imapUser || !config.imapPassword) return 0;

  const { ImapFlow: ImapFlowClass } = await importImapFlow();
  const client: ImapFlow = new ImapFlowClass({
    host: config.imapHost,
    port: config.imapPort ?? 993,
    secure: config.imapSecure ?? true,
    auth: { user: config.imapUser, pass: config.imapPassword },
    logger: false,
  });

  let removed = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = new Set<number>();
      for (const id of ids) {
        const found = await client.search({ header: { "message-id": id } }, { uid: true });
        for (const uid of found || []) uids.add(uid);
      }
      if (uids.size) {
        await client.messageDelete([...uids], { uid: true });
        removed = uids.size;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return removed;
}

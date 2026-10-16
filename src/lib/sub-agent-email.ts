import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MessageDirection, Prisma } from "@prisma/client";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";

export type SubAgentConfig = {
  smtpFromEmail?: string;
  smtpFromName?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  smtpRequireTls?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  imapPassword?: string;
  imapSecure?: boolean;
};

export function getSubAgentConfig(raw: unknown): SubAgentConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as SubAgentConfig;
}

function buildMessageId(domain: string): string {
  return `${randomUUID()}.${Date.now()}@${domain || "bestagentmedia.app"}`;
}

function smtpDomain(config: SubAgentConfig): string {
  if (config.smtpFromEmail) {
    const at = config.smtpFromEmail.indexOf("@");
    if (at !== -1) return config.smtpFromEmail.slice(at + 1);
  }
  return config.smtpHost ?? "bestagentmedia.app";
}

const COMPANY_NAME = "Best Version Media";
const SIGNATURE_PICTURE_CID = "signature-picture@bestagentmedia";
/** Name of the signature picture we attach; inbound files with this name are never taken as photos. */
const SIGNATURE_PICTURE_FILENAME = "signature.jpg";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Reads the sub agent's stored picture (media/sub-agents/<file>) or returns null when unavailable. */
async function loadSignaturePicture(picturePath: string | null): Promise<Buffer | null> {
  const filename = picturePath?.match(/^media\/sub-agents\/([a-z0-9._-]+)$/i)?.[1];
  if (!filename) return null;
  try {
    return await readFile(resolve(process.cwd(), "media", "sub-agents", filename));
  } catch {
    return null;
  }
}

const sha256 = (content: Buffer) => createHash("sha256").update(content).digest("hex");

/**
 * True when an inbound attachment is one of our own signature pictures echoed back by the
 * recipient's mail client (quoted replies re-attach the inline image, often under a new name and
 * Content-ID), so it must not be mistaken for a photo the person sent.
 */
export async function isSignaturePicture(
  content: Buffer | null,
  { cid, fileName }: { cid?: string | null; fileName?: string | null } = {},
): Promise<boolean> {
  // Banned by name: any file called signature.jpg is treated as our signature, whatever its content
  if (fileName?.trim().split(/[\\/]/).pop()?.toLowerCase() === SIGNATURE_PICTURE_FILENAME) return true;
  if (cid?.replace(/^<|>$/g, "") === SIGNATURE_PICTURE_CID) return true;
  if (!content) return false;
  const directory = resolve(process.cwd(), "media", "sub-agents");
  let files: string[];
  try {
    files = await readdir(directory);
  } catch {
    return false;
  }
  const hash = sha256(content);
  for (const file of files) {
    try {
      if (sha256(await readFile(resolve(directory, file))) === hash) return true;
    } catch {
      // Unreadable file: not a match
    }
  }
  return false;
}

export async function sendSubAgentEmail(opts: {
  subAgentId: number;
  /** AgentTask.id to link the new thread to. Omit when appending to an existing thread. */
  taskId?: string;
  toEmail: string;
  toName?: string;
  /** Omit when appending to an existing thread to reply with "Re: <latest subject>". */
  subject?: string;
  bodyText: string;
  bodyHtml?: string;
  /** Existing thread to append to (for follow-ups). Creates a new thread when omitted. */
  existingThreadId?: string;
  /** Files to attach, read from disk when the message is sent. */
  attachments?: { filename: string; path: string; contentType: string }[];
}): Promise<{ threadId: string; messageId: string; sentTo: string }> {
  const subAgent = await prisma.subAgent.findUnique({
    where: { id: opts.subAgentId },
    select: { id: true, name: true, picturePath: true, config: true },
  });
  if (!subAgent) throw new Error("Sub agent not found.");

  const config = getSubAgentConfig(subAgent.config);
  if (!config.smtpHost || !config.smtpUser || !config.smtpPassword || !config.smtpFromEmail) {
    throw new Error("Sub agent SMTP is not fully configured (smtpHost, smtpUser, smtpPassword, smtpFromEmail required).");
  }

  const messageId = buildMessageId(smtpDomain(config));
  const dummyEmail = process.env.DUMMY_EMAIL?.trim();
  const actualTo = dummyEmail || opts.toEmail;

  let inReplyTo: string | undefined;
  let references: string[] = [];
  let threadId = opts.existingThreadId;
  let subject = opts.subject;

  if (threadId) {
    // Reply to the most recent message in the thread (either direction) and carry the full
    // References chain so mail clients such as Gmail keep it in the same conversation.
    const history = await prisma.emailMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
      select: { messageId: true, subject: true },
    });
    const last = history[history.length - 1];
    if (last) {
      inReplyTo = last.messageId;
      references = history.map((m) => m.messageId);
      if (!subject) subject = last.subject;
    }
    if (!subject) {
      const thread = await prisma.emailThread.findUnique({ where: { id: threadId }, select: { subject: true } });
      subject = thread?.subject;
    }
    if (opts.subject === undefined && subject) {
      subject = `Re: ${subject.replace(/^(\s*re:\s*)+/i, "")}`;
    }
  }
  if (!subject) throw new Error("Email subject is required.");
  const finalSubject = subject;

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort ?? 587,
    secure: config.smtpSecure ?? false,
    requireTLS: config.smtpRequireTls ?? true,
    auth: { user: config.smtpUser, pass: config.smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  const fromAddress = config.smtpFromName
    ? `"${config.smtpFromName}" <${config.smtpFromEmail}>`
    : config.smtpFromEmail;

  // Every outbound email carries a signature with the agent's picture, name and company.
  const signatureName = subAgent.name;
  const picture = await loadSignaturePicture(subAgent.picturePath);
  const signatureText = `\n\n--\n${signatureName}\n${COMPANY_NAME}`;
  const signatureHtml =
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid #ddd;padding-top:12px"><tr>` +
    (picture
      ? `<td style="padding-right:12px;vertical-align:middle"><img src="cid:${SIGNATURE_PICTURE_CID}" alt="${escapeHtml(signatureName)}" width="64" height="64" style="border-radius:50%;display:block"></td>`
      : "") +
    `<td style="vertical-align:middle;font-family:Arial,sans-serif;font-size:14px;line-height:1.4">` +
    `<strong>${escapeHtml(signatureName)}</strong><br>${escapeHtml(COMPANY_NAME)}</td></tr></table>`;
  const bodyHtml = opts.bodyHtml ?? opts.bodyText.replace(/\n/g, "<br>");

  const mailOptions: Parameters<typeof transport.sendMail>[0] = {
    from: fromAddress,
    to: actualTo,
    subject: finalSubject,
    text: opts.bodyText + signatureText,
    html: bodyHtml + signatureHtml,
    attachments: [
      ...(picture
        ? [{ filename: SIGNATURE_PICTURE_FILENAME, content: picture, contentType: "image/jpeg", cid: SIGNATURE_PICTURE_CID, contentDisposition: "inline" as const }]
        : []),
      ...(opts.attachments ?? []),
    ],
    headers: {
      "Message-ID": `<${messageId}>`,
      ...(inReplyTo
        ? { "In-Reply-To": `<${inReplyTo}>`, References: references.map((id) => `<${id}>`).join(" ") }
        : {}),
    },
  };

  await transport.sendMail(mailOptions);

  const now = new Date();

  if (!threadId) {
    const thread = await prisma.emailThread.create({
      data: {
        subAgentId: opts.subAgentId,
        taskId: opts.taskId ?? null,
        toEmail: opts.toEmail,
        toName: opts.toName,
        subject: finalSubject,
      },
      select: { id: true },
    });
    threadId = thread.id;
  }

  await prisma.emailMessage.create({
    data: {
      threadId,
      messageId,
      inReplyTo: inReplyTo ?? null,
      direction: MessageDirection.OUTBOUND,
      fromEmail: config.smtpFromEmail,
      toEmail: actualTo,
      subject: finalSubject,
      bodyText: opts.bodyText,
      bodyHtml: opts.bodyHtml ?? null,
      sentAt: now,
    },
  });

  await prisma.emailThread.update({
    where: { id: threadId },
    data: { updatedAt: now },
  });

  return { threadId, messageId, sentTo: actualTo };
}

export async function updateTaskWithThread(
  taskId: string,
  threadId: string,
  subAgentId: number,
  sentTo: string,
): Promise<void> {
  const task = await prisma.agentTask.findUnique({
    where: { id: taskId },
    select: { result: true, steps: true },
  });
  if (!task) return;

  const result = (task.result as Record<string, unknown> | null) ?? {};
  const steps = Array.isArray(task.steps) ? (task.steps as unknown[]) : [];

  await prisma.agentTask.update({
    where: { id: taskId },
    data: {
      subAgentId,
      result: {
        ...result,
        status: "sent",
        threadId,
        sentTo,
      } as unknown as Prisma.InputJsonValue,
      steps: [
        ...steps,
        { at: new Date().toISOString(), level: "success", message: `Email sent to ${sentTo} via sub agent — thread created` },
      ] as unknown as Prisma.InputJsonValue,
    },
  });
}

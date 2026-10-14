import "server-only";
import { randomUUID } from "node:crypto";
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

export async function sendSubAgentEmail(opts: {
  subAgentId: number;
  /** AgentTask.id to link the new thread to. Omit when appending to an existing thread. */
  taskId?: string;
  toEmail: string;
  toName?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  /** Existing thread to append to (for follow-ups). Creates a new thread when omitted. */
  existingThreadId?: string;
}): Promise<{ threadId: string; messageId: string; sentTo: string }> {
  const subAgent = await prisma.subAgent.findUnique({
    where: { id: opts.subAgentId },
    select: { id: true, name: true, config: true },
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
  let threadId = opts.existingThreadId;

  if (threadId) {
    const last = await prisma.emailMessage.findFirst({
      where: { thread: { id: threadId }, direction: MessageDirection.OUTBOUND },
      orderBy: { createdAt: "desc" },
      select: { messageId: true },
    });
    if (last) inReplyTo = last.messageId;
  }

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

  const mailOptions: Parameters<typeof transport.sendMail>[0] = {
    from: fromAddress,
    to: actualTo,
    subject: opts.subject,
    text: opts.bodyText,
    html: opts.bodyHtml ?? opts.bodyText.replace(/\n/g, "<br>"),
    headers: {
      "Message-ID": `<${messageId}>`,
      ...(inReplyTo ? { "In-Reply-To": `<${inReplyTo}>`, References: `<${inReplyTo}>` } : {}),
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
        subject: opts.subject,
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
      subject: opts.subject,
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

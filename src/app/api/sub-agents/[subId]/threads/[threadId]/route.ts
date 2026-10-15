import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteInboxMessages } from "@/lib/imap-poller";

type Params = { params: Promise<{ subId: string; threadId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { subId, threadId } = await params;
  if (!/^[1-9]\d*$/.test(subId) || !/^[\w-]{1,64}$/.test(threadId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const thread = await prisma.emailThread.findFirst({
    where: { id: threadId, subAgentId: Number(subId) },
    select: {
      id: true,
      toEmail: true,
      toName: true,
      subject: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          messageId: true,
          inReplyTo: true,
          direction: true,
          fromEmail: true,
          toEmail: true,
          subject: true,
          bodyText: true,
          bodyHtml: true,
          sentAt: true,
          receivedAt: true,
          createdAt: true,
        },
      },
    },
  });

  if (!thread) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(thread);
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { subId, threadId } = await params;
  if (!/^[1-9]\d*$/.test(subId) || !/^[\w-]{1,64}$/.test(threadId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const thread = await prisma.emailThread.findFirst({
    where: { id: threadId, subAgentId: Number(subId) },
    select: {
      id: true,
      messages: { select: { messageId: true, attachments: { select: { fileName: true } } } },
    },
  });
  if (!thread) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Remove from the mailbox first; if it cannot be reached keep the local copy so nothing is orphaned.
  let inboxRemoved = 0;
  try {
    inboxRemoved = await deleteInboxMessages(Number(subId), thread.messages.map((m) => m.messageId));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not delete from the email inbox: ${detail}` }, { status: 502 });
  }

  await prisma.emailThread.delete({ where: { id: thread.id } });

  const attachmentDirectory = resolve(process.cwd(), "media", "email-attachments");
  for (const message of thread.messages) {
    for (const { fileName } of message.attachments) {
      if (!/^[\w.-]+$/.test(fileName)) continue;
      await rm(resolve(attachmentDirectory, fileName), { force: true }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, inboxRemoved });
}

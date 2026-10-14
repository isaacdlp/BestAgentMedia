import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

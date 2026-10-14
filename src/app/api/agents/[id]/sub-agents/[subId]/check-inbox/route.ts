import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { pollSubAgentInbox } from "@/lib/imap-poller";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string; subId: string }> };

export async function POST(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { id, subId } = await params;
  if (!/^[1-9]\d*$/.test(id) || !/^[1-9]\d*$/.test(subId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const subAgent = await prisma.subAgent.findFirst({
    where: { id: Number(subId), agentId: Number(id) },
    select: { id: true },
  });
  if (!subAgent) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const result = await pollSubAgentInbox(Number(subId));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

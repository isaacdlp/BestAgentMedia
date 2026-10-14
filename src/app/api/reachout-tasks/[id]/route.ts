import { ReachoutTaskStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  action: z.enum(["stop"]),
});

export async function GET(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { id } = await params;

  const task = await prisma.reachoutTask.findUnique({
    where: { id },
    include: {
      business: { select: { id: true, name: true, email: true, postalCode: true } },
      subAgent: { select: { id: true, name: true } },
      thread: {
        select: {
          id: true,
          subject: true,
          updatedAt: true,
          _count: { select: { messages: true } },
        },
      },
    },
  });
  if (!task) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(task);
}

export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide action: stop." }, { status: 400 });
  }

  const task = await prisma.reachoutTask.findUnique({ where: { id }, select: { status: true } });
  if (!task) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (task.status !== ReachoutTaskStatus.PENDING && task.status !== ReachoutTaskStatus.RUNNING) {
    return NextResponse.json({ error: "Task is not active." }, { status: 409 });
  }

  const updated = await prisma.reachoutTask.update({
    where: { id },
    data: { status: ReachoutTaskStatus.STOPPED, message: "Stopped by user.", finishedAt: new Date() },
    select: { id: true, status: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { id } = await params;

  const task = await prisma.reachoutTask.findUnique({ where: { id }, select: { id: true } });
  if (!task) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.reachoutTask.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}

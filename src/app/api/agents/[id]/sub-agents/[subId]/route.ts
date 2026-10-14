import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string; subId: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  soul: z.string().trim().min(1).max(10_000).optional(),
  cellNumber: z.string().trim().max(50).nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(_req: Request, { params }: Params) {
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
    select: {
      id: true,
      name: true,
      soul: true,
      picturePath: true,
      cellNumber: true,
      config: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!subAgent) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(subAgent);
}

export async function PATCH(req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { id, subId } = await params;
  if (!/^[1-9]\d*$/.test(id) || !/^[1-9]\d*$/.test(subId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const existing = await prisma.subAgent.findFirst({
    where: { id: Number(subId), agentId: Number(id) },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await req.json() as unknown;
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data.", details: parsed.error.issues }, { status: 400 });
  }

  const updated = await prisma.subAgent.update({
    where: { id: Number(subId) },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.soul !== undefined && { soul: parsed.data.soul }),
      ...(parsed.data.cellNumber !== undefined && { cellNumber: parsed.data.cellNumber }),
      ...(parsed.data.config !== undefined && {
        config: parsed.data.config as Parameters<typeof prisma.subAgent.update>[0]["data"]["config"],
      }),
    },
    select: { id: true, name: true, updatedAt: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { id, subId } = await params;
  if (!/^[1-9]\d*$/.test(id) || !/^[1-9]\d*$/.test(subId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const existing = await prisma.subAgent.findFirst({
    where: { id: Number(subId), agentId: Number(id) },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.subAgent.delete({ where: { id: Number(subId) } });
  return NextResponse.json({ ok: true });
}

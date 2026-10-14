import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  name: z.string().trim().min(1).max(100).default("New Sub Agent"),
  soul: z.string().trim().max(10_000).default(""),
  cellNumber: z.string().trim().max(50).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const sp = Object.fromEntries(searchParams.entries());
  const { parseListParams } = await import("@/lib/list-params");
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "createdAt", "asc");

  const where = {
    agentId: Number(id),
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const orderBy = sort === "name" ? [{ name: order }] : [{ createdAt: order }];

  const [subAgents, total] = await Promise.all([
    prisma.subAgent.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        soul: true,
        picturePath: true,
        cellNumber: true,
        config: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { emailThreads: true } },
      },
    }),
    prisma.subAgent.count({ where }),
  ]);

  return NextResponse.json({ items: subAgents, total, page, limit });
}

export async function POST(req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

  const agent = await prisma.agent.findUnique({ where: { id: Number(id) }, select: { id: true } });
  if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

  const body = await req.json() as unknown;
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data.", details: parsed.error.issues }, { status: 400 });
  }

  const subAgent = await prisma.subAgent.create({
    data: {
      agentId: Number(id),
      name: parsed.data.name,
      soul: parsed.data.soul,
      cellNumber: parsed.data.cellNumber ?? null,
      config: (parsed.data.config ?? {}) as Parameters<typeof prisma.subAgent.create>[0]["data"]["config"],
    },
    select: { id: true, name: true, createdAt: true },
  });

  return NextResponse.json(subAgent, { status: 201 });
}

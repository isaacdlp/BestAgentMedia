import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to view agent tasks." }, { status: 401 });
  if (user.role !== UserRole.ADMIN) return NextResponse.json({ error: "Administrators only." }, { status: 403 });

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const sp = Object.fromEntries(searchParams.entries());
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "createdAt", "desc");

  const where = {
    agentId: Number(id),
    ...(q ? { label: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const orderBy =
    sort === "status" ? [{ status: order }, { createdAt: "desc" as const }]
    : sort === "label" ? [{ label: order }]
    : [{ createdAt: order }];

  const [items, total] = await Promise.all([
    prisma.agentTask.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        status: true,
        label: true,
        steps: true,
        result: true,
        error: true,
        issueId: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        triggeredBy: { select: { name: true, surname: true } },
      },
    }),
    prisma.agentTask.count({ where }),
  ]);

  return NextResponse.json({ items, total, page, limit });
}

import { after } from "next/server";
import { ReachoutTaskStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseListParams } from "@/lib/list-params";
import { runReachoutTask } from "@/lib/reachout-tasks";

const createSchema = z.object({
  businessIds: z.array(z.number().int().positive()).min(1).max(200),
});

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sp = Object.fromEntries(searchParams.entries());
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "createdAt", "desc");
  const statusFilter = searchParams.get("status");

  const where = {
    ...(q ? { business: { name: { contains: q, mode: "insensitive" as const } } } : {}),
    ...(statusFilter ? { status: statusFilter as ReachoutTaskStatus } : {}),
  };

  const orderBy =
    sort === "status" ? [{ status: order }]
    : sort === "businessName" ? [{ business: { name: order } }]
    : [{ createdAt: order }];

  const [items, total] = await Promise.all([
    prisma.reachoutTask.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        business: { select: { id: true, name: true, email: true, postalCode: true } },
        subAgent: { select: { id: true, name: true } },
        thread: { select: { _count: { select: { messages: true } } } },
      },
    }),
    prisma.reachoutTask.count({ where }),
  ]);

  return NextResponse.json({ items, total, page, limit }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide at least one businessId." }, { status: 400 });
  }

  const { businessIds } = parsed.data;

  // Skip businesses that already have an active task
  const existing = await prisma.reachoutTask.findMany({
    where: {
      businessId: { in: businessIds },
      status: { in: [ReachoutTaskStatus.PENDING, ReachoutTaskStatus.RUNNING] },
    },
    select: { businessId: true },
  });
  const existingIds = new Set(existing.map((t) => t.businessId));
  const newIds = businessIds.filter((id) => !existingIds.has(id));

  if (!newIds.length) {
    return NextResponse.json(
      { error: "All selected businesses already have an active onboarding task." },
      { status: 409 },
    );
  }

  const tasks = await prisma.$transaction(
    newIds.map((businessId) =>
      prisma.reachoutTask.create({
        data: { businessId, createdByUserId: user.id },
        select: { id: true, businessId: true },
      }),
    ),
  );

  after(async () => {
    for (const task of tasks) {
      await runReachoutTask(task.id);
    }
  });

  const registryTasks = await prisma.task.findMany({
    where: { reachoutTaskId: { in: tasks.map((task) => task.id) } },
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });

  return NextResponse.json(
    { created: tasks.length, skipped: businessIds.length - newIds.length, tasks: registryTasks },
    { status: 202 },
  );
}

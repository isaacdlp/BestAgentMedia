import { after } from "next/server";
import { BusinessImportTaskStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runBusinessImportTask } from "@/lib/business-import-tasks";

const createTaskSchema = z.object({
  source: z.enum([
    "here",
    "google-places",
    "overpass",
    "yelp-fusion",
    "foursquare-places",
  ]),
  zipCode: z.string().regex(/^\d{5}$/),
  categories: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  limit: z.number().int().positive().max(10_000),
});

export const maxDuration = 300;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sp = Object.fromEntries(searchParams.entries());
  const { parseListParams } = await import("@/lib/list-params");
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "startedAt", "desc");

  const where = q
    ? {
        OR: [
          { zipCode: { contains: q, mode: "insensitive" as const } },
          { sourceProvider: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const orderBy =
    sort === "status" ? [{ status: order }, { startedAt: "desc" as const }]
    : sort === "zipCode" ? [{ zipCode: order }]
    : [{ startedAt: order }, { createdAt: "desc" as const }];

  const [taskRows, total] = await Promise.all([
    prisma.businessImportTask.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: { _count: { select: { businesses: true } } },
    }),
    prisma.businessImportTask.count({ where }),
  ]);

  return NextResponse.json(
    {
      items: taskRows.map(({ _count, ...task }) => ({ ...task, businessCount: _count.businesses })),
      total,
      page,
      limit,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Provide a valid task request." }, { status: 400 });
  }
  const parsed = createTaskSchema.safeParse(requestBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a ZIP code, at least one category, and a positive business limit." },
      { status: 400 },
    );
  }
  if (parsed.data.source !== "here") {
    return NextResponse.json(
      { error: "Feature Not Implemented: this business search source is not available yet." },
      { status: 501 },
    );
  }

  const zipCode = await prisma.zipCode.findUnique({
    where: { code: parsed.data.zipCode },
    select: { code: true, boundaryGeometry: true },
  });
  if (!zipCode?.boundaryGeometry) {
    return NextResponse.json(
      { error: "That ZIP code does not have a searchable boundary." },
      { status: 400 },
    );
  }

  const task = await prisma.businessImportTask.create({
    data: {
      sourceProvider: "HERE",
      zipCode: parsed.data.zipCode,
      categories: [...new Set(parsed.data.categories)],
      newBusinessLimit: parsed.data.limit,
      status: BusinessImportTaskStatus.RUNNING,
      message: "Import task started.",
      createdByUserId: user.id,
    },
    select: { id: true },
  });

  after(async () => {
    await runBusinessImportTask(task.id);
  });

  return NextResponse.json({ id: task.id }, { status: 202 });
}

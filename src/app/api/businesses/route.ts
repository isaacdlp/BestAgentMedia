import { UserRole, ReachoutTaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sp = Object.fromEntries(searchParams.entries());
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "name", "asc");
  const withReachoutStatus = searchParams.has("withReachoutStatus");

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { primaryCategory: { contains: q, mode: "insensitive" as const } },
          { city: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const orderBy =
    sort === "city" ? [{ city: order }]
    : sort === "category" ? [{ primaryCategory: order }]
    : [{ name: order }];

  const [businesses, total] = await Promise.all([
    prisma.business.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        primaryCategory: true,
        postalCode: true,
        ...(withReachoutStatus
          ? {
              reachoutTasks: {
                where: { status: { in: [ReachoutTaskStatus.PENDING, ReachoutTaskStatus.RUNNING] } },
                select: { id: true },
                take: 1,
              },
            }
          : {}),
      },
    }),
    prisma.business.count({ where }),
  ]);

  const items = businesses.map((b) => {
    const { reachoutTasks, ...rest } = b as typeof b & { reachoutTasks?: { id: string }[] };
    return {
      ...rest,
      ...(withReachoutStatus ? { hasActiveTask: (reachoutTasks?.length ?? 0) > 0 } : {}),
    };
  });

  return NextResponse.json({ items, total, page, limit }, { headers: { "Cache-Control": "no-store" } });
}

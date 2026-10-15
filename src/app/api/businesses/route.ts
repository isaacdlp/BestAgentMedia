import { AgentTaskStatus, Prisma, PromotionSaleStatus, UserRole, ReachoutTaskStatus } from "@prisma/client";
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
  // Promote: only businesses in the ZIP codes served by the issue's publication, with their sale status.
  const issueId = searchParams.get("issueId");
  if (issueId !== null && !/^[\w-]{1,64}$/.test(issueId)) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }
  const issue = issueId
    ? await prisma.issue.findUnique({
        where: { id: issueId },
        select: { id: true, publication: { select: { zipCodes: { select: { code: true } } } } },
      })
    : null;
  if (issueId && !issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });

  const filters: Prisma.BusinessWhereInput[] = [];
  if (issue) filters.push({ postalCode: { in: issue.publication.zipCodes.map((zip) => zip.code) } });
  if (q) {
    filters.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { primaryCategory: { contains: q, mode: "insensitive" } },
        { categories: { has: q } },
        { city: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { postalCode: { contains: q } },
      ],
    });
  }
  const where: Prisma.BusinessWhereInput = filters.length ? { AND: filters } : {};

  const orderBy: Prisma.BusinessOrderByWithRelationInput[] =
    sort === "city" ? [{ city: order }, { name: "asc" }]
    : sort === "category" ? [{ primaryCategory: order }, { name: "asc" }]
    : sort === "zip" ? [{ postalCode: order }, { name: "asc" }]
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
        ...(issue
          ? {
              promotionSales: {
                where: {
                  OR: [
                    { optedOut: true },
                    { issueId: issue.id, agentTask: { status: { in: [AgentTaskStatus.PENDING, AgentTaskStatus.RUNNING] } } },
                    { issueId: issue.id, status: PromotionSaleStatus.PURCHASED },
                  ],
                },
                select: { optedOut: true, status: true },
              },
              promotionDeals: { where: { optedOut: true }, select: { id: true }, take: 1 },
            }
          : {}),
      },
    }),
    prisma.business.count({ where }),
  ]);

  const items = businesses.map((b) => {
    const { reachoutTasks, promotionSales, promotionDeals, ...rest } = b as typeof b & {
      reachoutTasks?: { id: string }[];
      promotionSales?: { optedOut: boolean; status: string }[];
      promotionDeals?: { id: number }[];
    };
    return {
      ...rest,
      ...(withReachoutStatus ? { hasActiveTask: (reachoutTasks?.length ?? 0) > 0 } : {}),
      ...(issue
        ? {
            saleStatus: promotionSales?.some((sale) => sale.optedOut) || promotionDeals?.length
              ? "opted_out"
              : promotionSales?.some((sale) => sale.status === "PURCHASED")
                ? "purchased"
                : promotionSales?.length
                  ? "active"
                  : "eligible",
          }
        : {}),
    };
  });

  return NextResponse.json({ items, total, page, limit }, { headers: { "Cache-Control": "no-store" } });
}

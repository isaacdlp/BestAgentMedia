import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ subId: string }> };

export async function GET(req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { subId } = await params;
  if (!/^[1-9]\d*$/.test(subId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const sp = Object.fromEntries(searchParams.entries());
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "updatedAt", "desc");

  const where = {
    subAgentId: Number(subId),
    ...(q
      ? {
          OR: [
            { subject: { contains: q, mode: "insensitive" as const } },
            { toEmail: { contains: q, mode: "insensitive" as const } },
            { toName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const orderBy =
    sort === "subject" ? [{ subject: order }]
    : sort === "toEmail" ? [{ toEmail: order }]
    : [{ updatedAt: order }];

  const [items, total] = await Promise.all([
    prisma.emailThread.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        toEmail: true,
        toName: true,
        subject: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { direction: true, createdAt: true },
        },
      },
    }),
    prisma.emailThread.count({ where }),
  ]);

  return NextResponse.json({ items, total, page, limit });
}

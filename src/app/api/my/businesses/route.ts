import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const businesses = await prisma.business.findMany({
    where: { ownerUserId: user.id },
    select: {
      id: true,
      name: true,
      primaryCategory: true,
      addressLabel: true,
      city: true,
      stateCode: true,
      postalCode: true,
      phone: true,
      email: true,
      website: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ items: businesses });
}

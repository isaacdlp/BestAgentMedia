import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
});

export async function GET(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const business = await prisma.business.findFirst({
    where: { id: Number(id), ownerUserId: user.id },
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
      updatedAt: true,
    },
  });

  if (!business) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(business);
}

export async function PATCH(req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const existing = await prisma.business.findFirst({
    where: { id: Number(id), ownerUserId: user.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await req.json() as unknown;
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid data." }, { status: 400 });

  const updated = await prisma.business.update({
    where: { id: Number(id) },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.phone !== undefined && { phone: parsed.data.phone }),
      ...(parsed.data.website !== undefined && { website: parsed.data.website }),
    },
    select: { id: true, name: true, phone: true, website: true, updatedAt: true },
  });

  return NextResponse.json(updated);
}

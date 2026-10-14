import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createBusinessPitch } from "@/lib/marketer-agent";

const bodySchema = z.object({
  pitchType: z.enum(["sponsored_article", "advertisement"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to send a pitch." }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) {
    return NextResponse.json({ error: "Business not found." }, { status: 404 });
  }
  const businessId = Number(id);

  const parsed = bodySchema.safeParse(await request.json() as unknown);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide a valid pitchType (sponsored_article or advertisement)." }, { status: 400 });
  }

  try {
    const taskId = await createBusinessPitch(businessId, parsed.data.pitchType, user.id);
    return NextResponse.json({ taskId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

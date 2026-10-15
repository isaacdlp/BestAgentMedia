import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { MAX_PROMOTION_INSTRUCTIONS, PromotionReviewError } from "@/lib/promotion-deals";
import { launchPromotionSales, MAX_SALE_BUSINESSES } from "@/lib/promotion-sales";

const createSchema = z.object({
  issueId: z.string().regex(/^[\w-]{1,64}$/),
  businessIds: z.array(z.number().int().positive().safe()).min(1).max(MAX_SALE_BUSINESSES),
  instructions: z.string().max(MAX_PROMOTION_INSTRUCTIONS).optional().default(""),
});

/** "Promote": the Marketer emails each selected business to sell paid promotions in the issue. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: `Choose an issue and between 1 and ${MAX_SALE_BUSINESSES} businesses; keep the instructions under ${MAX_PROMOTION_INSTRUCTIONS} characters.`,
      },
      { status: 400 },
    );
  }

  try {
    const { tasks, skipped } = await launchPromotionSales(user, parsed.data);
    return NextResponse.json({ created: tasks.length, tasks, skipped }, { status: 202 });
  } catch (error) {
    if (error instanceof PromotionReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

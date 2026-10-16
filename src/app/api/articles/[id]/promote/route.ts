import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getArticleScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MAX_PROMOTION_INSTRUCTIONS, PromotionReviewError } from "@/lib/promotion-deals";
import { launchPromotionSales } from "@/lib/promotion-sales";

const promoteSchema = z.object({
  issueId: z.string().regex(/^[\w-]{1,64}$/),
  instructions: z.string().max(MAX_PROMOTION_INSTRUCTIONS).optional().default(""),
});

/**
 * "Promote" on an article: the Marketer emails the article's business to sign the article up as a
 * paid sponsored feature in the chosen issue (and sell other placements where they fit). Allowed
 * only while the article has a business and no paid promotion style.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Article not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = promoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Choose an issue and keep the instructions under ${MAX_PROMOTION_INSTRUCTIONS} characters.` },
      { status: 400 },
    );
  }

  const article = await prisma.article.findFirst({
    where: { id, ...(await getArticleScope(user)) },
    select: { id: true, businessId: true },
  });
  if (!article) {
    return NextResponse.json({ error: "Article not found." }, { status: 404 });
  }
  if (!article.businessId) {
    return NextResponse.json({ error: "Link the article to a business before promoting it." }, { status: 400 });
  }

  try {
    const { tasks, skipped } = await launchPromotionSales(user, {
      issueId: parsed.data.issueId,
      businessIds: [article.businessId],
      instructions: parsed.data.instructions,
      articleId: article.id,
    });
    return NextResponse.json({ created: tasks.length, tasks, skipped }, { status: 202 });
  } catch (error) {
    if (error instanceof PromotionReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

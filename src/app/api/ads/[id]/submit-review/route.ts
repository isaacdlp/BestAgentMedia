import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { launchPromotionReview, PromotionReviewError, readPromotionInstructions } from "@/lib/promotion-deals";

/** Launches a Marketer Task that sends the ad to its advertiser for review and sells a promotion package. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to submit an ad for review." }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Advertisement not found." }, { status: 404 });
  }

  try {
    const task = await launchPromotionReview(user, "ad", id, await readPromotionInstructions(request));
    return NextResponse.json({ task }, { status: 202 });
  } catch (error) {
    if (error instanceof PromotionReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Could not submit ad for review:", error);
    return NextResponse.json({ error: "The review could not be started." }, { status: 500 });
  }
}

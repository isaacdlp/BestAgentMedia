import { NextResponse } from "next/server";
import { AdReviewDecision } from "@prisma/client";
import { isReviewToken } from "@/lib/ad-reviews";
import { AdReviewSubmissionError, submitAdReviewFromPage } from "@/lib/promotion-deals";

/**
 * Public, no login: the advertiser approves their ad or requests changes from the review page
 * linked in the Marketer's email. The secret token in the URL is the only credential.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isReviewToken(token)) {
    return NextResponse.json({ error: "This review link is not valid." }, { status: 404 });
  }

  let body: { decision?: unknown; comments?: unknown; reviewerName?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const decision =
    body.decision === "APPROVED"
      ? AdReviewDecision.APPROVED
      : body.decision === "CHANGES_REQUESTED"
        ? AdReviewDecision.CHANGES_REQUESTED
        : null;
  if (!decision) return NextResponse.json({ error: "Choose Approve or Request changes." }, { status: 400 });
  if (
    (body.comments !== undefined && typeof body.comments !== "string") ||
    (body.reviewerName !== undefined && typeof body.reviewerName !== "string")
  ) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    await submitAdReviewFromPage(token, {
      decision,
      comments: (body.comments as string | undefined) ?? "",
      reviewerName: (body.reviewerName as string | undefined) ?? "",
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof AdReviewSubmissionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Could not record ad review:", error);
    return NextResponse.json({ error: "Your review could not be saved. Please try again." }, { status: 500 });
  }
}

import "server-only";
import { randomBytes } from "node:crypto";
import {
  AdReviewDecision,
  AdReviewSource,
  AdvertisementStatus,
  AgentTaskStatus,
  Prisma,
  PromotionDealStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";

// Advertiser reviews of an ad. They come from the public review page linked in the Marketer's
// email (/review/[token]) or from email replies the Marketer classifies, are kept in order on the
// ad (Reviews tab), and are given to the Creative when the ad is redesigned.

/** Most reviews one review link accepts, so a leaked link cannot flood the ad. */
export const MAX_REVIEWS_PER_DEAL = 30;
export const MAX_REVIEW_COMMENTS = 4000;
export const MAX_REVIEWER_NAME = 120;

export const AD_REVIEW_DECISION_LABELS: Record<AdReviewDecision, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
};

export const AD_REVIEW_SOURCE_LABELS: Record<AdReviewSource, string> = {
  REVIEW_PAGE: "Review page",
  EMAIL: "Email reply",
};

/** Unguessable secret for a review link; it is a credential, never a record ID. */
export function newReviewToken(): string {
  return randomBytes(24).toString("base64url");
}

export function isReviewToken(value: string): boolean {
  return /^[\w-]{32}$/.test(value);
}

export function reviewUrl(token: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/review/${encodeURIComponent(token)}`;
}

/**
 * Whether a review link still accepts reviews. It closes when staff stop the conversation or it
 * failed, and when a newer review conversation for the same ad replaced it. A declined advertiser
 * may still come back, as with email replies.
 */
export async function reviewLinkState(deal: {
  id: number;
  advertisementId: string | null;
  status: PromotionDealStatus;
  agentTask: { status: AgentTaskStatus };
}): Promise<"open" | "closed" | "superseded"> {
  if (!deal.advertisementId) return "closed";
  const taskStatus = deal.agentTask.status;
  if (taskStatus === AgentTaskStatus.FAILED) return "closed";
  if (taskStatus === AgentTaskStatus.STOPPED && deal.status !== PromotionDealStatus.DECLINED) return "closed";
  const newer = await prisma.promotionDeal.count({
    where: { advertisementId: deal.advertisementId, id: { gt: deal.id } },
  });
  return newer ? "superseded" : "open";
}

/**
 * Stores one review on the ad and moves the ad's status with it: an approval approves a draft or
 * in-review ad, and a change request sends an approved ad back to In review.
 */
export async function recordAdReview(
  tx: Prisma.TransactionClient,
  input: {
    advertisementId: string;
    promotionDealId: number | null;
    source: AdReviewSource;
    decision: AdReviewDecision;
    comments: string;
    reviewerName?: string | null;
  },
): Promise<{ reviewId: number; statusChange: AdvertisementStatus | null }> {
  const ad = await tx.advertisement.findUnique({
    where: { id: input.advertisementId },
    select: { status: true, creativeFileName: true },
  });
  if (!ad) throw new Error("Advertisement not found.");

  const review = await tx.adReview.create({
    data: {
      advertisementId: input.advertisementId,
      promotionDealId: input.promotionDealId,
      source: input.source,
      decision: input.decision,
      comments: input.comments.trim().slice(0, MAX_REVIEW_COMMENTS),
      reviewerName: input.reviewerName?.trim().slice(0, MAX_REVIEWER_NAME) || null,
      creativeFileName: ad.creativeFileName,
    },
    select: { id: true },
  });

  let statusChange: AdvertisementStatus | null = null;
  if (
    input.decision === AdReviewDecision.APPROVED &&
    (ad.status === AdvertisementStatus.DRAFT || ad.status === AdvertisementStatus.IN_REVIEW)
  ) {
    statusChange = AdvertisementStatus.APPROVED;
  } else if (input.decision === AdReviewDecision.CHANGES_REQUESTED && ad.status === AdvertisementStatus.DRAFT) {
    // The first review of a draft moves it into review
    statusChange = AdvertisementStatus.IN_REVIEW;
  } else if (input.decision === AdReviewDecision.CHANGES_REQUESTED && ad.status === AdvertisementStatus.APPROVED) {
    statusChange = AdvertisementStatus.IN_REVIEW;
  }
  if (statusChange) {
    await tx.advertisement.update({ where: { id: input.advertisementId }, data: { status: statusChange } });
  }
  return { reviewId: review.id, statusChange };
}

/**
 * What the public review page shows for a review link, or null for an unknown token. Only the
 * ad, its advertiser's name and the issue are exposed; no contact details.
 */
export async function getPublicAdReview(token: string) {
  if (!isReviewToken(token)) return null;
  const deal = await prisma.promotionDeal.findUnique({
    where: { reviewToken: token },
    select: {
      id: true,
      advertisementId: true,
      status: true,
      agentTask: { select: { status: true } },
      business: { select: { name: true } },
      publication: { select: { name: true } },
      issue: { select: { name: true, publicationDate: true } },
      subAgent: { select: { name: true } },
      advertisement: {
        select: { title: true, description: true, styleName: true, creativeFileName: true, creativeMimeType: true },
      },
      adReviews: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, decision: true, comments: true, createdAt: true },
      },
    },
  });
  if (!deal?.advertisement) return null;
  return { ...deal, advertisement: deal.advertisement, state: await reviewLinkState(deal) };
}

/** All reviews of an ad, oldest first, so they can be numbered in order. */
export function listAdReviews(advertisementId: string) {
  return prisma.adReview.findMany({
    where: { advertisementId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      source: true,
      decision: true,
      comments: true,
      reviewerName: true,
      creativeFileName: true,
      createdAt: true,
      promotionDeal: {
        select: {
          id: true,
          subAgent: { select: { name: true } },
          agentTask: { select: { registry: { select: { id: true } } } },
        },
      },
    },
  });
}

export type AdReviewEntry = Awaited<ReturnType<typeof listAdReviews>>[number];

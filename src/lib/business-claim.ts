import "server-only";
import { ReachoutTaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function processClaimToken(
  userId: string,
  token: string,
): Promise<{ businessId?: number; error?: string }> {
  const claimToken = await prisma.businessClaimToken.findUnique({
    where: { token },
    include: { business: { select: { id: true, ownerUserId: true } } },
  });

  if (!claimToken) return { error: "invalid" };
  if (claimToken.usedAt) return { error: "used" };

  const { business } = claimToken;

  if (business.ownerUserId === userId) {
    return { businessId: business.id };
  }

  if (business.ownerUserId) {
    return { error: "already_claimed" };
  }

  await prisma.$transaction([
    prisma.business.update({
      where: { id: business.id },
      data: { ownerUserId: userId },
    }),
    prisma.businessClaimToken.update({
      where: { id: claimToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await prisma.reachoutTask.updateMany({
    where: {
      businessId: business.id,
      status: { in: [ReachoutTaskStatus.PENDING, ReachoutTaskStatus.RUNNING] },
    },
    data: {
      status: ReachoutTaskStatus.SUCCEEDED,
      message: "Business successfully claimed by its owner.",
      finishedAt: new Date(),
    },
  });

  return { businessId: business.id };
}

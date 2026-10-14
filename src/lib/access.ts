import "server-only";
import { UserRole, type Prisma } from "@prisma/client";
import type { AwaitedUser } from "@/lib/types";
import { prisma } from "@/lib/db";

export function getBusinessScope(
  user: AwaitedUser,
): Prisma.BusinessWhereInput | null {
  if (user.role === UserRole.ADMIN) return {};
  if (user.role === UserRole.EDITOR) return null;
  return { ownerUserId: user.id };
}

export async function getSubmissionScope(
  user: AwaitedUser,
): Promise<Prisma.ContentSubmissionWhereInput | null> {
  switch (user.role) {
    case UserRole.ADMIN:
      return {};
    case UserRole.EDITOR: {
      const assignments = await prisma.publicationPublisher.findMany({
        where: { userId: user.id },
        select: { publicationId: true },
      });
      return { publicationId: { in: assignments.map(({ publicationId }) => publicationId) } };
    }
    default:
      return { submittedByUserId: user.id };
  }
}

export async function getAdvertisementScope(
  user: AwaitedUser,
): Promise<Prisma.AdvertisementWhereInput | null> {
  switch (user.role) {
    case UserRole.ADMIN:
      return {};
    case UserRole.EDITOR: {
      const assignments = await prisma.publicationPublisher.findMany({
        where: { userId: user.id },
        select: { publicationId: true },
      });
      return {
        publications: {
          some: { publicationId: { in: assignments.map(({ publicationId }) => publicationId) } },
        },
      };
    }
    default:
      return { business: { ownerUserId: user.id } };
  }
}

export async function getPublicationScope(
  user: AwaitedUser,
): Promise<Prisma.PublicationWhereInput | null> {
  switch (user.role) {
    case UserRole.ADMIN:
      return {};
    case UserRole.EDITOR: {
      const assignments = await prisma.publicationPublisher.findMany({
        where: { userId: user.id },
        select: { publicationId: true },
      });
      return { id: { in: assignments.map(({ publicationId }) => publicationId) } };
    }
    default:
      return null;
  }
}

export async function getIssueScope(
  user: AwaitedUser,
): Promise<Prisma.IssueWhereInput | null> {
  switch (user.role) {
    case UserRole.ADMIN:
      return {};
    case UserRole.EDITOR: {
      const assignments = await prisma.publicationPublisher.findMany({
        where: { userId: user.id },
        select: { publicationId: true },
      });
      return {
        publicationId: { in: assignments.map(({ publicationId }) => publicationId) },
      };
    }
    default:
      return null;
  }
}

export async function getArticleScope(
  user: AwaitedUser,
): Promise<Prisma.ArticleWhereInput> {
  switch (user.role) {
    case UserRole.ADMIN:
      return {};
    case UserRole.EDITOR: {
      const assignments = await prisma.publicationPublisher.findMany({
        where: { userId: user.id },
        select: { publicationId: true },
      });
      return {
        publications: {
          some: {
            publicationId: { in: assignments.map(({ publicationId }) => publicationId) },
          },
        },
      };
    }
    default:
      return {
        OR: [
          { createdByUserId: user.id },
          { sourceSubmission: { is: { submittedByUserId: user.id } } },
        ],
      };
  }
}

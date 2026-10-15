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
      // Unassigned ads stay visible so an editor can attach them to an Issue.
      return {
        OR: [
          {
            issues: {
              some: {
                issue: { publicationId: { in: assignments.map(({ publicationId }) => publicationId) } },
              },
            },
          },
          { issues: { none: {} } },
        ],
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
      const publicationIds = assignments.map(({ publicationId }) => publicationId);
      // Articles accepted from a submission stay visible until they are attached to an Issue.
      return {
        OR: [
          { issues: { some: { issue: { publicationId: { in: publicationIds } } } } },
          { sourceSubmission: { is: { publicationId: { in: publicationIds } } } },
          { issues: { none: {} }, sourceSubmissionId: null },
        ],
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

export type IssueOption = { id: string; name: string; issueName: string; publicationId: number };

/** Issues the user may attach ads/articles to, labelled "Publication · Issue". */
export async function listIssueOptions(user: AwaitedUser): Promise<IssueOption[]> {
  const scope = await getIssueScope(user);
  if (!scope) return [];
  const issues = await prisma.issue.findMany({
    where: scope,
    orderBy: [{ publicationDate: "desc" }, { name: "asc" }],
    select: { id: true, name: true, publicationId: true, publication: { select: { name: true } } },
  });
  return issues.map((issue) => ({
    id: issue.id,
    name: `${issue.publication.name} · ${issue.name}`,
    issueName: issue.name,
    publicationId: issue.publicationId,
  }));
}

/** Returns the distinct issue ids if every one is in the user's scope, otherwise null. */
export async function resolveIssueIds(user: AwaitedUser, issueIds: string[]): Promise<string[] | null> {
  const scope = await getIssueScope(user);
  if (!scope) return null;
  const unique = [...new Set(issueIds)];
  const found = await prisma.issue.findMany({ where: { id: { in: unique }, ...scope }, select: { id: true } });
  return found.length === unique.length ? unique : null;
}

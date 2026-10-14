import "server-only";

import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  getAdvertisementScope,
  getArticleScope,
  getBusinessScope,
  getIssueScope,
  getSubmissionScope,
} from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import type { AwaitedUser } from "@/lib/types";
import { prisma } from "@/lib/db";
import { removeAdImageFiles } from "@/lib/ad-images";
import { removeCreativeFile } from "@/lib/ad-creative";
import { removeArticleImageFiles } from "@/lib/article-images";
import { removeBusinessImageFiles } from "@/lib/business-images";
import { removeSubmissionImageFiles } from "@/lib/submission-images";

type DeleteContext = { id: string; actorId: string; where: object };
type Deleter = {
  label: string;
  numericId: boolean;
  revalidate: string[];
  /** Records this person may delete, or null when they may not delete any. */
  scope: (user: AwaitedUser) => Promise<object | null>;
  /** Deletes the record and returns file cleanup to run after the database delete succeeds. */
  run: (context: DeleteContext) => Promise<(() => Promise<void>) | null>;
};

const isAdmin = (user: AwaitedUser) => user.role === UserRole.ADMIN;
const isAdminOrEditor = (user: AwaitedUser) => user.role === UserRole.ADMIN || user.role === UserRole.EDITOR;
const adminOnly = async (user: AwaitedUser) => (isAdmin(user) ? {} : null);

const NOT_FOUND = Symbol("not-found");
class DeleteBlocked extends Error {}

const deleters = {
  user: {
    label: "User",
    numericId: false,
    revalidate: ["/users"],
    scope: adminOnly,
    async run({ id, actorId }) {
      if (id === actorId) throw new DeleteBlocked("You cannot delete your own account.");
      const target = await prisma.user.findFirst({ where: { id }, select: { picturePath: true } });
      if (!target) throw NOT_FOUND;
      const importTasks = await prisma.businessImportTask.count({ where: { createdByUserId: id } });
      if (importTasks) {
        throw new DeleteBlocked(`This user launched ${importTasks} business import task${importTasks === 1 ? "" : "s"}. Delete those first.`);
      }
      await prisma.user.delete({ where: { id } });
      const fileName = target.picturePath?.match(/^media\/users\/([a-z0-9._-]+)$/i)?.[1];
      return fileName ? () => rm(resolve(process.cwd(), "media", "users", fileName), { force: true }) : null;
    },
  },
  article: {
    label: "Article",
    numericId: false,
    revalidate: ["/articles", "/issues"],
    scope: async (user) => (isAdminOrEditor(user) ? getArticleScope(user) : null),
    async run({ id, where }) {
      const article = await prisma.article.findFirst({ where: { id, ...where }, select: { images: { select: { fileName: true } } } });
      if (!article) throw NOT_FOUND;
      await prisma.article.delete({ where: { id } });
      return () => removeArticleImageFiles(article.images.map((image) => image.fileName));
    },
  },
  ad: {
    label: "Ad",
    numericId: false,
    revalidate: ["/ads", "/issues"],
    scope: async (user) => (isAdminOrEditor(user) ? getAdvertisementScope(user) : null),
    async run({ id, where }) {
      const ad = await prisma.advertisement.findFirst({
        where: { id, ...where },
        select: { creativeFileName: true, images: { select: { fileName: true } } },
      });
      if (!ad) throw NOT_FOUND;
      await prisma.advertisement.delete({ where: { id } });
      return async () => {
        await removeAdImageFiles(ad.images.map((image) => image.fileName));
        if (ad.creativeFileName) await removeCreativeFile(ad.creativeFileName);
      };
    },
  },
  business: {
    label: "Business",
    numericId: true,
    revalidate: ["/businesses", "/ads", "/articles", "/submissions"],
    scope: async (user) => getBusinessScope(user),
    async run({ id, where }) {
      const businessId = Number(id);
      const business = await prisma.business.findFirst({
        where: { id: businessId, ...where },
        select: { images: { select: { fileName: true } }, _count: { select: { ads: true } } },
      });
      if (!business) throw NOT_FOUND;
      if (business._count.ads) {
        throw new DeleteBlocked(
          `This business has ${business._count.ads} ad${business._count.ads === 1 ? "" : "s"}. Delete those ads first.`,
        );
      }
      await prisma.business.delete({ where: { id: businessId } });
      return () => removeBusinessImageFiles(business.images.map((image) => image.fileName));
    },
  },
  submission: {
    label: "Submission",
    numericId: false,
    revalidate: ["/submissions", "/articles"],
    scope: async (user) => (isAdminOrEditor(user) ? getSubmissionScope(user) : null),
    async run({ id, where }) {
      const submission = await prisma.contentSubmission.findFirst({
        where: { id, ...where },
        select: { images: { select: { fileName: true } } },
      });
      if (!submission) throw NOT_FOUND;
      await prisma.contentSubmission.delete({ where: { id } });
      return () => removeSubmissionImageFiles(submission.images.map((image) => image.fileName));
    },
  },
  issue: {
    label: "Issue",
    numericId: false,
    revalidate: ["/issues"],
    scope: async (user) => (isAdminOrEditor(user) ? getIssueScope(user) : null),
    async run({ id, where }) {
      const issue = await prisma.issue.findFirst({ where: { id, ...where }, select: { id: true } });
      if (!issue) throw NOT_FOUND;
      await prisma.issue.delete({ where: { id } });
      return null;
    },
  },
  publication: {
    label: "Publication",
    numericId: true,
    revalidate: ["/publications", "/issues", "/submissions", "/ads", "/articles"],
    scope: adminOnly,
    async run({ id }) {
      const publicationId = Number(id);
      const publication = await prisma.publication.findFirst({
        where: { id: publicationId },
        select: { _count: { select: { submissions: true, issues: true } } },
      });
      if (!publication) throw NOT_FOUND;
      const { submissions, issues } = publication._count;
      if (submissions || issues) {
        const parts = [
          issues ? `${issues} issue${issues === 1 ? "" : "s"}` : null,
          submissions ? `${submissions} submission${submissions === 1 ? "" : "s"}` : null,
        ].filter(Boolean);
        throw new DeleteBlocked(`This publication still has ${parts.join(" and ")}. Delete those first.`);
      }
      await prisma.publication.delete({ where: { id: publicationId } });
      return null;
    },
  },
} satisfies Record<string, Deleter>;

export type DeletableKind = keyof typeof deleters;

/**
 * Shared handler for `DELETE /api/<kind>/<id>`. Each kind decides who may delete which records
 * (administrators everything; editors only records in their publications; some kinds admin-only).
 */
export async function handleAdminDelete(kind: DeletableKind, rawId: string) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to delete records." }, { status: 401 });
  const deleter: Deleter = deleters[kind];
  const where = await deleter.scope(user);
  if (!where) return NextResponse.json({ error: `You cannot delete this ${deleter.label.toLowerCase()}.` }, { status: 403 });
  const valid = deleter.numericId ? /^[1-9]\d{0,9}$/.test(rawId) : /^[\w-]{1,64}$/.test(rawId);
  if (!valid) return NextResponse.json({ error: `${deleter.label} not found.` }, { status: 404 });

  try {
    const cleanup = await deleter.run({ id: rawId, actorId: user.id, where });
    await cleanup?.().catch(() => undefined);
  } catch (error) {
    if (error === NOT_FOUND) return NextResponse.json({ error: `${deleter.label} not found.` }, { status: 404 });
    if (error instanceof DeleteBlocked) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2014")) {
      return NextResponse.json({ error: `${deleter.label} is still referenced by other records.` }, { status: 409 });
    }
    throw error;
  }
  for (const path of deleter.revalidate) revalidatePath(path);
  return NextResponse.json({ deleted: true });
}

"use server";

import { UserRole } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { updateArticleStatus } from "@/app/actions/content";
import { updateAdvertisementStatus, updateSubmissionStatus } from "@/app/actions/records";

export type BulkStatusKind = "submission" | "ad" | "article";
export type BulkStatusResult = { updated: number; failed: number; message?: string };

const ACTIONS = {
  submission: updateSubmissionStatus,
  ad: updateAdvertisementStatus,
  article: updateArticleStatus,
} as const;

/** Applies one status to many records, reusing each record type's single-record action (which validates scope and status). */
export async function bulkUpdateStatus(
  kind: BulkStatusKind,
  ids: Array<string | number>,
  status: string,
): Promise<BulkStatusResult> {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return { updated: 0, failed: ids.length, message: "You do not have permission to change status." };
  }
  const action = ACTIONS[kind];
  let updated = 0;
  let failed = 0;
  let message: string | undefined;
  for (const id of ids) {
    const formData = new FormData();
    formData.set("id", String(id));
    formData.set("status", status);
    try {
      await action(formData);
      updated += 1;
    } catch (error) {
      failed += 1;
      message ??= error instanceof Error ? error.message : "Update failed.";
    }
  }
  return { updated, failed, message };
}

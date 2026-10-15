"use server";

import { AdvertisementStatus, SubmissionStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdvertisementScope, getSubmissionScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const submissionStatusSchema = z.nativeEnum(SubmissionStatus);
const advertisementStatusSchema = z.nativeEnum(AdvertisementStatus);
const recordIdSchema = z.string().regex(/^[\w-]{1,64}$/);

export async function updateSubmissionStatus(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }

  const id = recordIdSchema.parse(formData.get("id"));
  const status = submissionStatusSchema.parse(formData.get("status"));
  const scope = await getSubmissionScope(user);

  if (!scope) {
    redirect("/dashboard");
  }

  const result = await prisma.contentSubmission.updateMany({
    where: { id, ...scope },
    data: { status },
  });

  if (result.count !== 1) {
    throw new Error("Submission not found or not accessible.");
  }

  revalidatePath("/submissions");
  revalidatePath("/dashboard");
}

export async function updateAdvertisementStatus(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }

  const id = recordIdSchema.parse(formData.get("id"));
  const status = advertisementStatusSchema.parse(formData.get("status"));
  const scope = await getAdvertisementScope(user);

  if (!scope) {
    redirect("/dashboard");
  }

  const ad = await prisma.advertisement.findFirst({
    where: { id, ...scope },
    select: { id: true, _count: { select: { issues: true } } },
  });
  if (!ad) throw new Error("Advertisement not found or not accessible.");
  if (status === "PUBLISHED" && ad._count.issues === 0) {
    throw new Error("Assign the ad to at least one issue before publishing it.");
  }

  await prisma.advertisement.update({ where: { id: ad.id }, data: { status } });

  revalidatePath("/ads");
  revalidatePath("/dashboard");
}

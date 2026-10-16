"use server";

import { stopTasksForSubject } from "@/lib/task-subjects";
import { AdvertisementStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdvertisementScope, resolveIssueIds } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const recordIdSchema = z.string().regex(/^[\w-]{1,64}$/);
const advertisementStatusSchema = z.nativeEnum(AdvertisementStatus);

const optionalText = z.preprocess(
  (value) => (value === null ? "" : value),
  z.string().trim().transform((value) => value || null),
);

const adCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText,
  businessId: z.preprocess(
    (v) => (typeof v === "string" && /^[1-9]\d*$/.test(v) ? Number(v) : v),
    z.number().int().positive().safe(),
  ),
  issueIds: z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").filter(Boolean) : Array.isArray(v) ? v : []),
    z.array(recordIdSchema),
  ),
});

const adUpdateSchema = z.object({
  id: recordIdSchema,
  title: z.string().trim().min(1).max(200),
  description: optionalText,
  issueIds: z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").filter(Boolean) : Array.isArray(v) ? v : []),
    z.array(recordIdSchema),
  ),
});

const packageIdSchema = z.preprocess(
  (v) => (typeof v === "string" && /^[1-9]\d*$/.test(v) ? Number(v) : null),
  z.number().int().positive().safe().nullable(),
);

const costSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : null),
  z.number().finite().min(0).max(1_000_000).nullable(),
);

/** Cost entered in dollars, as whole cents (null when blank or invalid). */
function parseCostCents(value: FormDataEntryValue | null): number | null {
  const parsed = costSchema.safeParse(value);
  if (!parsed.success || parsed.data === null) return null;
  return Math.round(parsed.data * 100);
}

/**
 * Checks the chosen ad style against the ad's issues and prices the ad. The style must be an ad
 * rate of one of their publications, and one is required whenever those publications have ad
 * rates. The cost defaults to the rate's price per issue times the ad's issues in that
 * publication; an entered cost (for example a client discount) replaces it.
 */
async function resolveAdStyle(
  packageId: number | null,
  issueIds: string[],
  enteredCostCents: number | null,
): Promise<{ promotionPackageId: number | null; styleName: string | null; costCents: number | null }> {
  const unpriced = { promotionPackageId: null, styleName: null, costCents: null };
  if (!issueIds.length) return unpriced;
  const issues = await prisma.issue.findMany({ where: { id: { in: issueIds } }, select: { publicationId: true } });
  const publicationIds = [...new Set(issues.map((issue) => issue.publicationId))];
  const rates = await prisma.promotionPackage.findMany({
    where: { publicationId: { in: publicationIds }, kind: "AD" },
    select: { id: true, name: true, priceCents: true, publicationId: true },
  });
  if (!rates.length) return unpriced;
  if (packageId === null) throw new Error("Select a style to calculate the cost of the ad.");
  const rate = rates.find((item) => item.id === packageId);
  if (!rate) throw new Error("The selected style is not an ad rate of the selected issues' publications.");
  const issueCount = issues.filter((issue) => issue.publicationId === rate.publicationId).length;
  return { promotionPackageId: rate.id, styleName: rate.name, costCents: enteredCostCents ?? rate.priceCents * issueCount };
}

export async function createAdvertisement(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }

  const rawIssueIds = formData.getAll("issueIds");
  const parsed = adCreateSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    businessId: formData.get("businessId"),
    issueIds: rawIssueIds.length ? rawIssueIds : formData.get("issueIds"),
  });
  if (!parsed.success) {
    throw new Error("Invalid advertisement data: " + parsed.error.issues[0]?.message);
  }

  const { title, description, businessId, issueIds } = parsed.data;

  // Verify business exists
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!business) throw new Error("Business not found.");

  // Verify issues exist and belong to publications the user can access
  const scopedIssueIds = await resolveIssueIds(user, issueIds);
  if (!scopedIssueIds) throw new Error("One or more selected issues are not accessible.");
  const adStyle = await resolveAdStyle(
    packageIdSchema.parse(formData.get("packageId")),
    scopedIssueIds,
    parseCostCents(formData.get("cost")),
  );

  // Pull description and images from the business
  const businessForImport = await prisma.business.findUnique({
    where: { id: businessId },
    select: { description: true },
  });

  const ad = await prisma.advertisement.create({
    data: {
      title,
      description: description ?? businessForImport?.description ?? null,
      businessId,
      ...adStyle,
      issues: {
        create: scopedIssueIds.map((issueId) => ({ issueId })),
      },
    },
    select: { id: true },
  });

  // Copy business images to the new ad
  const { copyBusinessImagesToAd } = await import("@/lib/business-image-copies");
  await copyBusinessImagesToAd(businessId, ad.id);

  revalidatePath("/ads");
  redirect(`/ads/${ad.id}`);
}

export async function updateAdvertisement(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }

  const rawIssueIds = formData.getAll("issueIds");
  const parsed = adUpdateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description"),
    issueIds: rawIssueIds.length ? rawIssueIds : formData.get("issueIds"),
  });
  if (!parsed.success) {
    throw new Error("Invalid advertisement data: " + parsed.error.issues[0]?.message);
  }

  const { id, title, description, issueIds } = parsed.data;

  const scope = await getAdvertisementScope(user);
  if (!scope) redirect("/dashboard");

  const ad = await prisma.advertisement.findFirst({ where: { id, ...scope }, select: { id: true } });
  if (!ad) throw new Error("Advertisement not found or not accessible.");

  const scopedIssueIds = await resolveIssueIds(user, issueIds);
  if (!scopedIssueIds) throw new Error("One or more selected issues are not accessible.");
  const adStyle = await resolveAdStyle(
    packageIdSchema.parse(formData.get("packageId")),
    scopedIssueIds,
    parseCostCents(formData.get("cost")),
  );

  await prisma.$transaction([
    prisma.advertisementIssue.deleteMany({ where: { advertisementId: id } }),
    prisma.advertisement.update({
      where: { id: ad.id },
      data: {
        title,
        description,
        ...adStyle,
        issues: {
          create: scopedIssueIds.map((issueId) => ({ issueId })),
        },
      },
    }),
  ]);

  revalidatePath("/ads");
  revalidatePath(`/ads/${id}`);
}

export async function updateAdStatus(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }

  const id = recordIdSchema.parse(formData.get("id"));
  const status = advertisementStatusSchema.parse(formData.get("status"));
  const scope = await getAdvertisementScope(user);
  if (!scope) redirect("/dashboard");

  const ad = await prisma.advertisement.findFirst({
    where: { id, ...scope },
    select: { id: true, _count: { select: { issues: true } } },
  });
  if (!ad) throw new Error("Advertisement not found or not accessible.");
  if (status === AdvertisementStatus.PUBLISHED && ad._count.issues === 0) {
    throw new Error("Assign the ad to at least one issue before publishing it.");
  }

  await prisma.advertisement.update({ where: { id: ad.id }, data: { status } });
  if (status === AdvertisementStatus.APPROVED) await stopTasksForSubject("ad", ad.id);

  revalidatePath("/ads");
  revalidatePath(`/ads/${id}`);
  revalidatePath("/dashboard");
}

export async function deleteAdImage(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }

  const imageId = recordIdSchema.parse(formData.get("imageId"));
  const adId = recordIdSchema.parse(formData.get("adId"));

  const scope = await getAdvertisementScope(user);
  if (!scope) redirect("/dashboard");

  const image = await prisma.adImage.findFirst({
    where: { id: imageId, advertisement: { is: { id: adId, ...scope } } },
    select: { id: true, fileName: true, advertisementId: true },
  });
  if (!image) throw new Error("Image not found or not accessible.");

  await prisma.adImage.delete({ where: { id: image.id } });

  const { removeAdImageFiles } = await import("@/lib/ad-images");
  await removeAdImageFiles([image.fileName]);

  revalidatePath(`/ads/${adId}`);
}

export async function setAdImageAsCreative(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }

  const imageId = recordIdSchema.parse(formData.get("imageId"));
  const adId = recordIdSchema.parse(formData.get("adId"));

  const scope = await getAdvertisementScope(user);
  if (!scope) redirect("/dashboard");

  const ad = await prisma.advertisement.findFirst({
    where: { id: adId, ...scope },
    select: { id: true, creativeFileName: true },
  });
  if (!ad) throw new Error("Advertisement not found or not accessible.");

  const image = await prisma.adImage.findFirst({
    where: { id: imageId, advertisementId: adId },
    select: { id: true, fileName: true, mimeType: true, originalName: true, size: true },
  });
  if (!image) throw new Error("Image not found.");

  const { adImageDirectory } = await import("@/lib/ad-images");
  const { adCreativeDirectory, removeCreativeFile } = await import("@/lib/ad-creative");
  const { randomUUID } = await import("node:crypto");
  const { copyFile, mkdir } = await import("node:fs/promises");
  const { resolve } = await import("node:path");

  const ext = image.fileName.split(".").pop() ?? "jpg";
  const newFileName = `${randomUUID()}.${ext}`;

  await mkdir(adCreativeDirectory, { recursive: true });
  await copyFile(resolve(adImageDirectory, image.fileName), resolve(adCreativeDirectory, newFileName));

  const oldFileName = ad.creativeFileName;

  await prisma.advertisement.update({
    where: { id: ad.id },
    data: {
      creativeFileName: newFileName,
      creativeMimeType: image.mimeType,
      creativeSize: image.size,
      creativeOriginalName: image.originalName,
      creativeImageId: image.id,
    },
  });

  if (oldFileName) await removeCreativeFile(oldFileName);

  // The Marketer sends the advertiser the revised artwork for approval.
  const { scheduleAdArtworkNotification } = await import("@/lib/promotion-deals");
  scheduleAdArtworkNotification(ad.id);

  revalidatePath(`/ads/${adId}`);
}

export async function deleteBusinessImage(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const imageId = recordIdSchema.parse(formData.get("imageId"));
  const businessId = z.preprocess(
    (v) => (typeof v === "string" && /^[1-9]\d*$/.test(v) ? Number(v) : v),
    z.number().int().positive().safe(),
  ).parse(formData.get("businessId"));

  const image = await prisma.businessImage.findFirst({
    where: { id: imageId, businessId },
    select: { id: true, fileName: true },
  });
  if (!image) throw new Error("Image not found.");

  await prisma.businessImage.delete({ where: { id: image.id } });

  const { removeBusinessImageFiles } = await import("@/lib/business-images");
  await removeBusinessImageFiles([image.fileName]);

  revalidatePath(`/businesses/${businessId}`);
}

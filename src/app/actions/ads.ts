"use server";

import { AdvertisementStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdvertisementScope } from "@/lib/access";
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
  cta: optionalText,
  businessId: z.preprocess(
    (v) => (typeof v === "string" && /^[1-9]\d*$/.test(v) ? Number(v) : v),
    z.number().int().positive().safe(),
  ),
  publicationIds: z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").filter(Boolean) : Array.isArray(v) ? v : []),
    z.array(z.preprocess(
      (id) => (typeof id === "string" && /^[1-9]\d*$/.test(id) ? Number(id) : id),
      z.number().int().positive().safe(),
    )).min(1),
  ),
});

const adUpdateSchema = z.object({
  id: recordIdSchema,
  title: z.string().trim().min(1).max(200),
  description: optionalText,
  cta: optionalText,
  publicationIds: z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").filter(Boolean) : Array.isArray(v) ? v : []),
    z.array(z.preprocess(
      (id) => (typeof id === "string" && /^[1-9]\d*$/.test(id) ? Number(id) : id),
      z.number().int().positive().safe(),
    )).min(1),
  ),
});

export async function createAdvertisement(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    redirect("/dashboard");
  }

  const rawPublicationIds = formData.getAll("publicationIds");
  const parsed = adCreateSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    cta: formData.get("cta"),
    businessId: formData.get("businessId"),
    publicationIds: rawPublicationIds.length ? rawPublicationIds : formData.get("publicationIds"),
  });
  if (!parsed.success) {
    throw new Error("Invalid advertisement data: " + parsed.error.issues[0]?.message);
  }

  const { title, description, cta, businessId, publicationIds } = parsed.data;

  // Verify business exists
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!business) throw new Error("Business not found.");

  // Verify publications exist (and scope for publishers)
  if (user.role === UserRole.PUBLISHER) {
    const assignments = await prisma.publicationPublisher.findMany({
      where: { userId: user.id },
      select: { publicationId: true },
    });
    const allowed = new Set(assignments.map((a) => a.publicationId));
    if (!publicationIds.every((id) => allowed.has(id))) {
      throw new Error("One or more selected publications are not accessible.");
    }
  } else {
    const pubs = await prisma.publication.findMany({
      where: { id: { in: publicationIds } },
      select: { id: true },
    });
    if (pubs.length !== publicationIds.length) throw new Error("One or more publications not found.");
  }

  // Pull description and images from the business
  const businessForImport = await prisma.business.findUnique({
    where: { id: businessId },
    select: { description: true },
  });
  const businessImages = await prisma.businessImage.findMany({
    where: { businessId },
    orderBy: { position: "asc" },
    select: { fileName: true, originalName: true, mimeType: true, size: true },
  });

  const ad = await prisma.advertisement.create({
    data: {
      title,
      description: description ?? businessForImport?.description ?? null,
      cta,
      businessId,
      publications: {
        create: publicationIds.map((publicationId) => ({ publicationId })),
      },
    },
    select: { id: true },
  });

  // Copy business images to the new ad
  if (businessImages.length > 0) {
    const { adImageDirectory } = await import("@/lib/ad-images");
    const { businessImageDirectory } = await import("@/lib/business-images");
    const { randomUUID } = await import("node:crypto");
    const { copyFile, mkdir } = await import("node:fs/promises");
    const { resolve, extname } = await import("node:path");

    await mkdir(adImageDirectory, { recursive: true });

    const copied: { advertisementId: string; fileName: string; originalName: string; mimeType: string; size: number; position: number }[] = [];
    const newFileNames: string[] = [];
    try {
      for (const [i, img] of businessImages.slice(0, 20).entries()) {
        const ext = extname(img.fileName);
        const newFileName = `${randomUUID()}${ext}`;
        await copyFile(
          resolve(businessImageDirectory, img.fileName),
          resolve(adImageDirectory, newFileName),
        );
        newFileNames.push(newFileName);
        copied.push({ advertisementId: ad.id, fileName: newFileName, originalName: img.originalName, mimeType: img.mimeType, size: img.size, position: i });
      }
    } catch {
      const { removeAdImageFiles } = await import("@/lib/ad-images");
      await removeAdImageFiles(newFileNames);
    }

    if (copied.length > 0) {
      await prisma.adImage.createMany({ data: copied });
    }
  }

  revalidatePath("/ads");
  redirect(`/ads/${ad.id}`);
}

export async function updateAdvertisement(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    redirect("/dashboard");
  }

  const rawPublicationIds = formData.getAll("publicationIds");
  const parsed = adUpdateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description"),
    cta: formData.get("cta"),
    publicationIds: rawPublicationIds.length ? rawPublicationIds : formData.get("publicationIds"),
  });
  if (!parsed.success) {
    throw new Error("Invalid advertisement data: " + parsed.error.issues[0]?.message);
  }

  const { id, title, description, cta, publicationIds } = parsed.data;

  const scope = await getAdvertisementScope(user);
  if (!scope) redirect("/dashboard");

  const ad = await prisma.advertisement.findFirst({ where: { id, ...scope }, select: { id: true } });
  if (!ad) throw new Error("Advertisement not found or not accessible.");

  // Verify publications scope for publishers
  if (user.role === UserRole.PUBLISHER) {
    const assignments = await prisma.publicationPublisher.findMany({
      where: { userId: user.id },
      select: { publicationId: true },
    });
    const allowed = new Set(assignments.map((a) => a.publicationId));
    if (!publicationIds.every((pubId) => allowed.has(pubId))) {
      throw new Error("One or more selected publications are not accessible.");
    }
  }

  await prisma.$transaction([
    prisma.advertisementPublication.deleteMany({ where: { advertisementId: id } }),
    prisma.advertisement.update({
      where: { id: ad.id },
      data: {
        title,
        description,
        cta,
        publications: {
          create: publicationIds.map((publicationId) => ({ publicationId })),
        },
      },
    }),
  ]);

  revalidatePath("/ads");
  revalidatePath(`/ads/${id}`);
}

export async function updateAdStatus(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    redirect("/dashboard");
  }

  const id = recordIdSchema.parse(formData.get("id"));
  const status = advertisementStatusSchema.parse(formData.get("status"));
  const scope = await getAdvertisementScope(user);
  if (!scope) redirect("/dashboard");

  const ad = await prisma.advertisement.findFirst({ where: { id, ...scope }, select: { id: true } });
  if (!ad) throw new Error("Advertisement not found or not accessible.");

  await prisma.advertisement.update({ where: { id: ad.id }, data: { status } });

  revalidatePath("/ads");
  revalidatePath(`/ads/${id}`);
  revalidatePath("/dashboard");
}

export async function deleteAdImage(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
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

export async function importFromBusiness(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    redirect("/dashboard");
  }

  const id = recordIdSchema.parse(formData.get("id"));
  const scope = await getAdvertisementScope(user);
  if (!scope) redirect("/dashboard");

  const ad = await prisma.advertisement.findFirst({
    where: { id, ...scope },
    select: { id: true, businessId: true },
  });
  if (!ad) throw new Error("Advertisement not found or not accessible.");

  const business = await prisma.business.findUnique({
    where: { id: ad.businessId },
    select: { description: true },
  });
  if (!business) throw new Error("Business not found.");

  const businessImages = await prisma.businessImage.findMany({
    where: { businessId: ad.businessId },
    orderBy: { position: "asc" },
    select: { fileName: true, originalName: true, mimeType: true, size: true },
  });

  const { adImageDirectory } = await import("@/lib/ad-images");
  const { businessImageDirectory } = await import("@/lib/business-images");
  const { randomUUID } = await import("node:crypto");
  const { copyFile, mkdir } = await import("node:fs/promises");
  const { resolve, extname } = await import("node:path");

  await mkdir(adImageDirectory, { recursive: true });

  const currentCount = await prisma.adImage.count({ where: { advertisementId: id } });
  const toImport = businessImages.slice(0, Math.max(0, 20 - currentCount));

  const copied: { fileName: string; originalName: string; mimeType: string; size: number; position: number }[] = [];
  const newFileNames: string[] = [];
  try {
    for (const [i, img] of toImport.entries()) {
      const ext = extname(img.fileName);
      const newFileName = `${randomUUID()}${ext}`;
      await copyFile(
        resolve(businessImageDirectory, img.fileName),
        resolve(adImageDirectory, newFileName),
      );
      newFileNames.push(newFileName);
      copied.push({
        fileName: newFileName,
        originalName: img.originalName,
        mimeType: img.mimeType,
        size: img.size,
        position: currentCount + i,
      });
    }
  } catch (error) {
    const { removeAdImageFiles } = await import("@/lib/ad-images");
    await removeAdImageFiles(newFileNames);
    throw error;
  }

  await prisma.$transaction([
    prisma.advertisement.update({
      where: { id: ad.id },
      data: { description: business.description },
    }),
    ...(copied.length > 0
      ? [prisma.adImage.createMany({ data: copied.map((img) => ({ ...img, advertisementId: id })) })]
      : []),
  ]);

  revalidatePath(`/ads/${id}`);
}

export async function setAdImageAsCreative(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
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

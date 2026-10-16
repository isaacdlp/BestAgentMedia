"use server";

import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ZIP_CODE_PATTERN } from "@/lib/postal-code";

const optionalText = z.preprocess(
  (value) => (value === null ? "" : value),
  z.string().trim().transform((value) => value || null),
);
const optionalNumber = z.preprocess(
  (value) =>
    value === null || value === ""
      ? null
      : typeof value === "string"
        ? Number(value)
        : value,
  z.number().finite().nullable(),
);
const optionalDate = z.preprocess(
  (value) => (value === null ? "" : value),
  z
    .string()
    .trim()
    .transform((value) => (value ? new Date(`${value}Z`) : null))
    .pipe(z.date().nullable()),
);

const optionalZipCode = optionalText.pipe(
  z.string().regex(ZIP_CODE_PATTERN, "Postal code must be exactly 5 digits.").nullable(),
);

const businessUpdateSchema = z.object({
  id: z.preprocess(
    (value) =>
      typeof value === "string" && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : value,
    z.number().int().positive().safe(),
  ),
  name: z.string().trim().min(1).max(200),
  sourceProvider: z.string().trim().min(1).max(100),
  externalId: optionalText,
  sourceQuery: optionalText,
  primaryCategory: optionalText,
  description: optionalText,
  categories: z.string().transform((value) =>
    value
      .split(/\r?\n/)
      .map((category) => category.trim())
      .filter(Boolean),
  ),
  addressLabel: optionalText,
  houseNumber: optionalText,
  street: optionalText,
  city: optionalText,
  state: optionalText,
  stateCode: optionalText,
  postalCode: optionalZipCode,
  countryCode: optionalText,
  latitude: optionalNumber.pipe(z.number().min(-90).max(90).nullable()),
  longitude: optionalNumber.pipe(z.number().min(-180).max(180).nullable()),
  distanceMeters: optionalNumber.pipe(z.number().int().nonnegative().nullable()),
  phone: optionalText,
  email: optionalText.pipe(z.string().email().nullable()),
  website: optionalText,
  sourceRetrievedAt: optionalDate,
  ownerUserId: optionalText,
});

const businessCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  primaryCategory: optionalText,
  categories: z.string().transform((value) =>
    value
      .split(/\r?\n/)
      .map((category) => category.trim())
      .filter(Boolean),
  ),
  addressLabel: optionalText,
  houseNumber: optionalText,
  street: optionalText,
  city: optionalText,
  state: optionalText,
  stateCode: optionalText,
  postalCode: optionalZipCode,
  countryCode: optionalText,
  latitude: optionalNumber.pipe(z.number().min(-90).max(90).nullable()),
  longitude: optionalNumber.pipe(z.number().min(-180).max(180).nullable()),
  phone: optionalText,
  email: optionalText.pipe(z.string().email().nullable()),
  website: optionalText,
});

export async function createBusiness(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const business = businessCreateSchema.parse({
    name: formData.get("name"),
    primaryCategory: formData.get("primaryCategory"),
    categories: formData.get("categories"),
    addressLabel: formData.get("addressLabel"),
    houseNumber: formData.get("houseNumber"),
    street: formData.get("street"),
    city: formData.get("city"),
    state: formData.get("state"),
    stateCode: formData.get("stateCode"),
    postalCode: formData.get("postalCode"),
    countryCode: formData.get("countryCode"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    website: formData.get("website"),
  });

  const createdBusiness = await prisma.business.create({
    data: {
      ...business,
      sourceProvider: "MANUAL",
    },
    select: { id: true },
  });

  revalidatePath("/businesses");
  redirect(`/businesses/${createdBusiness.id}`);
}

const ownerUpdateSchema = z.object({
  id: z.preprocess(
    (value) => typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : value,
    z.number().int().positive().safe(),
  ),
  name: z.string().trim().min(1).max(200),
  primaryCategory: optionalText,
  phone: optionalText,
  email: optionalText.pipe(z.string().email().nullable()),
  website: optionalText,
});

export async function updateBusiness(formData: FormData) {
  const user = await requireUser();
  const isAdmin = user.role === UserRole.ADMIN;

  if (!isAdmin && user.role !== UserRole.CONTRIBUTOR && user.role !== null) {
    redirect("/dashboard");
  }

  const rawId = z.preprocess(
    (v) => typeof v === "string" && /^[1-9]\d*$/.test(v) ? Number(v) : v,
    z.number().int().positive().safe(),
  ).parse(formData.get("id"));

  if (!isAdmin) {
    const owned = await prisma.business.findFirst({
      where: { id: rawId, ownerUserId: user.id },
      select: { id: true },
    });
    if (!owned) redirect("/businesses");

    const data = ownerUpdateSchema.parse({
      id: formData.get("id"),
      name: formData.get("name"),
      primaryCategory: formData.get("primaryCategory"),
      phone: formData.get("phone"),
      email: formData.get("email"),
      website: formData.get("website"),
    });
    await prisma.business.update({
      where: { id: data.id },
      data: { name: data.name, primaryCategory: data.primaryCategory, phone: data.phone, email: data.email, website: data.website },
    });
    revalidatePath(`/businesses/${data.id}`);
    redirect(`/businesses/${data.id}`);
  }

  const business = businessUpdateSchema.parse({
    id: formData.get("id"),
    name: formData.get("name"),
    sourceProvider: formData.get("sourceProvider"),
    externalId: formData.get("externalId"),
    sourceQuery: formData.get("sourceQuery"),
    primaryCategory: formData.get("primaryCategory"),
    description: formData.get("description"),
    categories: formData.get("categories"),
    addressLabel: formData.get("addressLabel"),
    houseNumber: formData.get("houseNumber"),
    street: formData.get("street"),
    city: formData.get("city"),
    state: formData.get("state"),
    stateCode: formData.get("stateCode"),
    postalCode: formData.get("postalCode"),
    countryCode: formData.get("countryCode"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    distanceMeters: formData.get("distanceMeters"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    website: formData.get("website"),
    sourceRetrievedAt: formData.get("sourceRetrievedAt"),
    ownerUserId: formData.get("ownerUserId"),
  });

  await prisma.business.update({
    where: { id: business.id },
    data: {
      name: business.name,
      sourceProvider: business.sourceProvider,
      externalId: business.externalId,
      sourceQuery: business.sourceQuery,
      primaryCategory: business.primaryCategory,
      description: business.description,
      categories: business.categories,
      addressLabel: business.addressLabel,
      houseNumber: business.houseNumber,
      street: business.street,
      city: business.city,
      state: business.state,
      stateCode: business.stateCode,
      postalCode: business.postalCode,
      countryCode: business.countryCode,
      latitude: business.latitude,
      longitude: business.longitude,
      distanceMeters: business.distanceMeters,
      phone: business.phone,
      email: business.email,
      website: business.website,
      sourceRetrievedAt: business.sourceRetrievedAt,
      ownerUserId: business.ownerUserId,
    },
  });

  revalidatePath("/businesses");
  revalidatePath(`/businesses/${business.id}`);
  redirect(`/businesses/${business.id}`);
}

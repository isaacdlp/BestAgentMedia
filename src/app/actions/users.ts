"use server";

import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  surname: z.string().trim().max(100).default(""),
  phone: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().trim().max(50).nullable(),
  ),
});

export async function updateOwnProfile(formData: FormData) {
  const user = await requireUser();
  const data = profileUpdateSchema.parse({
    name: formData.get("name"),
    surname: formData.get("surname"),
    phone: formData.get("phone"),
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { name: data.name, surname: data.surname, phone: data.phone },
  });
  revalidatePath("/my/profile");
  redirect("/my/profile?saved=1");
}

const userUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  surname: z.string().trim().max(100).default(""),
  email: z.string().trim().email().max(200),
  phone: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().trim().max(50).nullable(),
  ),
  role: z.preprocess(
    (v) => (v === "" ? null : v),
    z.nativeEnum(UserRole).nullable(),
  ),
  active: z.preprocess(
    (v) => v === "on" || v === "true" || v === true,
    z.boolean(),
  ),
});

export async function updateUser(formData: FormData) {
  const currentUser = await requireUser();
  if (currentUser.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const data = userUpdateSchema.parse({
    id: formData.get("id"),
    name: formData.get("name"),
    surname: formData.get("surname"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    role: formData.get("role"),
    active: formData.get("active"),
  });

  await prisma.user.update({
    where: { id: data.id },
    data: {
      name: data.name,
      surname: data.surname,
      email: data.email,
      phone: data.phone,
      role: data.role,
      active: data.active,
    },
  });

  revalidatePath("/users");
  revalidatePath(`/users/${data.id}`);
  redirect(`/users/${data.id}`);
}

export async function updateUserPublications(formData: FormData) {
  const currentUser = await requireUser();
  if (currentUser.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const userId = z.string().min(1).parse(formData.get("id"));
  const publicationIds = [
    ...new Set(
      z
        .array(z.coerce.number().int().positive())
        .parse(formData.getAll("publicationIds")),
    ),
  ];

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (target?.role !== UserRole.EDITOR && target?.role !== UserRole.ADMIN) {
    redirect(`/users/${userId}`);
  }

  const validIds = (
    await prisma.publication.findMany({
      where: { id: { in: publicationIds } },
      select: { id: true },
    })
  ).map((publication) => publication.id);

  await prisma.$transaction([
    prisma.publicationPublisher.deleteMany({
      where: { userId, publicationId: { notIn: validIds } },
    }),
    prisma.publicationPublisher.createMany({
      data: validIds.map((publicationId) => ({ userId, publicationId })),
      skipDuplicates: true,
    }),
  ]);

  revalidatePath("/users");
  revalidatePath(`/users/${userId}`);
  redirect(`/users/${userId}`);
}

export async function deleteUser(formData: FormData) {
  const currentUser = await requireUser();
  if (currentUser.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const id = z.string().min(1).parse(formData.get("id"));

  if (id === currentUser.id) {
    redirect(`/users/${id}`);
  }

  await prisma.user.delete({ where: { id } });

  revalidatePath("/users");
  redirect("/users");
}

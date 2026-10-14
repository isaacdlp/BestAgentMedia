"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, UserRole } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function toggleAgent(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) redirect("/dashboard");

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id < 1) return;

  const enabled = formData.get("enabled") === "true";
  await prisma.agent.update({ where: { id }, data: { enabled } });

  revalidatePath("/agents");
  revalidatePath(`/agents/${String(id)}`);
}

export async function updateAgentSettings(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) redirect("/dashboard");

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id < 1) return;

  const settingsRaw = formData.get("settings");
  if (typeof settingsRaw !== "string") return;

  let settings: unknown;
  try {
    settings = JSON.parse(settingsRaw);
  } catch {
    return;
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return;

  await prisma.agent.update({
    where: { id },
    data: { settings: settings as Prisma.InputJsonValue },
  });

  revalidatePath(`/agents/${String(id)}`);
}

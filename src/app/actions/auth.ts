"use server";

import { compare, hash } from "bcryptjs";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { processClaimToken } from "@/lib/business-claim";
import { getSessionOptions, type SessionData } from "@/lib/session";

export type LoginState = { error?: string };
export type RegisterState = { error?: string };

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  claim: z.string().trim().optional(),
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  surname: z.string().trim().max(100).default(""),
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
  claim: z.string().trim().optional(),
});

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const credentials = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    claim: (formData.get("claim") as string | null) || undefined,
  });

  if (!credentials.success) {
    return { error: "Enter a valid email and password." };
  }

  const email = credentials.data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user?.active || !(await compare(credentials.data.password, user.passwordHash))) {
    return { error: "Email or password is incorrect." };
  }

  const session = await getIronSession<SessionData>(
    await cookies(),
    getSessionOptions(),
  );
  session.userId = user.id;
  session.authVersion = user.authVersion;
  await session.save();

  const { claim } = credentials.data;
  if (claim) {
    const { businessId } = await processClaimToken(user.id, claim);
    if (businessId) {
      redirect(`/businesses/${businessId}?claimed=1`);
    }
    redirect("/businesses");
  }

  if (user.role === UserRole.CONTRIBUTOR || !user.role) {
    redirect("/businesses");
  }
  redirect("/dashboard");
}

export async function register(
  _previousState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    surname: formData.get("surname") || "",
    email: formData.get("email"),
    password: formData.get("password"),
    claim: (formData.get("claim") as string | null) || undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "password" && issue.code === "too_small") {
      return { error: "Password must be at least 8 characters." };
    }
    return { error: "Please fill in all required fields correctly." };
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with this email already exists. Sign in instead." };
  }

  const passwordHash = await hash(parsed.data.password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      surname: parsed.data.surname,
      passwordHash,
      role: UserRole.CONTRIBUTOR,
      active: true,
    },
    select: { id: true, authVersion: true },
  });

  const session = await getIronSession<SessionData>(
    await cookies(),
    getSessionOptions(),
  );
  session.userId = user.id;
  session.authVersion = user.authVersion;
  await session.save();

  if (parsed.data.claim) {
    const { businessId } = await processClaimToken(user.id, parsed.data.claim);
    if (businessId) {
      redirect(`/businesses/${businessId}?claimed=1`);
    }
  }

  redirect("/businesses");
}

export async function logout() {
  const session = await getIronSession<SessionData>(
    await cookies(),
    getSessionOptions(),
  );
  session.destroy();
  redirect("/login");
}

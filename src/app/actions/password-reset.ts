"use server";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getPasswordResetUrl, sendPasswordResetEmail } from "@/lib/email";

export type PasswordResetState = {
  error?: string;
  message?: string;
};

const emailSchema = z.string().trim().email().max(254);
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Use no more than 72 bytes.",
  });

const genericRequestMessage =
  "If an active account exists for that email, we’ll send a password reset link shortly.";

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashRateLimitKey(email: string) {
  const sessionSecret = z.string().min(32).parse(process.env.SESSION_PASSWORD);
  return createHmac("sha256", sessionSecret).update(email).digest("hex");
}

async function allowResetRequest(email: string) {
  const [throttle] = await prisma.$queryRaw<Array<{ requestCount: number }>>`
    INSERT INTO "PasswordResetThrottle" ("emailHash", "windowStartedAt", "requestCount")
    VALUES (${hashRateLimitKey(email)}, CURRENT_TIMESTAMP, 1)
    ON CONFLICT ("emailHash") DO UPDATE SET
      "requestCount" = CASE
        WHEN "PasswordResetThrottle"."windowStartedAt" <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
          THEN 1
        ELSE "PasswordResetThrottle"."requestCount" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "PasswordResetThrottle"."windowStartedAt" <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
          THEN CURRENT_TIMESTAMP
        ELSE "PasswordResetThrottle"."windowStartedAt"
      END
    RETURNING "requestCount"
  `;

  return throttle.requestCount <= 3;
}

export async function requestPasswordReset(
  _previousState: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const parsedEmail = emailSchema.safeParse(formData.get("email"));
  if (!parsedEmail.success) {
    return { error: "Enter a valid email address." };
  }

  const email = parsedEmail.data.toLowerCase();
  await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  await prisma.passwordResetThrottle.deleteMany({
    where: { windowStartedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  const allowed = await allowResetRequest(email);
  if (!allowed) {
    return { message: genericRequestMessage };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, active: true },
  });

  if (!user?.active) {
    return { message: genericRequestMessage };
  }

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await prisma.$transaction(async (transaction) => {
    await transaction.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await transaction.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });
  });

  try {
    await sendPasswordResetEmail(user.email, getPasswordResetUrl(rawToken));
  } catch (error) {
    console.error(
      "Password reset email delivery failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    try {
      await prisma.passwordResetToken.deleteMany({ where: { tokenHash } });
    } catch (cleanupError) {
      console.error(
        "Failed to clean up an undeliverable password reset token:",
        cleanupError instanceof Error ? cleanupError.message : "Unknown error",
      );
    }
  }

  return { message: genericRequestMessage };
}

export async function resetPassword(
  _previousState: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const parsedToken = tokenSchema.safeParse(formData.get("token"));
  const parsedPassword = passwordSchema.safeParse(formData.get("password"));
  const confirmation = formData.get("confirmPassword");

  if (!parsedToken.success) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }

  if (!parsedPassword.success) {
    return { error: parsedPassword.error.issues[0]?.message ?? "Choose a valid password." };
  }

  if (confirmation !== parsedPassword.data) {
    return { error: "The passwords do not match." };
  }

  const tokenHash = hashResetToken(parsedToken.data);
  const now = new Date();
  const resetToken = await prisma.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    select: { id: true, userId: true },
  });

  if (!resetToken) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }

  const passwordHash = await hash(parsedPassword.data, 12);
  const updated = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.passwordResetToken.updateMany({
      where: {
        id: resetToken.id,
        tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (claimed.count !== 1) {
      return false;
    }

    const userUpdate = await transaction.user.updateMany({
      where: { id: resetToken.userId, active: true },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    if (userUpdate.count !== 1) {
      return false;
    }
    await transaction.passwordResetToken.deleteMany({
      where: { userId: resetToken.userId, id: { not: resetToken.id } },
    });

    return true;
  });

  if (!updated) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }

  revalidatePath("/login");
  redirect("/login?passwordReset=success");
}

import Link from "next/link";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import ResetPasswordForm from "@/app/reset-password/reset-password-form";

export const metadata = {
  title: "Choose a new password | BestAgentMedia",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const validFormat = typeof token === "string" && tokenPattern.test(token);
  const tokenHash = validFormat
    ? createHash("sha256").update(token).digest("hex")
    : "";
  const resetToken = validFormat
    ? await prisma.passwordResetToken.findFirst({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      })
    : null;

  return (
    <main className="login-page">
      <section className="login-card">
        <Link className="brand brand-login" href="/">
          <span className="brand-mark">B</span>
          <span>BestAgentMedia</span>
        </Link>
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        {resetToken && token ? (
          <>
            <h1>Choose a new password</h1>
            <p className="muted">Choose a unique password with at least 12 characters.</p>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <>
            <h1>Reset link unavailable</h1>
            <p className="muted">
              This reset link is invalid or has expired. Request a new link to continue.
            </p>
            <Link className="button button-primary login-submit reset-request-link" href="/forgot-password">
              Request another link
            </Link>
          </>
        )}
      </section>
      <p className="login-footer">Local stories. Stronger communities.</p>
    </main>
  );
}

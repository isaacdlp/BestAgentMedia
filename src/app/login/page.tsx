import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import LoginForm from "@/app/login/login-form";

export const metadata = {
  title: "Sign in | BestAgentMedia",
  referrer: "no-referrer",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ passwordReset?: string; claim?: string }>;
}) {
  const user = await getCurrentUser();
  const { passwordReset, claim } = await searchParams;

  if (user) {
    redirect(claim ? `/register?claim=${encodeURIComponent(claim)}` : "/dashboard");
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <Link className="brand brand-login" href="/">
          <span className="brand-mark">B</span>
          <span>BestVersionMedia</span>
        </Link>
        <p className="eyebrow">{claim ? "BUSINESS PORTAL" : "PUBLICATION WORKSPACE"}</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to continue{claim ? " and claim your business listing" : " to your workspace"}.</p>
        {passwordReset === "success" ? (
          <p className="form-success" role="status">Your password has been updated. Sign in with your new password.</p>
        ) : null}
        <LoginForm claim={claim} />
        {claim ? (
          <p className="register-signin-link">
            Don&apos;t have an account?{" "}
            <Link href={`/register?claim=${encodeURIComponent(claim)}`}>Create one</Link>
          </p>
        ) : null}
      </section>
      <p className="login-footer">Local stories. Stronger communities.</p>
    </main>
  );
}

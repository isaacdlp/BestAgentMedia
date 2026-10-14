import Link from "next/link";
import ForgotPasswordForm from "@/app/forgot-password/forgot-password-form";

export const metadata = {
  title: "Forgot password | BestAgentMedia",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ForgotPasswordPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <Link className="brand brand-login" href="/">
          <span className="brand-mark">B</span>
          <span>BestAgentMedia</span>
        </Link>
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>Reset your password</h1>
        <p className="muted">
          Enter the email address associated with your account. If it is active, we’ll email you a reset link.
        </p>
        <ForgotPasswordForm />
        <Link className="back-link" href="/login">Back to sign in</Link>
      </section>
      <p className="login-footer">Local stories. Stronger communities.</p>
    </main>
  );
}

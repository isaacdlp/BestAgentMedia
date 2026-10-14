import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { processClaimToken } from "@/lib/business-claim";
import RegisterForm from "@/app/register/register-form";

export const metadata = {
  title: "Create account | BestVersionMedia",
  referrer: "no-referrer",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>;
}) {
  const { claim } = await searchParams;
  const user = await getCurrentUser();

  if (user) {
    if (claim) {
      const { businessId } = await processClaimToken(user.id, claim);
      if (businessId) {
        redirect(`/businesses/${businessId}?claimed=1`);
      }
    }
    redirect("/businesses");
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <Link className="brand brand-login" href="/">
          <span className="brand-mark">B</span>
          <span>BestVersionMedia</span>
        </Link>
        <p className="eyebrow">BUSINESS PORTAL</p>
        <h1>Create your account</h1>
        <p className="muted">Claim your business listing and connect with your local publication.</p>
        <RegisterForm claim={claim} />
        <p className="register-signin-link">
          Already have an account?{" "}
          <Link href={claim ? `/login?claim=${encodeURIComponent(claim)}` : "/login"}>
            Sign in
          </Link>
        </p>
      </section>
      <p className="login-footer">Local stories. Stronger communities.</p>
    </main>
  );
}

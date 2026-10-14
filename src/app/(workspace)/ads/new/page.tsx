import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NewAdForm } from "./new-ad-form";

export default async function NewAdPage() {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    redirect("/dashboard");
  }

  const [businesses, publications] = await Promise.all([
    prisma.business.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, primaryCategory: true },
    }),
    user.role === UserRole.ADMIN
      ? prisma.publication.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : prisma.publication.findMany({
          where: {
            publisherAccess: { some: { userId: user.id } },
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/ads">← All advertisements</Link>
          <p className="eyebrow">ADVERTISING</p>
          <h1>Create advertisement</h1>
          <p className="muted">Add a new ad tied to a business and one or more publications.</p>
        </div>
      </div>
      <section className="panel">
        <NewAdForm businesses={businesses} publications={publications} />
      </section>
    </>
  );
}

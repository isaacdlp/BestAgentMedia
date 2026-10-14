import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { BusinessImportForm } from "@/components/business-import-form";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function NewBusinessImportTaskPage() {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const categoryRows = await prisma.hereCategory.findMany({
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const categories = [...new Set(categoryRows.map(({ name }) => name))];

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/businesses">
            ← All businesses
          </Link>
          <p className="eyebrow">BUSINESS DEVELOPMENT</p>
          <h1>Create import task</h1>
          <p className="muted">
            Configure a business search by ZIP code and category.
          </p>
        </div>
      </div>
      <BusinessImportForm categories={categories} />
    </>
  );
}

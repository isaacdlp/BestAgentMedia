import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { BusinessesSectionNav } from "@/components/businesses-section-nav";
import { BusinessImportForm } from "@/components/business-import-form";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function NewBusinessImportTaskPage() {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const categoryRows = await prisma.$queryRaw<Array<{ category: string }>>`
    SELECT DISTINCT category
    FROM (
      SELECT unnest("categories") AS category
      FROM "Business"
      UNION
      SELECT "primaryCategory" AS category
      FROM "Business"
      WHERE "primaryCategory" IS NOT NULL
    ) AS available_categories
    WHERE category IS NOT NULL AND btrim(category) <> ''
    ORDER BY category ASC
  `;
  const categories = categoryRows.map(({ category }) => category);

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/businesses/import">
            ← All import tasks
          </Link>
          <p className="eyebrow">BUSINESS DEVELOPMENT</p>
          <h1>Create import task</h1>
          <p className="muted">
            Configure a business search by ZIP code and category.
          </p>
        </div>
      </div>
      <BusinessesSectionNav current="import" />
      <BusinessImportForm categories={categories} />
    </>
  );
}

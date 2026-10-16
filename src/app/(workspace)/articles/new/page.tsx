import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { ArticleEditor } from "@/components/article-editor";
import { getPublicationScope, listIssueOptions } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { listAdStyleOptions } from "@/lib/ad-styles";
import { prisma } from "@/lib/db";

export default async function NewArticlePage() {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }
  const scope = await getPublicationScope(user);
  if (!scope) redirect("/dashboard");
  const [issues, businesses] = await Promise.all([
    listIssueOptions(user),
    prisma.business.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true, stateCode: true, postalCode: true, primaryCategory: true },
    }),
  ]);

  const promotionStyles = await listAdStyleOptions(issues.map((issue) => issue.publicationId), "ARTICLE");

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">EDITORIAL</p>
          <h1>Create article</h1>
          <p className="muted">Write a new piece and assign it to one or more issues.</p>
        </div>
      </div>
      <ArticleEditor article={null} businesses={businesses} canEdit issues={issues} promotionStyles={promotionStyles} />
    </>
  );
}

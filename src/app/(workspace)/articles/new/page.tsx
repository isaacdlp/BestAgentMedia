import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { ArticleEditor } from "@/components/article-editor";
import { getPublicationScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function NewArticlePage() {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    redirect("/dashboard");
  }
  const scope = await getPublicationScope(user);
  if (!scope) redirect("/dashboard");
  const [publications, businesses] = await Promise.all([
    prisma.publication.findMany({
      where: scope,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.business.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">EDITORIAL</p>
          <h1>Create article</h1>
          <p className="muted">Write a new piece and assign it to one or more publications.</p>
        </div>
      </div>
      <section className="panel">
        <ArticleEditor article={null} businesses={businesses} canEdit publications={publications} />
      </section>
    </>
  );
}

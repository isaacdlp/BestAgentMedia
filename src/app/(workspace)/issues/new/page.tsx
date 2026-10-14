import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { createIssue } from "@/app/actions/content";
import { IssueCreateForm } from "@/components/issue-create-form";
import { getPublicationScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function NewIssuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rawPublicationId = Array.isArray(sp.publicationId) ? sp.publicationId[0] : sp.publicationId;
  const initialPublicationId = Number.isInteger(Number(rawPublicationId)) ? Number(rawPublicationId) : null;
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }
  const scope = await getPublicationScope(user);
  if (!scope) redirect("/dashboard");
  const publications = await prisma.publication.findMany({
    where: scope,
    orderBy: { name: "asc" },
    select: { id: true, name: true, coverImagePath: true },
  });

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PUBLICATION WORKFLOW</p>
          <h1>Create issue</h1>
          <p className="muted">Choose a publication and release date to start a new issue.</p>
        </div>
      </div>
      <section className="panel issue-create-panel">
        <IssueCreateForm
          key={initialPublicationId ?? "none"}
          action={createIssue}
          initialPublicationId={initialPublicationId}
          defaultDate={new Date().toISOString().slice(0, 10)}
          publications={publications.map(({ coverImagePath, ...publication }) => ({
            ...publication,
            coverImageUrl: getCoverImageUrl(coverImagePath),
          }))}
        />
      </section>
    </>
  );
}

function getCoverImageUrl(coverImagePath: string | null) {
  const fileName = coverImagePath?.match(
    /^media\/publications\/([a-z0-9-]+\.(?:png|jpe?g))$/i,
  )?.[1];
  return fileName ? `/media/publications/${encodeURIComponent(fileName)}` : null;
}

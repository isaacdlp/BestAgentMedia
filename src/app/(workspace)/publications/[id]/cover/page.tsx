import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { getPublicationScope } from "@/lib/access";
import { prisma } from "@/lib/db";
import { EnhanceImageButton } from "@/components/enhance-image-button";

export default async function PublicationCoverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) redirect("/dashboard");

  const scope = await getPublicationScope(user);
  if (!scope) redirect("/dashboard");

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();
  const publicationId = Number(id);

  const publication = await prisma.publication.findFirst({
    where: { id: publicationId, ...scope },
    select: { id: true, name: true, coverImagePath: true },
  });
  if (!publication) notFound();

  const fileName = publication.coverImagePath?.match(
    /^media\/publications\/([a-z0-9-]+\.(?:png|jpe?g))$/i,
  )?.[1];
  const coverImageUrl = fileName ? `/media/publications/${encodeURIComponent(fileName)}` : null;

  if (!coverImageUrl) {
    return (
      <>
        <div className="page-heading">
          <div>
            <Link className="text-link back-link" href={`/publications/${id}`}>
              ← Back to publication
            </Link>
            <p className="eyebrow">PUBLICATION COVER</p>
            <h1>Cover image</h1>
            <p className="muted">{publication.name}</p>
          </div>
        </div>
        <section className="panel">
          <div className="empty-state">
            This publication does not have a cover image yet. Upload one from the publication settings.
          </div>
        </section>
      </>
    );
  }

  const canEdit = user.role === UserRole.ADMIN;
  const creativeAgent = canEdit
    ? await prisma.agent.findUnique({ where: { slug: "creative" }, select: { id: true, enabled: true } })
    : null;

  const pubIdStr = String(publication.id);

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href={`/publications/${id}`}>
            ← Back to publication
          </Link>
          <p className="eyebrow">PUBLICATION COVER</p>
          <h1>Cover image</h1>
          <p className="muted">{publication.name}</p>
        </div>
        {canEdit && creativeAgent?.enabled ? (
          <EnhanceImageButton
            agentPath={`/agents/${creativeAgent.id}`}
            imageId={pubIdStr}
            imageType="publication"
            originalImageSrc={coverImageUrl}
            parentId={pubIdStr}
            label="Enhance cover"
          />
        ) : null}
      </div>

      <section className="panel submission-image-detail">
        <Image
          alt={`${publication.name} cover`}
          height={1200}
          src={coverImageUrl}
          unoptimized
          width={900}
        />
        <div className="submission-image-detail-caption">
          <strong>{fileName}</strong>
          <span>Publication cover · {publication.name}</span>
        </div>
      </section>
    </>
  );
}

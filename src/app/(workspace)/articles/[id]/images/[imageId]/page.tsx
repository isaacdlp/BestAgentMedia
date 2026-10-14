import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { getArticleScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EnhanceImageButton } from "@/components/enhance-image-button";

export default async function ArticleImagePage({
  params,
}: {
  params: Promise<{ id: string; imageId: string }>;
}) {
  const user = await requireUser();
  const scope = await getArticleScope(user);

  const { id, imageId } = await params;
  if (!/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(imageId)) notFound();

  const image = await prisma.articleImage.findFirst({
    where: {
      id: imageId,
      article: { is: { id, ...scope } },
    },
    select: {
      originalName: true,
      caption: true,
      size: true,
      mimeType: true,
      position: true,
      article: { select: { id: true, title: true } },
    },
  });
  if (!image) notFound();

  const canEdit = user.role === UserRole.ADMIN || user.role === UserRole.PUBLISHER;
  const creativeAgent = canEdit
    ? await prisma.agent.findUnique({ where: { slug: "creative" }, select: { id: true, enabled: true } })
    : null;

  const imageSrc = `/api/articles/${id}/images/${imageId}`;

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href={`/articles/${id}`}>
            ← Back to article
          </Link>
          <p className="eyebrow">ARTICLE IMAGE</p>
          <h1>Image details</h1>
          <p className="muted">{image.article.title}</p>
        </div>
        {canEdit && creativeAgent?.enabled ? (
          <EnhanceImageButton
            agentPath={`/agents/${creativeAgent.id}`}
            imageId={imageId}
            imageType="article"
            originalImageSrc={imageSrc}
            parentId={id}
          />
        ) : null}
      </div>

      <section className="panel submission-image-detail">
        <Image
          alt={image.caption || image.originalName}
          height={1000}
          src={imageSrc}
          unoptimized
          width={1500}
        />
        <div className="submission-image-detail-caption">
          <strong>{image.originalName}</strong>
          <span>
            {image.mimeType} · {(image.size / (1024 * 1024)).toFixed(1)} MB
            {image.caption ? ` · "${image.caption}"` : ""}
          </span>
        </div>
      </section>
    </>
  );
}

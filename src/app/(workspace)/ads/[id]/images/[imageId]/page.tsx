import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { getAdvertisementScope } from "@/lib/access";
import { prisma } from "@/lib/db";
import { EnhanceImageButton } from "@/components/enhance-image-button";

export default async function AdImagePage({
  params,
}: {
  params: Promise<{ id: string; imageId: string }>;
}) {
  const user = await requireUser();
  const scope = await getAdvertisementScope(user);
  if (!scope) redirect("/dashboard");

  const { id, imageId } = await params;
  if (!/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(imageId)) notFound();

  const ad = await prisma.advertisement.findFirst({
    where: { id, ...scope },
    select: { id: true, title: true, business: { select: { name: true } } },
  });
  if (!ad) notFound();

  const image = await prisma.adImage.findFirst({
    where: { id: imageId, advertisementId: id },
    select: { originalName: true, size: true, mimeType: true, position: true },
  });
  if (!image) notFound();

  const canEdit = user.role === UserRole.ADMIN || user.role === UserRole.PUBLISHER;
  const creativeAgent = canEdit
    ? await prisma.agent.findUnique({ where: { slug: "creative" }, select: { id: true, enabled: true } })
    : null;

  const imageSrc = `/api/ads/${id}/images/${imageId}`;

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href={`/ads/${id}`}>
            ← Back to ad
          </Link>
          <p className="eyebrow">AD IMAGE · {ad.business.name}</p>
          <h1>Image details</h1>
          <p className="muted">{ad.title}</p>
        </div>
        {canEdit && creativeAgent?.enabled ? (
          <EnhanceImageButton
            agentPath={`/agents/${creativeAgent.id}`}
            imageId={imageId}
            imageType="ad"
            originalImageSrc={imageSrc}
            parentId={id}
          />
        ) : null}
      </div>

      <section className="panel submission-image-detail">
        <Image
          alt={image.originalName}
          height={1000}
          src={imageSrc}
          unoptimized
          width={1500}
        />
        <div className="submission-image-detail-caption">
          <strong>{image.originalName}</strong>
          <span>
            {image.mimeType} · {(image.size / (1024 * 1024)).toFixed(1)} MB
          </span>
        </div>
      </section>
    </>
  );
}

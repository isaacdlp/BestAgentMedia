import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { getSubmissionScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EnhanceImageButton } from "@/components/enhance-image-button";

export default async function SubmissionImagePage({
  params,
}: {
  params: Promise<{ id: string; imageId: string }>;
}) {
  const user = await requireUser();
  const scope = await getSubmissionScope(user);
  if (!scope) {
    redirect("/dashboard");
  }

  const { id, imageId } = await params;
  if (!/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(imageId)) {
    notFound();
  }

  const image = await prisma.submissionImage.findFirst({
    where: {
      id: imageId,
      submission: { is: { id, ...scope } },
    },
    select: {
      originalName: true,
      size: true,
      mimeType: true,
      submission: {
        select: {
          title: true,
        },
      },
    },
  });
  if (!image) {
    notFound();
  }

  const canEdit = user.role === UserRole.ADMIN || user.role === UserRole.PUBLISHER;
  const creativeAgent = canEdit
    ? await prisma.agent.findUnique({ where: { slug: "creative" }, select: { id: true, enabled: true } })
    : null;

  const imageSrc = `/api/submissions/${id}/images/${imageId}`;

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href={`/submissions/${id}`}>
            ← Back to submission
          </Link>
          <p className="eyebrow">SUBMISSION IMAGE</p>
          <h1>Image details</h1>
          <p className="muted">{image.submission.title}</p>
        </div>
        {canEdit && creativeAgent?.enabled ? (
          <EnhanceImageButton
            agentPath={`/agents/${creativeAgent.id}`}
            imageId={imageId}
            imageType="submission"
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

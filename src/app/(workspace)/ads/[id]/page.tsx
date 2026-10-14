import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { updateAdStatus, deleteAdImage, importFromBusiness, setAdImageAsCreative } from "@/app/actions/ads";
import { AdCreativeSection } from "./ad-creative-section";
import { AdDetailForm } from "./ad-detail-form";
import { AdImagesForm } from "./ad-images-form";
import { AdGenerateButton } from "./ad-generate-button";
import { getAdvertisementScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function AdDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const scope = await getAdvertisementScope(user);
  if (!scope) redirect("/dashboard");

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();

  const [ad, creativeAgent] = await Promise.all([
    prisma.advertisement.findFirst({
      where: { id, ...scope },
      select: {
        id: true,
        title: true,
        description: true,
        cta: true,
        status: true,
        creativeOriginalName: true,
        creativeMimeType: true,
        creativeSize: true,
        creativeImageId: true,
        business: { select: { id: true, name: true } },
        publications: { select: { publication: { select: { id: true, name: true } } } },
        images: { orderBy: { position: "asc" }, select: { id: true, originalName: true, mimeType: true, size: true, position: true } },
      },
    }),
    prisma.agent.findUnique({ where: { slug: "creative" }, select: { enabled: true } }),
  ]);
  if (!ad) notFound();

  const canEdit = user.role === UserRole.ADMIN || user.role === UserRole.PUBLISHER;

  const allPublications = canEdit
    ? user.role === UserRole.ADMIN
      ? await prisma.publication.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : await prisma.publication.findMany({
          where: { publisherAccess: { some: { userId: user.id } } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
    : [];

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/ads">← All advertisements</Link>
          <p className="eyebrow">ADVERTISING · {ad.business.name}</p>
          <h1>{ad.title}</h1>
          <p className="muted">
            Ad details, assigned publications, and image resources.
          </p>
        </div>
        <div className="page-heading-actions">
          <span className="status-pill">{formatStatus(ad.status)}</span>
          {canEdit ? (
            <form action={importFromBusiness}>
              <input name="id" type="hidden" value={ad.id} />
              <button className="button button-small" type="submit">Import from business</button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="business-detail-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Status */}
          {canEdit ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Review status</h2>
              </div>
              <form action={updateAdStatus} className="business-form" style={{ padding: "1rem 1.5rem" }}>
                <input name="id" type="hidden" value={ad.id} />
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <select aria-label="Update status" defaultValue={ad.status} name="status">
                    <option value="DRAFT">Draft</option>
                    <option value="SUBMITTED">Submitted</option>
                    <option value="IN_REVIEW">In review</option>
                    <option value="APPROVED">Approved</option>
                    <option value="PUBLISHED">Published</option>
                    <option value="DECLINED">Declined</option>
                  </select>
                  <button className="button button-small" type="submit">Update</button>
                </div>
              </form>
            </section>
          ) : null}

          {/* Ad creative */}
          <AdCreativeSection
            adId={ad.id}
            initial={ad.creativeOriginalName && ad.creativeMimeType && ad.creativeSize != null ? {
              originalName: ad.creativeOriginalName,
              mimeType: ad.creativeMimeType,
              size: ad.creativeSize,
            } : null}
            canEdit={canEdit}
          />

          {/* Ad details form */}
          <section className="panel">
            <div className="panel-heading">
              <h2>Ad details</h2>
            </div>
            {canEdit ? (
              <AdDetailForm
                adId={ad.id}
                title={ad.title}
                description={ad.description}
                cta={ad.cta}
                businessId={ad.business.id}
                businessName={ad.business.name}
                allPublications={allPublications}
                initialPublications={ad.publications.map((p) => p.publication)}
              />
            ) : (
              <div className="business-form">
                <div className="business-form-grid">
                  <ReadField label="Ad name" value={ad.title} />
                  <ReadField label="Description" value={ad.description} />
                  <ReadField label="Call to action" value={ad.cta} />
                  <ReadField label="Business" value={ad.business.name} />
                  <ReadField
                    label="Publications"
                    value={ad.publications.map((p) => p.publication.name).join(", ") || "—"}
                  />
                </div>
              </div>
            )}
          </section>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Ad image resources */}
          <section className="panel">
            <div className="panel-heading">
              <h2>Ad image resources <span className="count-badge">{ad.images.length}</span></h2>
              {canEdit ? (
                <AdGenerateButton
                  adId={ad.id}
                  images={ad.images.map((img) => ({ id: img.id, originalName: img.originalName }))}
                  agentEnabled={creativeAgent?.enabled ?? false}
                />
              ) : null}
            </div>
            <p className="muted" style={{ padding: "0 1.5rem 0.75rem", fontSize: "0.875rem" }}>
              Upload or generate images. Select one as the Creative to use in the publication layout.
            </p>

            {ad.images.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Preview</th>
                      <th>Name</th>
                      <th>Size</th>
                      {canEdit ? <th>Creative</th> : null}
                      {canEdit ? <th></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {ad.images.map((img) => {
                      const isCreative = ad.creativeImageId === img.id;
                      return (
                        <tr key={img.id}>
                          <td>
                            <Link href={`/ads/${ad.id}/images/${img.id}`}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/ads/${ad.id}/images/${img.id}`}
                                alt={img.originalName}
                                style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 4 }}
                              />
                            </Link>
                          </td>
                          <td>
                            <Link className="text-link" href={`/ads/${ad.id}/images/${img.id}`}>
                              {img.originalName}
                            </Link>
                          </td>
                          <td>{formatBytes(img.size)}</td>
                          {canEdit ? (
                            <td>
                              {isCreative ? (
                                <span className="status-pill" style={{ fontSize: "0.75rem" }}>Creative</span>
                              ) : (
                                <form action={setAdImageAsCreative}>
                                  <input name="imageId" type="hidden" value={img.id} />
                                  <input name="adId" type="hidden" value={ad.id} />
                                  <button className="button button-small" type="submit">Set as Creative</button>
                                </form>
                              )}
                            </td>
                          ) : null}
                          {canEdit ? (
                            <td>
                              <form action={deleteAdImage}>
                                <input name="imageId" type="hidden" value={img.id} />
                                <input name="adId" type="hidden" value={ad.id} />
                                <button className="button button-small button-danger" type="submit">Remove</button>
                              </form>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">No image resources yet.</div>
            )}

            {canEdit ? (
              <AdImagesForm adId={ad.id} />
            ) : null}
          </section>

        </div>
      </div>
    </>
  );
}

function ReadField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="business-field">
      <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{label}</span>
      <p style={{ margin: 0, padding: "0.375rem 0", color: value ? "inherit" : "var(--color-muted, #888)" }}>
        {value || "—"}
      </p>
    </div>
  );
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

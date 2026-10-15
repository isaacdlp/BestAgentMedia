import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { updateAdStatus, deleteAdImage, setAdImageAsCreative } from "@/app/actions/ads";
import { AdCreativeSection } from "./ad-creative-section";
import { AdDetailForm } from "./ad-detail-form";
import { AdImagesForm } from "./ad-images-form";
import { AdGenerateButton } from "./ad-generate-button";
import { AdReviewsList } from "@/components/ad-reviews-list";
import { SubmitReviewButton } from "@/components/submit-review-button";
import { getAdvertisementScope, listIssueOptions } from "@/lib/access";
import { listAdReviews, reviewLinkState, reviewUrl } from "@/lib/ad-reviews";
import { listAdStyleOptions } from "@/lib/ad-styles";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLatestPromotionDeal } from "@/lib/promotion-deals";
import { formatCents } from "@/lib/promotion-packages";

export default async function AdDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const scope = await getAdvertisementScope(user);
  if (!scope) redirect("/dashboard");

  const [{ id }, { tab: tabParam }] = await Promise.all([params, searchParams]);
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const tab = tabParam === "reviews" ? "reviews" : "details";

  const [ad, creativeAgent, marketerAgent, promotionDeal, reviews] = await Promise.all([
    prisma.advertisement.findFirst({
      where: { id, ...scope },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        creativeOriginalName: true,
        creativeMimeType: true,
        creativeSize: true,
        creativeImageId: true,
        creativeFileName: true,
        promotionPackageId: true,
        styleName: true,
        costCents: true,
        promotionPackage: { select: { name: true, description: true } },
        business: { select: { id: true, name: true, email: true } },
        issues: { select: { issue: { select: { id: true, name: true, publicationId: true, publication: { select: { name: true } } } } } },
        images: { orderBy: { position: "asc" }, select: { id: true, originalName: true, mimeType: true, size: true, position: true } },
      },
    }),
    prisma.agent.findUnique({ where: { slug: "creative" }, select: { enabled: true } }),
    prisma.agent.findUnique({ where: { slug: "marketer" }, select: { enabled: true } }),
    getLatestPromotionDeal({ advertisementId: id }),
    listAdReviews(id),
  ]);
  if (!ad) notFound();

  const canEdit = user.role === UserRole.ADMIN || user.role === UserRole.EDITOR;
  const reviewOpen = promotionDeal?.agentTask.status === "RUNNING" || promotionDeal?.agentTask.status === "PENDING";
  const reviewLink =
    canEdit && promotionDeal?.reviewToken
      ? { url: reviewUrl(promotionDeal.reviewToken), open: (await reviewLinkState(promotionDeal)) === "open" }
      : null;

  const allIssues = canEdit ? await listIssueOptions(user) : [];
  const adStyles = canEdit
    ? await listAdStyleOptions([...allIssues, ...ad.issues.map(({ issue }) => issue)].map((issue) => issue.publicationId))
    : [];

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/ads">← All advertisements</Link>
          <p className="eyebrow">ADVERTISING · {ad.business.name}</p>
          <h1>{ad.title}</h1>
          <p className="muted">
            Ad details, assigned issues, and image resources.
          </p>
        </div>
        <div className="page-heading-actions">
          {canEdit && marketerAgent?.enabled ? (
            <SubmitReviewButton
              apiPath={`/api/ads/${ad.id}/submit-review`}
              disabled={!ad.business.email || reviewOpen}
            />
          ) : null}
        </div>
      </div>

      <div className="sub-tabs">
        <Link className={`sub-tab ${tab === "details" ? "sub-tab-active" : ""}`} href={`/ads/${ad.id}`}>
          Details
        </Link>
        <Link className={`sub-tab ${tab === "reviews" ? "sub-tab-active" : ""}`} href={`/ads/${ad.id}?tab=reviews`}>
          Reviews{reviews.length > 0 ? ` (${reviews.length})` : ""}
        </Link>
      </div>

      {tab === "reviews" ? (
        <AdReviewsList
          currentCreativeFileName={ad.creativeFileName}
          reviewLink={reviewLink}
          reviews={reviews}
          showTaskLinks={canEdit}
        />
      ) : (
      <div className="business-detail-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Status */}
          {canEdit ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Review status</h2>
              </div>
              <form action={updateAdStatus} className="business-form" style={{ padding: "1rem 1.5rem" }}>
                <input name="id" type="hidden" value={ad.id} />
                <div className="review-status">
                  <div aria-label="Review status" className="review-status-options" role="radiogroup">
                    {[
                      ["DRAFT", "Draft"],
                      ["IN_REVIEW", "In review"],
                      ["APPROVED", "Approved"],
                      ["PUBLISHED", "Published"],
                      ["DECLINED", "Declined"],
                    ].map(([value, label]) => (
                      <label className={`review-status-option review-status-${value.toLowerCase()}`} key={value}>
                        <input defaultChecked={ad.status === value} name="status" type="radio" value={value} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <button className="button button-small" type="submit">Update status</button>
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

          {/* Ad image resources */}
          <section className="panel">
            <div className="panel-heading">
              <h2>Ad image resources <span className="count-badge">{ad.images.length}</span></h2>
              {canEdit ? (
                <AdGenerateButton
                  adId={ad.id}
                  images={ad.images.map((img) => ({ id: img.id, originalName: img.originalName }))}
                  agentEnabled={creativeAgent?.enabled ?? false}
                  styleName={ad.promotionPackage?.name ?? ad.styleName}
                  styleDescription={ad.promotionPackage?.description ?? null}
                  reviewCount={reviews.length}
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
                businessId={ad.business.id}
                businessName={ad.business.name}
                allIssues={allIssues}
                initialIssues={ad.issues.map(({ issue }) => ({ id: issue.id, name: `${issue.publication.name} · ${issue.name}`, publicationId: issue.publicationId }))}
                styles={adStyles}
                initialStyleId={ad.promotionPackageId}
                initialCostCents={ad.costCents}
              />
            ) : (
              <div className="business-form">
                <div className="business-form-grid">
                  <ReadField label="Ad name" value={ad.title} />
                  <ReadField label="Description" value={ad.description} />
                  <ReadField label="Style" value={ad.styleName} />
                  <ReadField label="Cost" value={ad.costCents != null ? formatCents(ad.costCents) : null} />
                  <ReadField label="Business" value={ad.business.name} />
                  <ReadField
                    label="Issues"
                    value={ad.issues.map(({ issue }) => `${issue.publication.name} · ${issue.name}`).join(", ") || "—"}
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      )}
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { updateBusiness } from "@/app/actions/businesses";
import { deleteBusinessImage } from "@/app/actions/ads";
import { BusinessLocationMap } from "@/components/business-location-map";
import { OnboardButton } from "@/components/onboard-button";
import { PitchButton } from "@/components/pitch-button";
import { BusinessImagesForm } from "./business-images-form";
import { ImportImagesButton } from "./import-images-button";
import { requireUser } from "@/lib/auth";
import { getBusinessScope } from "@/lib/access";
import { prisma } from "@/lib/db";

type BusinessDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ claimed?: string }>;
};

export default async function BusinessDetailPage({
  params,
  searchParams,
}: BusinessDetailPageProps) {
  const user = await requireUser();
  const scope = getBusinessScope(user);
  if (!scope) redirect("/dashboard");

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();
  const businessId = Number(id);
  if (!Number.isSafeInteger(businessId)) notFound();

  const isAdmin = user.role === UserRole.ADMIN;
  const { claimed } = await searchParams;

  const [business, marketerAgent, businessImages] = await Promise.all([
    prisma.business.findFirst({
      where: { id: businessId, ...scope },
      include: { owner: { select: { id: true, name: true, surname: true } } },
    }),
    prisma.agent.findUnique({
      where: { slug: "marketer" },
      select: { id: true, enabled: true },
    }),
    prisma.businessImage.findMany({
      where: { businessId },
      orderBy: { position: "asc" },
      select: { id: true, originalName: true, mimeType: true, size: true },
    }),
  ]);

  if (!business) notFound();

  const mapUrl = getMapEmbedUrl(business.latitude, business.longitude);
  const coordinates =
    business.latitude !== null && business.longitude !== null
      ? `${business.latitude}, ${business.longitude}`
      : null;

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/businesses">← All businesses</Link>
          <p className="eyebrow">BUSINESS DEVELOPMENT</p>
          <h1>{business.name}</h1>
          <p className="muted">Business details, source information, and exact mapped coordinates.</p>
        </div>
        <div className="page-heading-actions">
          {isAdmin ? <span className="role-pill">{business.sourceProvider.toLowerCase()}</span> : null}
          {isAdmin ? (
            <OnboardButton
              businessId={business.id}
              claimed={business.ownerUserId !== null}
              hasEmail={Boolean(business.email)}
            />
          ) : null}
          {isAdmin && marketerAgent?.enabled && business.email ? (
            <PitchButton businessId={business.id} />
          ) : null}
        </div>
      </div>

      {claimed === "1" ? (
        <div className="portal-claimed-banner" style={{ marginBottom: "1.5rem" }}>
          <span className="portal-claimed-banner-icon">🎉</span>
          <div>
            <strong>Business claimed!</strong>
            <p>You&apos;ve successfully claimed {business.name}. Keep your details up to date below.</p>
          </div>
        </div>
      ) : null}

      <div className="business-detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Business information</h2>
          </div>
          <form action={updateBusiness} className="business-form">
            <input name="id" type="hidden" value={business.id} />
            <div className="business-form-grid">
              <BusinessField label="Business name" name="name" required value={business.name} />
              <BusinessField label="Primary category" name="primaryCategory" value={business.primaryCategory} />
              {isAdmin ? (
                <>
                  <label className="business-field business-field-wide">
                    <span>Description</span>
                    <textarea defaultValue={business.description ?? ""} name="description" rows={3} />
                  </label>
                  <label className="business-field business-field-wide">
                    <span>Categories (one per line)</span>
                    <textarea defaultValue={business.categories.join("\n")} name="categories" rows={3} />
                  </label>
                  <BusinessField label="Source provider" name="sourceProvider" required value={business.sourceProvider} />
                  <BusinessField label="External ID" name="externalId" value={business.externalId} />
                  <BusinessField label="Source query" name="sourceQuery" value={business.sourceQuery} />
                  <BusinessField label="Source retrieved at (UTC)" name="sourceRetrievedAt" type="datetime-local" value={business.sourceRetrievedAt?.toISOString().slice(0, 16) ?? ""} />
                  <BusinessField label="Address label" name="addressLabel" value={business.addressLabel} />
                  <BusinessField label="House number" name="houseNumber" value={business.houseNumber} />
                  <BusinessField label="Street" name="street" value={business.street} />
                  <BusinessField label="City" name="city" value={business.city} />
                  <BusinessField label="State" name="state" value={business.state} />
                  <BusinessField label="State code" name="stateCode" value={business.stateCode} />
                  <BusinessField label="Postal code" name="postalCode" value={business.postalCode} />
                  <BusinessField label="Country code" name="countryCode" value={business.countryCode} />
                  <BusinessField label="Latitude" name="latitude" step="any" type="number" value={business.latitude} />
                  <BusinessField label="Longitude" name="longitude" step="any" type="number" value={business.longitude} />
                  <BusinessField label="Distance (meters)" name="distanceMeters" step="1" type="number" value={business.distanceMeters} />
                </>
              ) : null}
              <BusinessField label="Phone" name="phone" type="tel" value={business.phone} />
              <BusinessField label="Email" name="email" type="email" value={business.email} />
              <BusinessField label="Website" name="website" type="url" value={business.website} />
              {isAdmin ? (
                <label className="business-field">
                  <span>Owner user ID</span>
                  <input name="ownerUserId" type="text" defaultValue={business.ownerUserId ?? ""} />
                  {business.owner && (
                    <Link className="text-link" href={`/users/${business.owner.id}`} style={{ fontSize: "0.85em", marginTop: "0.25rem", display: "inline-block" }}>
                      → {business.owner.name} {business.owner.surname}
                    </Link>
                  )}
                </label>
              ) : null}
            </div>
            <div className="business-form-footer">
              <p className="muted">
                Record ID: {business.id}
                <br />
                Created {business.createdAt.toLocaleString()} · Updated {business.updatedAt.toLocaleString()}
              </p>
              <button className="button button-primary business-save" type="submit">Save changes</button>
            </div>
          </form>
        </section>

        {isAdmin ? (
          <section className="panel business-map-panel">
            <div className="panel-heading">
              <h2>Business location</h2>
              {coordinates ? <span className="status-pill">{coordinates}</span> : null}
            </div>
            {mapUrl && coordinates && business.latitude !== null && business.longitude !== null ? (
              <BusinessLocationMap
                businessName={business.name}
                latitude={business.latitude}
                longitude={business.longitude}
                mapUrl={mapUrl}
              />
            ) : (
              <div className="empty-state">Add both latitude and longitude to display this business on the map.</div>
            )}
          </section>
        ) : null}
      </div>

      <section className="panel" style={{ marginTop: "1.5rem" }}>
        <div className="panel-heading">
          <h2>Business images <span className="count-badge">{businessImages.length}</span></h2>
        </div>
        <div style={{ padding: "0 1.5rem 0.75rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" }}>
            <p className="muted" style={{ fontSize: "0.875rem", margin: 0 }}>
              Images shared across all ads created for this business.
            </p>
            <ImportImagesButton businessId={business.id} />
          </div>
          {businessImages.length > 0 ? (
            <ul className="submission-image-grid">
              {businessImages.map((img) => (
                <li key={img.id}>
                  <Link
                    aria-label={`View image details: ${img.originalName}`}
                    className="submission-image-thumbnail-link"
                    href={`/businesses/${business.id}/images/${img.id}`}
                  >
                    <Image
                      alt={img.originalName}
                      height={180}
                      src={`/api/businesses/${business.id}/images/${img.id}`}
                      unoptimized
                      width={240}
                    />
                  </Link>
                  <span>{img.originalName} ({formatBytes(img.size)})</span>
                  <form action={deleteBusinessImage}>
                    <input name="imageId" type="hidden" value={img.id} />
                    <input name="businessId" type="hidden" value={business.id} />
                    <button className="text-link" type="submit">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No images attached.</p>
          )}
        </div>
        <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid var(--color-border, #e5e7eb)", paddingTop: "1rem", marginTop: "0.25rem" }}>
          <BusinessImagesForm businessId={business.id} />
        </div>
      </section>
    </>
  );
}

type BusinessFieldProps = {
  label: string;
  name: string;
  required?: boolean;
  step?: string;
  type?: "email" | "number" | "tel" | "text" | "url" | "datetime-local";
  value: string | number | null;
};

function BusinessField({ label, name, required = false, step, type = "text", value }: BusinessFieldProps) {
  return (
    <label className="business-field">
      <span>{label}</span>
      <input name={name} required={required} step={step} type={type} defaultValue={value ?? ""} />
    </label>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMapEmbedUrl(latitude: number | null, longitude: number | null) {
  if (latitude === null || longitude === null) return null;
  const latPad = 0.003, lonPad = 0.005;
  const bounds = [
    Math.max(-180, longitude - lonPad),
    Math.max(-90, latitude - latPad),
    Math.min(180, longitude + lonPad),
    Math.min(90, latitude + latPad),
  ].join(",");
  return `https://www.openstreetmap.org/export/embed.html?${new URLSearchParams({ bbox: bounds, layer: "mapnik", marker: `${latitude},${longitude}` }).toString()}`;
}

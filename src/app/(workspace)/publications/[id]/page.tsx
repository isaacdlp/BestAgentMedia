import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { UserRole } from "@prisma/client";
import { getPublicationScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PublicationCoverageMap } from "@/components/publication-coverage-map";
import { PublicationCoverImage } from "@/components/publication-cover-image";
import { buildPublicationMapData } from "@/lib/zip-code-map";
import { PublicationEditor } from "./publication-editor";

type PublicationDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PublicationDetailPage({
  params,
}: PublicationDetailPageProps) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }

  const scope = await getPublicationScope(user);
  if (!scope) {
    redirect("/dashboard");
  }

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    notFound();
  }

  const publication = await prisma.publication.findFirst({
    where: { id: Number(id), ...scope },
    include: {
      zipCodes: { orderBy: { code: "asc" } },
      _count: { select: { submissions: true, advertisements: true } },
      publisherAccess: {
        orderBy: { user: { name: "asc" } },
        select: { user: { select: { id: true, name: true, surname: true, email: true, role: true } } },
      },
    },
  });

  if (!publication) {
    notFound();
  }

  const coverImageRecords = await prisma.$queryRaw<
    Array<{ coverImagePath: string | null }>
  >`
    SELECT "coverImagePath"
    FROM "Publication"
    WHERE "id" = ${publication.id}
  `;
  const coverImagePath = coverImageRecords[0]?.coverImagePath ?? null;
  const coverImageUrl = getCoverImageUrl(coverImagePath);

  const canEdit = user.role === UserRole.ADMIN;
  let mapData: ReturnType<typeof buildPublicationMapData> | null = null;
  let zipPopulationData: Array<{
    code: string;
    estimatedPopulation: number | null;
    populationMarginOfError: number | null;
    populationVintage: number | null;
  }> = [];
  let mapError: string | null = null;
  try {
    const zipBoundaries = await prisma.$queryRaw<
      Array<{
        code: string;
        boundaryGeometry: unknown;
        estimatedPopulation: number | null;
        populationMarginOfError: number | null;
        populationVintage: number | null;
      }>
    >`
      SELECT
        zip_code."code",
        zip_code."boundaryGeometry",
        zip_code."estimatedPopulation",
        zip_code."populationMarginOfError",
        zip_code."populationVintage"
      FROM "ZipCode" AS zip_code
      JOIN "_PublicationToZipCode" AS publication_zip
        ON publication_zip."B" = zip_code."id"
      WHERE publication_zip."A" = ${publication.id}
      ORDER BY zip_code."code"
    `;
    zipPopulationData = zipBoundaries;
    mapData = buildPublicationMapData(zipBoundaries);
  } catch (error) {
    console.error("Unable to load stored publication ZIP code boundaries:", error);
    mapError = "The ZIP code map could not be loaded. Run npm run db:seed to seed the Census boundaries.";
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link publication-back-link" href="/publications">
            ← All publications
          </Link>
          <p className="eyebrow">PUBLICATION</p>
          <h1>{publication.name}</h1>
          <p className="muted">
            Publication details and ZIP code distribution area.
          </p>
        </div>
        {canEdit ? <span className="role-pill">Administrator edit</span> : null}
      </div>

      <div className="publication-detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Publication information</h2>
          </div>
          <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: "20px" }}>
            {coverImageUrl ? (
              <Link href={`/publications/${publication.id}/cover`} style={{ display: "block" }}>
                <PublicationCoverImage
                  alt={`${publication.name} publication cover`}
                  imageUrl={coverImageUrl}
                />
              </Link>
            ) : (
              <PublicationCoverImage
                alt={`${publication.name} publication cover`}
                imageUrl={coverImageUrl}
              />
            )}
            <Link
              className="button button-secondary"
              href={`/issues?publicationId=${publication.id}`}
            >
              Issues
            </Link>
          </div>
          {canEdit ? (
            <>
              <PublicationEditor
                advertisementCount={publication._count.advertisements}
                coverImageUrl={coverImageUrl}
                id={publication.id}
                name={publication.name}
                slug={publication.slug}
                description={publication.description}
                submissionCount={publication._count.submissions}
                zipCodes={publication.zipCodes.map(({ code }) => code)}
              />
              <br/>
              <PublicationMetadata
                createdAt={publication.createdAt}
                id={publication.id}
                updatedAt={publication.updatedAt}
              />
            </>
          ) : (
            <dl className="publication-fields">
              <PublicationValue label="Name" value={publication.name} />
              <PublicationValue label="Slug" value={publication.slug} />
              <PublicationValue label="Description" value={publication.description} />
              <PublicationValue
                label="ZIP codes"
                value={publication.zipCodes.map(({ code }) => code).join(", ")}
              />
              <PublicationValue
                label="Record ID"
                value={publication.id}
              />
              <PublicationValue
                label="Created"
                value={publication.createdAt.toLocaleString()}
              />
              <PublicationValue
                label="Updated"
                value={publication.updatedAt.toLocaleString()}
              />
              <PublicationValue
                label="Activity"
                value={`${publication._count.submissions} submissions · ${publication._count.advertisements} advertisements`}
              />
            </dl>
          )}
  
          <br/>
          <div className="panel-heading">
            <h2>Publishers</h2>
            <span className="count-badge">{publication.publisherAccess.length}</span>
          </div>
          {publication.publisherAccess.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {publication.publisherAccess.map(({ user }) => (
                    <tr key={user.id}>
                      <td className="table-primary">
                        <Link className="text-link" href={`/users/${user.id}`}>
                          {user.name} {user.surname}
                        </Link>
                      </td>
                      <td>{user.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">No publishers are assigned to this publication.</div>
          )}
        </section>

        <section className="panel publication-map-panel">
          <div className="panel-heading">
            <h2>Distribution area</h2>
            <span className="count-badge">{publication.zipCodes.length} ZIP codes</span>
          </div>
          {mapError ? (
            <div className="empty-state" role="status">{mapError}</div>
          ) : mapData?.features.length ? (
            <>
              <PublicationCoverageMap
                key={`${publication.id}-${publication.zipCodes.map(({ code }) => code).join(",")}`}
                mapData={mapData}
              />
              {mapData.unmappedCodes.length > 0 ? (
                <p className="muted" role="status">
                  Not shown on the map (no valid Census boundary, e.g. PO-box-only ZIP
                  codes): {mapData.unmappedCodes.join(", ")}.
                </p>
              ) : null}
              <div aria-label="ZIP code population estimates" className="zip-population-list">
                {zipPopulationData.map((zipCode) => (
                  <div className="zip-population-row" key={zipCode.code}>
                    <strong>{zipCode.code}</strong>
                    <span>
                      {zipCode.estimatedPopulation === null
                        ? "No estimate available"
                        : `${zipCode.estimatedPopulation.toLocaleString()} people`}
                    </span>
                    <small>
                      {zipCode.populationVintage
                        ? `${zipCode.populationVintage} ACS 5-year estimate`
                        : "ACS population estimate unavailable"}
                      {zipCode.populationMarginOfError !== null
                        ? ` · ±${zipCode.populationMarginOfError.toLocaleString()} margin of error`
                        : ""}
                    </small>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              No ZIP code boundaries are available for this publication.
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function getCoverImageUrl(coverImagePath: string | null) {
  const fileName = coverImagePath?.match(
    /^media\/publications\/([a-z0-9-]+\.(?:png|jpe?g))$/i,
  )?.[1];
  return fileName ? `/media/publications/${encodeURIComponent(fileName)}` : null;
}

function PublicationValue({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="publication-value">
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function PublicationMetadata({
  createdAt,
  id,
  updatedAt,
}: {
  createdAt: Date;
  id: number;
  updatedAt: Date;
}) {
  return (
    <p className="muted publication-metadata">
      Record ID: {id}
      <br />
      Created {createdAt.toLocaleString()} · Updated {updatedAt.toLocaleString()}
    </p>
  );
}

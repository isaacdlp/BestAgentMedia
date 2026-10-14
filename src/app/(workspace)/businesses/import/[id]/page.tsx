import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { BusinessesSectionNav } from "@/components/businesses-section-nav";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type BusinessImportTaskDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function BusinessImportTaskDetailPage({
  params,
}: BusinessImportTaskDetailPageProps) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const task = await prisma.businessImportTask.findUnique({
    where: { id },
    include: {
      businesses: {
        orderBy: [{ city: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      },
    },
  });
  if (!task) {
    notFound();
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/businesses/import">
            ← All import tasks
          </Link>
          <p className="eyebrow">BUSINESS DEVELOPMENT</p>
          <h1>
            {task.sourceProvider === "HERE" ? "HERE Maps" : task.sourceProvider}
            {" · ZIP "}
            {task.zipCode}
          </h1>
          <p className="muted">Task started {task.startedAt.toLocaleString()}</p>
        </div>
        <span
          className={`business-import-task-status business-import-task-status-${task.status.toLowerCase()}`}
        >
          {formatTaskStatus(task.status)}
        </span>
      </div>
      <BusinessesSectionNav current="import" />
      <section className="panel business-import-task-detail">
        <h2>Task results</h2>
        <p className="business-import-task-message">{task.message}</p>
        <p className="muted business-import-task-meta">
          Categories: {task.categories.join(", ")} · Maximum new businesses:{" "}
          {task.newBusinessLimit}
          {task.finishedAt
            ? ` · Finished ${task.finishedAt.toLocaleString()}`
            : ""}
        </p>
        <div className="business-import-task-businesses">
          <strong>Imported businesses ({task.businesses.length})</strong>
          {task.businesses.length ? (
            <div className="business-import-task-business-grid">
              {task.businesses.map((business) => (
                <Link
                  className="business-import-task-business-card"
                  href={`/businesses/${business.id}`}
                  key={business.id}
                >
                  <span>{business.name}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">No businesses were created by this task.</p>
          )}
        </div>
      </section>
    </>
  );
}

function formatTaskStatus(status: string) {
  switch (status) {
    case "RUNNING":
      return "Running";
    case "SUCCEEDED":
      return "Succeeded";
    case "FAILED":
      return "Failed";
    case "STOPPED":
      return "Stopped";
    default:
      return status;
  }
}

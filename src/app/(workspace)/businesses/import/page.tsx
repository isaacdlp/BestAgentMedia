import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import Link from "next/link";
import { BusinessesSectionNav } from "@/components/businesses-section-nav";
import { BusinessImportTaskList } from "@/components/business-import-task-list";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function BusinessImportPage() {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const [taskRows, initialTotal] = await Promise.all([
    prisma.businessImportTask.findMany({
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      include: { _count: { select: { businesses: true } } },
    }),
    prisma.businessImportTask.count(),
  ]);
  const initialTasks = taskRows.map(({ _count, ...task }) => ({
    ...task,
    startedAt: task.startedAt.toISOString(),
    finishedAt: task.finishedAt?.toISOString() ?? null,
    businessCount: _count.businesses,
  }));

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUSINESS DEVELOPMENT</p>
          <h1>Import businesses</h1>
          <p className="muted">
            Review business search tasks and their results.
          </p>
        </div>
        <Link className="button button-primary" href="/businesses/import/new">
          Create import task
        </Link>
      </div>
      <BusinessesSectionNav current="import" />
      <BusinessImportTaskList initialTasks={initialTasks} initialTotal={initialTotal} />
    </>
  );
}

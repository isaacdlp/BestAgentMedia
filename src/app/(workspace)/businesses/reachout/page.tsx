import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import Link from "next/link";
import { ReachoutTaskList } from "@/components/reachout-task-list";
import type { ReachoutTaskSummary } from "@/components/reachout-task-list";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function ReachoutPage() {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) redirect("/dashboard");

  const [taskRows, initialTotal] = await Promise.all([
    prisma.reachoutTask.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        business: { select: { id: true, name: true, email: true, postalCode: true } },
        subAgent: { select: { id: true, name: true } },
        thread: { select: { _count: { select: { messages: true } } } },
      },
    }),
    prisma.reachoutTask.count(),
  ]);

  const initialTasks: ReachoutTaskSummary[] = taskRows.map((t) => ({
    ...t,
    initialEmailSentAt: t.initialEmailSentAt?.toISOString() ?? null,
    reminder1SentAt: t.reminder1SentAt?.toISOString() ?? null,
    reminder2SentAt: t.reminder2SentAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    finishedAt: t.finishedAt?.toISOString() ?? null,
  }));

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUSINESS DEVELOPMENT</p>
          <h1>Reachout tasks</h1>
          <p className="muted">
            Onboarding email sequences sent to local businesses.
          </p>
        </div>
        <Link className="button button-primary" href="/businesses/reachout/new">
          New onboarding task
        </Link>
      </div>
      <ReachoutTaskList initialTasks={initialTasks} initialTotal={initialTotal} />
    </>
  );
}

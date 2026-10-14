import { NextResponse } from "next/server";
import { TaskStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Tasks launched within this window keep the notifier polling quickly while they run.
const RECENT_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

type FinishedTaskRow = { id: number; name: string; status: string; agentName: string | null };

/**
 * Returns the caller's tasks that finished since they were last notified, and marks them as
 * notified so each completion is announced once.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to view task notifications." }, { status: 401 });

  const finished = await prisma.$queryRaw<FinishedTaskRow[]>`
    WITH claimed AS (
      UPDATE "Task"
      SET "notifiedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "createdByUserId" = ${user.id}
        AND "notifiedAt" IS NULL
        AND "status" IN ('SUCCEEDED', 'FAILED', 'STOPPED')
      RETURNING "id", "name", "status", "agentId", "finishedAt"
    )
    SELECT claimed."id", claimed."name", claimed."status"::TEXT AS "status", "Agent"."name" AS "agentName"
    FROM claimed
    LEFT JOIN "Agent" ON "Agent"."id" = claimed."agentId"
    ORDER BY claimed."finishedAt" ASC
  `;

  const activeWhere = {
    createdByUserId: user.id,
    status: { in: [TaskStatus.PENDING, TaskStatus.RUNNING] },
  };
  const [activeCount, recentActiveCount] = await Promise.all([
    prisma.task.count({ where: activeWhere }),
    prisma.task.count({
      where: { ...activeWhere, createdAt: { gte: new Date(Date.now() - RECENT_ACTIVE_WINDOW_MS) } },
    }),
  ]);

  return NextResponse.json(
    { finished, activeCount, recentActive: recentActiveCount > 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}

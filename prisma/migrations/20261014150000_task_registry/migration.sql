-- Unified task registry for the Tasks section.
--
-- "Task" rows mirror the long-running records stored in "AgentTask", "BusinessImportTask"
-- and "ReachoutTask". The triggers below create and update them, so every code path that
-- writes those tables (request handlers, background schedulers, IMAP replies) is reflected
-- without application changes. Deleting a backing record cascades to its "Task" row.

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('AGENT', 'BUSINESS_IMPORT', 'REACHOUT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'STOPPED');

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "source" "TaskSource" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "agentId" INTEGER,
    "createdByUserId" TEXT,
    "agentTaskId" TEXT,
    "businessImportTaskId" TEXT,
    "reachoutTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_agentTaskId_key" ON "Task"("agentTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_businessImportTaskId_key" ON "Task"("businessImportTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_reachoutTaskId_key" ON "Task"("reachoutTaskId");

-- CreateIndex
CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");

-- CreateIndex
CREATE INDEX "Task_status_createdAt_idx" ON "Task"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Task_agentId_createdAt_idx" ON "Task"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_createdByUserId_notifiedAt_idx" ON "Task"("createdByUserId", "notifiedAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_agentTaskId_fkey" FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_businessImportTaskId_fkey" FOREIGN KEY ("businessImportTaskId") REFERENCES "BusinessImportTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_reachoutTaskId_fkey" FOREIGN KEY ("reachoutTaskId") REFERENCES "ReachoutTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Timestamps are stored as UTC "timestamp without time zone", matching Prisma.
CREATE OR REPLACE FUNCTION task_registry_utc_now() RETURNS TIMESTAMP(3) AS $$
  SELECT (now() AT TIME ZONE 'UTC')::TIMESTAMP(3);
$$ LANGUAGE sql STABLE;

-- Terminal statuses always carry a finish time; active ones never do.
CREATE OR REPLACE FUNCTION task_registry_finished_at(status TEXT, source_finished TIMESTAMP(3), current_finished TIMESTAMP(3))
RETURNS TIMESTAMP(3) AS $$
  SELECT CASE
    WHEN status IN ('SUCCEEDED', 'FAILED', 'STOPPED')
      THEN COALESCE(source_finished, current_finished, task_registry_utc_now())
    ELSE NULL
  END;
$$ LANGUAGE sql STABLE;

-- AgentTask -> Task
CREATE OR REPLACE FUNCTION task_registry_sync_agent_task() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "Task" ("source", "name", "status", "agentId", "createdByUserId", "agentTaskId", "createdAt", "finishedAt", "updatedAt")
    VALUES (
      'AGENT', NEW."label", NEW."status"::TEXT::"TaskStatus", NEW."agentId", NEW."triggeredById", NEW."id", NEW."createdAt",
      task_registry_finished_at(NEW."status"::TEXT, NEW."completedAt", NULL), task_registry_utc_now()
    );
  ELSE
    UPDATE "Task" SET
      "name" = NEW."label",
      "status" = NEW."status"::TEXT::"TaskStatus",
      "agentId" = NEW."agentId",
      "finishedAt" = task_registry_finished_at(NEW."status"::TEXT, NEW."completedAt", "Task"."finishedAt"),
      "updatedAt" = task_registry_utc_now()
    WHERE "agentTaskId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AgentTask_task_registry"
AFTER INSERT OR UPDATE ON "AgentTask"
FOR EACH ROW EXECUTE FUNCTION task_registry_sync_agent_task();

-- BusinessImportTask -> Task
CREATE OR REPLACE FUNCTION task_registry_sync_business_import_task() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "Task" ("source", "name", "status", "agentId", "createdByUserId", "businessImportTaskId", "createdAt", "finishedAt", "updatedAt")
    VALUES (
      'BUSINESS_IMPORT', 'Import businesses · ZIP ' || NEW."zipCode", NEW."status"::TEXT::"TaskStatus", NULL, NEW."createdByUserId",
      NEW."id", NEW."createdAt", task_registry_finished_at(NEW."status"::TEXT, NEW."finishedAt", NULL), task_registry_utc_now()
    );
  ELSE
    UPDATE "Task" SET
      "status" = NEW."status"::TEXT::"TaskStatus",
      "finishedAt" = task_registry_finished_at(NEW."status"::TEXT, NEW."finishedAt", "Task"."finishedAt"),
      "updatedAt" = task_registry_utc_now()
    WHERE "businessImportTaskId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BusinessImportTask_task_registry"
AFTER INSERT OR UPDATE ON "BusinessImportTask"
FOR EACH ROW EXECUTE FUNCTION task_registry_sync_business_import_task();

-- ReachoutTask -> Task (onboarding outreach is carried out by the Assistant agent's sub agents)
CREATE OR REPLACE FUNCTION task_registry_reachout_agent(sub_agent_id INTEGER) RETURNS INTEGER AS $$
  SELECT COALESCE(
    (SELECT "agentId" FROM "SubAgent" WHERE "id" = sub_agent_id),
    (SELECT "id" FROM "Agent" WHERE "slug" = 'assistant')
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION task_registry_sync_reachout_task() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "Task" ("source", "name", "status", "agentId", "createdByUserId", "reachoutTaskId", "createdAt", "finishedAt", "updatedAt")
    VALUES (
      'REACHOUT',
      'Business onboarding · ' || COALESCE((SELECT "name" FROM "Business" WHERE "id" = NEW."businessId"), 'business #' || NEW."businessId"),
      NEW."status"::TEXT::"TaskStatus", task_registry_reachout_agent(NEW."subAgentId"), NEW."createdByUserId", NEW."id", NEW."createdAt",
      task_registry_finished_at(NEW."status"::TEXT, NEW."finishedAt", NULL), task_registry_utc_now()
    );
  ELSE
    UPDATE "Task" SET
      "status" = NEW."status"::TEXT::"TaskStatus",
      "agentId" = task_registry_reachout_agent(NEW."subAgentId"),
      "finishedAt" = task_registry_finished_at(NEW."status"::TEXT, NEW."finishedAt", "Task"."finishedAt"),
      "updatedAt" = task_registry_utc_now()
    WHERE "reachoutTaskId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReachoutTask_task_registry"
AFTER INSERT OR UPDATE ON "ReachoutTask"
FOR EACH ROW EXECUTE FUNCTION task_registry_sync_reachout_task();

-- Backfill existing records in chronological order. Finished tasks are marked as already
-- notified so users are not flooded with notifications for historic work.
INSERT INTO "Task" ("source", "name", "status", "agentId", "createdByUserId", "agentTaskId", "businessImportTaskId", "reachoutTaskId", "createdAt", "finishedAt", "notifiedAt", "updatedAt")
SELECT source, name, status::"TaskStatus", agent_id, created_by, agent_task_id, import_task_id, reachout_task_id, created_at,
       task_registry_finished_at(status, finished_at, NULL),
       CASE WHEN status IN ('SUCCEEDED', 'FAILED', 'STOPPED') THEN task_registry_utc_now() ELSE NULL END,
       task_registry_utc_now()
FROM (
  SELECT 'AGENT'::"TaskSource" AS source, t."label" AS name, t."status"::TEXT AS status, t."agentId" AS agent_id,
         t."triggeredById" AS created_by, t."id" AS agent_task_id, NULL::TEXT AS import_task_id, NULL::TEXT AS reachout_task_id,
         t."createdAt" AS created_at, t."completedAt" AS finished_at
  FROM "AgentTask" t
  UNION ALL
  SELECT 'BUSINESS_IMPORT'::"TaskSource", 'Import businesses · ZIP ' || t."zipCode", t."status"::TEXT, NULL,
         t."createdByUserId", NULL, t."id", NULL, t."createdAt", t."finishedAt"
  FROM "BusinessImportTask" t
  UNION ALL
  SELECT 'REACHOUT'::"TaskSource", 'Business onboarding · ' || b."name", t."status"::TEXT, task_registry_reachout_agent(t."subAgentId"),
         t."createdByUserId", NULL, NULL, t."id", t."createdAt", t."finishedAt"
  FROM "ReachoutTask" t
  JOIN "Business" b ON b."id" = t."businessId"
) existing
ORDER BY created_at ASC;

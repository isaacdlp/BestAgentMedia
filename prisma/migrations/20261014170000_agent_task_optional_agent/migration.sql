-- Allow tasks that belong to no agent (e.g. Google Places image import).
ALTER TABLE "AgentTask" ALTER COLUMN "agentId" DROP NOT NULL;

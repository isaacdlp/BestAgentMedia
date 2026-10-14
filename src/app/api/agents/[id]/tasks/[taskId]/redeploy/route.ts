import { AgentTaskStatus, Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to redeploy a layout." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "You cannot redeploy issue layouts." }, { status: 403 });
  }

  const { id, taskId } = await params;
  if (!/^[1-9]\d*$/.test(id)) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  if (!/^[\w-]{1,64}$/.test(taskId)) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const task = await prisma.agentTask.findFirst({
    where: { id: taskId, agentId: Number(id) },
    select: { id: true, status: true, issueId: true, result: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (task.status !== AgentTaskStatus.SUCCEEDED) {
    return NextResponse.json({ error: "Only succeeded tasks can be redeployed." }, { status: 409 });
  }
  if (!task.issueId) return NextResponse.json({ error: "This task has no associated issue." }, { status: 409 });

  const result = task.result as Record<string, unknown> | null;
  const design = result?.design;
  if (!design || typeof design !== "object" || Array.isArray(design)) {
    return NextResponse.json({ error: "This task does not have a stored design. Re-run generation to create a redeployable task." }, { status: 409 });
  }

  // Verify the issue still exists and the user has access to it
  const issue = await prisma.issue.findUnique({
    where: { id: task.issueId },
    select: { id: true, publicationId: true },
  });
  if (!issue) return NextResponse.json({ error: "The associated issue no longer exists." }, { status: 404 });

  if (user.role === UserRole.EDITOR) {
    const access = await prisma.publicationPublisher.findUnique({
      where: { userId_publicationId: { userId: user.id, publicationId: issue.publicationId } },
    });
    if (!access) return NextResponse.json({ error: "You do not have access to this issue." }, { status: 403 });
  }

  await prisma.issue.update({
    where: { id: issue.id },
    data: { designJson: design as Prisma.InputJsonValue },
  });

  return NextResponse.json({ issueId: issue.id });
}

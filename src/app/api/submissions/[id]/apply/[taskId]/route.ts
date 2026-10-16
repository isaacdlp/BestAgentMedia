import { AgentTaskStatus, Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSubmissionScope } from "@/lib/access";
import { step, type TaskStep } from "@/lib/agent-task-runner";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Resolves a Copywriter revision proposed by `/api/submissions/[id]/apply`: "accept" overwrites the
 * submission's title and body with the proposal, "discard" leaves the submission as it is. If the
 * submission was edited after the proposal was drafted (by a person, or by the Assistant folding in
 * a reply), accepting needs `force: true` because those edits would be lost.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to review revisions." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "You cannot edit submissions." }, { status: 403 });
  }

  const { id, taskId } = await params;
  if (!/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(taskId)) {
    return NextResponse.json({ error: "Revision not found." }, { status: 404 });
  }

  let body: { action?: unknown; force?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const action = body.action;
  if (action !== "accept" && action !== "discard") {
    return NextResponse.json({ error: "action must be accept or discard." }, { status: 400 });
  }

  const scope = await getSubmissionScope(user);
  if (!scope) return NextResponse.json({ error: "You cannot access this submission." }, { status: 403 });
  const submission = await prisma.contentSubmission.findFirst({
    where: { id, ...scope },
    select: { id: true, title: true, body: true },
  });
  if (!submission) return NextResponse.json({ error: "Submission not found." }, { status: 404 });

  const agent = await prisma.agent.findUnique({ where: { slug: "editor" }, select: { id: true } });
  const task = agent
    ? await prisma.agentTask.findFirst({
        where: {
          id: taskId,
          agentId: agent.id,
          status: AgentTaskStatus.SUCCEEDED,
          AND: [
            { result: { path: ["contentType"], equals: "submission-revision" } },
            { result: { path: ["referenceId"], equals: submission.id } },
          ],
        },
        select: { id: true, result: true, steps: true },
      })
    : null;
  if (!task) return NextResponse.json({ error: "Revision not found." }, { status: 404 });

  const result = (task.result ?? {}) as Record<string, unknown>;
  if (result.status !== "pending_review") {
    return NextResponse.json({ error: "This revision has already been resolved." }, { status: 409 });
  }
  const proposedTitle = typeof result.proposedTitle === "string" ? result.proposedTitle : "";
  const proposedBody = typeof result.proposedBody === "string" ? result.proposedBody : "";
  if (action === "accept" && (!proposedTitle || !proposedBody)) {
    return NextResponse.json({ error: "This task has no proposed revision." }, { status: 409 });
  }

  const editedSince = submission.title !== result.previousTitle || submission.body !== result.previousBody;
  if (action === "accept" && editedSince && body.force !== true) {
    return NextResponse.json(
      {
        error: "The submission was edited after this revision was drafted. Accepting it replaces those edits.",
        code: "edited-since",
      },
      { status: 409 },
    );
  }

  const reviewer = [user.name, user.surname].filter(Boolean).join(" ") || user.email;
  const steps = Array.isArray(task.steps) ? (task.steps as TaskStep[]) : [];
  const newStep =
    action === "accept"
      ? step("success", `Accepted by ${reviewer} — submission title and body replaced${editedSince ? " (overwrote later edits)" : ""}`)
      : step("info", `Discarded by ${reviewer} — submission left unchanged`);
  const resolved = {
    ...result,
    status: action === "accept" ? "accepted" : "discarded",
    resolvedAt: new Date().toISOString(),
    resolvedById: user.id,
    // What the submission held when the proposal was accepted, so the overwrite can be undone by hand
    ...(action === "accept" ? { replacedTitle: submission.title, replacedBody: submission.body } : {}),
  };

  // Mark the proposal resolved only if it is still pending, so two reviewers cannot both apply it
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.agentTask.updateMany({
      where: { id: task.id, result: { path: ["status"], equals: "pending_review" } },
      data: { result: resolved as Prisma.InputJsonValue, steps: [...steps, newStep] as Prisma.InputJsonValue },
    });
    if (claimed.count === 0) return false;
    if (action === "accept") {
      await tx.contentSubmission.update({
        where: { id: submission.id },
        data: { title: proposedTitle, body: proposedBody },
      });
    }
    return true;
  });
  if (!updated) {
    return NextResponse.json({ error: "This revision has already been resolved." }, { status: 409 });
  }

  return NextResponse.json({ status: resolved.status });
}

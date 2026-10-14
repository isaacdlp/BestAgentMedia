import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendSubAgentEmail, updateTaskWithThread } from "@/lib/sub-agent-email";

type Params = { params: Promise<{ id: string; taskId: string }> };

const sendSchema = z.object({
  subAgentId: z.number().int().positive(),
});

export async function POST(req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { id, taskId } = await params;
  if (!/^[1-9]\d*$/.test(id) || !/^[\w-]{1,64}$/.test(taskId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const task = await prisma.agentTask.findFirst({
    where: { id: taskId, agentId: Number(id) },
    select: { id: true, result: true, label: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const result = task.result as Record<string, unknown> | null;
  if (!result?.emailTo || !result?.emailSubject) {
    return NextResponse.json({ error: "This task does not have an email draft." }, { status: 409 });
  }
  if (result.status === "sent") {
    return NextResponse.json({ error: "This email has already been sent." }, { status: 409 });
  }

  const body = await req.json() as unknown;
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide a valid subAgentId." }, { status: 400 });
  }

  const subAgent = await prisma.subAgent.findFirst({
    where: { id: parsed.data.subAgentId, agent: { id: Number(id) } },
    select: { id: true, name: true },
  });
  if (!subAgent) {
    return NextResponse.json({ error: "Sub agent not found under this agent." }, { status: 404 });
  }

  try {
    const { threadId, sentTo } = await sendSubAgentEmail({
      subAgentId: subAgent.id,
      taskId: task.id,
      toEmail: String(result.emailTo),
      toName: typeof result.toName === "string" ? result.toName : undefined,
      subject: String(result.emailSubject),
      bodyText: typeof result.bodyPreview === "string" ? result.bodyPreview : String(result.emailSubject),
    });

    await updateTaskWithThread(task.id, threadId, subAgent.id, sentTo);

    return NextResponse.json({ threadId, sentTo });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

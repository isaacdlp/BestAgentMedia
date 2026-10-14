import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { creativeImageDirectory, type CreativeTaskResult } from "@/lib/creative-agent";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { taskId } = await params;
  if (!/^[\w-]{1,64}$/.test(taskId)) return new NextResponse("Not found", { status: 404 });

  const agent = await prisma.agent.findUnique({
    where: { slug: "creative" },
    select: { id: true },
  });
  if (!agent) return new NextResponse("Not found", { status: 404 });

  const task = await prisma.agentTask.findFirst({
    where: { id: taskId, agentId: agent.id },
    select: { result: true },
  });
  if (!task) return new NextResponse("Not found", { status: 404 });

  const result = task.result as CreativeTaskResult | null;
  if (!result?.enhancedFileName) return new NextResponse("Not found", { status: 404 });

  if (!/^[\da-f-]{36}\.(?:jpg|png|webp)$/i.test(result.enhancedFileName)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let image: Buffer;
  try {
    image = await readFile(resolve(creativeImageDirectory, result.enhancedFileName));
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
      return new NextResponse("Not found", { status: 404 });
    }
    throw err;
  }

  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(image.byteLength),
      "Content-Type": result.enhancedMimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

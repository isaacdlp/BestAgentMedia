import { BusinessImportTaskStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type TaskRouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: TaskRouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Provide a valid task action." }, { status: 400 });
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("action" in body) ||
    body.action !== "stop"
  ) {
    return NextResponse.json({ error: "Unsupported task action." }, { status: 400 });
  }

  const { id } = await params;
  const result = await prisma.businessImportTask.updateMany({
    where: { id, status: BusinessImportTaskStatus.RUNNING },
    data: {
      status: BusinessImportTaskStatus.STOPPED,
      message: "Stopped by user.",
      finishedAt: new Date(),
    },
  });
  if (result.count === 0) {
    const task = await prisma.businessImportTask.findUnique({
      where: { id },
      select: { id: true },
    });
    return NextResponse.json(
      { error: task ? "This task is no longer running." : "Import task not found." },
      { status: task ? 409 : 404 },
    );
  }

  revalidatePath("/businesses/import");
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: TaskRouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const result = await prisma.businessImportTask.deleteMany({ where: { id } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Import task not found." }, { status: 404 });
  }

  revalidatePath("/businesses/import");
  return NextResponse.json({ success: true });
}

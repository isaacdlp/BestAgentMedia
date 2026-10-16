import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getSubmissionScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { submissionImageDirectory } from "@/lib/submission-images";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const scope = await getSubmissionScope(user);
  if (!scope) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id, imageId } = await params;
  if (!/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(imageId)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const imageRecord = await prisma.submissionImage.findFirst({
    where: {
      id: imageId,
      submission: { is: { id, ...scope } },
    },
    select: { fileName: true, mimeType: true },
  });
  if (
    !imageRecord ||
    !/^(?:[\da-f-]{36}|seed-metrowest-story-\d+-\d+)\.(?:jpg|png|webp)$/i.test(
      imageRecord.fileName,
    )
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  let image: Buffer;
  try {
    image = await readFile(resolve(submissionImageDirectory, imageRecord.fileName));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return new NextResponse("Not found", { status: 404 });
    }
    throw error;
  }

  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(image.byteLength),
      "Content-Type": imageRecord.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

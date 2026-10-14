import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getIssueScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const mediaTypes: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id, filename } = await params;
  if (
    !/^[\w-]{1,64}$/.test(id) ||
    !/^[0-9a-f-]{36}\.(?:jpg|png|webp|svg)$/i.test(filename)
  ) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
  const scope = await getIssueScope(user);
  if (!scope) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const issue = await prisma.issue.findFirst({
    where: { id, ...scope },
    select: { id: true },
  });
  if (!issue) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  let image: Buffer;
  try {
    image = await readFile(resolve(process.cwd(), "media", "issues", id, filename));
  } catch (error) {
    if (isFileNotFound(error)) {
      return NextResponse.json({ error: "Image not found." }, { status: 404 });
    }
    throw error;
  }

  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(image.byteLength),
      "Content-Type": mediaTypes[filename.split(".").pop()!.toLowerCase()],
      // Uploaded SVGs are untrusted markup; never let them run scripts if opened directly.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

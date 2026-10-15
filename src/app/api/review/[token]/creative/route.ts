import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { adCreativeDirectory } from "@/lib/ad-creative";
import { isReviewToken } from "@/lib/ad-reviews";
import { prisma } from "@/lib/db";

/** Public, no login: the ad artwork for the review page. The review link's token is the credential. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isReviewToken(token)) return new NextResponse("Not found", { status: 404 });

  const deal = await prisma.promotionDeal.findUnique({
    where: { reviewToken: token },
    select: { advertisement: { select: { creativeFileName: true, creativeMimeType: true } } },
  });
  const ad = deal?.advertisement;
  if (!ad?.creativeFileName || !ad.creativeMimeType || !/^[\da-f-]{36}\.(?:jpg|png|webp)$/i.test(ad.creativeFileName)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let file: Buffer;
  try {
    file = await readFile(resolve(adCreativeDirectory, ad.creativeFileName));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return new NextResponse("Not found", { status: 404 });
    }
    throw error;
  }

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(file.byteLength),
      "Content-Type": ad.creativeMimeType,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

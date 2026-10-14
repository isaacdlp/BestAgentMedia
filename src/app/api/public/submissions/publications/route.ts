import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const postalCodeSchema = z.string().regex(/^\d{5}$/);

export async function GET(request: Request) {
  const postalCode = new URL(request.url).searchParams.get("postal_code");
  const parsed = postalCodeSchema.safeParse(postalCode);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid five-digit ZIP code." },
      { status: 400 },
    );
  }

  const publications = await prisma.publication.findMany({
    where: { zipCodes: { some: { code: parsed.data } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, coverImagePath: true },
  });

  return NextResponse.json(
    publications.map(({ coverImagePath, ...publication }) => {
      const filename = coverImagePath?.match(
        /^media\/publications\/([a-z0-9-]+\.(?:png|jpe?g))$/i,
      )?.[1];
      return {
        ...publication,
        coverUrl: filename
          ? `/api/public/submissions/publications/${publication.id}/cover`
          : null,
      };
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}

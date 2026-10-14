import Image from "next/image";

export function PublicationCoverImage({
  alt,
  imageUrl,
}: {
  alt: string;
  imageUrl: string | null;
}) {
  if (!imageUrl) {
    return null;
  }

  return (
    <Image
      alt={alt}
      className="publication-cover-detail"
      height={350}
      src={imageUrl}
      style={{ height: "auto", width: "250px" }}
      unoptimized
      width={250}
    />
  );
}

export function getIssueSeason(date: Date | string) {
  const month = Number(String(typeof date === "string" ? date : date.toISOString()).slice(5, 7));
  if (month === 12 || month <= 2) return "Winter";
  if (month <= 5) return "Spring";
  if (month <= 8) return "Summer";
  return "Fall";
}

/** "Lexington Living" + 2026-10-14 -> "Lexington Living Fall 2026". Expects a YYYY-MM-DD date string. */
export function buildIssueName(publicationName: string, publicationDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publicationDate)) return "";
  return `${publicationName} ${getIssueSeason(publicationDate)} ${publicationDate.slice(0, 4)}`;
}

export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

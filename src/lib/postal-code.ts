/** Business postal codes are stored as exactly five digits (US ZIP, no ZIP+4). */
export const ZIP_CODE_PATTERN = /^\d{5}$/;

/**
 * Coerces a provider-supplied postal code to five digits: "02138-1234" -> "02138",
 * "2138" -> "02138". Returns null when no valid five-digit ZIP can be derived.
 */
export function normalizeZipCode(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const match = /^(\d{4,5})(?:[-\s]?\d{4})?$/.exec(text);
  if (!match) return null;
  return match[1].padStart(5, "0");
}

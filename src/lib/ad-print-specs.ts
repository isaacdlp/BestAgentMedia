// Print sizes for ad styles. An ad style is a publication rate (PromotionPackage of kind AD)
// whose name says how much of the page the ad takes ("Quarter-page ad", "Half-page ad", …).
// Sizes follow the issue page used by the layout editor: 8.5 x 11 in trim (816 x 1056 px at
// 96 dpi, see issue-design.ts), 0.5 in margins (7.5 x 10 in live area) and a 0.25 in gutter
// between fractional ads. The editor's custom instructions may override the style's size, and an
// ad whose style names no size is printed as a half page.

export const PRINT_DPI = 300;

export type AdPrintSpec = {
  key: "full" | "half" | "quarter" | "eighth" | "custom";
  label: string;
  widthIn: number;
  heightIn: number;
  orientation: "portrait" | "landscape";
  /** Full-page ads run edge to edge; fractional ads sit inside the page's live area. */
  fullBleed: boolean;
  /** Distance from the ad's edges that headline, copy, logo and contact details must stay within. */
  safeInsetIn: number;
  /** Smallest legible body type for this size, in points. */
  minBodyPt: number;
  /** How much copy the size can carry. */
  copyGuidance: string;
};

const SPECS: Record<Exclude<AdPrintSpec["key"], "custom">, AdPrintSpec> = {
  full: {
    key: "full",
    label: "Full page",
    widthIn: 8.5,
    heightIn: 11,
    orientation: "portrait",
    fullBleed: true,
    safeInsetIn: 0.5,
    minBodyPt: 9,
    copyGuidance: "a headline, a short supporting paragraph or up to four benefit lines, a clear call to action, logo/business name and full booking details",
  },
  half: {
    key: "half",
    label: "Half page (horizontal)",
    widthIn: 7.5,
    heightIn: 4.875,
    orientation: "landscape",
    fullBleed: false,
    safeInsetIn: 0.25,
    minBodyPt: 8,
    copyGuidance: "a headline, one or two short supporting lines, a call to action, logo/business name and booking details",
  },
  quarter: {
    key: "quarter",
    label: "Quarter page (vertical)",
    widthIn: 3.625,
    heightIn: 4.875,
    orientation: "portrait",
    fullBleed: false,
    safeInsetIn: 0.1875,
    minBodyPt: 8,
    copyGuidance: "a short headline, at most one supporting line, a call to action, logo/business name and phone or website",
  },
  eighth: {
    key: "eighth",
    label: "Eighth page / business card (horizontal)",
    widthIn: 3.625,
    heightIn: 2.375,
    orientation: "landscape",
    fullBleed: false,
    safeInsetIn: 0.125,
    minBodyPt: 7,
    copyGuidance: "the business name or logo, a few-word tagline and one or two contact details; no paragraph copy",
  },
};

/** Size used when neither the editor's instructions nor the ad's style name a size. */
export const DEFAULT_AD_PRINT_SPEC = SPECS.half;

type SizeKey = keyof typeof SPECS;

// Style names are short labels, so a bare size word is enough.
const STYLE_PATTERNS: [RegExp, SizeKey][] = [
  [/\b(eighth|1\s*\/\s*8|business[\s-]*card)\b/i, "eighth"],
  [/\b(quarter|1\s*\/\s*4)\b/i, "quarter"],
  [/\b(half|1\s*\/\s*2)\b/i, "half"],
  [/\b(full|whole|back[\s-]*cover|inside[\s-]*cover)\b/i, "full"],
];

// Free-text instructions need "page" next to the size word, so "full colour" or "half the text" don't match.
const INSTRUCTION_PATTERNS: [RegExp, SizeKey][] = [
  [/\b(eighth|1\s*\/\s*8)[\s-]*(of\s+a\s+)?page\b|\bbusiness[\s-]*card\b/i, "eighth"],
  [/\b(quarter|1\s*\/\s*4)[\s-]*(of\s+a\s+)?page\b/i, "quarter"],
  [/\b(half|1\s*\/\s*2)[\s-]*(of\s+a\s+)?page\b/i, "half"],
  [/\b(full|whole)[\s-]*page\b|\b(back|inside)[\s-]*cover\b/i, "full"],
];

// "5 x 7 in", "5.5 × 8.5 inches", "4"x6"" (width first).
const DIMENSIONS_PATTERN = /(\d+(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?\b|["”])?\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?\b|["”])/i;

function matchSize(text: string | null | undefined, patterns: [RegExp, SizeKey][]): AdPrintSpec | null {
  if (!text?.trim()) return null;
  const match = patterns.find(([pattern]) => pattern.test(text));
  return match ? SPECS[match[1]] : null;
}

function customSpec(widthIn: number, heightIn: number): AdPrintSpec {
  const smallest = Math.min(widthIn, heightIn);
  const page = SPECS.full;
  return {
    key: "custom",
    label: "Custom size",
    widthIn,
    heightIn,
    orientation: widthIn > heightIn ? "landscape" : "portrait",
    fullBleed: widthIn >= page.widthIn && heightIn >= page.heightIn,
    safeInsetIn: smallest >= 7 ? 0.5 : smallest >= 3 ? 0.25 : 0.125,
    minBodyPt: smallest >= 3 ? 8 : 7,
    copyGuidance:
      smallest >= 7
        ? SPECS.full.copyGuidance
        : smallest >= 4
          ? SPECS.half.copyGuidance
          : smallest >= 3
            ? SPECS.quarter.copyGuidance
            : SPECS.eighth.copyGuidance,
  };
}

/** Resolves the print size of an ad style from its name (falling back to its description); null when unknown. */
export function resolveAdPrintSpec(styleName: string | null | undefined, styleDescription?: string | null): AdPrintSpec | null {
  return matchSize(styleName, STYLE_PATTERNS) ?? matchSize(styleDescription, STYLE_PATTERNS);
}

/** A size the editor asked for in custom instructions: explicit inches (1–17 in a side) or a named page fraction. */
export function resolveInstructionPrintSpec(instructions: string | null | undefined): AdPrintSpec | null {
  const dimensions = instructions?.match(DIMENSIONS_PATTERN);
  if (dimensions) {
    const [widthIn, heightIn] = [Number(dimensions[1]), Number(dimensions[2])];
    if ([widthIn, heightIn].every((side) => side >= 1 && side <= 17)) return customSpec(widthIn, heightIn);
  }
  return matchSize(instructions, INSTRUCTION_PATTERNS);
}

export type ResolvedAdPrintSpec = { spec: AdPrintSpec; source: "instructions" | "previous" | "style" | "default" };

/**
 * Editor instructions override everything; an iteration then keeps the size of the version it
 * revises; otherwise the style decides, and with no size anywhere the ad defaults to half page.
 */
export function resolveAdPrintSize({
  customInstructions,
  previous,
  styleName,
  styleDescription,
}: {
  customInstructions?: string | null;
  previous?: AdPrintSpec | null;
  styleName?: string | null;
  styleDescription?: string | null;
}): ResolvedAdPrintSpec {
  const fromInstructions = resolveInstructionPrintSpec(customInstructions);
  if (fromInstructions) return { spec: fromInstructions, source: "instructions" };
  if (previous) return { spec: previous, source: "previous" };
  const fromStyle = resolveAdPrintSpec(styleName, styleDescription);
  if (fromStyle) return { spec: fromStyle, source: "style" };
  return { spec: DEFAULT_AD_PRINT_SPEC, source: "default" };
}

/** Reads a spec stored in a task result, rejecting anything malformed. */
export function parseStoredPrintSpec(value: unknown): AdPrintSpec | null {
  if (typeof value !== "object" || value === null) return null;
  const spec = value as Partial<AdPrintSpec>;
  const inRange = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 17;
  if (
    typeof spec.key !== "string" ||
    typeof spec.label !== "string" ||
    !inRange(spec.widthIn) ||
    !inRange(spec.heightIn) ||
    (spec.orientation !== "portrait" && spec.orientation !== "landscape") ||
    typeof spec.fullBleed !== "boolean" ||
    typeof spec.safeInsetIn !== "number" ||
    typeof spec.minBodyPt !== "number" ||
    typeof spec.copyGuidance !== "string"
  ) {
    return null;
  }
  return spec as AdPrintSpec;
}

export function printPixels(spec: AdPrintSpec): { width: number; height: number } {
  return { width: Math.round(spec.widthIn * PRINT_DPI), height: Math.round(spec.heightIn * PRINT_DPI) };
}

// Aspect ratios the Gemini image models accept in generationConfig.imageConfig.aspectRatio.
const GEMINI_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/** Closest supported generation aspect ratio; the result is cropped to the exact size afterwards. */
export function closestGeminiAspectRatio(spec: AdPrintSpec): string {
  const target = Math.log(spec.widthIn / spec.heightIn);
  let best = GEMINI_ASPECT_RATIOS[0];
  let bestDistance = Infinity;
  for (const ratio of GEMINI_ASPECT_RATIOS) {
    const [w, h] = ratio.split(":").map(Number);
    const distance = Math.abs(Math.log(w / h) - target);
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best;
}

export function describePrintSize(spec: AdPrintSpec): string {
  const { width, height } = printPixels(spec);
  return `${spec.label}: ${spec.widthIn} x ${spec.heightIn} in (${width} x ${height} px at ${PRINT_DPI} dpi)`;
}

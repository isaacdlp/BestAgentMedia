import "server-only";

const maxInstructionsLength = 2000;

/** Body words that fill one magazine page next to a headline and a photo (an editorial estimate). */
export const ARTICLE_WORDS_PER_PAGE = 550;
export const DEFAULT_ARTICLE_PAGES = 1;
const MIN_PAGES = 0.25;
const MAX_PAGES = 6;

/**
 * Optional JSON body sent by the Enhance dialog on an article: staff custom instructions and the
 * target length in pages (quarter-page steps). A missing or malformed body means the defaults.
 */
export async function readArticleEnhanceRequest(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // keep the empty body
  }
  const instructions =
    typeof body.instructions === "string" ? body.instructions.trim().slice(0, maxInstructionsLength) : "";
  const pages = typeof body.targetPages === "number" && Number.isFinite(body.targetPages) ? body.targetPages : DEFAULT_ARTICLE_PAGES;
  const targetPages = Math.min(MAX_PAGES, Math.max(MIN_PAGES, Math.round(pages * 4) / 4));
  return { instructions, targetPages };
}

/** Approximate word count of a Markdown body (formatting marks ignored). */
export function countArticleWords(markdown: string) {
  return markdown.replace(/[#>*_`[\]()]/g, " ").split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

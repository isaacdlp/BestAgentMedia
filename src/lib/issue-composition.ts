// Automatic issue composition. The Designer agent writes a plan that assigns every page a
// template (src/lib/issue-templates.ts) and fills the template's stories with articles and its ad
// slots with ads. This module checks such a plan and resolves it into the exact content of every
// slot, flowing each article's text across its pages in order, so a long article continues on
// later pages. It has no browser or server dependencies: the generator uses it to validate the
// plan and give the model precise feedback, the task page uses its result for the preview, and
// the issue editor turns the result into editable CE.SDK pages (src/lib/cesdk-issue-templates.ts).

import { layoutRichText, parseArticleMarkdown, type RichParagraph } from "@/lib/article-rich-text";
import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAGE_WIDTH, type ContentSourceType, type IssuePageType } from "@/lib/issue-design";
import {
  columnWordCapacity,
  findIssuePageTemplate,
  fitSentences,
  flowTextWithRest,
  isAdSlot,
  isContentSlot,
  ISSUE_PAGE_TEMPLATES,
  labelText,
  pageNumberText,
  plainTextExcerpt,
  pullQuoteText,
  slotStory,
  slotTextLimit,
  type IssuePageTemplate,
  type TemplateIssueInfo,
  type TemplateSlot,
  type TemplateTextSlot,
} from "@/lib/issue-templates";

export const COMPOSITION_FORMAT = "composition";
export const MAX_COMPOSED_PAGES = 64;

const DEFAULT_TEMPLATES: Record<IssuePageType, string> = {
  COVER: "journer-cover",
  INNER: "feature-spread",
  BACK_COVER: "journer-back-cover",
};
const AD_PAGE_TEMPLATES = {
  full: "full-page-ad",
  half: "two-half-page-ads",
  quarter: "four-quarter-page-ads",
} as const;

export type AdSize = "full" | "half" | "quarter" | "eighth";

// Content as the composer sees it. Image URLs are the app's authorized media routes.
export type CompositionArticle = {
  id: string;
  title: string;
  // Markdown, as stored on the article.
  body: string;
  status: string;
  imageUrls: string[];
  // Paid promotion style (a sponsored feature), if any.
  sponsoredStyle: string | null;
  businessName: string | null;
};
export type CompositionAd = {
  id: string;
  title: string;
  businessName: string;
  status: string;
  size: AdSize;
  sizeLabel: string;
  imageUrl: string | null;
};

export type PlanStory = { story: number; articleId: string; headline: string | null; teaser: string | null };
export type PlanPage = {
  type: IssuePageType;
  templateId: string;
  stories: PlanStory[];
  adIds: string[];
  note: string;
};
// A shortened or tightened version of an article's text, written by the Designer so the article
// fits the chosen templates. It replaces the article's body in this layout only; the saved article
// is unchanged.
export type ArticleEdit = { articleId: string; body: string; reason: string };
export type CompositionPlan = { summary: string; pages: PlanPage[]; articleEdits?: ArticleEdit[] };

export type SlotLink = { sourceType: ContentSourceType; sourceId: string; title: string };
export type ComposedSlot =
  | { slotId: string; kind: "text"; text: string; rich?: RichParagraph[]; link?: SlotLink }
  // A null `src` keeps the template's placeholder picture.
  | { slotId: string; kind: "image"; src: string | null; fit: "Cover" | "Contain"; link?: SlotLink }
  // Content slots of an unfilled story are left out instead of showing placeholder text.
  | { slotId: string; kind: "omit" };
export type ComposedPage = {
  type: IssuePageType;
  templateId: string;
  note: string;
  articleIds: string[];
  adIds: string[];
  // One entry per template slot that is not a decoration, in template order.
  slots: ComposedSlot[];
};
export type ComposedIssue = {
  format: typeof COMPOSITION_FORMAT;
  version: 1;
  width: number;
  height: number;
  summary: string;
  generatedAt: string;
  pages: ComposedPage[];
};

export type CompositionContext = {
  articles: CompositionArticle[];
  ads: CompositionAd[];
  issueInfo: TemplateIssueInfo;
};

export type CompositionResult = {
  issue: ComposedIssue;
  // Problems that must be fixed before the plan is used.
  errors: string[];
  // Acceptable but worth a second look (placeholder photos, size mismatches).
  warnings: string[];
};

export function isComposedIssue(value: unknown): value is ComposedIssue {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.format === COMPOSITION_FORMAT && Array.isArray(record.pages);
}

export function countWords(text: string) {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function paragraphsWords(paragraphs: RichParagraph[]) {
  return paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph.text), 0);
}

// Edits that cut more than this share of an article are allowed but flagged for review.
const LARGE_CUT_SHARE = 0.5;

/**
 * Checks the Designer's text edits: each must name a known article once, keep some text and be no
 * longer than the original (edits fit text to the page; they never add to it). Returns the
 * articles as the layout prints them, with valid edits applied.
 */
export function applyArticleEdits(edits: ArticleEdit[] | undefined, articles: CompositionArticle[]) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(articles.map((article) => [article.id, article]));
  const valid: ArticleEdit[] = [];
  const seen = new Set<string>();
  for (const edit of edits ?? []) {
    const article = byId.get(edit.articleId);
    if (!article) {
      errors.push(`Text edit for unknown article ID "${edit.articleId}".`);
      continue;
    }
    if (seen.has(article.id)) {
      errors.push(`"${article.title}" has more than one text edit; submit one fitted text per article.`);
      continue;
    }
    seen.add(article.id);
    const original = countWords(article.body);
    const fitted = countWords(edit.body);
    if (!fitted) {
      errors.push(`The fitted text of "${article.title}" is empty; every article must still be printed.`);
      continue;
    }
    if (fitted > original) {
      errors.push(`The fitted text of "${article.title}" has ${fitted} words, more than the original ${original}; text edits may only shorten or tighten an article.`);
      continue;
    }
    if (fitted < original * (1 - LARGE_CUT_SHARE)) {
      warnings.push(`"${article.title}" was cut from ${original} to ${fitted} words to fit the layout; check that nothing important was lost.`);
    }
    valid.push(edit);
  }
  const fittedBodies = new Map(valid.map((edit) => [edit.articleId, edit.body]));
  return {
    articles: articles.map((article) => (fittedBodies.has(article.id) ? { ...article, body: fittedBodies.get(article.id) as string } : article)),
    valid,
    errors,
    warnings,
  };
}

// The size class an ad slot is made for, from its frame on the reference page.
export function adSlotSize(slot: TemplateSlot): AdSize {
  if (slot.frame.width >= 800) return "full";
  if (slot.frame.width >= 600) return "half";
  return "quarter";
}

function acceptsAdSize(slotSize: AdSize, size: AdSize) {
  if (slotSize === "quarter") return size === "quarter" || size === "eighth";
  return slotSize === size;
}

function bodyColumns(template: IssuePageTemplate, story: number) {
  return template.slots.filter(
    (slot): slot is TemplateTextSlot => slot.kind === "text" && slot.role === "body" && slotStory(slot) === story,
  );
}

function storyNumbers(template: IssuePageTemplate) {
  return [...new Set(template.slots.filter(isContentSlot).map(slotStory))].sort((a, b) => a - b);
}

/** A compact description of every template for the Designer's prompt. */
export function describeTemplates() {
  return ISSUE_PAGE_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    pageTypes: template.pageTypes,
    stories: storyNumbers(template).map((story) => {
      const slots = template.slots.filter((slot) => isContentSlot(slot) && slotStory(slot) === story);
      const has = (role: string) => slots.some((slot) => slot.role === role);
      const columns = bodyColumns(template, story);
      const teaser = slots.find((slot) => slot.kind === "text" && slot.role === "subtitle" && slot.maxChars);
      return {
        story,
        ...(story === 0 ? { continuationOnly: true } : {}),
        headline: has("title"),
        introOrCaption: has("subtitle") || has("caption"),
        ...(teaser && teaser.kind === "text" ? { teaserMaxChars: teaser.maxChars } : {}),
        pullQuote: has("quote"),
        photos: slots.filter((slot) => slot.kind === "image").length,
        bodyWords: columns.length ? columnWordCapacity(columns) : 0,
      };
    }),
    adSlots: template.slots.filter(isAdSlot).map(adSlotSize),
  }));
}

type ArticleState = {
  article: CompositionArticle;
  remaining: RichParagraph[];
  started: boolean;
  // Page number (1-based) of the article's first body placement.
  firstPage: number;
  lastBodyPage: number;
  quoteUsed: boolean;
};

function link(article: CompositionArticle): SlotLink {
  return { sourceType: "article", sourceId: article.id, title: article.title };
}

function adLink(ad: CompositionAd): SlotLink {
  return { sourceType: "advertisement", sourceId: ad.id, title: ad.title };
}

function plainText(paragraphs: RichParagraph[]) {
  return paragraphs.map((paragraph) => paragraph.text).join("\n\n");
}

/**
 * Resolves a plan into the content of every slot and checks it: every article must be printed
 * in full on inner pages, every ad placed exactly once, and every story slot filled.
 */
export function composeIssue(
  plan: CompositionPlan,
  context: CompositionContext,
  { strict = true }: { strict?: boolean } = {},
): CompositionResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Gaps a repaired plan may keep: the slots are left off the page instead.
  const gap = (message: string) => (strict ? errors : warnings).push(message);
  // Articles as printed: the Designer's fitted texts replace the original bodies.
  const edited = applyArticleEdits(plan.articleEdits, context.articles);
  errors.push(...edited.errors);
  warnings.push(...edited.warnings);
  const articles = new Map(edited.articles.map((article) => [article.id, article]));
  const ads = new Map(context.ads.map((ad) => [ad.id, ad]));
  const states = new Map<string, ArticleState>();
  const state = (article: CompositionArticle) => {
    let current = states.get(article.id);
    if (!current) {
      current = {
        article,
        remaining: parseArticleMarkdown(article.body).body,
        started: false,
        firstPage: 0,
        lastBodyPage: 0,
        quoteUsed: false,
      };
      states.set(article.id, current);
    }
    return current;
  };
  const placedAds = new Map<string, number>();

  if (plan.pages.length < 3) errors.push("The issue needs a cover, at least one inner page and a back cover.");
  if (plan.pages.length > MAX_COMPOSED_PAGES) errors.push(`Use at most ${MAX_COMPOSED_PAGES} pages.`);
  plan.pages.forEach((page, index) => {
    const expected: IssuePageType = index === 0 ? "COVER" : index === plan.pages.length - 1 ? "BACK_COVER" : "INNER";
    if (page.type !== expected) {
      errors.push(`Page ${index + 1} must be ${expected === "INNER" ? "an inner page" : expected === "COVER" ? "the cover" : "the back cover"} (the cover is first, the back cover last).`);
    }
  });

  // Each photo is printed once across the issue where possible. The cover's lead story and a
  // featured back-cover story reserve their article's first free photos before the inner pages
  // take theirs in order; slots left without a photo are filled from other articles afterwards.
  const usedPhotos = new Set<string>();
  const takePhoto = (article: CompositionArticle) => {
    const url = article.imageUrls.find((candidate) => !usedPhotos.has(candidate)) ?? null;
    if (url) usedPhotos.add(url);
    return url;
  };
  const reservedPhotos = new Map<number, string | null>();
  if (plan.pages.length >= 2) {
    for (const index of [0, plan.pages.length - 1]) {
      const entry = plan.pages[index].stories.find((candidate) => candidate.story === 1);
      const article = entry ? articles.get(entry.articleId) : undefined;
      if (article && plan.pages[index].type !== "INNER") reservedPhotos.set(index, takePhoto(article));
    }
  }
  type PendingFill = {
    pageIndex: number;
    slotId: string;
    priority: number;
    article: CompositionArticle | null;
    ad: CompositionAd | null;
  };
  const pendingFills: PendingFill[] = [];

  const pages: ComposedPage[] = plan.pages.map((page, index) => {
    const pageNumber = index + 1;
    const where = `Page ${pageNumber}`;
    const template = findIssuePageTemplate(page.templateId);
    if (!template) {
      errors.push(`${where}: unknown template "${page.templateId}".`);
      return { type: page.type, templateId: page.templateId, note: page.note, articleIds: [], adIds: [], slots: [] };
    }
    if (!template.pageTypes.includes(page.type)) {
      errors.push(`${where}: template "${template.id}" cannot be used on ${page.type === "INNER" ? "an inner page" : page.type === "COVER" ? "the cover" : "the back cover"}.`);
    }
    const isCover = page.type === "COVER";
    const isBack = page.type === "BACK_COVER";
    const resolved = new Map<string, ComposedSlot>();
    const stories = storyNumbers(template);
    const filledStories = new Set<number>();
    const articleIds: string[] = [];

    for (const entry of page.stories) {
      const article = articles.get(entry.articleId);
      if (!article) {
        errors.push(`${where}: unknown article ID "${entry.articleId}".`);
        continue;
      }
      if (!stories.includes(entry.story)) {
        errors.push(`${where}: template "${template.id}" has no story ${entry.story} (it has ${stories.join(", ")}).`);
        continue;
      }
      if (filledStories.has(entry.story)) {
        errors.push(`${where}: story ${entry.story} is assigned twice.`);
        continue;
      }
      if (isCover && page.stories.some((other) => other !== entry && other.story < entry.story && other.articleId === entry.articleId)) {
        errors.push(`${where}: "${article.title}" is already on the cover; each cover story needs a different article (leave extra teasers empty).`);
        continue;
      }
      filledStories.add(entry.story);
      articleIds.push(article.id);
      const slots = template.slots.filter((slot) => isContentSlot(slot) && slotStory(slot) === entry.story);
      const columns = bodyColumns(template, entry.story);
      const current = state(article);
      const articleLink = link(article);
      // The covers tease stories; the article itself is printed on inner pages.
      const teaser = isCover || isBack;
      const continuation = !teaser && current.started;
      if (!teaser && entry.story === 0 && !current.started) {
        gap(`${where}: story 0 is for text continued from an earlier page, but "${article.title}" starts here.`);
      }

      if (!teaser && !current.started) {
        current.started = true;
        current.firstPage = pageNumber;
        // The introduction or caption shows the opening paragraph, so the body starts after it.
        const introSlot = slots.find((slot): slot is TemplateTextSlot => slot.kind === "text" && (slot.role === "subtitle" || slot.role === "caption"));
        const textParagraphs = current.remaining.filter((paragraph) => !paragraph.heading);
        const intro = textParagraphs[0];
        if (introSlot && !entry.teaser?.trim() && intro && textParagraphs.length > 1 && plainTextExcerpt(article.body, slotTextLimit(introSlot)) === intro.text) {
          current.remaining = current.remaining.filter((paragraph) => paragraph !== intro);
        }
      }

      for (const slot of slots) {
        if (slot.kind === "image") {
          if (teaser) {
            const src = reservedPhotos.get(index) ?? null;
            resolved.set(slot.id, { slotId: slot.id, kind: "image", src, fit: "Cover", ...(src ? { link: articleLink } : {}) });
            if (!src) pendingFills.push({ pageIndex: index, slotId: slot.id, priority: 0, article, ad: null });
          } else {
            const src = takePhoto(article);
            resolved.set(slot.id, { slotId: slot.id, kind: "image", src, fit: "Cover", ...(src ? { link: articleLink } : {}) });
            if (!src) pendingFills.push({ pageIndex: index, slotId: slot.id, priority: 1, article, ad: null });
          }
          continue;
        }
        if (slot.kind !== "text" || slot.role === "body") continue;
        let text: string;
        if (slot.role === "title") {
          text = entry.headline?.trim() || (continuation ? `${article.title} (continued)` : article.title);
        } else if (slot.role === "subtitle" || slot.role === "caption") {
          const limit = slotTextLimit(slot);
          const teaserText = entry.teaser?.trim();
          if (teaserText && teaserText.length > limit) {
            // Teasers are printed whole, so one that is too long is sent back instead of being cut.
            gap(`${where}: the teaser for "${article.title}" has ${teaserText.length} characters but story ${entry.story}'s frame holds ${limit}; write a shorter teaser of complete sentences.`);
          }
          text = continuation
            ? `Continued from page ${current.firstPage}`
            : fitSentences(teaserText || plainTextExcerpt(article.body, limit), limit);
        } else if (slot.role === "quote") {
          text = !current.quoteUsed || !current.remaining.length ? pullQuoteText(article.body) : pullQuoteText(plainText(current.remaining));
          current.quoteUsed = true;
          if (!text) continue;
        } else {
          continue;
        }
        resolved.set(slot.id, { slotId: slot.id, kind: "text", text, link: articleLink });
      }

      if (columns.length) {
        if (teaser) continue;
        if (!current.remaining.length) {
          gap(`${where}: all of "${article.title}" is already printed on earlier pages, so story ${entry.story}'s columns would be empty.`);
        }
        const { parts, rest } = flowTextWithRest(current.remaining, columns);
        current.remaining = rest;
        current.lastBodyPage = pageNumber;
        const fill = Math.round((100 * paragraphsWords(parts.flat())) / Math.max(1, columnWordCapacity(columns)));
        if (current.remaining.length === 0 && fill < 35 && current.firstPage !== pageNumber) {
          warnings.push(`${where}: the end of "${article.title}" fills only about ${fill}% of story ${entry.story}'s columns.`);
        }
        for (const [columnIndex, column] of columns.entries()) {
          const rich = parts[columnIndex] ?? [];
          if (!rich.length) {
            resolved.set(column.id, { slotId: column.id, kind: "omit" });
            warnings.push(`${where}: column ${columnIndex + 1} of story ${entry.story} is empty because "${article.title}" ends earlier; a template with fewer columns, or more text for this page, would avoid a blank area.`);
            continue;
          }
          resolved.set(column.id, { slotId: column.id, kind: "text", text: layoutRichText(rich).text, rich, link: articleLink });
        }
      } else if (!teaser) {
        // An opener without columns (a feature photo); the text follows on later pages.
        current.lastBodyPage = Math.max(current.lastBodyPage, pageNumber);
      }
    }

    for (const story of stories) {
      if (filledStories.has(story)) continue;
      // Cover teasers are optional: an issue with few articles shows fewer of them.
      if (isCover && story > 1) continue;
      gap(`${where}: story ${story} of "${template.id}" has no article; fill it or pick a template with fewer stories.`);
    }

    // Ads go into the ad slots of inner pages, in order; the covers never carry ads.
    const adSlots = template.slots.filter(isAdSlot).map((slot) => ({ slot, size: adSlotSize(slot) }));
    const pageAds: string[] = [];
    if ((isCover || isBack) && page.adIds.length) {
      errors.push(`${where}: the ${isCover ? "front" : "back"} cover never carries ads; place them on inner pages.`);
    } else if (page.adIds.length > adSlots.length) {
      errors.push(`${where}: ${page.adIds.length} ads assigned but "${template.id}" has ${adSlots.length} ad slot(s).`);
    }
    if (adSlots.length && !page.adIds.length) {
      gap(`${where}: "${template.id}" is an ad template but no ad is assigned to it.`);
    }
    for (const [adIndex, { slot, size }] of adSlots.entries()) {
      const adId = page.adIds[adIndex];
      const ad = adId ? ads.get(adId) : undefined;
      if (adId && !ad) errors.push(`${where}: unknown ad ID "${adId}".`);
      if (!ad) {
        // A free ad slot next to the page's ads (one half-page ad on "two-half-page-ads", say)
        // shows an unused article photo; it is filled after every story photo.
        resolved.set(slot.id, { slotId: slot.id, kind: "omit" });
        pendingFills.push({ pageIndex: index, slotId: slot.id, priority: 2, article: null, ad: null });
        continue;
      }
      if (placedAds.has(ad.id)) errors.push(`${where}: ad "${ad.title}" is already placed on page ${placedAds.get(ad.id)}.`);
      placedAds.set(ad.id, pageNumber);
      pageAds.push(ad.id);
      if (!acceptsAdSize(size, ad.size)) {
        warnings.push(`${where}: "${ad.title}" is a ${ad.sizeLabel} ad in a ${size} slot; its artwork is scaled to fit.`);
      }
      resolved.set(slot.id, { slotId: slot.id, kind: "image", src: ad.imageUrl, fit: "Contain", link: adLink(ad) });
      if (!ad.imageUrl) pendingFills.push({ pageIndex: index, slotId: slot.id, priority: 1, article: null, ad });
    }

    const slots: ComposedSlot[] = template.slots
      .filter((slot) => slot.kind !== "rect")
      .map((slot): ComposedSlot => {
        const found = resolved.get(slot.id);
        if (found) return found;
        if (slot.kind === "text" && slot.role === "label") return { slotId: slot.id, kind: "text", text: labelText(slot, context.issueInfo) };
        if (slot.kind === "text" && slot.role === "pageNumber") return { slotId: slot.id, kind: "text", text: pageNumberText(slot, pageNumber) };
        return { slotId: slot.id, kind: "omit" };
      });
    return { type: page.type, templateId: template.id, note: page.note, articleIds: [...new Set(articleIds)], adIds: pageAds, slots };
  });

  // Fill every picture slot that has no picture: the cover and back cover first, then inner
  // pages and ad slots without an ad or artwork. Photos not used yet come first (from the page's
  // own articles, then the articles with the most photos left); only when none is left is a photo
  // repeated.
  const pickPhoto = (preferIds: string[]) => {
    const preferred = preferIds.flatMap((id) => (articles.get(id) ? [articles.get(id) as CompositionArticle] : []));
    const others = edited.articles
      .filter((article) => !preferIds.includes(article.id))
      .sort(
        (a, b) =>
          b.imageUrls.filter((url) => !usedPhotos.has(url)).length - a.imageUrls.filter((url) => !usedPhotos.has(url)).length,
      );
    const candidates = [...preferred, ...others];
    for (const article of candidates) {
      const url = takePhoto(article);
      if (url) return { article, url, repeated: false };
    }
    for (const article of candidates) {
      const url = article.imageUrls[article.imageUrls.length - 1];
      if (url) return { article, url, repeated: true };
    }
    return null;
  };
  for (const fill of [...pendingFills].sort((a, b) => a.priority - b.priority || a.pageIndex - b.pageIndex)) {
    const where = `Page ${fill.pageIndex + 1}`;
    const page = pages[fill.pageIndex];
    const subject = fill.ad ? `the ad "${fill.ad.title}"` : fill.article ? `"${fill.article.title}"` : "an empty slot";
    const freeAdSlot = !fill.ad && !fill.article;
    const found = pickPhoto([...(fill.article ? [fill.article.id] : []), ...page.articleIds]);
    const slotIndex = page.slots.findIndex((slot) => slot.slotId === fill.slotId);
    if (freeAdSlot && (!found || found.repeated)) {
      gap(`${where}: ad slot "${fill.slotId}" has no ad and no unused article photo is left for it; pick a template with fewer ad slots.`);
      if (!found) continue;
    }
    if (!found || slotIndex < 0) {
      warnings.push(
        fill.ad
          ? `${where}: "${fill.ad.title}" has no artwork yet and no article photo is available; its slot keeps the ad placeholder until a creative is set.`
          : `${where}: no photo is available for ${subject}; the slot keeps its placeholder.`,
      );
      continue;
    }
    page.slots[slotIndex] = { slotId: fill.slotId, kind: "image", src: found.url, fit: "Cover", link: link(found.article) };
    if (!page.articleIds.includes(found.article.id)) page.articleIds.push(found.article.id);
    const source = found.article.id === fill.article?.id ? "" : ` from "${found.article.title}"`;
    if (fill.ad) {
      warnings.push(
        `${where}: "${fill.ad.title}" has no artwork yet, so its slot shows a photo${source || ` of "${found.article.title}"`}${found.repeated ? " that is already used elsewhere (no unused photo was left)" : ""}; select the photo and apply the ad once its creative is set.`,
      );
    } else if (found.repeated) {
      warnings.push(`${where}: no unused photo was left for ${subject}, so a photo already used elsewhere is repeated.`);
    } else if (freeAdSlot) {
      warnings.push(`${where}: the free ad slot "${fill.slotId}" shows an unused photo of "${found.article.title}".`);
    } else if (source) {
      warnings.push(`${where}: ${subject} has no photo left, so its slot uses an unused photo${source}.`);
    }
  }

  for (const article of edited.articles) {
    const current = states.get(article.id);
    if (!current?.started) {
      errors.push(`Article "${article.title}" (${article.id}) is not placed on any inner page.`);
    } else if (current.remaining.length) {
      errors.push(
        `Article "${article.title}" (${article.id}) still has about ${paragraphsWords(current.remaining)} words left after its last page (page ${current.lastBodyPage}); continue it on later pages (for example story 0 of "two-stories" or a "text-columns" page), or shorten its fitted text.`,
      );
    }
  }
  for (const ad of context.ads) {
    if (!placedAds.has(ad.id)) errors.push(`Ad "${ad.title}" (${ad.id}, ${ad.sizeLabel}) is not placed.`);
  }

  return {
    issue: {
      format: COMPOSITION_FORMAT,
      version: 1,
      width: DEFAULT_PAGE_WIDTH,
      height: DEFAULT_PAGE_HEIGHT,
      summary: plan.summary,
      generatedAt: new Date().toISOString(),
      pages,
    },
    errors,
    warnings,
  };
}

function blankPage(type: IssuePageType, templateId: string, note: string): PlanPage {
  return { type, templateId, stories: [], adIds: [], note };
}

/**
 * Turns any plan into one that passes `composeIssue`: it fixes the page order and templates,
 * drops invalid assignments, and adds pages for content the plan left out or text that did not
 * fit. Used only when the Designer could not produce a valid plan itself; each change is listed.
 */
export function repairPlan(plan: CompositionPlan, context: CompositionContext): { plan: CompositionPlan; changes: string[] } {
  const changes: string[] = [];
  const articles = new Map(context.articles.map((article) => [article.id, article]));
  const ads = new Map(context.ads.map((ad) => [ad.id, ad]));
  const inner = plan.pages.filter((page) => page.type === "INNER").map((page) => ({ ...page }));
  const cover = { ...(plan.pages.find((page) => page.type === "COVER") ?? blankPage("COVER", DEFAULT_TEMPLATES.COVER, "Added cover")) };
  const back = { ...(plan.pages.find((page) => page.type === "BACK_COVER") ?? blankPage("BACK_COVER", DEFAULT_TEMPLATES.BACK_COVER, "Added back cover")) };
  if (plan.pages[0]?.type !== "COVER" || plan.pages[plan.pages.length - 1]?.type !== "BACK_COVER") {
    changes.push("Put the cover first and the back cover last.");
  }
  let pages: PlanPage[] = [cover, ...inner, back];

  const usedAds = new Set<string>();
  pages = pages.map((page) => {
    const template = findIssuePageTemplate(page.templateId);
    let templateId = page.templateId;
    if (!template || !template.pageTypes.includes(page.type)) {
      templateId = DEFAULT_TEMPLATES[page.type];
      changes.push(`Replaced template "${page.templateId}" with "${templateId}".`);
    }
    const chosen = findIssuePageTemplate(templateId) as IssuePageTemplate;
    const stories = storyNumbers(chosen);
    const seen = new Set<number>();
    const storyEntries = page.stories.filter((entry) => {
      const ok = articles.has(entry.articleId) && stories.includes(entry.story) && !seen.has(entry.story);
      if (ok) seen.add(entry.story);
      else changes.push(`Dropped an invalid story assignment (${entry.articleId}, story ${entry.story}).`);
      return ok;
    });
    // The covers have no ad slots, so ads planned there move to added ad pages.
    const capacity = chosen.slots.filter(isAdSlot).length;
    const adIds = page.adIds.filter((id) => {
      const ok = ads.has(id) && !usedAds.has(id);
      if (ok) usedAds.add(id);
      return ok;
    });
    const kept = adIds.slice(0, capacity);
    for (const id of adIds.slice(capacity)) usedAds.delete(id);
    if (page.type !== "INNER" && adIds.length) changes.push(`Moved the ads planned on the ${page.type === "COVER" ? "front" : "back"} cover to inner pages.`);
    return { ...page, templateId, stories: storyEntries, adIds: kept };
  });

  // Ad pages left without any ad or story are dropped.
  pages = pages.filter((page) => {
    const template = findIssuePageTemplate(page.templateId);
    const empty = page.type === "INNER" && !page.adIds.length && !page.stories.length && !!template?.slots.some(isAdSlot);
    if (empty) changes.push(`Removed an ad page ("${page.templateId}") that had no ads.`);
    return !empty;
  });

  // Both covers feature an article in story 1: the one with the most photos that the other
  // cover does not already lead.
  const byPhotos = [...context.articles].sort((a, b) => b.imageUrls.length - a.imageUrls.length);
  for (const index of [0, pages.length - 1]) {
    const page = pages[index];
    if (page.stories.some((entry) => entry.story === 1) || !byPhotos.length) continue;
    const other = pages[index === 0 ? pages.length - 1 : 0].stories.find((entry) => entry.story === 1)?.articleId;
    const article = byPhotos.find((candidate) => candidate.id !== other) ?? byPhotos[0];
    pages[index] = { ...page, stories: [{ story: 1, articleId: article.id, headline: null, teaser: null }, ...page.stories] };
    changes.push(`Featured "${article.title}" on the ${index === 0 ? "front" : "back"} cover.`);
  }

  // Ads the plan left out get ad pages of their size, before the back cover.
  const missingAds = context.ads.filter((ad) => !usedAds.has(ad.id));
  for (const size of ["full", "half", "quarter"] as const) {
    const group = missingAds.filter((ad) => ad.size === size || (size === "quarter" && ad.size === "eighth"));
    const templateId = AD_PAGE_TEMPLATES[size];
    const perPage = findIssuePageTemplate(templateId)?.slots.filter(isAdSlot).length ?? 1;
    for (let start = 0; start < group.length; start += perPage) {
      const chunk = group.slice(start, start + perPage);
      pages.splice(pages.length - 1, 0, { ...blankPage("INNER", templateId, "Added for unplaced ads"), adIds: chunk.map((ad) => ad.id) });
      changes.push(`Added a page for ${chunk.map((ad) => `"${ad.title}"`).join(", ")}.`);
    }
  }

  // Articles the plan left out get their own pages, before the back cover.
  const placed = new Set(pages.filter((page) => page.type === "INNER").flatMap((page) => page.stories.map((entry) => entry.articleId)));
  for (const article of context.articles) {
    if (placed.has(article.id)) continue;
    const templateId = article.imageUrls.length >= 3 ? "feature-spread" : article.imageUrls.length ? "photo-story" : "text-columns";
    pages.splice(pages.length - 1, 0, {
      ...blankPage("INNER", templateId, "Added for an unplaced article"),
      stories: [{ story: 1, articleId: article.id, headline: null, teaser: null }],
    });
    changes.push(`Added a page for "${article.title}".`);
  }

  // Only valid text edits are kept; the others fall back to the article's original text.
  const edits = applyArticleEdits(plan.articleEdits, context.articles);
  for (const error of edits.errors) changes.push(`Ignored a text edit: ${error}`);

  // Text that does not fit continues on added text pages right after the article's last page.
  let candidate: CompositionPlan = { summary: plan.summary, pages, articleEdits: edits.valid };
  for (let round = 0; round < 80; round += 1) {
    const { errors } = composeIssue(candidate, context, { strict: false });
    const overflow = errors
      .map((error) => /^Article ".*" \(([\w-]+)\) still has about \d+ words left after its last page \(page (\d+)\)/.exec(error))
      .find((match): match is RegExpExecArray => !!match);
    if (!overflow) break;
    const [, articleId, pageText] = overflow;
    const article = articles.get(articleId) as CompositionArticle;
    const at = Math.min(Number(pageText), candidate.pages.length - 1);
    candidate = {
      ...candidate,
      pages: [
        ...candidate.pages.slice(0, at),
        { ...blankPage("INNER", "text-columns", "Added for continued text"), stories: [{ story: 1, articleId, headline: null, teaser: null }] },
        ...candidate.pages.slice(at),
      ],
    };
    if (round === 0 || !changes.at(-1)?.includes(article.title)) changes.push(`Added continuation pages for "${article.title}".`);
  }
  if (candidate.pages.length > MAX_COMPOSED_PAGES) changes.push(`The issue has ${candidate.pages.length} pages, more than the usual limit of ${MAX_COMPOSED_PAGES}.`);
  return { plan: candidate, changes: [...new Set(changes)] };
}

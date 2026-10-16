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
  fitSlotText,
  flowTextWithRest,
  isAdSlot,
  isContentSlot,
  ISSUE_PAGE_TEMPLATES,
  labelText,
  pageNumberText,
  plainTextExcerpt,
  pullQuoteText,
  slotStory,
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
  // Headline and introduction for a page that shows them without an article (a back cover with an ad).
  headline: string | null;
  intro: string | null;
  note: string;
};
export type CompositionPlan = { summary: string; pages: PlanPage[] };

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

// The size class an ad slot is made for, from its frame on the reference page.
export function adSlotSize(slot: TemplateSlot): AdSize {
  if (slot.frame.width >= 800) return "full";
  if (slot.frame.width >= 600) return "half";
  return "quarter";
}

function acceptsAdSize(slotSize: AdSize | "back-cover", size: AdSize) {
  if (slotSize === "back-cover") return size === "full" || size === "half";
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
  const articles = new Map(context.articles.map((article) => [article.id, article]));
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
        const showsIntro = slots.some((slot) => slot.role === "subtitle" || slot.role === "caption");
        const textParagraphs = current.remaining.filter((paragraph) => !paragraph.heading);
        const intro = textParagraphs[0];
        if (showsIntro && intro && textParagraphs.length > 1 && plainTextExcerpt(article.body) === intro.text) {
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
          text = continuation
            ? `Continued from page ${current.firstPage}`
            : fitSlotText(slot, entry.teaser?.trim() || plainTextExcerpt(article.body, slot.maxChars ?? 220));
        } else if (slot.role === "quote") {
          text = !current.quoteUsed || !current.remaining.length ? pullQuoteText(article.body) : pullQuoteText(plainText(current.remaining));
          current.quoteUsed = true;
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
      const pageHeadline = page.headline?.trim();
      const isBackStory = isBack && story === 1 && (page.adIds.length > 0 || pageHeadline);
      // Cover teasers are optional: an issue with few articles shows fewer of them.
      const optionalTeaser = isCover && story > 1;
      if (!isBackStory && !optionalTeaser) {
        gap(`${where}: story ${story} of "${template.id}" has no article; fill it or pick a template with fewer stories.`);
      }
    }

    // Ads go into the ad slots in order; the back cover shows one ad in its photo frame.
    const adSlots: { slot: TemplateSlot; size: AdSize | "back-cover" }[] = template.slots.filter(isAdSlot).map((slot) => ({ slot, size: adSlotSize(slot) }));
    if (isBack && !adSlots.length) {
      const photo = template.slots.find((slot) => slot.kind === "image" && slotStory(slot) === 1);
      if (photo && page.adIds.length) {
        if (filledStories.has(1)) errors.push(`${where}: the back cover shows either a featured story or an ad in its photo frame, not both.`);
        adSlots.push({ slot: photo, size: "back-cover" });
      }
    }
    const pageAds: string[] = [];
    if (page.adIds.length > adSlots.length) {
      errors.push(`${where}: ${page.adIds.length} ads assigned but "${template.id}" has ${adSlots.length} ad slot(s).`);
    }
    for (const [adIndex, { slot, size }] of adSlots.entries()) {
      const adId = page.adIds[adIndex];
      const ad = adId ? ads.get(adId) : undefined;
      if (adId && !ad) errors.push(`${where}: unknown ad ID "${adId}".`);
      if (!ad) {
        if (!adId) gap(`${where}: ad slot ${adIndex + 1} of "${template.id}" is empty; every ad slot needs an ad.`);
        resolved.set(slot.id, { slotId: slot.id, kind: "omit" });
        pendingFills.push({ pageIndex: index, slotId: slot.id, priority: 1, article: null, ad: null });
        continue;
      }
      if (placedAds.has(ad.id)) errors.push(`${where}: ad "${ad.title}" is already placed on page ${placedAds.get(ad.id)}.`);
      placedAds.set(ad.id, pageNumber);
      pageAds.push(ad.id);
      if (!acceptsAdSize(size, ad.size)) {
        warnings.push(`${where}: "${ad.title}" is a ${ad.sizeLabel} ad in a ${size === "back-cover" ? "back-cover" : size} slot; its artwork is scaled to fit.`);
      }
      resolved.set(slot.id, { slotId: slot.id, kind: "image", src: ad.imageUrl, fit: "Contain", link: adLink(ad) });
      if (!ad.imageUrl) pendingFills.push({ pageIndex: index, slotId: slot.id, priority: 1, article: null, ad });
    }

    // A back cover without a featured story takes its headline and introduction from the page.
    if (isBack && !filledStories.has(1)) {
      const firstAd = ads.get(pageAds[0] ?? "");
      for (const slot of template.slots.filter((candidate) => isContentSlot(candidate) && slotStory(candidate) === 1)) {
        if (slot.kind !== "text" || resolved.has(slot.id)) continue;
        const text =
          slot.role === "title"
            ? page.headline?.trim() || firstAd?.businessName
            : slot.role === "subtitle" || slot.role === "caption"
              ? page.intro?.trim() || firstAd?.title
              : undefined;
        if (text) resolved.set(slot.id, { slotId: slot.id, kind: "text", text: fitSlotText(slot, text) });
      }
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
    const others = context.articles
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
    const found = pickPhoto([...(fill.article ? [fill.article.id] : []), ...page.articleIds]);
    const slotIndex = page.slots.findIndex((slot) => slot.slotId === fill.slotId);
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
    } else if (source) {
      warnings.push(`${where}: ${subject} has no photo left, so its slot uses an unused photo${source}.`);
    }
  }

  for (const article of context.articles) {
    const current = states.get(article.id);
    if (!current?.started) {
      errors.push(`Article "${article.title}" (${article.id}) is not placed on any inner page.`);
    } else if (current.remaining.length) {
      errors.push(
        `Article "${article.title}" (${article.id}) still has about ${paragraphsWords(current.remaining)} words left after its last page (page ${current.lastBodyPage}); continue it on later pages (for example story 0 of "two-stories" or a "text-columns" page).`,
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
  return { type, templateId, stories: [], adIds: [], headline: null, intro: null, note };
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
    const capacity = chosen.slots.filter(isAdSlot).length || (page.type === "BACK_COVER" ? 1 : 0);
    const adIds = page.adIds.filter((id) => {
      const ok = ads.has(id) && !usedAds.has(id);
      if (ok) usedAds.add(id);
      return ok;
    });
    const kept = adIds.slice(0, capacity);
    for (const id of adIds.slice(capacity)) usedAds.delete(id);
    if (page.type === "BACK_COVER" && kept.length && storyEntries.some((entry) => entry.story === 1)) {
      changes.push("Moved the back-cover story off the ad's photo frame.");
      return { ...page, templateId, stories: storyEntries.filter((entry) => entry.story !== 1), adIds: kept };
    }
    return { ...page, templateId, stories: storyEntries, adIds: kept };
  });

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

  // Text that does not fit continues on added text pages right after the article's last page.
  let candidate: CompositionPlan = { summary: plan.summary, pages };
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

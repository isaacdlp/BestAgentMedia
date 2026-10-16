// Browser-only helpers that apply page templates (src/lib/issue-templates.ts) to a CreativeEditor
// (CE.SDK) issue scene. A templated page records its template ID in page metadata, and each
// block created from a slot records the slot ID. The blocks are ordinary CE.SDK blocks that stay
// editable, movable and deletable.

import type { CreativeEngine, DesignBlockId, Typeface } from "@cesdk/cesdk-js";
import {
  absoluteUrl,
  applyContentLink,
  createImageBlock,
  newId,
  parseHexColor,
  readMetadata,
  setPageMetadata,
  type ContentItem,
  type ContentLink,
  type IssuePageInfo,
} from "@/lib/cesdk-issue-scene";
import type { ComposedIssue, ComposedPage } from "@/lib/issue-composition";
import {
  layoutRichText,
  markSegments,
  parseArticleMarkdown,
  richTextFromPlain,
  type RichParagraph,
  type TextSpan,
} from "@/lib/article-rich-text";
import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAGE_WIDTH, METADATA_KEYS, type IssuePageType } from "@/lib/issue-design";
import {
  findIssuePageTemplate,
  findTemplateSlot,
  flowTextIntoColumns,
  fitSlotText,
  isAdSlot,
  isContentSlot,
  isTemplatePlaceholderText,
  ISSUE_PAGE_TEMPLATES,
  joinColumnTexts,
  labelText,
  pageNumberText,
  plainTextExcerpt,
  pullQuoteText,
  slotStory,
  TEMPLATE_REFERENCE_HEIGHT,
  TEMPLATE_REFERENCE_WIDTH,
  type IssuePageTemplate,
  type TemplateFrame,
  type TemplateIssueInfo,
  type TemplateSlot,
  type TemplateTextRole,
  type TemplateTextSlot,
} from "@/lib/issue-templates";

export const TEMPLATE_PHOTO_PLACEHOLDER = "/issue-templates/photo-placeholder.svg";
export const TEMPLATE_AD_PLACEHOLDER = "/issue-templates/ad-placeholder.svg";

const TYPEFACE_SOURCE_ID = "ly.img.typeface";
const typefaceCache = new Map<string, Typeface>();

async function findTypeface(engine: CreativeEngine, family: string) {
  const key = family.toLowerCase();
  const cached = typefaceCache.get(key);
  if (cached) return cached;
  try {
    const result = await engine.asset.findAssets(TYPEFACE_SOURCE_ID, { query: family, page: 0, perPage: 20 });
    for (const asset of result.assets) {
      const typeface = asset.payload?.typeface as Typeface | undefined;
      if (typeface?.name?.toLowerCase() === key || (typeface && asset.label?.toLowerCase() === key)) {
        typefaceCache.set(key, typeface);
        return typeface;
      }
    }
  } catch {
    // The typeface library is unavailable; the caller falls back to the default typeface.
  }
  return null;
}

async function resolveTypeface(engine: CreativeEngine, families: string[] | undefined, fallback: Typeface | null) {
  for (const family of families ?? []) {
    const typeface = await findTypeface(engine, family);
    if (typeface) return typeface;
  }
  return fallback;
}

// Template frames are defined on the reference page and scaled to the actual page size.
function scaleFrame(engine: CreativeEngine, page: DesignBlockId, frame: TemplateFrame) {
  const scaleX = engine.block.getWidth(page) / TEMPLATE_REFERENCE_WIDTH;
  const scaleY = engine.block.getHeight(page) / TEMPLATE_REFERENCE_HEIGHT;
  return {
    x: frame.x * scaleX,
    y: frame.y * scaleY,
    width: Math.max(1, frame.width * scaleX),
    height: Math.max(1, frame.height * scaleY),
    fontScale: scaleX,
  };
}

function tryStyle(apply: () => void) {
  try {
    apply();
  } catch {
    // The typeface or engine does not support this style; keep the block editable without it.
  }
}

function createTextSlot(
  engine: CreativeEngine,
  page: DesignBlockId,
  slot: TemplateTextSlot,
  text: string,
  typeface: Typeface | null,
  rich?: RichParagraph[],
) {
  const frame = scaleFrame(engine, page, slot.frame);
  const block = engine.block.create("text");
  engine.block.appendChild(page, block);
  engine.block.replaceText(block, text);
  engine.block.setPositionX(block, frame.x);
  engine.block.setPositionY(block, frame.y);
  engine.block.setWidthMode(block, "Absolute");
  engine.block.setWidth(block, frame.width);
  if (slot.verticalAlign) {
    engine.block.setHeightMode(block, "Absolute");
    engine.block.setHeight(block, frame.height);
    tryStyle(() => engine.block.setEnum(block, "text/verticalAlignment", slot.verticalAlign as string));
    // Fixed-height columns hide lines that do not fit instead of spilling over the layout.
    tryStyle(() => engine.block.setBool(block, "text/clipLinesOutsideOfFrame", true));
  } else {
    engine.block.setHeightMode(block, "Auto");
  }
  if (typeface) tryStyle(() => engine.block.setTypeface(block, typeface));
  tryStyle(() => engine.block.setTextFontSize(block, slot.fontSize * frame.fontScale, { unit: "Pixel" }));
  if (slot.bold) tryStyle(() => engine.block.setTextFontWeight(block, "bold"));
  if (slot.lineHeight) tryStyle(() => engine.block.setFloat(block, "text/lineHeight", slot.lineHeight as number));
  const color = parseHexColor(slot.color);
  if (color) engine.block.setTextColor(block, color);
  engine.block.setEnum(block, "text/horizontalAlignment", slot.align);
  if (rich) writeRichText(engine, block, rich, slot.fontSize * frame.fontScale, !!slot.bold);
  // Body columns are flowed to fit; other fixed frames (headlines, intros, captions, teasers,
  // quotes) shrink a text that is still too long instead of clipping its last lines.
  if ((slot.autoFit || slot.role !== "body") && slot.verticalAlign) {
    // Long texts (a publication name, a cover line) shrink to fit, never above the template size.
    tryStyle(() => {
      const size = engine.block.getFloat(block, "text/fontSize");
      engine.block.setFloat(block, "text/maxAutomaticFontSize", size);
      engine.block.setFloat(block, "text/minAutomaticFontSize", size * 0.3);
      engine.block.setBool(block, "text/automaticFontSizeEnabled", true);
    });
  }
  return block;
}

const BOLD_WEIGHTS = new Set(["semiBold", "bold", "extraBold", "heavy"]);

// Sets a text block's text to styled paragraphs: inline bold, italic, strikethrough and
// underline, list styles and larger subheadings. The block's styles are reset first so
// formatting from its earlier text does not carry over.
function writeRichText(engine: CreativeEngine, block: DesignBlockId, paragraphs: RichParagraph[], fontSize: number, bold: boolean) {
  const layout = layoutRichText(paragraphs);
  const text = layout.text || " ";
  engine.block.replaceText(block, text, 0, engine.block.getString(block, "text/text").length);
  tryStyle(() => engine.block.setTextFontSize(block, fontSize, { unit: "Pixel", from: 0, to: text.length }));
  tryStyle(() => engine.block.setTextFontWeight(block, bold ? "bold" : "normal", 0, text.length));
  tryStyle(() => engine.block.setTextFontStyle(block, "normal", 0, text.length));
  tryStyle(() => engine.block.setTextDecoration(block, { lines: ["None"] }, 0, text.length));
  tryStyle(() => engine.block.setTextListStyle(block, "None", -1));
  for (const paragraph of layout.paragraphs) {
    const { list, listLevel, scale, offset } = paragraph;
    if (list) tryStyle(() => engine.block.setTextListStyle(block, list, paragraph.index, listLevel ?? 0));
    if (scale && scale !== 1) {
      const to = offset + paragraph.text.length;
      tryStyle(() => engine.block.setTextFontSize(block, fontSize * scale, { unit: "Pixel", from: offset, to }));
    }
    for (const segment of markSegments(paragraph)) {
      const from = offset + segment.from;
      const to = offset + segment.to;
      if (segment.bold) tryStyle(() => engine.block.setTextFontWeight(block, "bold", from, to));
      if (segment.italic) tryStyle(() => engine.block.setTextFontStyle(block, "italic", from, to));
      const lines: ("Underline" | "Strikethrough")[] = [];
      if (segment.underline) lines.push("Underline");
      if (segment.strike) lines.push("Strikethrough");
      if (lines.length > 0) tryStyle(() => engine.block.setTextDecoration(block, { lines }, from, to));
    }
  }
}

// The UTF-16 ranges within [from, to) where a mark is set, found by halving mixed ranges.
function markedRanges(from: number, to: number, probe: (from: number, to: number) => boolean[], out: [number, number][]) {
  let values: boolean[];
  try {
    values = probe(from, to);
  } catch {
    return;
  }
  if (values.length > 0 && values.every(Boolean)) {
    const last = out[out.length - 1];
    if (last && last[1] === from) last[1] = to;
    else out.push([from, to]);
    return;
  }
  if (!values.some(Boolean) || to - from <= 1) return;
  const middle = Math.floor((from + to) / 2);
  markedRanges(from, middle, probe, out);
  markedRanges(middle, to, probe, out);
}

function readSpans(engine: CreativeEngine, block: DesignBlockId, start: number, end: number) {
  const probes: [keyof Omit<TextSpan, "from" | "to">, (from: number, to: number) => boolean[]][] = [
    ["bold", (from, to) => engine.block.getTextFontWeights(block, from, to).map((weight) => BOLD_WEIGHTS.has(weight))],
    ["italic", (from, to) => engine.block.getTextFontStyles(block, from, to).map((style) => style === "italic")],
    ["strike", (from, to) => engine.block.getTextDecorations(block, from, to).map((config) => config.lines.includes("Strikethrough"))],
    ["underline", (from, to) => engine.block.getTextDecorations(block, from, to).map((config) => config.lines.includes("Underline"))],
  ];
  const spans: TextSpan[] = [];
  for (const [mark, probe] of probes) {
    const ranges: [number, number][] = [];
    markedRanges(start, end, probe, ranges);
    for (const [from, to] of ranges) spans.push({ [mark]: true, from: from - start, to: to - start });
  }
  return spans;
}

function fontSizeRange(engine: CreativeEngine, block: DesignBlockId, range: { from?: number; to?: number } = {}) {
  try {
    const sizes = engine.block.getTextFontSizes(block, { unit: "Pixel", ...range });
    return sizes.length > 0 ? { min: Math.min(...sizes), max: Math.max(...sizes) } : null;
  } catch {
    return null;
  }
}

// Reads a text block back as styled paragraphs, so restyling a page keeps its formatting.
// Paragraphs set larger than the block's smallest text are taken as subheadings.
function readRichText(engine: CreativeEngine, block: DesignBlockId): RichParagraph[] {
  const text = engine.block.getString(block, "text/text");
  const base = fontSizeRange(engine, block)?.min;
  const paragraphs: RichParagraph[] = [];
  let offset = 0;
  for (const [index, line] of text.split("\n").entries()) {
    const start = offset + (line.length - line.trimStart().length);
    const end = offset + line.trimEnd().length;
    offset += line.length + 1;
    if (end <= start) continue;
    const paragraph: RichParagraph = { text: text.slice(start, end), spans: readSpans(engine, block, start, end) };
    tryStyle(() => {
      const list = engine.block.getTextListStyle(block, index);
      if (list === "None") return;
      paragraph.list = list;
      paragraph.listLevel = engine.block.getTextListLevel(block, index);
    });
    const largest = fontSizeRange(engine, block, { from: start, to: end })?.max;
    if (base && largest && largest / base > 1.02) {
      paragraph.scale = Math.round((largest / base) * 100) / 100;
      paragraph.heading = true;
    }
    paragraphs.push(paragraph);
  }
  return paragraphs;
}

function createShapeSlot(engine: CreativeEngine, page: DesignBlockId, frame: TemplateFrame, colorValue: string) {
  const scaled = scaleFrame(engine, page, frame);
  const block = engine.block.create("graphic");
  engine.block.setShape(block, engine.block.createShape("rect"));
  const fill = engine.block.createFill("color");
  const color = parseHexColor(colorValue);
  if (color) engine.block.setColor(fill, "fill/color/value", color);
  engine.block.setFill(block, fill);
  engine.block.setKind(block, "shape");
  engine.block.appendChild(page, block);
  engine.block.setPositionX(block, scaled.x);
  engine.block.setPositionY(block, scaled.y);
  engine.block.setWidth(block, scaled.width);
  engine.block.setHeight(block, scaled.height);
  return block;
}

function fitImageBlock(
  engine: CreativeEngine,
  page: DesignBlockId,
  block: DesignBlockId,
  frame: TemplateFrame,
  mode: "Cover" | "Contain",
) {
  const scaled = scaleFrame(engine, page, frame);
  engine.block.setRotation(block, 0);
  engine.block.setPositionX(block, scaled.x);
  engine.block.setPositionY(block, scaled.y);
  engine.block.setWidth(block, scaled.width);
  engine.block.setHeight(block, scaled.height);
  tryStyle(() => engine.block.resetCrop(block));
  tryStyle(() => engine.block.setContentFillMode(block, mode));
}

function readLink(engine: CreativeEngine, block: DesignBlockId): ContentLink | null {
  const sourceType = readMetadata(engine, block, METADATA_KEYS.sourceType);
  const sourceId = readMetadata(engine, block, METADATA_KEYS.sourceId);
  if ((sourceType !== "article" && sourceType !== "advertisement") || !sourceId) return null;
  const title = readMetadata(engine, block, METADATA_KEYS.title);
  return { sourceType, sourceId, ...(title ? { title } : {}) };
}

function imageFillUri(engine: CreativeEngine, block: DesignBlockId) {
  try {
    if (engine.block.getKind(block) !== "image") return null;
    const fill = engine.block.getFill(block);
    if (engine.block.getType(fill) !== "//ly.img.ubq/fill/image") return null;
    return engine.block.getString(fill, "fill/image/imageFileURI");
  } catch {
    return null;
  }
}

function isPlaceholderImage(uri: string | null) {
  return !!uri && (uri.endsWith(TEMPLATE_PHOTO_PLACEHOLDER) || uri.endsWith(TEMPLATE_AD_PLACEHOLDER));
}

function isTextBlock(engine: CreativeEngine, block: DesignBlockId) {
  return engine.block.getType(block) === "//ly.img.ubq/text";
}

function setSlot(engine: CreativeEngine, block: DesignBlockId, slot: TemplateSlot, name?: string) {
  engine.block.setMetadata(block, METADATA_KEYS.templateSlot, slot.id);
  engine.block.setName(block, name ? `${slot.label}: ${name}` : slot.label);
}

function linkBlock(engine: CreativeEngine, block: DesignBlockId, link: ContentLink, elementId?: string) {
  applyContentLink(engine, block, elementId || newId(), link);
}

function slotOf(engine: CreativeEngine, page: DesignBlockId, block: DesignBlockId) {
  const slotId = readMetadata(engine, block, METADATA_KEYS.templateSlot);
  if (!slotId) return undefined;
  const templateId = readMetadata(engine, page, METADATA_KEYS.templateId);
  // A template block copied from another page still has a known slot.
  return (
    findTemplateSlot(templateId, slotId) ??
    ISSUE_PAGE_TEMPLATES.flatMap((template) => template.slots).find((slot) => slot.id === slotId)
  );
}

export function pageTemplateId(engine: CreativeEngine, page: DesignBlockId) {
  return readMetadata(engine, page, METADATA_KEYS.templateId);
}

export function templateAllowsPage(template: IssuePageTemplate, pageType: IssuePageType | string) {
  return template.pageTypes.includes(pageType as IssuePageType);
}

type CarriedText = {
  text: string;
  // A body text's styled paragraphs.
  rich?: RichParagraph[];
  link: ContentLink | null;
  elementId: string;
  blocks: DesignBlockId[];
  fromPage: boolean;
};
type CarriedImage = { block: DesignBlockId; link: ContentLink | null };
type StoryContent = {
  texts: Map<TemplateTextRole, CarriedText>;
  bodyParts: { rich: RichParagraph[]; link: ContentLink | null; elementId: string; block: DesignBlockId }[];
  images: CarriedImage[];
  // Article pictures for photo slots no carried image fills.
  articleImages: { url: string; link: ContentLink }[];
};

// Introductions and captions both hold the article's opening paragraph, so either fills the other.
const ROLE_ALIASES: Partial<Record<TemplateTextRole, TemplateTextRole>> = { subtitle: "caption", caption: "subtitle" };

function emptyStory(): StoryContent {
  return { texts: new Map(), bodyParts: [], images: [], articleImages: [] };
}

// The texts an article provides for a story's slots. When the story shows the opening paragraph
// as an introduction or caption, the body starts after it (unless the excerpt had to be shortened).
// The body keeps the article's formatting; the pull quote comes from its first blockquote.
function articleTexts(article: ContentItem, slots: TemplateSlot[]) {
  const paragraphs = parseArticleMarkdown(article.description).body;
  const excerpt = plainTextExcerpt(article.description);
  const showsIntro = slots.some((slot) => slot.role === "subtitle" || slot.role === "caption");
  const textParagraphs = paragraphs.filter((paragraph) => !paragraph.heading);
  const intro = textParagraphs[0];
  const body =
    showsIntro && textParagraphs.length > 1 && excerpt === intro.text
      ? paragraphs.filter((paragraph) => paragraph !== intro)
      : paragraphs;
  const texts: Partial<Record<TemplateTextRole, string>> = {
    title: article.title,
    subtitle: excerpt,
    caption: excerpt,
    body: layoutRichText(body).text,
    quote: pullQuoteText(article.description),
  };
  return { texts, body };
}

function articleImageUrls(article: ContentItem) {
  return article.imageUrls?.length ? article.imageUrls : article.imageUrl ? [article.imageUrl] : [];
}

function storySlots(template: IssuePageTemplate, story: number) {
  return template.slots.filter((slot) => isContentSlot(slot) && slotStory(slot) === story);
}

function forgetSlot(engine: CreativeEngine, block: DesignBlockId) {
  tryStyle(() => engine.block.removeMetadata(block, METADATA_KEYS.templateSlot));
}

export type ApplyTemplateOptions = {
  typeface: Typeface | null;
  // Looks up a linked article so its text can fill the template's slots.
  findArticle: (id: string) => ContentItem | undefined;
  // Publication name and date shown by label slots such as a cover masthead.
  issueInfo?: TemplateIssueInfo;
};

// Applies a template to a page. Content already on the page is restyled into the template's
// slots, story by story: text and photos from a previous template, and blocks linked to an
// article (its title text and image). Slots still empty are filled from the linked article
// (introduction, body columns, pull quote). Content the new template has no slot for, and other
// blocks (ads, free text, shapes), stay where they are, above the template.
// Returns the block to select (the first headline, when the template has one).
export async function applyTemplateToPage(
  engine: CreativeEngine,
  page: DesignBlockId,
  template: IssuePageTemplate,
  options: ApplyTemplateOptions,
) {
  const stories = new Map<number, StoryContent>();
  const story = (id: number) => {
    let content = stories.get(id);
    if (!content) stories.set(id, (content = emptyStory()));
    return content;
  };
  // Earlier template blocks with no content of their own (placeholders, shapes, page numbers).
  const discard: DesignBlockId[] = [];
  const looseBlocks = new Set<DesignBlockId>();
  // Edited label texts (such as a renamed masthead), kept when the same slot is re-created.
  const labelTexts = new Map<string, string>();
  // When the template has ad slots, ads (and whatever an earlier ad slot held) go into them
  // instead of photo slots.
  const adSlotCount = template.slots.filter(isAdSlot).length;
  const ads: CarriedImage[] = [];

  const children = engine.block.getChildren(page);
  // Earlier template blocks first, so their content wins over loose linked blocks.
  for (const block of children) {
    const slot = slotOf(engine, page, block);
    if (!slot) continue;
    const content = story(slotStory(slot));
    const link = readLink(engine, block);
    if (slot.kind === "text" && slot.role === "label" && isTextBlock(engine, block)) {
      const text = engine.block.getString(block, "text/text");
      if (text.trim()) labelTexts.set(slot.id, text);
      discard.push(block);
    } else if (slot.kind === "text" && slot.role !== "pageNumber" && isTextBlock(engine, block)) {
      const text = engine.block.getString(block, "text/text");
      if (!text.trim() || isTemplatePlaceholderText(text)) {
        discard.push(block);
      } else if (slot.role === "body") {
        content.bodyParts.push({
          rich: readRichText(engine, block),
          link,
          elementId: readMetadata(engine, block, METADATA_KEYS.elementId),
          block,
        });
      } else if (!content.texts.has(slot.role)) {
        content.texts.set(slot.role, {
          text,
          link,
          elementId: readMetadata(engine, block, METADATA_KEYS.elementId),
          blocks: [block],
          fromPage: true,
        });
      } else {
        looseBlocks.add(block);
      }
    } else if (slot.kind === "image") {
      const uri = imageFillUri(engine, block);
      if (uri === null || isPlaceholderImage(uri)) discard.push(block);
      else if (adSlotCount > 0 && (isAdSlot(slot) || link?.sourceType === "advertisement")) ads.push({ block, link });
      else content.images.push({ block, link });
    } else {
      discard.push(block);
    }
  }
  for (const content of stories.values()) {
    if (content.bodyParts.length === 0) continue;
    const first = content.bodyParts.find((part) => part.link) ?? content.bodyParts[0];
    const rich = joinColumnTexts(content.bodyParts.map((part) => part.rich));
    content.texts.set("body", {
      text: layoutRichText(rich).text,
      rich,
      link: first.link,
      elementId: first.elementId,
      blocks: content.bodyParts.map((part) => part.block),
      fromPage: true,
    });
  }
  const main = story(1);
  const hadImages = main.images.length > 0;
  for (const block of children) {
    if (slotOf(engine, page, block)) continue;
    const link = readLink(engine, block);
    if (link?.sourceType === "advertisement") {
      // Ads placed loosely on the page move into free ad slots.
      if (ads.length < adSlotCount && imageFillUri(engine, block) !== null) ads.push({ block, link });
      continue;
    }
    if (link?.sourceType !== "article") continue;
    if (isTextBlock(engine, block) && !main.texts.has("title")) {
      main.texts.set("title", {
        text: engine.block.getString(block, "text/text"),
        link,
        elementId: readMetadata(engine, block, METADATA_KEYS.elementId),
        blocks: [block],
        fromPage: true,
      });
    } else if (!hadImages && imageFillUri(engine, block) !== null) {
      main.images.push({ block, link });
    }
  }

  // Fill gaps from each story's linked article.
  for (const [storyId, content] of stories) {
    const slots = storySlots(template, storyId);
    if (slots.length === 0) continue;
    const link =
      content.texts.get("title")?.link ??
      content.images.find((image) => image.link?.sourceType === "article")?.link ??
      [...content.texts.values()].find((text) => text.link?.sourceType === "article")?.link ??
      null;
    const article = link?.sourceType === "article" ? options.findArticle(link.sourceId) : undefined;
    if (!article || !link) continue;
    const shown = new Set(content.images.map((image) => imageFillUri(engine, image.block)));
    content.articleImages = articleImageUrls(article)
      .filter((url) => !shown.has(absoluteUrl(url)))
      .map((url) => ({ url, link }));
    const { texts, body } = articleTexts(article, slots);
    for (const role of Object.keys(texts) as TemplateTextRole[]) {
      const text = texts[role];
      if (!text || content.texts.has(role)) continue;
      const rich = role === "body" ? { rich: body } : {};
      content.texts.set(role, { text, ...rich, link, elementId: "", blocks: [], fromPage: false });
    }
  }

  const typefaces = new Map<string, Typeface | null>();
  for (const slot of template.slots) {
    if (slot.kind !== "text") continue;
    const key = (slot.fontFamilies ?? []).join("|");
    if (!typefaces.has(key)) typefaces.set(key, await resolveTypeface(engine, slot.fontFamilies, options.typeface));
  }

  const carriedText = (storyId: number, role: TemplateTextRole) => {
    const content = stories.get(storyId);
    if (!content) return undefined;
    const alias = ROLE_ALIASES[role];
    const own = content.texts.get(role);
    if (own || !alias || template.slots.some((slot) => slot.role === alias && slotStory(slot) === storyId)) return own;
    return content.texts.get(alias);
  };
  // Body text is flowed across each story's columns up front.
  const bodyTexts = new Map<string, RichParagraph[]>();
  const placedTexts = new Set<CarriedText>();
  for (const storyId of new Set(template.slots.map(slotStory))) {
    const columns = template.slots.filter(
      (slot): slot is TemplateTextSlot => slot.kind === "text" && slot.role === "body" && slotStory(slot) === storyId,
    );
    const body = carriedText(storyId, "body");
    if (!body || columns.length === 0) continue;
    const parts = flowTextIntoColumns(body.rich ?? richTextFromPlain(body.text), columns, body.fromPage ? "keep" : "truncate");
    for (const [index, column] of columns.entries()) bodyTexts.set(column.id, parts[index]);
    placedTexts.add(body);
  }

  const pageIndex = engine.scene.getPages().indexOf(page);
  const placedImages = new Set<DesignBlockId>();
  let selection: DesignBlockId | null = null;
  const created: DesignBlockId[] = [];
  for (const slot of template.slots) {
    let block: DesignBlockId;
    const storyId = slotStory(slot);
    if (slot.kind === "rect") {
      block = createShapeSlot(engine, page, slot.frame, slot.color);
      setSlot(engine, block, slot);
    } else if (isAdSlot(slot)) {
      const ad = ads.find((candidate) => !placedImages.has(candidate.block));
      if (ad) {
        block = ad.block;
        placedImages.add(block);
        fitImageBlock(engine, page, block, slot.frame, ad.link?.sourceType === "advertisement" ? "Contain" : "Cover");
      } else {
        block = createImageBlock(engine, page, { src: TEMPLATE_AD_PLACEHOLDER, ...scaleFrame(engine, page, slot.frame) });
      }
      setSlot(engine, block, slot, ad?.link?.title);
    } else if (slot.kind === "image") {
      const image = stories.get(storyId)?.images.find((candidate) => !placedImages.has(candidate.block));
      if (image) {
        block = image.block;
        placedImages.add(block);
        // Ads keep their whole artwork; photos fill the frame.
        fitImageBlock(engine, page, block, slot.frame, image.link?.sourceType === "advertisement" ? "Contain" : "Cover");
      } else {
        const frame = scaleFrame(engine, page, slot.frame);
        const picture = stories.get(storyId)?.articleImages.shift();
        block = createImageBlock(engine, page, { src: picture?.url ?? TEMPLATE_PHOTO_PLACEHOLDER, ...frame });
        if (picture) {
          tryStyle(() => engine.block.setContentFillMode(block, "Cover"));
          linkBlock(engine, block, picture.link);
        }
      }
      setSlot(engine, block, slot, image?.link?.title);
    } else {
      let text: string;
      let rich: RichParagraph[] | undefined;
      let carried: CarriedText | undefined;
      if (slot.role === "pageNumber") {
        text = pageNumberText(slot, pageIndex + 1);
      } else if (slot.role === "label") {
        text = labelTexts.get(slot.id) ?? labelText(slot, options.issueInfo);
      } else if (slot.role === "body") {
        const column = bodyTexts.get(slot.id);
        rich = column?.length ? column : undefined;
        carried = rich ? carriedText(storyId, "body") : undefined;
        text = rich ? layoutRichText(rich).text : slot.text;
      } else {
        carried = carriedText(storyId, slot.role);
        // Text already on the page is kept whole; article text is shortened to the slot's limit.
        text = carried ? (carried.fromPage ? carried.text : fitSlotText(slot, carried.text)) : slot.text;
        if (carried) placedTexts.add(carried);
      }
      block = createTextSlot(engine, page, slot, text, typefaces.get((slot.fontFamilies ?? []).join("|")) ?? null, rich);
      if (carried?.link) {
        // Only the first block made from a carried text keeps its element ID.
        const elementId = carried.elementId;
        carried.elementId = "";
        linkBlock(engine, block, carried.link, elementId);
      }
      setSlot(engine, block, slot, carried?.link?.title);
      if (slot.role === "title" && selection === null) selection = block;
    }
    created.push(block);
  }

  const removable = new Set(discard);
  for (const content of stories.values()) {
    for (const carried of content.texts.values()) {
      for (const block of carried.blocks) {
        if (placedTexts.has(carried)) removable.add(block);
        else forgetSlot(engine, block);
      }
    }
    for (const image of content.images) if (!placedImages.has(image.block)) forgetSlot(engine, image.block);
  }
  for (const ad of ads) if (!placedImages.has(ad.block)) forgetSlot(engine, ad.block);
  for (const block of looseBlocks) forgetSlot(engine, block);
  for (const block of removable) {
    if (!placedImages.has(block) && engine.block.isValid(block)) engine.block.destroy(block);
  }
  // Template blocks sit behind anything else left on the page, in template order.
  for (const [index, block] of created.entries()) engine.block.insertChild(page, block, index);

  const background = parseHexColor(template.background);
  if (background) tryStyle(() => engine.block.setFillSolidColor(page, background.r, background.g, background.b, 1));
  engine.block.setMetadata(page, METADATA_KEYS.templateId, template.id);
  return selection ?? created[created.length - 1] ?? null;
}

function setImageContent(engine: CreativeEngine, block: DesignBlockId, url: string, mode: "Cover" | "Contain") {
  const fill = engine.block.getFill(block);
  tryStyle(() => engine.block.setSourceSet(fill, "fill/image/sourceSet", []));
  engine.block.setString(fill, "fill/image/imageFileURI", absoluteUrl(url));
  tryStyle(() => engine.block.resetCrop(block));
  tryStyle(() => engine.block.setContentFillMode(block, mode));
}

// A picture placeholder is a template's image slot (empty or filled) or any image block still
// showing the template placeholder photo.
export function isPicturePlaceholder(engine: CreativeEngine, block: DesignBlockId) {
  if (!engine.block.isValid(block)) return false;
  const uri = imageFillUri(engine, block);
  if (uri === null) return false;
  if (isPlaceholderImage(uri)) return true;
  const slotId = readMetadata(engine, block, METADATA_KEYS.templateSlot);
  return !!slotId && ISSUE_PAGE_TEMPLATES.some((template) =>
    template.slots.some((slot) => slot.id === slotId && slot.kind === "image"),
  );
}

// Puts a library item's picture into a picture placeholder, keeping the placeholder's frame, and
// links the block to the item. Ads are fitted whole ("Contain") because their artwork must not be
// cropped; other pictures fill the frame. Returns false when the item has no picture.
export function placeContentInPicture(engine: CreativeEngine, block: DesignBlockId, item: ContentItem) {
  if (!item.imageUrl) return false;
  setImageContent(engine, block, item.imageUrl, item.type === "advertisement" ? "Contain" : "Cover");
  linkBlock(engine, block, { sourceType: item.type, sourceId: item.id, title: item.title });
  const slotId = readMetadata(engine, block, METADATA_KEYS.templateSlot);
  const slot = slotId
    ? ISSUE_PAGE_TEMPLATES.flatMap((template) => template.slots).find((candidate) => candidate.id === slotId)
    : undefined;
  if (slot) setSlot(engine, block, slot, item.title);
  return true;
}

// Puts an ad into the page's first ad slot that still shows the ad placeholder. Returns the
// block, or null when the page has no free ad slot or the ad has no creative.
export function fillTemplateAdSlot(engine: CreativeEngine, page: DesignBlockId, item: ContentItem) {
  const block = engine.block
    .getChildren(page)
    .find((child) => isAdSlot(slotOf(engine, page, child)) && isPlaceholderImage(imageFillUri(engine, child)));
  if (block === undefined || !placeContentInPicture(engine, block, item)) return null;
  return block;
}

// The story an article dropped on a templated page goes into: the story of the selected
// template block, else the first story whose headline still shows its placeholder, else story 1.
function targetStory(engine: CreativeEngine, page: DesignBlockId, template: IssuePageTemplate) {
  for (const block of engine.block.findAllSelected()) {
    if (!engine.block.isValid(block) || engine.block.getParent(block) !== page) continue;
    const slot = slotOf(engine, page, block);
    if (slot && isContentSlot(slot)) return slotStory(slot);
  }
  const titles = engine.block
    .getChildren(page)
    .map((block) => ({ block, slot: slotOf(engine, page, block) }))
    .filter(({ block, slot }) => slot?.kind === "text" && slot.role === "title" && isTextBlock(engine, block))
    .sort((a, b) => slotStory(a.slot as TemplateSlot) - slotStory(b.slot as TemplateSlot));
  const open = titles.find(({ block }) => {
    const text = engine.block.getString(block, "text/text");
    return !text.trim() || isTemplatePlaceholderText(text);
  });
  if (open?.slot) return slotStory(open.slot);
  return template.slots.some((slot) => slotStory(slot) === 1) ? 1 : slotStory(template.slots[0]);
}

// A body block's current size on the reference page, so text flows by the column as it is now.
function columnAsPlaced(engine: CreativeEngine, page: DesignBlockId, block: DesignBlockId, slot: TemplateTextSlot): TemplateTextSlot {
  const scaleX = engine.block.getWidth(page) / TEMPLATE_REFERENCE_WIDTH;
  const scaleY = engine.block.getHeight(page) / TEMPLATE_REFERENCE_HEIGHT;
  return {
    ...slot,
    frame: { ...slot.frame, width: engine.block.getWidth(block) / scaleX, height: engine.block.getHeight(block) / scaleY },
  };
}

function replaceBlockText(engine: CreativeEngine, block: DesignBlockId, text: string) {
  engine.block.replaceText(block, text, 0, engine.block.getString(block, "text/text").length);
}

// Puts an article into one story of a templated page (headline, introduction or caption, body
// columns, pull quote and photos), replacing what those slots held, and links each
// filled block to the article. Returns null when the page has no template slots for article
// content, so the caller can add the article as a loose block instead.
export function fillTemplateWithArticle(engine: CreativeEngine, page: DesignBlockId, item: ContentItem) {
  const template = findIssuePageTemplate(pageTemplateId(engine, page));
  if (!template) return null;
  const storyId = targetStory(engine, page, template);
  const { texts, body } = articleTexts(item, storySlots(template, storyId));
  const link: ContentLink = { sourceType: item.type, sourceId: item.id, title: item.title };
  const blocks = engine.block
    .getChildren(page)
    .map((block) => ({ block, slot: slotOf(engine, page, block) }))
    .filter((entry): entry is { block: DesignBlockId; slot: TemplateSlot } => !!entry.slot && slotStory(entry.slot) === storyId)
    .sort((a, b) => template.slots.indexOf(a.slot) - template.slots.indexOf(b.slot));

  const filled: { block: DesignBlockId; slot: TemplateSlot }[] = [];
  const columns = blocks.filter(
    (entry): entry is { block: DesignBlockId; slot: TemplateTextSlot } =>
      entry.slot.kind === "text" && entry.slot.role === "body" && isTextBlock(engine, entry.block),
  );
  if (body.length > 0 && columns.length > 0) {
    const parts = flowTextIntoColumns(
      body,
      columns.map(({ block, slot }) => columnAsPlaced(engine, page, block, slot)),
      "truncate",
    );
    const scaleX = engine.block.getWidth(page) / TEMPLATE_REFERENCE_WIDTH;
    for (const [index, column] of columns.entries()) {
      // A column keeps its current base size, which a person may have changed.
      const fontSize = fontSizeRange(engine, column.block)?.min ?? column.slot.fontSize * scaleX;
      writeRichText(engine, column.block, parts[index] ?? [], fontSize, !!column.slot.bold);
      filled.push(column);
    }
  }
  for (const entry of blocks) {
    const { block, slot } = entry;
    if (slot.kind !== "text" || slot.role === "body" || !isContentSlot(slot) || !isTextBlock(engine, block)) continue;
    const text = texts[slot.role];
    if (!text) continue;
    replaceBlockText(engine, block, fitSlotText(slot, text));
    filled.push(entry);
  }
  // The article's pictures go into the story's photo slots in order; extra slots keep their photo.
  const pictures = blocks.filter(
    ({ block, slot }) => slot.kind === "image" && !isAdSlot(slot) && imageFillUri(engine, block) !== null,
  );
  for (const [index, url] of articleImageUrls(item).slice(0, pictures.length).entries()) {
    setImageContent(engine, pictures[index].block, url, "Cover");
    filled.push(pictures[index]);
  }
  if (filled.length === 0) return null;

  let selection: DesignBlockId | null = null;
  for (const { block, slot } of filled) {
    linkBlock(engine, block, link);
    setSlot(engine, block, slot, item.title);
    if (slot.role === "title") selection = block;
  }
  return selection ?? filled[0].block;
}

// Keeps page-number slots in step with page order. Returns true if any text changed.
export function syncTemplatePageNumbers(engine: CreativeEngine) {
  let changed = false;
  for (const [index, page] of engine.scene.getPages().entries()) {
    if (!pageTemplateId(engine, page)) continue;
    for (const block of engine.block.getChildren(page)) {
      const slot = slotOf(engine, page, block);
      if (slot?.kind !== "text" || slot.role !== "pageNumber" || !isTextBlock(engine, block)) continue;
      const expected = pageNumberText(slot, index + 1);
      const current = engine.block.getString(block, "text/text");
      if (current === expected) continue;
      engine.block.replaceText(block, expected, 0, current.length);
      changed = true;
    }
  }
  return changed;
}

// Lays out one page of a composed issue (src/lib/issue-composition.ts): the template's blocks
// are created with the composed content already in place and linked to its article or ad, so
// the page is the same as one templated and filled by hand.
async function buildComposedPage(
  engine: CreativeEngine,
  page: DesignBlockId,
  composed: ComposedPage,
  typeface: Typeface | null,
) {
  const template = findIssuePageTemplate(composed.templateId);
  if (!template) return;
  const content = new Map(composed.slots.map((slot) => [slot.slotId, slot]));
  const typefaces = new Map<string, Typeface | null>();
  for (const slot of template.slots) {
    if (slot.kind !== "text") continue;
    const key = (slot.fontFamilies ?? []).join("|");
    if (!typefaces.has(key)) typefaces.set(key, await resolveTypeface(engine, slot.fontFamilies, typeface));
  }
  const pageNumber = engine.scene.getPages().indexOf(page) + 1;
  for (const slot of template.slots) {
    if (slot.kind === "rect") {
      setSlot(engine, createShapeSlot(engine, page, slot.frame, slot.color), slot);
      continue;
    }
    const filled = content.get(slot.id);
    if (filled?.kind === "omit" || (!filled && isContentSlot(slot)) || (!filled && isAdSlot(slot))) continue;
    let block: DesignBlockId;
    if (slot.kind === "image") {
      const src = filled?.kind === "image" ? filled.src : null;
      block = createImageBlock(engine, page, {
        src: src ?? (isAdSlot(slot) ? TEMPLATE_AD_PLACEHOLDER : TEMPLATE_PHOTO_PLACEHOLDER),
        ...scaleFrame(engine, page, slot.frame),
      });
      if (filled?.kind === "image") tryStyle(() => engine.block.setContentFillMode(block, filled.fit));
    } else {
      const text =
        filled?.kind === "text"
          ? filled.text
          : slot.role === "pageNumber"
            ? pageNumberText(slot, pageNumber)
            : slot.text;
      const rich = filled?.kind === "text" ? filled.rich : undefined;
      block = createTextSlot(engine, page, slot, text, typefaces.get((slot.fontFamilies ?? []).join("|")) ?? null, rich);
    }
    const contentLink = filled?.link;
    if (contentLink) linkBlock(engine, block, contentLink);
    setSlot(engine, block, slot, contentLink?.title);
  }
  const background = parseHexColor(template.background);
  if (background) tryStyle(() => engine.block.setFillSolidColor(page, background.r, background.g, background.b, 1));
  engine.block.setMetadata(page, METADATA_KEYS.templateId, template.id);
}

// Replaces the scene with a composed issue. The cover and back cover keep the issue's page IDs,
// inner pages reuse the issue's inner page IDs in order, and extra pages get new IDs (the next
// save adds them to the issue).
export async function buildSceneFromComposition(
  engine: CreativeEngine,
  composition: ComposedIssue,
  issuePages: IssuePageInfo[],
  typeface: Typeface | null,
) {
  const width = composition.width || DEFAULT_PAGE_WIDTH;
  const height = composition.height || DEFAULT_PAGE_HEIGHT;
  const scene = engine.scene.create("VerticalStack", { designUnit: "Pixel" });
  const container =
    engine.block.getChildren(scene).find((child) => engine.block.getType(child) === "//ly.img.ubq/stack") ?? scene;
  const innerIds = issuePages.filter((page) => page.type === "INNER").map((page) => page.id);
  const coverId = issuePages.find((page) => page.type === "COVER")?.id ?? newId();
  const backCoverId = issuePages.find((page) => page.type === "BACK_COVER")?.id ?? newId();
  const pages: [DesignBlockId, ComposedPage][] = [];
  for (const [index, composed] of composition.pages.entries()) {
    const type: IssuePageType = index === 0 ? "COVER" : index === composition.pages.length - 1 ? "BACK_COVER" : "INNER";
    const page = engine.block.create("page");
    engine.block.setWidth(page, width);
    engine.block.setHeight(page, height);
    engine.block.appendChild(container, page);
    setPageMetadata(engine, page, type === "COVER" ? coverId : type === "BACK_COVER" ? backCoverId : innerIds.shift() ?? newId(), type);
    pages.push([page, composed]);
  }
  for (const [page, composed] of pages) {
    try {
      await buildComposedPage(engine, page, composed, typeface);
    } catch (error) {
      console.warn("Skipped part of a composed page that could not be built:", error);
    }
  }
}

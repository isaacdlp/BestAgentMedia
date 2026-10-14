// Browser-only helpers that translate between BestAgentMedia issue data and a CreativeEditor
// (CE.SDK) scene. See src/lib/issue-design.ts for the stored design formats.

import type { CreativeEngine, DesignBlockId, RGBAColor, Typeface } from "@cesdk/cesdk-js";
import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  METADATA_KEYS,
  type ContentSourceType,
  type IssuePageType,
  type LayoutDesign,
  type LayoutElement,
  type ManifestElement,
  type ManifestPage,
} from "@/lib/issue-design";

export type IssuePageInfo = { id: string; pageNumber: number; type: IssuePageType };
export type ContentItem = {
  id: string;
  title: string;
  type: ContentSourceType;
  description: string;
  imageUrl?: string;
};

const RECORD_ID_PATTERN = /^[\w-]{1,64}$/;
const PAGE_TYPES = new Set<IssuePageType>(["COVER", "INNER", "BACK_COVER"]);
const DEFAULT_TYPEFACE = { sourceId: "ly.img.typeface", assetId: "ly.img.typeface.roboto" };

export function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// The engine fetches resources outside the page's URL context, so relative app URLs
// (for example /api/issues/<id>/images/<file>) are made absolute before use.
export function absoluteUrl(src: string) {
  return src.startsWith("/") && !src.startsWith("//") ? `${window.location.origin}${src}` : src;
}

function parseHexColor(value: unknown): RGBAColor | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((char) => char + char).join("") : match[1];
  const channel = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4), a: 1 };
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readMetadata(engine: CreativeEngine, block: DesignBlockId, key: string) {
  return engine.block.hasMetadata(block, key) ? engine.block.getMetadata(block, key) : "";
}

// Resolves the default typeface so generated text can switch between bold/italic variants.
export async function loadDefaultTypeface(engine: CreativeEngine): Promise<Typeface | null> {
  try {
    const asset = await engine.asset.fetchAsset(DEFAULT_TYPEFACE.sourceId, DEFAULT_TYPEFACE.assetId);
    return (asset?.payload?.typeface as Typeface | undefined) ?? null;
  } catch {
    return null;
  }
}

type ContentLink = { sourceType: ContentSourceType; sourceId: string; title?: string };

function readContentLink(custom: unknown): ContentLink | null {
  if (typeof custom !== "object" || custom === null) return null;
  const data = (custom as Record<string, unknown>).bestAgentMedia;
  if (typeof data !== "object" || data === null) return null;
  const { sourceType, sourceId, title } = data as Record<string, unknown>;
  if ((sourceType !== "article" && sourceType !== "advertisement") || typeof sourceId !== "string") return null;
  return { sourceType, sourceId, title: typeof title === "string" ? title : undefined };
}

function applyContentLink(engine: CreativeEngine, block: DesignBlockId, elementId: string, link: ContentLink | null) {
  engine.block.setMetadata(block, METADATA_KEYS.elementId, elementId);
  if (!link) return;
  engine.block.setMetadata(block, METADATA_KEYS.sourceType, link.sourceType);
  engine.block.setMetadata(block, METADATA_KEYS.sourceId, link.sourceId);
  if (link.title) {
    engine.block.setMetadata(block, METADATA_KEYS.title, link.title);
    engine.block.setName(block, link.title);
  }
}

type TextOptions = {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
  color?: RGBAColor | null;
  align?: "Left" | "Center" | "Right";
};

function createTextBlock(engine: CreativeEngine, page: DesignBlockId, options: TextOptions, typeface: Typeface | null) {
  const block = engine.block.create("text");
  engine.block.appendChild(page, block);
  engine.block.replaceText(block, options.text);
  engine.block.setPositionX(block, options.x);
  engine.block.setPositionY(block, options.y);
  engine.block.setWidthMode(block, "Absolute");
  engine.block.setWidth(block, options.width);
  engine.block.setHeightMode(block, "Auto");
  if (typeface) engine.block.setTypeface(block, typeface);
  engine.block.setTextFontSize(block, options.fontSize);
  // Font variants depend on the typeface; keep the text editable even if a variant is missing.
  try {
    if (options.bold) engine.block.setTextFontWeight(block, "bold");
    if (options.italic) engine.block.setTextFontStyle(block, "italic");
  } catch {
    // The typeface has no matching variant.
  }
  if (options.color) engine.block.setTextColor(block, options.color);
  if (options.align) engine.block.setEnum(block, "text/horizontalAlignment", options.align);
  return block;
}

type ImageOptions = { src: string; x: number; y: number; width: number; height: number };

function createImageBlock(engine: CreativeEngine, page: DesignBlockId, options: ImageOptions) {
  const block = engine.block.create("graphic");
  engine.block.setShape(block, engine.block.createShape("rect"));
  const fill = engine.block.createFill("image");
  engine.block.setString(fill, "fill/image/imageFileURI", absoluteUrl(options.src));
  engine.block.setFill(block, fill);
  engine.block.setKind(block, "image");
  engine.block.appendChild(page, block);
  engine.block.setPositionX(block, options.x);
  engine.block.setPositionY(block, options.y);
  engine.block.setWidth(block, options.width);
  engine.block.setHeight(block, options.height);
  engine.block.setContentFillMode(block, "Cover");
  return block;
}

function createLayoutElement(engine: CreativeEngine, page: DesignBlockId, element: LayoutElement, typeface: Typeface | null) {
  const x = numberOr(element.x, 40);
  const y = numberOr(element.y, 40);
  const width = Math.max(1, numberOr(element.width, 400));
  if (element.type === "image") {
    if (typeof element.src !== "string" || !element.src) return null;
    return createImageBlock(engine, page, { src: element.src, x, y, width, height: Math.max(1, numberOr(element.height, 300)) });
  }
  if (element.type !== "text" || typeof element.text !== "string") return null;
  const align = element.align === "center" ? "Center" : element.align === "right" ? "Right" : "Left";
  return createTextBlock(engine, page, {
    text: element.text,
    x,
    y,
    width,
    fontSize: Math.max(1, numberOr(element.fontSize, 16)),
    bold: element.fontWeight === "bold" || numberOr(element.fontWeight, 400) >= 600,
    italic: element.fontStyle === "italic",
    color: parseHexColor(element.fill),
    align,
  }, typeface);
}

function setPageMetadata(engine: CreativeEngine, page: DesignBlockId, id: string, type: IssuePageType) {
  engine.block.setMetadata(page, METADATA_KEYS.issuePageId, id);
  engine.block.setMetadata(page, METADATA_KEYS.pageType, type);
  // The cover and back cover are fixed issue pages; only inner pages may be deleted.
  engine.block.setScopeEnabled(page, "lifecycle/destroy", type === "INNER");
}

// Replaces the current scene with one built from a layout specification. `pages` lists the
// issue's stored pages; saved layout pages are matched by ID first and by position second.
export async function buildSceneFromLayout(
  engine: CreativeEngine,
  layout: LayoutDesign | null,
  pages: IssuePageInfo[],
  typeface: Typeface | null,
) {
  const width = Math.max(1, numberOr(layout?.width, DEFAULT_PAGE_WIDTH));
  const height = Math.max(1, numberOr(layout?.height, DEFAULT_PAGE_HEIGHT));
  const savedPages = Array.isArray(layout?.pages) ? layout.pages : [];

  // Pages must live in the scene's stack block to be laid out and listed by getPages().
  const scene = engine.scene.create("VerticalStack", { designUnit: "Pixel" });
  const container =
    engine.block.getChildren(scene).find((child) => engine.block.getType(child) === "//ly.img.ubq/stack") ?? scene;

  for (const [index, issuePage] of pages.entries()) {
    const page = engine.block.create("page");
    engine.block.setWidth(page, width);
    engine.block.setHeight(page, height);
    engine.block.appendChild(container, page);
    setPageMetadata(engine, page, issuePage.id, issuePage.type);

    const saved = savedPages.find((candidate) => candidate.id === issuePage.id) ?? savedPages[index];
    if (!saved) continue;
    const background = parseHexColor(saved.background);
    if (background) engine.block.setFillSolidColor(page, background.r, background.g, background.b, 1);
    for (const element of Array.isArray(saved.children) ? saved.children : []) {
      try {
        const block = createLayoutElement(engine, page, element, typeface);
        if (block === null) continue;
        const elementId = typeof element.id === "string" && RECORD_ID_PATTERN.test(element.id) ? element.id : newId();
        applyContentLink(engine, block, elementId, readContentLink(element.custom));
      } catch (error) {
        console.warn("Skipped a layout element that could not be converted:", error);
      }
    }
  }
}

// Adds an article/advertisement library item to the current page as a linked block.
export function addContentBlock(engine: CreativeEngine, item: ContentItem, typeface: Typeface | null) {
  const page = engine.scene.getCurrentPage() ?? engine.scene.getPages()[0];
  if (page === undefined || page === null) return undefined;
  const block = item.imageUrl
    ? createImageBlock(engine, page, { src: item.imageUrl, x: 60, y: 60, width: 500, height: 400 })
    : createTextBlock(engine, page, { text: item.title, x: 60, y: 60, width: 500, fontSize: 28, bold: true }, typeface);
  applyContentLink(engine, block, newId(), { sourceType: item.type, sourceId: item.id, title: item.title });
  return block;
}

// Keeps page identity and order consistent after edits: new or duplicated pages become inner
// pages with fresh IDs, the cover stays first, and the back cover stays last.
// Returns true if the scene was changed.
export function enforceIssuePageRules(engine: CreativeEngine) {
  let changed = false;
  const seen = new Set<string>();
  for (const page of engine.scene.getPages()) {
    const id = readMetadata(engine, page, METADATA_KEYS.issuePageId);
    const type = readMetadata(engine, page, METADATA_KEYS.pageType) as IssuePageType;
    if (!RECORD_ID_PATTERN.test(id) || seen.has(id) || !PAGE_TYPES.has(type)) {
      const nextId = newId();
      setPageMetadata(engine, page, nextId, "INNER");
      seen.add(nextId);
      changed = true;
    } else {
      seen.add(id);
    }
  }

  const pages = engine.scene.getPages();
  const container = pages.length ? engine.block.getParent(pages[0]) : null;
  if (container === null) return changed;
  const typeOf = (page: DesignBlockId) => readMetadata(engine, page, METADATA_KEYS.pageType);
  const cover = pages.find((page) => typeOf(page) === "COVER");
  if (cover !== undefined && pages[0] !== cover) {
    engine.block.insertChild(container, cover, 0);
    changed = true;
  }
  const ordered = engine.scene.getPages();
  const backCover = ordered.find((page) => typeOf(page) === "BACK_COVER");
  if (backCover !== undefined && ordered[ordered.length - 1] !== backCover) {
    engine.block.appendChild(container, backCover);
    changed = true;
  }
  return changed;
}

// Fits a scene loaded from an imported .imgly/.scene/archive file into the open issue. Imported
// pages are matched to the issue's pages by position (first = cover, last = back cover), reusing
// the issue's page IDs so page IDs from another issue are never carried over. Blank pages are
// added until there is a cover, an inner page and a back cover. Content links to articles or
// ads that are not in `linkableSources` (keys "<sourceType>:<sourceId>") are removed so the
// blocks stay on the canvas as plain content.
export function adoptImportedScene(
  engine: CreativeEngine,
  issuePages: IssuePageInfo[],
  linkableSources: Set<string>,
) {
  const imported = engine.scene.getPages();
  if (!imported.length) throw new Error("The imported file does not contain any pages.");
  const container = engine.block.getParent(imported[0]);
  if (container === null) throw new Error("The imported file does not contain a page layout.");
  const width = engine.block.getWidth(imported[0]);
  const height = engine.block.getHeight(imported[0]);
  for (let count = imported.length; count < 3; count += 1) {
    const page = engine.block.create("page");
    engine.block.setWidth(page, width);
    engine.block.setHeight(page, height);
    engine.block.insertChild(container, page, 1);
  }

  const pages = engine.scene.getPages();
  const innerIds = issuePages.filter((page) => page.type === "INNER").map((page) => page.id);
  const coverId = issuePages.find((page) => page.type === "COVER")?.id ?? newId();
  const backCoverId = issuePages.find((page) => page.type === "BACK_COVER")?.id ?? newId();
  for (const [index, page] of pages.entries()) {
    if (index === 0) setPageMetadata(engine, page, coverId, "COVER");
    else if (index === pages.length - 1) setPageMetadata(engine, page, backCoverId, "BACK_COVER");
    else setPageMetadata(engine, page, innerIds.shift() ?? newId(), "INNER");
  }

  const pending = pages.flatMap((page) => engine.block.getChildren(page));
  while (pending.length) {
    const block = pending.shift() as DesignBlockId;
    pending.push(...engine.block.getChildren(block));
    const sourceType = readMetadata(engine, block, METADATA_KEYS.sourceType);
    const sourceId = readMetadata(engine, block, METADATA_KEYS.sourceId);
    if (!sourceType && !sourceId) continue;
    if (linkableSources.has(`${sourceType}:${sourceId}`)) continue;
    for (const key of [METADATA_KEYS.sourceType, METADATA_KEYS.sourceId, METADATA_KEYS.title]) {
      if (engine.block.hasMetadata(block, key)) engine.block.removeMetadata(block, key);
    }
  }
}

function shortType(longhand: string) {
  return longhand.split("/").pop() || longhand;
}

// Builds the page manifest stored next to the scene. Element IDs are de-duplicated because
// duplicating a block in the editor also copies its metadata.
export function buildPageManifest(engine: CreativeEngine): ManifestPage[] {
  const seenElementIds = new Set<string>();
  return engine.scene.getPages().map((page) => {
    const children: ManifestElement[] = [];
    const pending = [...engine.block.getChildren(page)];
    while (pending.length) {
      const block = pending.shift() as DesignBlockId;
      pending.push(...engine.block.getChildren(block));
      const sourceType = readMetadata(engine, block, METADATA_KEYS.sourceType);
      const sourceId = readMetadata(engine, block, METADATA_KEYS.sourceId);
      if ((sourceType !== "article" && sourceType !== "advertisement") || !sourceId) continue;
      let elementId = readMetadata(engine, block, METADATA_KEYS.elementId);
      if (!RECORD_ID_PATTERN.test(elementId) || seenElementIds.has(elementId)) {
        elementId = newId();
        engine.block.setMetadata(block, METADATA_KEYS.elementId, elementId);
      }
      seenElementIds.add(elementId);
      const title = readMetadata(engine, block, METADATA_KEYS.title);
      children.push({
        id: elementId,
        type: shortType(engine.block.getType(block)),
        custom: { bestAgentMedia: { sourceType, sourceId, ...(title ? { title } : {}) } },
      });
    }
    const issuePageId = readMetadata(engine, page, METADATA_KEYS.issuePageId);
    const pageType = readMetadata(engine, page, METADATA_KEYS.pageType) as IssuePageType;
    return { id: issuePageId, children, custom: { bestAgentMedia: { issuePageId, pageType } } };
  });
}

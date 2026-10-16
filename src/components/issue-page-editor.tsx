"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type CreativeEditorSDK from "@cesdk/cesdk-js";
import { AgentPromptButton } from "@/components/agent-prompt-button";
import type { AssetResult, AssetSource, CreativeEngine, DesignBlockId, Typeface } from "@cesdk/cesdk-js";
import { persistTransientResources, SCENE_FILE_TYPES, setupIssueFileMenu } from "@/lib/cesdk-issue-files";
import {
  absoluteUrl,
  addContentBlock,
  adoptImportedScene,
  buildPageManifest,
  buildSceneFromLayout,
  enforceIssuePageRules,
  loadDefaultTypeface,
  newId,
  type ContentItem,
  type IssuePageInfo,
} from "@/lib/cesdk-issue-scene";
import {
  CESDK_DESIGN_FORMAT,
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  isCesdkDesign,
  METADATA_KEYS,
  sanitizeLayoutDesign,
  type CesdkDesign,
  type IssuePageType,
  type LayoutDesign,
} from "@/lib/issue-design";
import {
  applyTemplateToPage,
  buildSceneFromComposition,
  fillTemplateAdSlot,
  fillTemplateWithArticle,
  isPicturePlaceholder,
  pageTemplateId,
  placeContentInPicture,
  syncTemplatePageNumbers,
  templateAllowsPage,
} from "@/lib/cesdk-issue-templates";
import { isComposedIssue } from "@/lib/issue-composition";
import { findIssuePageTemplate, ISSUE_PAGE_TEMPLATES, templateThumbnail } from "@/lib/issue-templates";

type Props = {
  issueId: string;
  pages: IssuePageInfo[];
  design: Record<string, unknown> | null;
  articles: ContentItem[];
  advertisements: ContentItem[];
  // Shown by template labels such as the cover masthead and issue date.
  publicationName: string;
  publicationDate: string;
};

const ARTICLE_SOURCE_ID = "bestAgentMedia.articles";
const ADVERTISEMENT_SOURCE_ID = "bestAgentMedia.advertisements";
const ARTICLE_IMAGE_SOURCE_ID = "bestAgentMedia.articleImages";
const TEMPLATE_SOURCE_ID = "bestAgentMedia.templates";
// Sections of the Templates library, in display order; each lists the templates for one page type.
const TEMPLATE_SECTIONS: { pageType: IssuePageType; title: string }[] = [
  { pageType: "COVER", title: "Cover" },
  { pageType: "INNER", title: "Inner" },
  { pageType: "BACK_COVER", title: "Back" },
];

const TEMPLATE_PANEL_ID = "bestAgentMedia.templates.panel";

function templateEntryId(pageType: IssuePageType) {
  return `${TEMPLATE_SOURCE_ID}.${pageType.toLowerCase()}`;
}
// Applied when an article is added to a page that has no template yet.
const DEFAULT_ARTICLE_TEMPLATE_ID = "feature-spread";
const ISSUE_IMAGE_MIME_TYPES = "image/jpeg,image/png,image/webp,image/svg+xml";

const ICON_SPRITE = `<svg xmlns="http://www.w3.org/2000/svg">
  <symbol id="@bestAgentMedia/Article" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6zm2-7h8v1H8v-1zm0 3h8v1H8v-1zm0-6h3v1H8v-1z"/></symbol>
  <symbol id="@bestAgentMedia/Template" viewBox="0 0 24 24"><path fill="currentColor" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v3h14V5H5zm0 5v4h14v-4H5zm0 6v3h14v-3H5zm4 1h6v1H9v-1z"/></symbol>
  <symbol id="@bestAgentMedia/Image" viewBox="0 0 24 24"><path fill="currentColor" d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></symbol>
  <symbol id="@bestAgentMedia/Ad" viewBox="0 0 24 24"><path fill="currentColor" d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></symbol>
</svg>`;

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// Library cards need a thumbnail; text-only items get a generated title card.
function placeholderThumbnail(item: ContentItem) {
  const label = item.type === "article" ? "ARTICLE" : "AD";
  const title = escapeXml(item.title.length > 48 ? `${item.title.slice(0, 45)}…` : item.title);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" fill="#eef2f5"/><text x="16" y="34" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#7b8794">${label}</text><foreignObject x="16" y="48" width="208" height="176"><div xmlns="http://www.w3.org/1999/xhtml" style="font:600 20px/1.3 Arial,sans-serif;color:#2e3c49;overflow:hidden">${title}</div></foreignObject></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function toAssetResult(item: ContentItem): AssetResult {
  return {
    id: item.id,
    label: item.title,
    tags: [item.type],
    meta: { thumbUri: item.imageUrl ? absoluteUrl(item.imageUrl) : placeholderThumbnail(item) },
  };
}

function createContentSource(
  id: string,
  engine: CreativeEngine,
  itemsRef: React.RefObject<ContentItem[]>,
  typefaceRef: React.RefObject<Typeface | null>,
): AssetSource {
  return {
    id,
    async findAssets({ query, page, perPage }) {
      const term = query?.trim().toLowerCase() ?? "";
      const matches = itemsRef.current.filter(
        (item) => !term || `${item.title} ${item.description}`.toLowerCase().includes(term),
      );
      const start = page * perPage;
      return {
        assets: matches.slice(start, start + perPage).map(toAssetResult),
        total: matches.length,
        currentPage: page,
        nextPage: start + perPage < matches.length ? page + 1 : undefined,
      };
    },
    async applyAsset(asset) {
      const item = itemsRef.current.find((candidate) => candidate.id === asset.id);
      if (!item) return undefined;
      // An ad applied while a picture placeholder is selected goes into that placeholder.
      const selected = engine.block.findAllSelected();
      if (
        item.type === "advertisement" &&
        selected.length === 1 &&
        isPicturePlaceholder(engine, selected[0]) &&
        placeContentInPicture(engine, selected[0], item)
      ) {
        engine.block.select(selected[0]);
        engine.editor.addUndoStep();
        return undefined;
      }
      // Otherwise it goes into the current page's first free ad slot, if the template has one.
      const page = engine.scene.getCurrentPage();
      if (item.type === "advertisement" && page !== null) {
        const filled = fillTemplateAdSlot(engine, page, item);
        if (filled !== null) {
          engine.block.select(filled);
          engine.editor.addUndoStep();
          return undefined;
        }
      }
      // An article on a page without a template first lays the page out with the default template.
      const defaultTemplate = findIssuePageTemplate(DEFAULT_ARTICLE_TEMPLATE_ID);
      if (
        item.type === "article" &&
        page !== null &&
        !pageTemplateId(engine, page) &&
        defaultTemplate &&
        templateAllowsPage(defaultTemplate, pageTypeOf(engine, page))
      ) {
        await applyTemplateToPage(engine, page, defaultTemplate, {
          typeface: typefaceRef.current,
          findArticle: (id) => itemsRef.current.find((candidate) => candidate.id === id),
        });
        enforcePageRules(engine);
      }
      // On a templated page an article fills the template's headline, photo and caption slots.
      if (item.type === "article" && page !== null && pageTemplateId(engine, page)) {
        const filled = fillTemplateWithArticle(engine, page, item);
        if (filled !== null) {
          engine.block.select(filled);
          engine.editor.addUndoStep();
          return undefined;
        }
      }
      return addContentBlock(engine, item, typefaceRef.current);
    },
  };
}

// One library item per article picture, so a single photo can be placed on its own. Each item
// keeps the article's ID, so a placed photo stays linked to its article.
function articleImageItems(articles: ContentItem[]) {
  return articles.flatMap((article) => {
    const urls = article.imageUrls ?? (article.imageUrl ? [article.imageUrl] : []);
    return urls.map((url, index) => ({
      assetId: `${article.id}:${index}`,
      label: urls.length > 1 ? `${article.title} (${index + 1}/${urls.length})` : article.title,
      item: { ...article, imageUrl: url, imageUrls: [url] } satisfies ContentItem,
    }));
  });
}

function createArticleImageSource(engine: CreativeEngine, articlesRef: React.RefObject<ContentItem[]>): AssetSource {
  return {
    id: ARTICLE_IMAGE_SOURCE_ID,
    async findAssets({ query, page, perPage }) {
      const term = query?.trim().toLowerCase() ?? "";
      const matches = articleImageItems(articlesRef.current).filter(
        ({ item }) => !term || `${item.title} ${item.description}`.toLowerCase().includes(term),
      );
      const start = page * perPage;
      return {
        assets: matches.slice(start, start + perPage).map(({ assetId, label, item }) => ({
          id: assetId,
          label,
          tags: ["article", "image"],
          meta: { thumbUri: absoluteUrl(item.imageUrl) },
        })),
        total: matches.length,
        currentPage: page,
        nextPage: start + perPage < matches.length ? page + 1 : undefined,
      };
    },
    async applyAsset(asset) {
      const match = articleImageItems(articlesRef.current).find((candidate) => candidate.assetId === asset.id);
      if (!match) return undefined;
      // A photo applied while a picture placeholder is selected goes into that placeholder.
      const selected = engine.block.findAllSelected();
      if (selected.length === 1 && isPicturePlaceholder(engine, selected[0]) && placeContentInPicture(engine, selected[0], match.item)) {
        engine.block.select(selected[0]);
        engine.editor.addUndoStep();
        return undefined;
      }
      // Otherwise it is added to the current page as a loose image block, sized to the photo.
      return addContentBlock(engine, match.item, null);
    },
  };
}

// Stores an image in the issue's media folder and returns its absolute URL.
async function uploadIssueImage(issueId: string, file: File) {
  const formData = new FormData();
  formData.set("image", file);
  const response = await fetch(`/api/issues/${issueId}/images`, { method: "POST", body: formData });
  const result = (await response.json()) as { url?: string; name?: string; error?: string };
  if (!response.ok || !result.url) throw new Error(result.error ?? "Upload failed.");
  return { uri: absoluteUrl(result.url), name: result.name ?? file.name };
}

function pageTypeOf(engine: CreativeEngine, page: DesignBlockId) {
  return engine.block.hasMetadata(page, METADATA_KEYS.pageType) ? engine.block.getMetadata(page, METADATA_KEYS.pageType) : "";
}

// Page identity/order rules plus template page numbers, which follow page order.
function enforcePageRules(engine: CreativeEngine) {
  const changed = enforceIssuePageRules(engine);
  return syncTemplatePageNumbers(engine) || changed;
}

function resetHistory(engine: CreativeEngine) {
  const previous = engine.editor.getActiveHistory();
  engine.editor.setActiveHistory(engine.editor.createHistory());
  engine.editor.destroyHistory(previous);
}

function currentScenePages(engine: CreativeEngine): IssuePageInfo[] {
  return buildPageManifest(engine).map((page, index) => ({
    id: page.id,
    pageNumber: index + 1,
    type: page.custom.bestAgentMedia.pageType,
  }));
}

function reasonText(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "";
}

/** CE.SDK license problems (missing, invalid or expired key), as opposed to real editor failures. */
function isLicenseError(reason: unknown): boolean {
  return /licen[sc]e/i.test(reasonText(reason));
}

export function IssuePageEditor({
  issueId,
  pages,
  design,
  articles,
  advertisements,
  publicationName,
  publicationDate,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [cesdk, setCesdk] = useState<CreativeEditorSDK | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [editorError, setEditorError] = useState("");
  const cesdkRef = useRef<CreativeEditorSDK | null>(null);
  const typefaceRef = useRef<Typeface | null>(null);
  const articlesRef = useRef(articles);
  const advertisementsRef = useRef(advertisements);
  const issueInfoRef = useRef({ publicationName, publicationDate });
  useEffect(() => {
    issueInfoRef.current = { publicationName, publicationDate };
  }, [publicationName, publicationDate]);
  const initialDesignRef = useRef(design);
  const initialPagesRef = useRef(pages);
  const savingRef = useRef(false);
  const changeCounterRef = useRef(0);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Suppress change-event dirty marking for a short window after programmatic scene loads
  const suppressDirtyUntil = useRef<number>(0);

  useEffect(() => {
    articlesRef.current = articles;
    advertisementsRef.current = advertisements;
    cesdkRef.current?.engine.asset.assetSourceContentsChanged(ARTICLE_SOURCE_ID);
    cesdkRef.current?.engine.asset.assetSourceContentsChanged(ARTICLE_IMAGE_SOURCE_ID);
    cesdkRef.current?.engine.asset.assetSourceContentsChanged(ADVERTISEMENT_SOURCE_ID);
  }, [articles, advertisements]);

  const save = useCallback(async () => {
    const engine = cesdkRef.current?.engine;
    if (!engine || savingRef.current) return;
    const savedChangeCounter = changeCounterRef.current;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const manifest = buildPageManifest(engine);
      const [firstPage] = engine.scene.getPages();
      const document: CesdkDesign = {
        format: CESDK_DESIGN_FORMAT,
        version: 1,
        width: firstPage === undefined ? DEFAULT_PAGE_WIDTH : engine.block.getWidth(firstPage),
        height: firstPage === undefined ? DEFAULT_PAGE_HEIGHT : engine.block.getHeight(firstPage),
        scene: await engine.scene.saveToString(),
        pages: manifest,
      };
      const response = await fetch(`/api/issues/${issueId}/design`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The issue layout could not be saved.");
      if (changeCounterRef.current === savedChangeCounter) {
        setDirty(false);
        setSavedNotice("All changes saved.");
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (changeCounterRef.current !== savedChangeCounter) {
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
        autosaveTimer.current = setTimeout(() => void save(), 250);
      }
    }
  }, [issueId]);

  const markChanged = useCallback(() => {
    changeCounterRef.current += 1;
    setDirty(true);
    setSavedNotice("");
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => void save(), 1200);
  }, [save]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let instance: CreativeEditorSDK | null = null;
    const cleanups: (() => void)[] = [];

    // Without a license key the engine reports license problems as errors. The canvas still works
    // in evaluation mode, so keep them out of the page and the Next.js error overlay.
    const swallowLicenseError = (event: PromiseRejectionEvent | ErrorEvent) => {
      const reason = "reason" in event ? event.reason : event.error ?? event.message;
      if (isLicenseError(reason)) {
        event.preventDefault();
        console.warn("[IssueEditor] CE.SDK license notice (running unlicensed):", reasonText(reason));
      }
    };
    window.addEventListener("unhandledrejection", swallowLicenseError);
    window.addEventListener("error", swallowLicenseError);
    // CE.SDK also logs its evaluation banner and "[UBQ]" notices with console.error, which the
    // Next.js overlay shows as an error. They are informational, so log them at info level.
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const text = args.map((arg) => (typeof arg === "string" ? arg : "")).join(" ");
      if (/\[UBQ\]|For Evaluation Purposes Only/.test(text)) console.info(...args);
      else originalConsoleError.apply(console, args);
    };
    cleanups.push(() => {
      window.removeEventListener("unhandledrejection", swallowLicenseError);
      window.removeEventListener("error", swallowLicenseError);
      console.error = originalConsoleError;
    });

    const initialize = async () => {
      const [{ default: CreativeEditor }, plugins, { DesignEditorConfig }] = await Promise.all([
        import("@cesdk/cesdk-js"),
        import("@cesdk/cesdk-js/plugins"),
        import("@/lib/cesdk-design-editor/plugin"),
      ]);
      if (disposed) return;
      const created = await CreativeEditor.create(container, {
        // Optional: without a license key CE.SDK runs in evaluation mode and watermarks exports.
        license: process.env.NEXT_PUBLIC_CESDK_LICENSE || undefined,
      });
      if (disposed) {
        created.dispose();
        return;
      }
      instance = created;
      const { engine } = created;
      // CE.SDK starts with an empty UI; the design-editor config adds the dock, inspector and panels.
      // It resets the editor (including asset sources), so it must be added before everything else.
      await created.addPlugin(new DesignEditorConfig());
      if (disposed) return;
      created.ui.setTheme("light");

      await created.addPlugin(new plugins.ImageColorsAssetSource());
      await created.addPlugin(new plugins.PagePresetsAssetSource());
      await created.addPlugin(new plugins.ColorPaletteAssetSource());
      await created.addPlugin(new plugins.TypefaceAssetSource());
      await created.addPlugin(new plugins.TextAssetSource());
      await created.addPlugin(new plugins.TextComponentAssetSource());
      await created.addPlugin(new plugins.VectorShapeAssetSource());
      await created.addPlugin(new plugins.StickerAssetSource());
      await created.addPlugin(new plugins.EffectsAssetSource());
      await created.addPlugin(new plugins.FiltersAssetSource());
      await created.addPlugin(new plugins.BlurAssetSource());
      await created.addPlugin(new plugins.CropPresetsAssetSource());
      await created.addPlugin(new plugins.UploadAssetSources({ include: ["ly.img.image.upload"] }));
      if (disposed) return;

      // Issue images are stored on the server (media/issues/<issueId>/), not embedded in the scene.
      engine.editor.setSetting("upload/supportedMimeTypes", ISSUE_IMAGE_MIME_TYPES);
      created.actions.register("uploadFile", async (file, onProgress) => {
        const { uri, name } = await uploadIssueImage(issueId, file);
        onProgress(100);
        return {
          id: newId(),
          label: { en: name },
          meta: { uri, thumbUri: uri, mimeType: file.type, kind: "image", fillType: "//ly.img.ubq/fill/image" },
        };
      });

      // Importing a scene or archive replaces the layout; it is fitted to the issue's pages and saved.
      const importSceneFile = async () => {
        if (!window.confirm("Import a CreativeEditor scene or archive? It replaces the layout of every page in this issue.")) return;
        let fileUrl: string;
        try {
          fileUrl = await created.utils.loadFile({ accept: SCENE_FILE_TYPES, returnType: "objectURL" });
        } catch {
          return;
        }
        const issuePages = currentScenePages(engine);
        const linkableSources = new Set(
          [...articlesRef.current, ...advertisementsRef.current].map((item) => `${item.type}:${item.id}`),
        );
        const previousScene = await engine.scene.saveToString();
        const notification = created.ui.showNotification({ type: "loading", message: "Importing…", duration: "infinite" });
        suppressDirtyUntil.current = Number.POSITIVE_INFINITY;
        try {
          try {
            await engine.scene.load(fileUrl, false, true);
          } finally {
            URL.revokeObjectURL(fileUrl);
          }
          adoptImportedScene(engine, issuePages, linkableSources);
          const skipped = await persistTransientResources(engine, async (file) => (await uploadIssueImage(issueId, file)).uri);
          enforcePageRules(engine);
          resetHistory(engine);
          markChanged();
          await created.actions.run("zoom.toPage", { page: "first" });
          created.ui.showNotification(
            skipped
              ? {
                  type: "warning",
                  message: `Imported, but ${skipped} embedded asset(s) such as fonts or media could not be stored and will be missing when the issue is reopened.`,
                  duration: "long",
                }
              : { type: "success", message: "Imported. The new layout is being saved.", duration: "medium" },
          );
        } catch (error) {
          await engine.scene.loadFromString(previousScene).catch(() => undefined);
          enforcePageRules(engine);
          resetHistory(engine);
          created.ui.showNotification({
            type: "error",
            message: `Import failed: ${error instanceof Error ? error.message : "the file could not be loaded."}`,
            duration: "long",
          });
        } finally {
          created.ui.dismissNotification(notification);
          suppressDirtyUntil.current = Date.now() + 1000;
        }
      };
      setupIssueFileMenu(created, { baseName: `issue-${issueId}`, importScene: importSceneFile });

      // Article and advertisement libraries add linked blocks to the current page.
      engine.asset.addSource(createContentSource(ARTICLE_SOURCE_ID, engine, articlesRef, typefaceRef));
      engine.asset.addSource(createContentSource(ADVERTISEMENT_SOURCE_ID, engine, advertisementsRef, typefaceRef));
      // Every article picture on its own, for placing photos separately from their article.
      engine.asset.addSource(createArticleImageSource(engine, articlesRef));
      // Page templates restyle the current page; see src/lib/issue-templates.ts.
      engine.asset.addSource({
        id: TEMPLATE_SOURCE_ID,
        // Groups are the page types a template allows; the library shows one section per group.
        async getGroups() {
          return TEMPLATE_SECTIONS.map((section) => section.pageType);
        },
        async findAssets({ query, page, perPage, groups, excludeGroups }) {
          const term = query?.trim().toLowerCase() ?? "";
          const matches = ISSUE_PAGE_TEMPLATES.filter(
            (template) =>
              (!term || `${template.name} ${template.description}`.toLowerCase().includes(term)) &&
              (!groups?.length || template.pageTypes.some((type) => groups.includes(type))) &&
              !template.pageTypes.some((type) => excludeGroups?.includes(type)),
          );
          const start = page * perPage;
          return {
            assets: matches.slice(start, start + perPage).map((template) => ({
              id: template.id,
              label: template.name,
              tags: ["template"],
              groups: template.pageTypes,
              meta: { thumbUri: templateThumbnail(template), description: template.description },
            })),
            total: matches.length,
            currentPage: page,
            nextPage: start + perPage < matches.length ? page + 1 : undefined,
          };
        },
        async applyAsset(asset) {
          const template = findIssuePageTemplate(asset.id);
          const page = engine.scene.getCurrentPage();
          if (!template || page === null) return undefined;
          const pageType = pageTypeOf(engine, page);
          if (!templateAllowsPage(template, pageType)) {
            const pageName = (type: string) => (type === "COVER" ? "the cover" : type === "BACK_COVER" ? "the back cover" : "inner pages");
            created.ui.showNotification({
              type: "warning",
              message: `“${template.name}” is for ${template.pageTypes.map(pageName).join(" and ")} and cannot be applied to ${pageType === "INNER" ? "an inner page" : pageName(pageType)}.`,
              duration: "medium",
            });
            return undefined;
          }
          const hasContent = engine.block.getChildren(page).length > 0;
          const selection = await applyTemplateToPage(engine, page, template, {
            typeface: typefaceRef.current,
            findArticle: (id) => articlesRef.current.find((item) => item.id === id),
            issueInfo: issueInfoRef.current,
          });
          enforcePageRules(engine);
          if (selection !== null) engine.block.select(selection);
          engine.editor.addUndoStep();
          if (hasContent) {
            created.ui.showNotification({
              type: "info",
              message: `Applied “${template.name}”. Linked article content was restyled into the template; other elements were kept above it.`,
              duration: "medium",
            });
          }
          return undefined;
        },
      });
      created.ui.addIconSet("bestAgentMedia", ICON_SPRITE);
      // One library entry per page type. The Templates panel shows them as Cover, Inner and Back
      // tabs, each a full multi-row grid (the stock library panel previews sections in one row).
      for (const section of TEMPLATE_SECTIONS) {
        created.ui.addAssetLibraryEntry({
          id: templateEntryId(section.pageType),
          sourceIds: [TEMPLATE_SOURCE_ID],
          includeGroups: [section.pageType],
          title: section.title,
          gridColumns: 2,
          gridItemHeight: "auto",
          gridBackgroundType: "contain",
          previewBackgroundType: "contain",
          cardLabel: (asset) => asset.label,
          isSearchable: true,
        });
      }
      created.ui.registerPanel<{ pageType?: string; openId?: number }>(TEMPLATE_PANEL_ID, ({ builder, state, payload }) => {
        // Each opening starts on the tab for the current page's type.
        const tab = state(`tab-${payload?.openId ?? 0}`, payload?.pageType || "INNER");
        // The section gives the tab buttons the panel's standard padding; the library below keeps
        // the full panel width and height.
        builder.Section("templateTabsSection", {
          children: () =>
            builder.Tabs("templateTabs", {
              value: tab.value,
              setValue: tab.setValue,
              tabs: TEMPLATE_SECTIONS.map((section) => ({ id: section.pageType, label: section.title })),
            }),
        });
        const section = TEMPLATE_SECTIONS.find((candidate) => candidate.pageType === tab.value) ?? TEMPLATE_SECTIONS[1];
        builder.Library(`templateLibrary-${section.pageType}`, {
          entries: [templateEntryId(section.pageType)],
          searchable: true,
          onSelect: async (asset) => {
            await engine.asset.apply(asset.context.sourceId, asset);
          },
        });
      });
      created.i18n.setTranslations({ en: { [`panel.${TEMPLATE_PANEL_ID}`]: "Page templates" } });
      created.ui.setPanelPosition(TEMPLATE_PANEL_ID, "left");
      created.ui.setPanelFloating(TEMPLATE_PANEL_ID, false);
      let templatePanelOpenings = 0;
      const toggleTemplatePanel = () => {
        if (created.ui.isPanelOpen(TEMPLATE_PANEL_ID)) {
          created.ui.closePanel(TEMPLATE_PANEL_ID);
          return;
        }
        // Only one left-hand library panel at a time.
        created.ui.closePanel("//ly.img.panel/assetLibrary");
        const page = engine.scene.getCurrentPage();
        templatePanelOpenings += 1;
        created.ui.openPanel(TEMPLATE_PANEL_ID, {
          payload: { pageType: page === null ? "" : pageTypeOf(engine, page), openId: templatePanelOpenings },
        });
        // Other dock buttons open the stock library panel without notice; give way to it.
        const watch = window.setInterval(() => {
          try {
            if (!created.ui.isPanelOpen(TEMPLATE_PANEL_ID)) {
              window.clearInterval(watch);
            } else if (created.ui.isPanelOpen("//ly.img.panel/assetLibrary")) {
              created.ui.closePanel(TEMPLATE_PANEL_ID);
              window.clearInterval(watch);
            }
          } catch {
            // The editor was disposed.
            window.clearInterval(watch);
          }
        }, 250);
      };
      for (const [id, title] of [[ARTICLE_SOURCE_ID, "Articles"], [ARTICLE_IMAGE_SOURCE_ID, "Images"], [ADVERTISEMENT_SOURCE_ID, "Ads"]] as const) {
        created.ui.addAssetLibraryEntry({
          id,
          sourceIds: [id],
          title,
          gridColumns: 2,
          gridItemHeight: "square",
          gridBackgroundType: "cover",
          previewBackgroundType: "cover",
          cardLabel: (asset) => asset.label,
          isSearchable: true,
        });
      }
      created.ui.insertOrderComponent({ in: "ly.img.dock", before: "ly.img.spacer" }, [
        { id: "ly.img.assetLibrary.dock", key: TEMPLATE_SOURCE_ID, label: "Templates", icon: "@bestAgentMedia/Template", entries: [], isSelected: () => created.ui.isPanelOpen(TEMPLATE_PANEL_ID), onClick: toggleTemplatePanel },
        { id: "ly.img.assetLibrary.dock", key: ARTICLE_SOURCE_ID, label: "Articles", icon: "@bestAgentMedia/Article", entries: [ARTICLE_SOURCE_ID] },
        { id: "ly.img.assetLibrary.dock", key: ARTICLE_IMAGE_SOURCE_ID, label: "Images", icon: "@bestAgentMedia/Image", entries: [ARTICLE_IMAGE_SOURCE_ID] },
        { id: "ly.img.assetLibrary.dock", key: ADVERTISEMENT_SOURCE_ID, label: "Ads", icon: "@bestAgentMedia/Ad", entries: [ADVERTISEMENT_SOURCE_ID] },
      ]);

      // Cover and back-cover pages disable deletion through their own block scope.
      engine.editor.setGlobalScope("lifecycle/destroy", "Defer");
      typefaceRef.current = await loadDefaultTypeface(engine);
      if (disposed) return;

      suppressDirtyUntil.current = Date.now() + 1000;
      const savedDesign = initialDesignRef.current;
      // A layout composed by the Designer and applied from its task is built into editable
      // template pages, then saved as a CE.SDK document (which also records any new pages).
      const composed = isComposedIssue(savedDesign);
      if (isCesdkDesign(savedDesign)) {
        await engine.scene.loadFromString(savedDesign.scene);
      } else if (composed) {
        await buildSceneFromComposition(engine, savedDesign, initialPagesRef.current, typefaceRef.current);
      } else {
        await buildSceneFromLayout(
          engine,
          savedDesign ? sanitizeLayoutDesign(savedDesign as LayoutDesign) : null,
          initialPagesRef.current,
          typefaceRef.current,
        );
      }
      if (disposed) return;
      enforcePageRules(engine);
      resetHistory(engine);

      cleanups.push(
        engine.editor.onHistoryUpdatedWithKind((kind) => {
          if (kind !== "Updated" || Date.now() < suppressDirtyUntil.current) return;
          // Page fixes are applied outside the history callback to avoid re-entrant edits.
          setTimeout(() => {
            if (!disposed) enforcePageRules(engine);
          }, 0);
          markChanged();
        }),
      );
      cesdkRef.current = created;
      setCesdk(created);
      if (composed) {
        markChanged();
        created.ui.showNotification({
          type: "success",
          message: `Built the Designer's layout (${engine.scene.getPages().length} pages). It is being saved; every text, photo and ad stays editable.`,
          duration: "long",
        });
      }
    };

    initialize().catch((error: unknown) => {
      if (!disposed && isLicenseError(error)) {
        console.warn("[IssueEditor] CE.SDK license notice (running unlicensed):", reasonText(error));
      } else if (!disposed) {
        setEditorError(error instanceof Error ? error.message : "The issue editor could not be loaded.");
      }
    });
    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      cesdkRef.current = null;
      setCesdk(null);
      instance?.dispose();
    };
  }, [issueId, markChanged]);

  const resetLayout = useCallback(async () => {
    const engine = cesdkRef.current?.engine;
    if (!engine) return;
    if (!window.confirm("Reset layout? This will remove all content from every page. The canvas will be saved as empty.")) return;
    try {
      suppressDirtyUntil.current = Date.now() + 1000;
      await buildSceneFromLayout(engine, null, currentScenePages(engine), typefaceRef.current);
      resetHistory(engine);
      markChanged();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The layout could not be reset.");
    }
  }, [markChanged]);

  return (
    <div className="issue-editor">
      <div className="issue-save-bar">
        <h2 className="issue-save-bar-title">Issue layout</h2>
        <div className="issue-save-bar-right">
          {saveError ? (
            <p aria-live="polite" className="form-error issue-save-error" role="alert">{saveError}</p>
          ) : savedNotice && !dirty ? (
            <p aria-live="polite" className="muted issue-save-notice">{savedNotice}</p>
          ) : null}
          <button
            className="button button-ghost-danger"
            onClick={() => void resetLayout()}
            disabled={!cesdk || saving}
            title="Clear all content from every page"
          >
            Reset
          </button>
          <span className="issue-save-bar-divider" aria-hidden="true" />
          {/* Composition runs as a background Designer task; the proposal is reviewed and applied
              from the task page, so the canvas is never replaced while someone is editing it. */}
          <AgentPromptButton
            agentSlug="designer"
            apiPath={`/api/issues/${issueId}/generate-layout`}
            buttonLabel="Generate"
            description="The Designer composes the whole issue from the publication, this issue, every article and every ad assigned to it: front cover, as many inner pages as the content needs, and back cover. Long articles continue across pages and every ad gets a slot of its size. The result is a proposal you review on the task page before applying it."
            dialogTitle="Compose issue layout"
            placeholder="E.g. Lead the cover with the garden story, keep sponsored features near the front, put the full-page ad opposite the longest feature…"
            startLabel="Compose layout"
            suggestions={[
              "Lead with the most local, timely story",
              "Spread the ads evenly through the issue",
              "Keep each article on as few pages as possible",
              "Feature the strongest photo story on the back cover",
            ]}
          />
          <button
            className="button button-primary"
            onClick={() => void save()}
            disabled={!cesdk || !dirty || saving}
          >
            {saving ? "Saving…" : dirty ? "Save layout" : "Saved"}
          </button>
        </div>
      </div>
      <div className="issue-canvas-wrap">
        {editorError ? (
          <p aria-live="polite" className="form-error issue-canvas-loading issue-canvas-overlay" role="alert">{editorError}</p>
        ) : !cesdk ? (
          <div className="issue-canvas-loading issue-canvas-overlay">Loading CreativeEditor…</div>
        ) : null}
        <div className="issue-canvas" ref={containerRef} />
      </div>
    </div>
  );
}

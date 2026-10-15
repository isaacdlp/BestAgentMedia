"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type CreativeEditorSDK from "@cesdk/cesdk-js";
import type { AssetResult, AssetSource, CreativeEngine, Typeface } from "@cesdk/cesdk-js";
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
  sanitizeLayoutDesign,
  type CesdkDesign,
  type LayoutDesign,
} from "@/lib/issue-design";
import { announceTaskStarted, type LaunchedTask } from "@/lib/task-events";

type Props = {
  issueId: string;
  pages: IssuePageInfo[];
  design: Record<string, unknown> | null;
  articles: ContentItem[];
  advertisements: ContentItem[];
};

const ARTICLE_SOURCE_ID = "bestAgentMedia.articles";
const ADVERTISEMENT_SOURCE_ID = "bestAgentMedia.advertisements";
const ISSUE_IMAGE_MIME_TYPES = "image/jpeg,image/png,image/webp,image/svg+xml";

const ICON_SPRITE = `<svg xmlns="http://www.w3.org/2000/svg">
  <symbol id="@bestAgentMedia/Article" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6zm2-7h8v1H8v-1zm0 3h8v1H8v-1zm0-6h3v1H8v-1z"/></symbol>
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
      return item ? addContentBlock(engine, item, typefaceRef.current) : undefined;
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
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [cesdk, setCesdk] = useState<CreativeEditorSDK | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [editorError, setEditorError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateNotice, setGenerateNotice] = useState("");
  const [generateTaskHref, setGenerateTaskHref] = useState<string | null>(null);
  const cesdkRef = useRef<CreativeEditorSDK | null>(null);
  const typefaceRef = useRef<Typeface | null>(null);
  const articlesRef = useRef(articles);
  const advertisementsRef = useRef(advertisements);
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
          enforceIssuePageRules(engine);
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
          enforceIssuePageRules(engine);
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
      created.ui.addIconSet("bestAgentMedia", ICON_SPRITE);
      for (const [id, title] of [[ARTICLE_SOURCE_ID, "Articles"], [ADVERTISEMENT_SOURCE_ID, "Ads"]] as const) {
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
        { id: "ly.img.assetLibrary.dock", key: ARTICLE_SOURCE_ID, label: "Articles", icon: "@bestAgentMedia/Article", entries: [ARTICLE_SOURCE_ID] },
        { id: "ly.img.assetLibrary.dock", key: ADVERTISEMENT_SOURCE_ID, label: "Ads", icon: "@bestAgentMedia/Ad", entries: [ADVERTISEMENT_SOURCE_ID] },
      ]);

      // Cover and back-cover pages disable deletion through their own block scope.
      engine.editor.setGlobalScope("lifecycle/destroy", "Defer");
      typefaceRef.current = await loadDefaultTypeface(engine);
      if (disposed) return;

      suppressDirtyUntil.current = Date.now() + 1000;
      const savedDesign = initialDesignRef.current;
      if (isCesdkDesign(savedDesign)) {
        await engine.scene.loadFromString(savedDesign.scene);
      } else {
        await buildSceneFromLayout(
          engine,
          savedDesign ? sanitizeLayoutDesign(savedDesign as LayoutDesign) : null,
          initialPagesRef.current,
          typefaceRef.current,
        );
      }
      if (disposed) return;
      enforceIssuePageRules(engine);
      resetHistory(engine);

      cleanups.push(
        engine.editor.onHistoryUpdatedWithKind((kind) => {
          if (kind !== "Updated" || Date.now() < suppressDirtyUntil.current) return;
          // Page fixes are applied outside the history callback to avoid re-entrant edits.
          setTimeout(() => {
            if (!disposed) enforceIssuePageRules(engine);
          }, 0);
          markChanged();
        }),
      );
      cesdkRef.current = created;
      setCesdk(created);
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

  // Layout generation runs as a background Designer task; the result is reviewed and applied
  // from the task page, so the canvas is never replaced while someone is editing it.
  const generateLayout = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setGenerateError("");
    setGenerateNotice("");
    try {
      const response = await fetch(`/api/issues/${issueId}/generate-layout`, { method: "POST" });
      const result = (await response.json()) as { task?: LaunchedTask; error?: string };
      if (!response.ok || !result.task) throw new Error(result.error ?? "Layout generation could not be started.");
      announceTaskStarted(result.task);
      setGenerateNotice("Layout generation started — you'll be notified when the proposal is ready to review.");
      setGenerateTaskHref(`/tasks/${result.task.id}`);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setGenerating(false);
    }
  }, [generating, issueId]);

  return (
    <div className="issue-editor">
      <div className="issue-save-bar">
        <h2 className="issue-save-bar-title">Issue layout</h2>
        <div className="issue-save-bar-right">
          {generateError ? (
            <p aria-live="polite" className="form-error issue-save-error" role="alert">{generateError}</p>
          ) : generateNotice ? (
            <p aria-live="polite" className="muted issue-save-notice">
              {generateNotice}
              {generateTaskHref ? (
                <> <Link className="text-link" href={generateTaskHref}>View task →</Link></>
              ) : null}
            </p>
          ) : saveError ? (
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
            Reset layout
          </button>
          <span className="issue-save-bar-divider" aria-hidden="true" />
          <button
            className="button button-secondary"
            onClick={() => void generateLayout()}
            disabled={!cesdk || generating || saving}
            title="Generate a layout using AI based on your articles and ads"
          >
            {generating ? "Starting…" : "Generate Layout"}
          </button>
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

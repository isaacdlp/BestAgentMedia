"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { StoreType } from "polotno/model/store";
import type { Section } from "polotno/side-panel";

type IssuePage = { id: string; pageNumber: number; type: "COVER" | "INNER" | "BACK_COVER" };
type ContentItem = {
  id: string;
  title: string;
  type: "article" | "advertisement";
  description: string;
  imageUrl?: string;
};
type CanvasPage = Record<string, unknown> & {
  id: string;
  children?: unknown[];
  custom?: Record<string, unknown>;
};
type CanvasDesign = Record<string, unknown> & { pages?: CanvasPage[] };

// Polotno throws on unrecognised element types (e.g. "rect" from AI output).
// Strip anything that isn't a known-safe type before it reaches the store.
const VALID_ELEMENT_TYPES = new Set(["text", "image", "svg", "figure", "video", "line", "group"]);
function sanitizeDesign(design: CanvasDesign): CanvasDesign {
  const pages = Array.isArray(design.pages) ? design.pages : [];
  return {
    ...design,
    pages: pages.map((page) => ({
      ...page,
      children: Array.isArray(page.children)
        ? page.children.filter((el) => {
            if (typeof el !== "object" || el === null) return false;
            const t = (el as Record<string, unknown>).type;
            return typeof t === "string" && VALID_ELEMENT_TYPES.has(t);
          })
        : [],
    })),
  };
}
type Props = {
  issueId: string;
  pages: IssuePage[];
  design: CanvasDesign | null;
  articles: ContentItem[];
  advertisements: ContentItem[];
};

// Context so sidebar panel components can access issue content without prop-drilling
type IssueEditorCtx = {
  articles: ContentItem[];
  advertisements: ContentItem[];
  storeRef: React.MutableRefObject<StoreType | null>;
};
const IssueEditorContext = createContext<IssueEditorCtx>({
  articles: [],
  advertisements: [],
  storeRef: { current: null },
});

function addContentToPage(store: StoreType | null, item: ContentItem) {
  const activePage = store?.activePage;
  if (!activePage) return;
  const meta = { bestAgentMedia: { sourceType: item.type, sourceId: item.id, title: item.title } };
  if (item.imageUrl) {
    activePage.addElement({ type: "image", src: item.imageUrl, custom: meta, name: item.title, width: 500, height: 400 });
  } else {
    activePage.addElement({ type: "text", text: item.title, custom: meta, fontSize: 28, width: 500, height: 100 });
  }
}

// Stable module-level panel components so section references don't change between renders

function SideContentItem({ item, onAdd }: { item: ContentItem; onAdd: (i: ContentItem) => void }) {
  return (
    <div className="issue-side-item">
      {item.imageUrl && <img src={item.imageUrl} alt="" className="issue-side-item-img" />}
      <div className="issue-side-item-copy">
        <strong className="issue-side-item-title">{item.title}</strong>
        {item.description && <p className="issue-side-item-desc">{item.description}</p>}
        <button className="issue-side-item-btn" onClick={() => onAdd(item)} type="button">
          Add to page
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ArticlesPanel(_: { store: StoreType }) {
  const { articles, storeRef } = useContext(IssueEditorContext);
  const handleAdd = useCallback((item: ContentItem) => { addContentToPage(storeRef.current, item); }, [storeRef]);
  return (
    <div className="issue-side-panel">
      <p className="issue-side-panel-hint">Add article content to the active canvas page.</p>
      {articles.length ? (
        <div className="issue-side-list">
          {articles.map((item) => <SideContentItem key={item.id} item={item} onAdd={handleAdd} />)}
        </div>
      ) : (
        <p className="issue-side-empty">No articles are available for this publication.</p>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AdsPanel(_: { store: StoreType }) {
  const { advertisements, storeRef } = useContext(IssueEditorContext);
  const handleAdd = useCallback((item: ContentItem) => { addContentToPage(storeRef.current, item); }, [storeRef]);
  return (
    <div className="issue-side-panel">
      <p className="issue-side-panel-hint">Add advertisement content to the active canvas page.</p>
      {advertisements.length ? (
        <div className="issue-side-list">
          {advertisements.map((item) => <SideContentItem key={item.id} item={item} onAdd={handleAdd} />)}
        </div>
      ) : (
        <p className="issue-side-empty">No advertisements are available for this publication.</p>
      )}
    </div>
  );
}

export function IssuePageEditor({
  issueId,
  pages,
  design,
  articles,
  advertisements,
}: Props) {
  const [store, setStore] = useState<StoreType | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [editorError, setEditorError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateNotice, setGenerateNotice] = useState("");
  const [generateTaskHref, setGenerateTaskHref] = useState<string | null>(null);
  const storeRef = useRef<StoreType | null>(null);
  const savingRef = useRef(false);
  const changeCounterRef = useRef(0);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Suppress change-event dirty marking for a short window after loadJSON
  const suppressDirtyUntil = useRef<number>(0);

  const normalizedDesign = useMemo(() => {
    const savedPages = Array.isArray(design?.pages) ? design.pages : [];
    const normalizedPages = pages.map((page, index) => {
      const savedPage =
        savedPages.find((candidate) => candidate.id === page.id) ??
        savedPages[index];
      const savedCustom =
        savedPage?.custom && typeof savedPage.custom === "object"
          ? savedPage.custom
          : {};
      const savedMetadata =
        savedCustom.bestAgentMedia && typeof savedCustom.bestAgentMedia === "object"
          ? savedCustom.bestAgentMedia
          : {};
      return {
        ...(savedPage ?? { children: [] }),
        id: page.id,
        custom: {
          ...savedCustom,
          bestAgentMedia: { ...savedMetadata, issuePageId: page.id, pageType: page.type },
        },
      } as CanvasPage;
    });
    return sanitizeDesign({ ...(design ?? { width: 816, height: 1056 }), pages: normalizedPages } as CanvasDesign);
  }, [design, pages]);

  useEffect(() => {
    let disposed = false;
    void import("polotno/model/store").then(({ createStore }) => {
      const nextStore = createStore({ key: "", showCredit: true });
      nextStore.loadJSON(normalizedDesign);
      if (!normalizedDesign.pages?.length) {
        for (const page of pages) nextStore.addPage({ id: page.id });
      }
      if (!disposed) {
        storeRef.current = nextStore;
        setStore(nextStore);
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        setEditorError(
          error instanceof Error ? error.message : "The issue editor could not be loaded.",
        );
      }
    });
    return () => {
      disposed = true;
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [normalizedDesign, pages]);

  const resetLayout = useCallback(() => {
    const currentStore = storeRef.current;
    if (!currentStore) return;
    if (!window.confirm("Reset layout? This will remove all content from every page. The canvas will be saved as empty.")) return;
    const cleanDesign = {
      width: 816,
      height: 1056,
      pages: pages.map((page) => ({
        id: page.id,
        children: [],
        custom: { bestAgentMedia: { issuePageId: page.id, pageType: page.type } },
      })),
    };
    currentStore.loadJSON(cleanDesign);
    // Let the normal change → dirty → autosave flow persist the reset
  }, [pages]);

  const generateLayout = useCallback(async () => {
    const currentStore = storeRef.current;
    if (!currentStore || generating) return;
    setGenerating(true);
    setGenerateError("");
    setGenerateNotice("");
    try {
      const response = await fetch(`/api/issues/${issueId}/generate-layout`, { method: "POST" });
      const result = (await response.json()) as { design?: unknown; taskId?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Layout generation failed.");
      if (!result.design || typeof result.design !== "object") throw new Error("AI returned an invalid design.");
      suppressDirtyUntil.current = Date.now() + 500;
      currentStore.loadJSON(sanitizeDesign(result.design as CanvasDesign));
      setDirty(false);
      setSavedNotice("");
      const taskHref = result.taskId ? `/agents` : null;
      setGenerateNotice("Layout generated and saved to draft — review it above.");
      setGenerateTaskHref(taskHref);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setGenerating(false);
    }
  }, [generating, issueId]);

  const save = useCallback(async () => {
    const currentStore = storeRef.current;
    if (!currentStore || savingRef.current) return;
    const savedChangeCounter = changeCounterRef.current;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch(`/api/issues/${issueId}/design`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentStore.toJSON()),
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

  useEffect(() => {
    if (!store) return;
    const knownPageIds = new Set(store.pages.map(({ id }) => id));
    const handleChange = () => {
      if (Date.now() < suppressDirtyUntil.current) return;
      changeCounterRef.current += 1;
      const addedPages = store.pages.filter(({ id }) => !knownPageIds.has(id));
      for (const page of addedPages) knownPageIds.add(page.id);
      const addedPage = addedPages[addedPages.length - 1];
      if (addedPage) {
        const existingMetadata = addedPage.custom?.bestAgentMedia ?? {};
        addedPage.set({
          custom: {
            ...(addedPage.custom ?? {}),
            bestAgentMedia: { ...existingMetadata, issuePageId: addedPage.id, pageType: "INNER" },
          },
        });
      }
      const coverIndex = store.pages.findIndex(
        (page) => page.custom?.bestAgentMedia?.pageType === "COVER",
      );
      const backCoverIndex = store.pages.findIndex(
        (page) => page.custom?.bestAgentMedia?.pageType === "BACK_COVER",
      );
      if (coverIndex > 0) {
        store.setPageZIndex(store.pages[coverIndex].id, 0);
      } else if (backCoverIndex >= 0 && backCoverIndex !== store.pages.length - 1) {
        store.setPageZIndex(store.pages[backCoverIndex].id, store.pages.length - 1);
      } else if (addedPage && backCoverIndex >= 0) {
        const addedPageIndex = store.pages.findIndex(({ id }) => id === addedPage.id);
        if (addedPageIndex > backCoverIndex) {
          store.setPageZIndex(addedPage.id, backCoverIndex);
        }
      }
      setDirty(true);
      setSavedNotice("");
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => void save(), 1200);
    };
    const unsubscribe = store.on("change", handleChange);
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [save, store]);

  return (
    <IssueEditorContext.Provider value={{ articles, advertisements, storeRef }}>
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
                  <> <Link className="text-link" href={generateTaskHref}>View in Agents →</Link></>
                ) : null}
              </p>
            ) : saveError ? (
              <p aria-live="polite" className="form-error issue-save-error" role="alert">{saveError}</p>
            ) : savedNotice && !dirty ? (
              <p aria-live="polite" className="muted issue-save-notice">{savedNotice}</p>
            ) : null}
            <button
              className="button button-ghost-danger"
              onClick={resetLayout}
              disabled={saving}
              title="Clear all content from every page"
            >
              Reset layout
            </button>
            <span className="issue-save-bar-divider" aria-hidden="true" />
            <button
              className="button button-secondary"
              onClick={() => void generateLayout()}
              disabled={generating || saving}
              title="Generate a layout using AI based on your articles and ads"
            >
              {generating ? "Generating…" : "Generate Layout"}
            </button>
            <button
              className="button button-primary"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? "Saving…" : dirty ? "Save layout" : "Saved"}
            </button>
          </div>
        </div>
        <div className="issue-canvas-wrap">
          {store ? (
            <IssueCanvas store={store} issueId={issueId} />
          ) : editorError ? (
            <p aria-live="polite" className="form-error" role="alert">{editorError}</p>
          ) : (
            <div className="issue-canvas-loading">Loading Polotno editor…</div>
          )}
        </div>
      </div>
    </IssueEditorContext.Provider>
  );
}

type PolotnoComponents = {
  PolotnoContainer: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  SidePanelWrap: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  WorkspaceWrap: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  SidePanel: React.ComponentType<{ store: StoreType; sections?: Section[]; defaultSection?: string }>;
  TextSection: Section;
  UploadSection: Section;
  BackgroundSection: Section;
  ElementsSection: Section;
  LayersSection: Section;
  SectionTab: React.ComponentType<{
    children: React.ReactNode;
    name: string;
    onClick: React.MouseEventHandler<HTMLDivElement>;
    active: boolean;
    iconSize?: number;
  }>;
  Workspace: React.ComponentType<{ store: StoreType }>;
  Toolbar: React.ComponentType<{ store: StoreType }>;
  ZoomButtons: React.ComponentType<{ store: StoreType }>;
  PagesTimeline: React.ComponentType<{ store: StoreType }>;
};

function IssueCanvas({ store, issueId }: { store: StoreType; issueId: string }) {
  const [components, setComponents] = useState<PolotnoComponents | null>(null);

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      import("polotno/polotno-app"),
      import("polotno/side-panel"),
      import("polotno/side-panel/upload-panel"),
      import("polotno/canvas/workspace"),
      import("polotno/toolbar/toolbar"),
      import("polotno/toolbar/zoom-buttons"),
      import("polotno/pages-timeline"),
    ]).then(([app, panel, uploadPanel, workspace, toolbar, zoom, timeline]) => {
      if (disposed) return;
      uploadPanel.setUploadFunc(async (file: File) => {
        const formData = new FormData();
        formData.set("image", file);
        const response = await fetch(`/api/issues/${issueId}/images`, {
          method: "POST",
          body: formData,
        });
        const result = (await response.json()) as { url?: string; error?: string };
        if (!response.ok || !result.url) throw new Error(result.error ?? "Upload failed.");
        return result.url;
      });
      setComponents({
        PolotnoContainer: app.PolotnoContainer,
        SidePanelWrap: app.SidePanelWrap,
        WorkspaceWrap: app.WorkspaceWrap,
        SidePanel: panel.SidePanel,
        TextSection: panel.TextSection,
        UploadSection: panel.UploadSection,
        BackgroundSection: panel.BackgroundSection,
        ElementsSection: panel.ElementsSection,
        LayersSection: panel.LayersSection,
        SectionTab: panel.SectionTab,
        Workspace: workspace.Workspace,
        Toolbar: toolbar.Toolbar,
        ZoomButtons: zoom.ZoomButtons,
        PagesTimeline: timeline.PagesTimeline,
      });
    });
    return () => { disposed = true; };
  }, [issueId]);

  const sections = useMemo((): Section[] | null => {
    if (!components) return null;
    const { TextSection, UploadSection, BackgroundSection, ElementsSection, LayersSection, SectionTab } = components;

    const ArticlesSection: Section = {
      name: "articles",
      Tab: ({ onClick, active }) => (
        <SectionTab onClick={onClick} active={active} name="Articles" iconSize={18}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6zm2-7h8v1H8v-1zm0 3h8v1H8v-1zm0-6h3v1H8v-1z" />
          </svg>
        </SectionTab>
      ),
      Panel: ArticlesPanel,
    };

    const AdsSection: Section = {
      name: "ads",
      Tab: ({ onClick, active }) => (
        <SectionTab onClick={onClick} active={active} name="Ads" iconSize={18}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z" />
          </svg>
        </SectionTab>
      ),
      Panel: AdsPanel,
    };

    return [TextSection, UploadSection, BackgroundSection, ElementsSection, ArticlesSection, AdsSection, LayersSection];
  }, [components]);

  if (!components || !sections) {
    return <div className="issue-canvas-loading">Loading Polotno editor…</div>;
  }

  const { PolotnoContainer, SidePanelWrap, WorkspaceWrap, SidePanel, Workspace, Toolbar, ZoomButtons, PagesTimeline } = components;

  return (
    <PolotnoContainer style={{ width: "100%", height: "100%" }}>
      <SidePanelWrap>
        <SidePanel store={store} sections={sections} />
      </SidePanelWrap>
      <WorkspaceWrap>
        <Toolbar store={store} />
        <Workspace store={store} />
        <ZoomButtons store={store} />
        <PagesTimeline store={store} />
      </WorkspaceWrap>
    </PolotnoContainer>
  );
}

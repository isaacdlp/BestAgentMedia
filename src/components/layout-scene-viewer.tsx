"use client";

import { useEffect, useRef, useState } from "react";
import type CreativeEditorSDK from "@cesdk/cesdk-js";
import { buildSceneFromLayout, loadDefaultTypeface, newId, type IssuePageInfo } from "@/lib/cesdk-issue-scene";
import { buildSceneFromComposition } from "@/lib/cesdk-issue-templates";
import type { ComposedIssue } from "@/lib/issue-composition";
import { sanitizeLayoutDesign, type IssuePageType, type LayoutDesign } from "@/lib/issue-design";

type Props = {
  composition: ComposedIssue | null;
  design: LayoutDesign | null;
};

function isLicenseNotice(reason: unknown) {
  const text = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return /licen[sc]e/i.test(text);
}

// Legacy layouts carry their own pages; the viewer gives them page identities in order.
function legacyPages(design: LayoutDesign): IssuePageInfo[] {
  const pages = Array.isArray(design.pages) ? design.pages : [];
  return pages.map((page, index) => {
    const type: IssuePageType = index === 0 ? "COVER" : index === pages.length - 1 ? "BACK_COVER" : "INNER";
    return { id: typeof page.id === "string" ? page.id : newId(), pageNumber: index + 1, type };
  });
}

/**
 * A read-only CreativeEditor (CE.SDK) canvas for a generated layout. The scene is built with the
 * same code the issue editor uses when the layout is applied, so what is shown here is exactly
 * what the issue gets: same frames, typefaces, text flow and image crops.
 */
export function LayoutSceneViewer({ composition, design }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const compositionRef = useRef(composition);
  const designRef = useRef(design);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let instance: CreativeEditorSDK | null = null;

    // Unlicensed CE.SDK reports its evaluation mode as errors; they are informational here.
    const swallowLicense = (event: PromiseRejectionEvent | ErrorEvent) => {
      const reason = "reason" in event ? event.reason : event.error ?? event.message;
      if (isLicenseNotice(reason)) {
        event.preventDefault();
        console.warn("[LayoutViewer] CE.SDK license notice (running unlicensed):", reason instanceof Error ? reason.message : reason);
      }
    };
    window.addEventListener("unhandledrejection", swallowLicense);
    window.addEventListener("error", swallowLicense);
    // CE.SDK logs its evaluation banner and "[UBQ]" notices with console.error, which the Next.js
    // overlay shows as an error. They are informational, so log them at info level.
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const text = args.map((arg) => (typeof arg === "string" ? arg : arg instanceof Error ? arg.message : "")).join(" ");
      if (/\[UBQ\]|For Evaluation Purposes Only|licen[sc]e/i.test(text)) console.info(...args);
      else originalConsoleError.apply(console, args);
    };

    const initialize = async () => {
      const [{ default: CreativeEditor }, plugins, { DesignEditorConfig }] = await Promise.all([
        import("@cesdk/cesdk-js"),
        import("@cesdk/cesdk-js/plugins"),
        import("@/lib/cesdk-design-editor/plugin"),
      ]);
      if (disposed) return;
      const created = await CreativeEditor.create(container, {
        license: process.env.NEXT_PUBLIC_CESDK_LICENSE || undefined,
      });
      if (disposed) {
        created.dispose();
        return;
      }
      instance = created;
      const { engine } = created;
      await created.addPlugin(new DesignEditorConfig());
      // The same typeface library as the editor, so template fonts resolve identically.
      await created.addPlugin(new plugins.TypefaceAssetSource());
      if (disposed) return;
      created.ui.setTheme("light");

      // View only: no dock, inspector, panels or canvas menus; just the pages and zoom controls.
      created.feature.disable([
        "ly.img.dock",
        "ly.img.inspector",
        "ly.img.inspector.bar",
        "ly.img.inspector.toggle",
        "ly.img.library.panel",
        "ly.img.canvas.bar",
        "ly.img.canvas.menu",
        "ly.img.page.add",
        "ly.img.page.move",
        "ly.img.page.settings",
        "ly.img.navigation.undoRedo",
        "ly.img.navigation.documentSettings",
      ]);
      created.ui.setComponentOrder({ in: "ly.img.navigation.bar" }, ["ly.img.spacer", "ly.img.zoom.navigationBar"]);
      engine.editor.setRole("Viewer");
      engine.editor.setGlobalScope("editor/select", "Deny");
      engine.editor.setGlobalScope("text/edit", "Deny");
      engine.editor.setGlobalScope("layer/move", "Deny");
      engine.editor.setGlobalScope("lifecycle/destroy", "Deny");

      const typeface = await loadDefaultTypeface(engine);
      if (disposed) return;
      if (compositionRef.current) {
        await buildSceneFromComposition(engine, compositionRef.current, [], typeface);
      } else if (designRef.current) {
        const layout = sanitizeLayoutDesign(designRef.current);
        await buildSceneFromLayout(engine, layout, legacyPages(layout), typeface);
      }
      if (disposed) return;
      await created.actions.run("zoom.toPage", { page: "first", padding: 24 });
      setReady(true);
    };

    initialize().catch((reason: unknown) => {
      if (disposed || isLicenseNotice(reason)) return;
      setError(reason instanceof Error ? reason.message : "The layout viewer could not be loaded.");
    });
    return () => {
      disposed = true;
      window.removeEventListener("unhandledrejection", swallowLicense);
      window.removeEventListener("error", swallowLicense);
      console.error = originalConsoleError;
      instance?.dispose();
    };
  }, []);

  return (
    <div className="issue-canvas-wrap layout-viewer-wrap">
      {error ? (
        <p className="form-error issue-canvas-loading issue-canvas-overlay" role="alert">{error}</p>
      ) : !ready ? (
        <div className="issue-canvas-loading issue-canvas-overlay">Building the layout in CreativeEditor…</div>
      ) : null}
      <div className="issue-canvas" ref={containerRef} />
    </div>
  );
}

// Shared issue-design definitions used by the CreativeEditor (CE.SDK) canvas,
// the design persistence endpoint, and the AI layout generator.
//
// Issue.designJson holds one of three shapes:
// - A CE.SDK document ({ format: "cesdk", scene, pages }) saved by the editor. `scene` is the
//   opaque string from `engine.scene.saveToString()`; `pages` is a manifest of page identity
//   and linked content derived from block metadata, so the server can validate placements
//   without decoding the scene.
// - A layout specification ({ width, height, pages: [{ id, background, children }] }) with
//   simple text/image elements. Older Designer layouts and designs saved before the CE.SDK
//   migration use this shape; the editor converts it into a CE.SDK scene when it is opened.
// - A composition ({ format: "composition", pages }) from the Designer's automatic layout
//   (src/lib/issue-composition.ts); the editor builds it into template pages when it is opened.

export const CESDK_DESIGN_FORMAT = "cesdk";
export const DEFAULT_PAGE_WIDTH = 816;
export const DEFAULT_PAGE_HEIGHT = 1056;

// Block metadata keys (engine.block.setMetadata) that link canvas blocks to records.
export const METADATA_KEYS = {
  issuePageId: "bestAgentMedia/issuePageId",
  pageType: "bestAgentMedia/pageType",
  elementId: "bestAgentMedia/elementId",
  sourceType: "bestAgentMedia/sourceType",
  sourceId: "bestAgentMedia/sourceId",
  title: "bestAgentMedia/title",
  // Page template (src/lib/issue-templates.ts): the page's template ID and each template block's slot ID.
  templateId: "bestAgentMedia/templateId",
  templateSlot: "bestAgentMedia/templateSlot",
} as const;

export type IssuePageType = "COVER" | "INNER" | "BACK_COVER";
export type ContentSourceType = "article" | "advertisement";

export type LayoutElement = Record<string, unknown> & {
  id?: string;
  type?: string;
  custom?: Record<string, unknown>;
};
export type LayoutPage = Record<string, unknown> & {
  id: string;
  background?: string;
  children?: LayoutElement[];
  custom?: Record<string, unknown>;
};
export type LayoutDesign = Record<string, unknown> & {
  width?: number;
  height?: number;
  pages?: LayoutPage[];
};

export type ManifestElement = {
  id: string;
  type: string;
  custom: { bestAgentMedia: { sourceType: ContentSourceType; sourceId: string; title?: string } };
};
export type ManifestPage = {
  id: string;
  children: ManifestElement[];
  custom: { bestAgentMedia: { issuePageId: string; pageType: IssuePageType } };
};
export type CesdkDesign = {
  format: typeof CESDK_DESIGN_FORMAT;
  version: 1;
  width: number;
  height: number;
  scene: string;
  pages: ManifestPage[];
};

export function isCesdkDesign(design: unknown): design is CesdkDesign {
  if (typeof design !== "object" || design === null) return false;
  const record = design as Record<string, unknown>;
  return record.format === CESDK_DESIGN_FORMAT && typeof record.scene === "string" && record.scene.length > 0;
}

// Layout specifications only support text and image elements. Anything else (for example
// "rect" from AI output) is dropped before it is converted into CE.SDK blocks.
const LAYOUT_ELEMENT_TYPES = new Set(["text", "image"]);

export function sanitizeLayoutDesign<T extends Record<string, unknown>>(design: T): T {
  const pages = Array.isArray(design.pages) ? (design.pages as Record<string, unknown>[]) : [];
  return {
    ...design,
    pages: pages.map((page) => ({
      ...page,
      children: Array.isArray(page.children)
        ? (page.children as unknown[]).filter((element) => {
            if (typeof element !== "object" || element === null) return false;
            const type = (element as Record<string, unknown>).type;
            return typeof type === "string" && LAYOUT_ELEMENT_TYPES.has(type);
          })
        : [],
    })),
  };
}

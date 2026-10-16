// Page templates for the issue layout editor (CE.SDK). A template is plain data: named slots
// with frames on a reference 816 x 1056 px page. Applying a template creates ordinary,
// independently editable CE.SDK blocks tagged with the slot they came from, so a page stays
// editable (and exportable) like any other page. See src/lib/cesdk-issue-templates.ts.

import {
  joinParagraphs,
  paragraphSeparator,
  parseArticleMarkdown,
  sliceParagraph,
  type RichParagraph,
} from "@/lib/article-rich-text";
import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAGE_WIDTH, type IssuePageType } from "@/lib/issue-design";

export const TEMPLATE_REFERENCE_WIDTH = DEFAULT_PAGE_WIDTH;
export const TEMPLATE_REFERENCE_HEIGHT = DEFAULT_PAGE_HEIGHT;

// What a slot holds. Content roles are filled from articles: "subtitle" and "caption" take the
// article's first paragraph, "body" columns take the article text (flowed across the story's
// columns in order) and "quote" takes a pull quote. "pageNumber" is kept in sync with the page's
// position; "label" slots are fixed text such as a cover masthead, never filled from articles;
// "decoration" slots are plain shapes (panels and rules). "ad" slots are picture frames reserved
// for an advertisement: articles never fill them, and an ad's artwork is fitted whole.
export type TemplateSlotRole =
  | "title"
  | "subtitle"
  | "body"
  | "quote"
  | "image"
  | "ad"
  | "caption"
  | "pageNumber"
  | "label"
  | "decoration";

export type TemplateTextRole = "title" | "subtitle" | "body" | "quote" | "caption" | "pageNumber" | "label";

export type TemplateFrame = { x: number; y: number; width: number; height: number };

type SlotBase = {
  id: string;
  label: string;
  role: TemplateSlotRole;
  frame: TemplateFrame;
  // Pages with several articles group their content slots by story; omitted means story 1.
  // Story 0 holds text continued from a previous page.
  story?: number;
};

export type TemplateTextSlot = SlotBase & {
  kind: "text";
  role: TemplateTextRole;
  // Shown until content is added. For "pageNumber", "{n}" is replaced with the page number; for
  // "label", "{publication}" and "{date}" are replaced with the issue's publication name and date.
  text: string;
  fontSize: number;
  // Preferred typefaces, by family name; the first one available in the typeface library is used.
  fontFamilies?: string[];
  bold?: boolean;
  color: string;
  align: "Left" | "Center" | "Right" | "Justify";
  verticalAlign?: "Top" | "Center" | "Bottom";
  lineHeight?: number;
  // Shrinks the font so the text fits the frame (needs a fixed height, i.e. verticalAlign).
  autoFit?: boolean;
  // Article text longer than this is shortened at a word boundary with an ellipsis.
  maxChars?: number;
};

export type TemplateImageSlot = SlotBase & { kind: "image"; role: "image" | "ad" };

export type TemplateShapeSlot = SlotBase & { kind: "rect"; role: "decoration"; color: string };

export type TemplateSlot = TemplateTextSlot | TemplateImageSlot | TemplateShapeSlot;

export type IssuePageTemplate = {
  id: string;
  name: string;
  description: string;
  // Page types the template may be applied to.
  pageTypes: IssuePageType[];
  background: string;
  // Listed back to front.
  slots: TemplateSlot[];
};

// Merriweather matches the reference design; the bundled CE.SDK library has Source Serif Pro and Playfair Display.
const SERIF_FAMILIES = ["Merriweather", "Source Serif Pro", "Playfair Display"];

const RULE_COLOR = "#a7afb7";
const INK = "#1f2328";
const BODY_INK = "#2f3a45";
const BODY_PLACEHOLDER =
  "Body copy goes here. Drop an article from the library onto this page to fill the headline, columns and photos, or type straight into this column.";
const BODY_PLACEHOLDER_CONTINUED =
  "The column continues here. Long articles flow from the first column into this one when an article is dropped onto the page.";

function bodySlot(id: string, label: string, frame: TemplateFrame, text = BODY_PLACEHOLDER, story?: number): TemplateTextSlot {
  return {
    id,
    label,
    kind: "text",
    role: "body",
    text,
    frame,
    fontSize: 12,
    fontFamilies: SERIF_FAMILIES,
    color: BODY_INK,
    align: "Justify",
    verticalAlign: "Top",
    lineHeight: 1.5,
    ...(story === undefined ? {} : { story }),
  };
}

function headlineSlot(id: string, frame: TemplateFrame, story?: number): TemplateTextSlot {
  const second = story !== undefined && story > 1;
  return {
    id,
    label: second ? `Headline ${story}` : "Headline",
    kind: "text",
    role: "title",
    text: second ? "Second Story Headline Goes Here" : "Story Headline Goes Here",
    frame,
    fontSize: 24,
    fontFamilies: SERIF_FAMILIES,
    bold: true,
    color: INK,
    align: "Center",
    verticalAlign: "Top",
    lineHeight: 1.3,
    ...(story === undefined ? {} : { story }),
  };
}

// Slot IDs must be unique within a template, so pages with several ads number their slots.
function adSlot(label: string, frame: TemplateFrame, id = "ad"): TemplateImageSlot {
  return { id, label, kind: "image", role: "ad", frame };
}

// A headline across both columns, for pages that share the page with an ad.
function wideHeadlineSlot(): TemplateTextSlot {
  return { ...headlineSlot("title", { x: 100, y: 72, width: 616, height: 72 }), fontSize: 30, verticalAlign: "Center", lineHeight: 1.2 };
}

function ruleSlot(id: string, y: number): TemplateShapeSlot {
  return { id, label: "Rule", kind: "rect", role: "decoration", color: RULE_COLOR, frame: { x: 100, y, width: 616, height: 1.5 } };
}

function pageNumberSlot(): TemplateTextSlot {
  return {
    id: "pageNumber",
    label: "Page number",
    kind: "text",
    role: "pageNumber",
    text: "Page {n}",
    frame: { x: 308, y: 1002, width: 200, height: 20 },
    fontSize: 12,
    fontFamilies: SERIF_FAMILIES,
    color: BODY_INK,
    align: "Center",
  };
}

export const ISSUE_PAGE_TEMPLATES: IssuePageTemplate[] = [
  {
    id: "feature-photo",
    name: "Feature photo",
    description: "Centered serif headline, full-bleed photo and a caption panel with the page number.",
    pageTypes: ["INNER"],
    background: "#eef0f2",
    slots: [
      { id: "panel", label: "Caption panel", kind: "rect", role: "decoration", color: "#c9d3dc", frame: { x: 0, y: 846, width: 816, height: 210 } },
      { id: "image", label: "Photo", kind: "image", role: "image", frame: { x: 0, y: 268, width: 816, height: 578 } },
      {
        id: "title",
        label: "Headline",
        kind: "text",
        role: "title",
        text: "Your Headline Goes Here",
        frame: { x: 88, y: 64, width: 640, height: 190 },
        fontSize: 58,
        fontFamilies: SERIF_FAMILIES,
        bold: true,
        color: "#1f2328",
        align: "Center",
        verticalAlign: "Center",
        lineHeight: 1.15,
      },
      {
        id: "caption",
        label: "Caption",
        kind: "text",
        role: "caption",
        text: "Add a short caption that introduces the story and invites readers to turn the page.",
        frame: { x: 168, y: 884, width: 480, height: 80 },
        fontSize: 15,
        fontFamilies: SERIF_FAMILIES,
        color: "#2f3a45",
        align: "Center",
        lineHeight: 1.4,
      },
      {
        id: "pageNumber",
        label: "Page number",
        kind: "text",
        role: "pageNumber",
        text: "Page {n}",
        frame: { x: 308, y: 992, width: 200, height: 20 },
        fontSize: 12,
        fontFamilies: SERIF_FAMILIES,
        color: "#2f3a45",
        align: "Center",
      },
    ],
  },
  {
    id: "feature-spread",
    name: "Feature spread",
    description: "Large centered headline between rules, an introduction, two body columns and a row of three photos.",
    pageTypes: ["INNER"],
    background: "#ffffff",
    slots: [
      {
        id: "title",
        label: "Headline",
        kind: "text",
        role: "title",
        text: "Your Feature Headline Goes Here",
        frame: { x: 100, y: 84, width: 616, height: 176 },
        fontSize: 54,
        fontFamilies: SERIF_FAMILIES,
        bold: true,
        color: INK,
        align: "Center",
        verticalAlign: "Center",
        lineHeight: 1.15,
      },
      ruleSlot("rule-top", 276),
      {
        id: "subtitle",
        label: "Introduction",
        kind: "text",
        role: "subtitle",
        text: "A short introduction sets the scene for the feature and draws readers into the story below.",
        frame: { x: 136, y: 292, width: 544, height: 84 },
        fontSize: 15,
        fontFamilies: SERIF_FAMILIES,
        color: BODY_INK,
        align: "Center",
        verticalAlign: "Center",
        lineHeight: 1.4,
      },
      ruleSlot("rule-bottom", 392),
      bodySlot("body-1", "Column 1", { x: 100, y: 420, width: 292, height: 330 }),
      bodySlot("body-2", "Column 2", { x: 424, y: 420, width: 292, height: 330 }, BODY_PLACEHOLDER_CONTINUED),
      { id: "image", label: "Photo 1", kind: "image", role: "image", frame: { x: 0, y: 776, width: 236, height: 188 } },
      { id: "image-2", label: "Photo 2", kind: "image", role: "image", frame: { x: 270, y: 776, width: 276, height: 188 } },
      { id: "image-3", label: "Photo 3", kind: "image", role: "image", frame: { x: 580, y: 776, width: 236, height: 188 } },
      pageNumberSlot(),
    ],
  },
  {
    id: "photo-story",
    name: "Photo story with quote",
    description: "Wide photo over a headline and two body columns, with a pull quote panel at the foot of the second column.",
    pageTypes: ["INNER"],
    background: "#ffffff",
    slots: [
      { id: "image", label: "Photo", kind: "image", role: "image", frame: { x: 100, y: 88, width: 616, height: 262 } },
      headlineSlot("title", { x: 100, y: 384, width: 292, height: 120 }),
      bodySlot("body-1", "Column 1", { x: 100, y: 516, width: 292, height: 460 }),
      bodySlot("body-2", "Column 2", { x: 424, y: 384, width: 292, height: 420 }, BODY_PLACEHOLDER_CONTINUED),
      { id: "quote-panel", label: "Quote panel", kind: "rect", role: "decoration", color: "#cdd6df", frame: { x: 424, y: 836, width: 292, height: 140 } },
      {
        id: "quote",
        label: "Pull quote",
        kind: "text",
        role: "quote",
        text: "\u201cA memorable line from the story makes a strong pull quote.\u201d",
        frame: { x: 450, y: 852, width: 240, height: 108 },
        fontSize: 15,
        fontFamilies: SERIF_FAMILIES,
        color: BODY_INK,
        align: "Center",
        verticalAlign: "Center",
        lineHeight: 1.4,
      },
      pageNumberSlot(),
    ],
  },
  {
    id: "two-stories",
    name: "Two stories",
    description: "Text continued from the previous page, then two stories side by side, each with a headline, body and photo.",
    pageTypes: ["INNER"],
    background: "#ffffff",
    slots: [
      bodySlot(
        "continued",
        "Continued text",
        { x: 100, y: 80, width: 616, height: 176 },
        "Text continued from the previous page goes here. Select this block and drop an article to continue it, or delete the block to start the page with the stories below.",
        0,
      ),
      ruleSlot("rule-top", 284),
      headlineSlot("title", { x: 100, y: 316, width: 292, height: 88 }),
      bodySlot("body-1", "Story 1 body", { x: 100, y: 416, width: 292, height: 316 }),
      { id: "image", label: "Story 1 photo", kind: "image", role: "image", frame: { x: 100, y: 760, width: 292, height: 190 } },
      { id: "story2-image", label: "Story 2 photo", kind: "image", role: "image", story: 2, frame: { x: 424, y: 316, width: 292, height: 190 } },
      headlineSlot("story2-title", { x: 424, y: 530, width: 292, height: 88 }, 2),
      bodySlot("story2-body", "Story 2 body", { x: 424, y: 630, width: 292, height: 320 }, BODY_PLACEHOLDER, 2),
      pageNumberSlot(),
    ],
  },
  {
    id: "full-page-ad",
    name: "Full-page ad",
    description: "A full-bleed advertisement filling the whole page.",
    pageTypes: ["INNER"],
    background: "#ffffff",
    slots: [adSlot("Full-page ad", { x: 0, y: 0, width: 816, height: 1056 })],
  },
  {
    id: "half-page-ad",
    name: "Half-page ad",
    description: "A story headline and two body columns on the top half, with a half-page ad across the bottom.",
    pageTypes: ["INNER"],
    background: "#ffffff",
    slots: [
      wideHeadlineSlot(),
      ruleSlot("rule-top", 156),
      bodySlot("body-1", "Column 1", { x: 100, y: 176, width: 292, height: 320 }),
      bodySlot("body-2", "Column 2", { x: 424, y: 176, width: 292, height: 320 }, BODY_PLACEHOLDER_CONTINUED),
      adSlot("Half-page ad", { x: 100, y: 524, width: 616, height: 452 }),
      pageNumberSlot(),
    ],
  },
  {
    id: "quarter-page-ad",
    name: "Quarter-page ad",
    description: "A story headline and two body columns wrapped around a quarter-page ad in the bottom-right corner.",
    pageTypes: ["INNER"],
    background: "#ffffff",
    slots: [
      wideHeadlineSlot(),
      ruleSlot("rule-top", 156),
      bodySlot("body-1", "Column 1", { x: 100, y: 176, width: 292, height: 800 }),
      bodySlot("body-2", "Column 2", { x: 424, y: 176, width: 292, height: 404 }, BODY_PLACEHOLDER_CONTINUED),
      adSlot("Quarter-page ad", { x: 424, y: 608, width: 292, height: 368 }),
      pageNumberSlot(),
    ],
  },
  {
    id: "text-columns",
    name: "Text columns",
    description: "A headline over two full-height body columns, for text-only stories and articles continued from an earlier page.",
    pageTypes: ["INNER"],
    background: "#ffffff",
    slots: [
      wideHeadlineSlot(),
      ruleSlot("rule-top", 156),
      bodySlot("body-1", "Column 1", { x: 100, y: 176, width: 292, height: 800 }),
      bodySlot("body-2", "Column 2", { x: 424, y: 176, width: 292, height: 800 }, BODY_PLACEHOLDER_CONTINUED),
      pageNumberSlot(),
    ],
  },
  {
    id: "two-half-page-ads",
    name: "Two half-page ads",
    description: "Two half-page ads stacked on the page.",
    pageTypes: ["INNER"],
    background: "#ffffff",
    slots: [
      adSlot("Half-page ad 1", { x: 100, y: 72, width: 616, height: 440 }),
      adSlot("Half-page ad 2", { x: 100, y: 540, width: 616, height: 440 }, "ad-2"),
      pageNumberSlot(),
    ],
  },
  {
    id: "four-quarter-page-ads",
    name: "Four quarter-page ads",
    description: "Four quarter-page (or business-card) ads in a two-by-two grid.",
    pageTypes: ["INNER"],
    background: "#ffffff",
    slots: [
      adSlot("Quarter-page ad 1", { x: 100, y: 72, width: 292, height: 440 }),
      adSlot("Quarter-page ad 2", { x: 424, y: 72, width: 292, height: 440 }, "ad-2"),
      adSlot("Quarter-page ad 3", { x: 100, y: 540, width: 292, height: 440 }, "ad-3"),
      adSlot("Quarter-page ad 4", { x: 424, y: 540, width: 292, height: 440 }, "ad-4"),
      pageNumberSlot(),
    ],
  },
  {
    id: "journer-cover",
    name: "Journer cover",
    description: "Front cover: serif masthead between rules with issue and date, a framed lead photo with its cover line, and three teaser stories.",
    pageTypes: ["COVER"],
    background: "#f0f2f4",
    slots: [
      { id: "cover-panel", label: "Lower panel", kind: "rect", role: "decoration", color: "#c9d5df", frame: { x: 0, y: 560, width: 816, height: 496 } },
      { id: "cover-card", label: "Photo card", kind: "rect", role: "decoration", color: "#ffffff", frame: { x: 60, y: 276, width: 696, height: 640 } },
      {
        id: "masthead",
        label: "Masthead",
        kind: "text",
        role: "label",
        text: "{publication}",
        frame: { x: 80, y: 44, width: 656, height: 136 },
        fontSize: 120,
        fontFamilies: SERIF_FAMILIES,
        bold: true,
        color: INK,
        align: "Center",
        verticalAlign: "Center",
        lineHeight: 1,
        autoFit: true,
      },
      { id: "masthead-rule-left", label: "Rule", kind: "rect", role: "decoration", color: BODY_INK, frame: { x: 100, y: 199, width: 178, height: 1.5 } },
      {
        id: "masthead-kicker",
        label: "Masthead kicker",
        kind: "text",
        role: "label",
        text: "Magazine",
        frame: { x: 288, y: 180, width: 240, height: 40 },
        fontSize: 30,
        fontFamilies: SERIF_FAMILIES,
        bold: true,
        color: INK,
        align: "Center",
        verticalAlign: "Center",
        lineHeight: 1,
      },
      { id: "masthead-rule-right", label: "Rule", kind: "rect", role: "decoration", color: BODY_INK, frame: { x: 538, y: 199, width: 178, height: 1.5 } },
      {
        id: "issue-number",
        label: "Issue number",
        kind: "text",
        role: "label",
        text: "Issue 01",
        frame: { x: 100, y: 214, width: 240, height: 30 },
        fontSize: 18,
        fontFamilies: SERIF_FAMILIES,
        color: INK,
        align: "Left",
        verticalAlign: "Center",
      },
      {
        id: "issue-date",
        label: "Issue date",
        kind: "text",
        role: "label",
        text: "{date}",
        frame: { x: 476, y: 214, width: 240, height: 30 },
        fontSize: 18,
        fontFamilies: SERIF_FAMILIES,
        color: INK,
        align: "Right",
        verticalAlign: "Center",
      },
      { id: "masthead-rule-bottom", label: "Rule", kind: "rect", role: "decoration", color: BODY_INK, frame: { x: 100, y: 252, width: 616, height: 1.5 } },
      { id: "image", label: "Cover photo", kind: "image", role: "image", frame: { x: 80, y: 292, width: 656, height: 540 } },
      {
        id: "title",
        label: "Cover line",
        kind: "text",
        role: "title",
        text: "Where Every Journey Begins",
        frame: { x: 80, y: 846, width: 656, height: 54 },
        fontSize: 28,
        fontFamilies: SERIF_FAMILIES,
        color: INK,
        align: "Center",
        verticalAlign: "Center",
        lineHeight: 1.15,
        autoFit: true,
      },
      // Three teaser stories under the photo card.
      ...[2, 3, 4].flatMap((story, index): TemplateTextSlot[] => {
        const x = 60 + index * 242;
        return [
          {
            id: `teaser${story}-title`,
            label: `Teaser ${index + 1} headline`,
            kind: "text",
            role: "title",
            story,
            text: "Header title here",
            frame: { x, y: 930, width: 212, height: 48 },
            fontSize: 19,
            fontFamilies: SERIF_FAMILIES,
            color: INK,
            align: "Center",
            verticalAlign: "Top",
            lineHeight: 1.2,
          },
          {
            id: `teaser${story}-text`,
            label: `Teaser ${index + 1} text`,
            kind: "text",
            role: "subtitle",
            story,
            text: "Insert your content information text detail here, lorem ipsum dolor si amet.",
            frame: { x, y: 980, width: 212, height: 50 },
            fontSize: 11.5,
            fontFamilies: SERIF_FAMILIES,
            color: BODY_INK,
            align: "Center",
            verticalAlign: "Top",
            lineHeight: 1.35,
            maxChars: 100,
          },
        ];
      }),
    ],
  },
  {
    id: "journer-back-cover",
    name: "Journer back cover",
    description: "Back cover: headline and introduction over a rule, a framed photo or ad with a barcode, and contact, social and location columns.",
    pageTypes: ["BACK_COVER"],
    background: "#f0f2f4",
    slots: [
      { id: "back-panel", label: "Lower panel", kind: "rect", role: "decoration", color: "#c9d5df", frame: { x: 0, y: 600, width: 816, height: 456 } },
      { id: "back-card", label: "Photo card", kind: "rect", role: "decoration", color: "#ffffff", frame: { x: 72, y: 290, width: 672, height: 636 } },
      {
        id: "title",
        label: "Headline",
        kind: "text",
        role: "title",
        text: "Your Back Cover Headline",
        frame: { x: 100, y: 68, width: 616, height: 60 },
        fontSize: 34,
        fontFamilies: SERIF_FAMILIES,
        bold: true,
        color: INK,
        align: "Center",
        verticalAlign: "Center",
        lineHeight: 1.15,
        autoFit: true,
      },
      {
        id: "subtitle",
        label: "Introduction",
        kind: "text",
        role: "subtitle",
        text: "A short introduction to the featured story or a message to readers goes here. Drop an article onto this page to fill the headline, introduction and photo, or select the photo and apply an ad.",
        frame: { x: 100, y: 138, width: 616, height: 92 },
        fontSize: 12.5,
        fontFamilies: SERIF_FAMILIES,
        color: BODY_INK,
        align: "Center",
        verticalAlign: "Top",
        lineHeight: 1.45,
        maxChars: 380,
      },
      ruleSlot("rule-top", 246),
      { id: "image", label: "Photo", kind: "image", role: "image", frame: { x: 88, y: 306, width: 640, height: 548 } },
      ...barcodeSlots({ x: 596, y: 870, width: 132, height: 38 }),
      ...[
        { id: "contact", heading: "Contact Us", text: "Phone: (000) 000-0000\nEmail: hello@example.com" },
        { id: "social", heading: "Get Connected", text: "Facebook · Instagram\nwww.example.com" },
        { id: "location", heading: "Our Location", text: "Street address\nCity, State ZIP" },
      ].flatMap(({ id, heading, text }, index): TemplateTextSlot[] => {
        const x = 60 + index * 242;
        return [
          {
            id: `${id}-heading`,
            label: `${heading} heading`,
            kind: "text",
            role: "label",
            text: heading,
            frame: { x, y: 944, width: 212, height: 30 },
            fontSize: 20,
            fontFamilies: SERIF_FAMILIES,
            color: INK,
            align: "Center",
            verticalAlign: "Center",
          },
          {
            id: `${id}-text`,
            label: `${heading} details`,
            kind: "text",
            role: "label",
            text,
            frame: { x, y: 980, width: 212, height: 48 },
            fontSize: 11.5,
            fontFamilies: SERIF_FAMILIES,
            color: BODY_INK,
            align: "Center",
            verticalAlign: "Top",
            lineHeight: 1.4,
          },
        ];
      }),
    ],
  },
];

// A decorative barcode drawn as thin bars (not a scannable code).
function barcodeSlots(frame: TemplateFrame): TemplateShapeSlot[] {
  const pattern = [2, 1, 1, 3, 2, 1, 4, 1, 1, 2, 3, 1, 2, 2, 1, 1, 3, 2, 1, 4, 2, 1, 1, 3];
  const unit = frame.width / pattern.reduce((sum, value) => sum + value + 1.5, 0);
  const slots: TemplateShapeSlot[] = [];
  let x = frame.x;
  for (const [index, bar] of pattern.entries()) {
    slots.push({
      id: `barcode-${index + 1}`,
      label: "Barcode",
      kind: "rect",
      role: "decoration",
      color: INK,
      frame: { x, y: frame.y, width: bar * unit, height: frame.height },
    });
    x += (bar + 1.5) * unit;
  }
  return slots;
}

export function findIssuePageTemplate(id: string) {
  return ISSUE_PAGE_TEMPLATES.find((template) => template.id === id);
}

export function findTemplateSlot(templateId: string, slotId: string) {
  return findIssuePageTemplate(templateId)?.slots.find((slot) => slot.id === slotId);
}

// Placeholder texts of every template, so restyling never carries a placeholder over as content.
export function isTemplatePlaceholderText(text: string) {
  const value = text.trim();
  return ISSUE_PAGE_TEMPLATES.some((template) =>
    template.slots.some((slot) => slot.kind === "text" && slot.text.trim() === value),
  );
}

export function pageNumberText(slot: TemplateTextSlot, pageNumber: number) {
  return slot.text.replaceAll("{n}", String(pageNumber));
}

// Issue details that "label" slots show.
export type TemplateIssueInfo = { publicationName: string; publicationDate: string };

export function labelText(slot: TemplateTextSlot, info: TemplateIssueInfo | undefined) {
  const date = info?.publicationDate ? new Date(info.publicationDate) : null;
  const dateText =
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      : "Month Year";
  return slot.text.replaceAll("{publication}", info?.publicationName || "Publication").replaceAll("{date}", dateText);
}

// Slots that hold article content (not shapes, page numbers, fixed labels or ad frames).
export function isContentSlot(slot: TemplateSlot) {
  return slot.kind !== "rect" && slot.role !== "pageNumber" && slot.role !== "label" && slot.role !== "ad";
}

export function isAdSlot(slot: TemplateSlot | undefined): slot is TemplateImageSlot & { role: "ad" } {
  return slot?.kind === "image" && slot.role === "ad";
}

// Shortens article text to a slot's character limit, keeping only whole sentences.
export function fitSlotText(slot: TemplateTextSlot, text: string) {
  return slot.maxChars ? fitSentences(text, slot.maxChars) : text;
}

export function slotStory(slot: TemplateSlot) {
  return slot.story ?? 1;
}

// Plain-text paragraphs of a Markdown article body. Subheadings are dropped because they would
// read as body copy in an introduction, caption or pull quote.
export function plainTextParagraphs(markdown: string) {
  return parseArticleMarkdown(markdown)
    .body.filter((paragraph) => !paragraph.heading)
    .map((paragraph) => paragraph.text);
}

// Words whose trailing period does not end a sentence.
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "st", "jr", "sr", "prof", "rev", "gov", "sen", "rep", "gen", "capt", "lt", "col", "sgt",
  "mt", "ft", "ave", "blvd", "rd", "hwy", "inc", "co", "corp", "ltd", "no", "vs", "etc", "approx", "dept", "est",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "a.m", "p.m", "e.g", "i.e", "u.s",
]);

/**
 * Splits text into sentences, each with its closing punctuation and quotes. A period ends a
 * sentence only before whitespace and a capital, digit or quote, and not after an abbreviation
 * or an initial; text without a closing mark is the last "sentence".
 */
export function splitSentences(text: string) {
  const sentences: string[] = [];
  const pattern = /[.!?]+["”’)\]]*(?=\s+["“‘(]?[\p{Lu}\p{N}]|\s*$)/gu;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    const word = text.slice(start, match.index).split(/\s+/).pop()?.toLowerCase().replace(/^["“‘(]+/, "") ?? "";
    if (match[0].startsWith(".") && (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word))) continue;
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/**
 * Shortens text to at most `maxLength` characters without cutting a sentence: it keeps as many
 * leading sentences as fit. When even the first sentence is too long, the first complete
 * sentence that fits is used instead, and failing that the whole first sentence (template frames
 * shrink their text to fit). Text is never cut mid-sentence or given an ellipsis.
 */
export function fitSentences(text: string, maxLength: number) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const sentences = splitSentences(trimmed);
  let fitted = "";
  for (const sentence of sentences) {
    const next = fitted ? `${fitted} ${sentence}` : sentence;
    if (next.length > maxLength) break;
    fitted = next;
  }
  if (fitted) return fitted;
  return sentences.find((sentence) => sentence.length <= maxLength && sentence.length >= Math.min(25, maxLength / 2)) ?? sentences[0] ?? trimmed;
}

// Turns a Markdown article body into a short plain-text caption of whole sentences.
export function plainTextExcerpt(markdown: string, maxLength = 220) {
  return fitSentences(plainTextParagraphs(markdown)[0] ?? "", maxLength);
}

function curlyQuoted(text: string) {
  const unquoted = text.replace(/^["“]+|["”]+$/g, "").trim();
  return unquoted ? `“${unquoted}”` : "";
}

// The article's pull quote: the first blockquote in the body, which is how an editor marks the
// line to highlight. Without one, a sentence is picked, preferring one after the opening
// paragraph so the quote does not repeat the introduction.
export function pullQuoteText(markdown: string) {
  const quote = parseArticleMarkdown(markdown).quotes[0];
  if (quote) return curlyQuoted(quote);
  const paragraphs = plainTextParagraphs(markdown);
  // Only complete sentences (ending in a closing mark) make a pull quote.
  const sentences = (list: string[]) => list.flatMap(splitSentences).filter((sentence) => /[.!?]["”’)\]]*$/.test(sentence));
  const fits = (sentence: string) => sentence.length >= 40 && sentence.length <= 160;
  const sentence =
    sentences(paragraphs.slice(1)).find(fits) ?? sentences(paragraphs).find(fits) ?? fitSentences(paragraphs[0] ?? "", 160);
  return curlyQuoted(sentence);
}

// Joins column texts back into one text. A column that ends mid-sentence was split from the
// next column's paragraph, so those two are joined with a space instead of a paragraph break.
export function joinColumnTexts(columns: RichParagraph[][]) {
  const joined: RichParagraph[] = [];
  for (const column of columns) {
    for (const [index, paragraph] of column.entries()) {
      const previous = joined[joined.length - 1];
      if (index === 0 && previous && !previous.heading && !paragraph.heading && !/[.!?:"”’…)]$/.test(previous.text)) {
        joined[joined.length - 1] = joinParagraphs(previous, paragraph);
      } else {
        joined.push(paragraph);
      }
    }
  }
  return joined;
}

// Rough capacity of a text slot, used to flow one text across several columns. Text blocks do
// not link in CE.SDK, so each column gets its own share of paragraphs.
function slotLineMetrics(slot: TemplateTextSlot) {
  const lineHeight = slot.fontSize * (slot.lineHeight ?? 1.2);
  return {
    lines: Math.max(1, Math.floor(slot.frame.height / lineHeight)),
    // Average serif glyph width is roughly half the font size.
    charsPerLine: Math.max(8, Math.floor(slot.frame.width / (slot.fontSize * 0.52))),
  };
}

// Splits paragraphs into one part per column, in column order. When the text is longer than the
// columns hold, "truncate" ends the last column on its last complete sentence; otherwise the rest is kept in
// the last column (clipped on the page, but not lost if the column is enlarged).
export function flowTextIntoColumns(paragraphs: RichParagraph[], slots: TemplateTextSlot[], overflow: "truncate" | "keep") {
  return flowColumns(paragraphs, slots, overflow).parts;
}

// Fills the columns and returns the text that did not fit, so it can continue on a later page.
export function flowTextWithRest(paragraphs: RichParagraph[], slots: TemplateTextSlot[]) {
  return flowColumns(paragraphs, slots, "split");
}

// Characters a text slot shows before its frame clips lines (with a margin for the estimate),
// or Infinity for slots that grow with their text.
export function slotCharCapacity(slot: TemplateTextSlot) {
  if (!slot.verticalAlign) return Number.POSITIVE_INFINITY;
  const { lines, charsPerLine } = slotLineMetrics(slot);
  return Math.floor(lines * charsPerLine * 0.9);
}

// The longest text a slot takes: its character limit or what its frame holds, whichever is less.
export function slotTextLimit(slot: TemplateTextSlot, fallback = 220) {
  return Math.min(slot.maxChars ?? fallback, slotCharCapacity(slot));
}

// Approximate number of words a set of body columns holds.
export function columnWordCapacity(slots: TemplateTextSlot[]) {
  const chars = slots.reduce((sum, slot) => {
    const { lines, charsPerLine } = slotLineMetrics(slot);
    return sum + lines * charsPerLine;
  }, 0);
  return Math.round(chars / 6.2);
}

// End offset of the last complete sentence of `text` that ends within `limit` characters (0 if none).
function lastSentenceEnd(text: string, limit: number) {
  let end = 0;
  let position = 0;
  for (const sentence of splitSentences(text)) {
    const start = text.indexOf(sentence, position);
    const sentenceEnd = start + sentence.length;
    if (start < 0 || sentenceEnd > limit) break;
    if (/[.!?]["”’)\]]*$/.test(sentence)) end = sentenceEnd;
    position = sentenceEnd;
  }
  return end;
}

function flowColumns(paragraphs: RichParagraph[], slots: TemplateTextSlot[], overflow: "truncate" | "keep" | "split") {
  const parts = slots.map(() => [] as RichParagraph[]);
  const queue = paragraphs.filter((paragraph) => paragraph.text.trim());
  if (slots.length === 0) return { parts, rest: queue };
  let rest: RichParagraph[] = [];
  let column = 0;
  let usedLines = 0;
  while (queue.length > 0 && column < slots.length) {
    const paragraph = queue.shift() as RichParagraph;
    const current = parts[column];
    const { lines, charsPerLine: slotChars } = slotLineMetrics(slots[column]);
    // Larger subheadings fit fewer characters on a line.
    const charsPerLine = Math.max(1, Math.floor(slotChars / (paragraph.scale ?? 1)));
    const previous = current[current.length - 1];
    const gap = previous ? paragraphSeparator(previous, paragraph).length - 1 : 0;
    const available = lines - usedLines - gap;
    const needed = Math.ceil(paragraph.text.length / charsPerLine);
    if (needed <= available) {
      current.push(paragraph);
      usedLines += gap + needed;
      continue;
    }
    const isLast = column === slots.length - 1;
    const room = Math.max(0, available) * charsPerLine;
    const cut = room > 0 ? paragraph.text.lastIndexOf(" ", room) : -1;
    if (isLast) {
      if (overflow === "keep") {
        current.push(paragraph, ...queue);
      } else if (overflow === "split") {
        if (cut > 0 && !paragraph.heading) {
          current.push(sliceParagraph(paragraph, 0, cut));
          rest = [sliceParagraph(paragraph, cut + 1), ...queue];
        } else {
          rest = [paragraph, ...queue];
        }
        // A subheading moves with the text it introduces.
        while (current.length > 1 && current[current.length - 1].heading) rest.unshift(current.pop() as RichParagraph);
      } else {
        // The column ends on the last whole sentence that fits, never mid-sentence.
        const end = paragraph.heading ? 0 : lastSentenceEnd(paragraph.text, room);
        if (end > 0) current.push(sliceParagraph(paragraph, 0, end));
        while (current.length && current[current.length - 1].heading) current.pop();
      }
      queue.length = 0;
      break;
    }
    if (cut > 0 && !paragraph.heading) {
      current.push(sliceParagraph(paragraph, 0, cut));
      queue.unshift(sliceParagraph(paragraph, cut + 1));
    } else {
      queue.unshift(paragraph);
    }
    column += 1;
    usedLines = 0;
  }
  return { parts, rest };
}

// A schematic SVG of the template's slots for the editor's template library.
export function templateThumbnail(template: IssuePageTemplate) {
  const shapes = template.slots.map((slot) => {
    const { x, y, width, height } = slot.frame;
    if (slot.kind === "rect") return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${slot.color}"/>`;
    if (isAdSlot(slot)) {
      const size = Math.min(width / 3, height / 3, 180);
      return `<rect x="${x + 4}" y="${y + 4}" width="${width - 8}" height="${height - 8}" fill="#efe6d2" stroke="#c8b78f" stroke-width="8" stroke-dasharray="24 16"/><text x="${x + width / 2}" y="${y + height / 2 + size * 0.35}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${size}" font-weight="bold" fill="#8a7444">AD</text>`;
    }
    if (slot.kind === "image") {
      const cx = x + width / 2;
      const cy = y + height / 2;
      // The landscape glyph is drawn for a 400 x 260 frame and shrunk to fit smaller frames.
      const s = Math.min(1, width / 400, height / 260);
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#7f9bb3"/><path d="M${cx - 150 * s} ${cy + 90 * s} L${cx - 40 * s} ${cy - 40 * s} L${cx + 30 * s} ${cy + 30 * s} L${cx + 80 * s} ${cy - 10 * s} L${cx + 150 * s} ${cy + 90 * s} Z" fill="#dfe7ee"/><circle cx="${cx + 90 * s}" cy="${cy - 80 * s}" r="${28 * s}" fill="#f3d27a"/>`;
    }
    const lineHeight = slot.fontSize * (slot.lineHeight ?? 1.2);
    if (slot.role === "body") {
      // Body columns render as rows of thin lines with a short last line every few rows.
      const bodyLineHeight = Math.max(lineHeight, 22);
      const rows = Math.max(1, Math.floor(height / bodyLineHeight));
      return Array.from({ length: rows }, (_, index) => {
        const barWidth = width * (index % 6 === 5 ? 0.55 : 0.97);
        return `<rect x="${x}" y="${y + index * bodyLineHeight + 4}" width="${barWidth}" height="9" rx="3" fill="${slot.color}" fill-opacity="0.45"/>`;
      }).join("");
    }
    const lines = Math.max(1, Math.min(4, Math.floor(slot.frame.height / lineHeight)));
    const barHeight = Math.max(6, slot.fontSize * 0.7);
    const top = slot.verticalAlign === "Top" ? y : y + (height - lines * lineHeight) / 2;
    return Array.from({ length: lines }, (_, index) => {
      const barWidth = width * (index === lines - 1 && lines > 1 ? 0.6 : slot.role === "pageNumber" ? 0.35 : 0.9);
      const barX = slot.align === "Left" || slot.align === "Justify" ? x : slot.align === "Right" ? x + width - barWidth : x + (width - barWidth) / 2;
      return `<rect x="${barX}" y="${top + index * lineHeight + (lineHeight - barHeight) / 2}" width="${barWidth}" height="${barHeight}" rx="${barHeight / 3}" fill="${slot.color}"/>`;
    }).join("");
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TEMPLATE_REFERENCE_WIDTH} ${TEMPLATE_REFERENCE_HEIGHT}"><rect width="${TEMPLATE_REFERENCE_WIDTH}" height="${TEMPLATE_REFERENCE_HEIGHT}" fill="${template.background}"/>${shapes.join("")}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

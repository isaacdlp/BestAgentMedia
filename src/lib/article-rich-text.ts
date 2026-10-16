// A small rich-text model that carries an article's formatting (bold, italic, strikethrough,
// underline, subheadings and lists) from its Markdown body into the issue layout editor
// (CE.SDK). Blockquotes are not styled in the layout: they mark the lines an editor wants pulled
// into a template's pull-quote ("highlight") slot, and their text stays in the body as an
// ordinary paragraph.

import { Lexer, type Token, type Tokens } from "marked";

export type TextMarks = { bold?: boolean; italic?: boolean; strike?: boolean; underline?: boolean };

// A styled range of a paragraph's text (UTF-16 offsets, end exclusive). Spans may overlap.
export type TextSpan = TextMarks & { from: number; to: number };

export type RichListStyle = "Unordered" | "Ordered";

export type RichParagraph = {
  text: string;
  spans: TextSpan[];
  list?: RichListStyle;
  // 0 is the outermost list level.
  listLevel?: number;
  // Font size relative to the block's size; subheadings are larger.
  scale?: number;
  heading?: boolean;
};

export type ParsedArticle = {
  body: RichParagraph[];
  // Plain text of each blockquote, in order.
  quotes: string[];
};

const HEADING_SCALE: Record<number, number> = { 2: 1.25, 3: 1.12 };
const MARK_KEYS = ["bold", "italic", "strike", "underline"] as const;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function sameMarks(a: TextMarks, b: TextMarks) {
  return MARK_KEYS.every((key) => !!a[key] === !!b[key]);
}

function hasMarks(marks: TextMarks) {
  return MARK_KEYS.some((key) => marks[key]);
}

// Builds one paragraph's text and spans, collapsing whitespace the way a browser renders it.
class ParagraphBuilder {
  text = "";
  spans: TextSpan[] = [];

  push(raw: string, marks: TextMarks) {
    let text = raw.replace(/\s+/g, " ");
    if (this.text.endsWith(" ") || this.text.length === 0) text = text.replace(/^ /, "");
    if (!text) return;
    const from = this.text.length;
    this.text += text;
    if (!hasMarks(marks)) return;
    const last = this.spans[this.spans.length - 1];
    if (last && last.to === from && sameMarks(last, marks)) last.to = this.text.length;
    else this.spans.push({ ...marks, from, to: this.text.length });
  }

  finish(extra: Omit<RichParagraph, "text" | "spans"> = {}): RichParagraph | null {
    const text = this.text.trimEnd();
    if (!text) return null;
    const spans = this.spans
      .map((span) => ({ ...span, to: Math.min(span.to, text.length) }))
      .filter((span) => span.to > span.from);
    return { text, spans, ...extra };
  }
}

function addInline(builder: ParagraphBuilder, tokens: Token[] | undefined, marks: TextMarks) {
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "strong":
        addInline(builder, (token as Tokens.Strong).tokens, { ...marks, bold: true });
        break;
      case "em":
        addInline(builder, (token as Tokens.Em).tokens, { ...marks, italic: true });
        break;
      case "del":
        addInline(builder, (token as Tokens.Del).tokens, { ...marks, strike: true });
        break;
      case "link":
        // Print has no hyperlinks; the link text keeps its surrounding style.
        addInline(builder, (token as Tokens.Link).tokens, marks);
        break;
      case "image":
      case "html":
        break;
      case "br":
        builder.push(" ", marks);
        break;
      case "codespan":
        builder.push(decodeEntities((token as Tokens.Codespan).text), marks);
        break;
      default: {
        const nested = (token as { tokens?: Token[] }).tokens;
        if (nested?.length) addInline(builder, nested, marks);
        else builder.push(decodeEntities((token as { text?: string }).text ?? ""), marks);
      }
    }
  }
}

function inlineParagraph(tokens: Token[] | undefined, extra?: Omit<RichParagraph, "text" | "spans">, marks: TextMarks = {}) {
  const builder = new ParagraphBuilder();
  addInline(builder, tokens, marks);
  return builder.finish(extra);
}

type BlockContext = { list?: RichListStyle; listLevel?: number; quote?: string[] };

function addBlocks(tokens: Token[], context: BlockContext, out: ParsedArticle) {
  const add = (paragraph: RichParagraph | null) => {
    if (!paragraph) return;
    out.body.push(paragraph);
    context.quote?.push(paragraph.text);
  };
  const listExtra = context.list ? { list: context.list, listLevel: context.listLevel ?? 0 } : {};
  for (const token of tokens) {
    switch (token.type) {
      case "paragraph":
      case "text":
        add(inlineParagraph((token as Tokens.Paragraph).tokens ?? [{ type: "text", raw: token.raw, text: (token as Tokens.Text).text }], listExtra));
        break;
      case "heading": {
        const heading = token as Tokens.Heading;
        // A top-level heading repeats the article title, which has its own slot.
        if (heading.depth <= 1) break;
        add(inlineParagraph(heading.tokens, { heading: true, scale: HEADING_SCALE[heading.depth] ?? 1.05 }, { bold: true }));
        break;
      }
      case "list": {
        const list = token as Tokens.List;
        const level = context.list ? (context.listLevel ?? 0) + 1 : 0;
        for (const item of list.items) {
          addBlocks(item.tokens, { ...context, list: list.ordered ? "Ordered" : "Unordered", listLevel: level }, out);
        }
        break;
      }
      case "blockquote": {
        const lines: string[] = [];
        addBlocks((token as Tokens.Blockquote).tokens, { ...context, quote: lines }, out);
        const quote = lines.join(" ").trim();
        if (quote) out.quotes.push(quote);
        context.quote?.push(...lines);
        break;
      }
      case "code":
        add(plainParagraph((token as Tokens.Code).text, listExtra));
        break;
      case "table": {
        const table = token as Tokens.Table;
        for (const row of [table.header, ...table.rows]) {
          const builder = new ParagraphBuilder();
          row.forEach((cell, index) => {
            if (index > 0) builder.push(" · ", {});
            addInline(builder, cell.tokens, {});
          });
          add(builder.finish(listExtra));
        }
        break;
      }
      default:
        // Spacing, rules, raw HTML and link definitions carry no body text.
        break;
    }
  }
}

function plainParagraph(text: string, extra: Omit<RichParagraph, "text" | "spans"> = {}) {
  const builder = new ParagraphBuilder();
  builder.push(text, {});
  return builder.finish(extra);
}

// Parses a Markdown article body (as saved by the article editor) into styled paragraphs.
export function parseArticleMarkdown(markdown: string): ParsedArticle {
  const out: ParsedArticle = { body: [], quotes: [] };
  try {
    addBlocks(new Lexer({ gfm: true }).lex(markdown.replace(/\r\n/g, "\n")), {}, out);
  } catch {
    // Malformed input falls back to plain paragraphs.
    out.body = markdown
      .split(/\n\s*\n/)
      .map((block) => plainParagraph(block))
      .filter((paragraph): paragraph is RichParagraph => !!paragraph);
  }
  return out;
}

// Plain text that has no formatting, one paragraph per blank-line-separated block.
export function richTextFromPlain(text: string): RichParagraph[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => plainParagraph(block))
    .filter((paragraph): paragraph is RichParagraph => !!paragraph);
}

export function sliceParagraph(paragraph: RichParagraph, from: number, to = paragraph.text.length): RichParagraph {
  const spans = paragraph.spans
    .map((span) => ({ ...span, from: Math.max(span.from, from) - from, to: Math.min(span.to, to) - from }))
    .filter((span) => span.to > span.from);
  return { ...paragraph, text: paragraph.text.slice(from, to), spans };
}

// Joins two parts of one paragraph that was split across columns.
export function joinParagraphs(first: RichParagraph, second: RichParagraph, separator = " "): RichParagraph {
  const offset = first.text.length + separator.length;
  return {
    ...first,
    text: `${first.text}${separator}${second.text}`,
    spans: [...first.spans, ...second.spans.map((span) => ({ ...span, from: span.from + offset, to: span.to + offset }))],
  };
}

export function withSuffix(paragraph: RichParagraph, suffix: string): RichParagraph {
  return { ...paragraph, text: `${paragraph.text}${suffix}` };
}

// Items of one list (including its nested items) sit on adjacent lines; other paragraphs are
// separated by a blank line.
export function paragraphSeparator(previous: RichParagraph, next: RichParagraph) {
  const sameList =
    !!previous.list && !!next.list && (previous.list === next.list || !!previous.listLevel || !!next.listLevel);
  return sameList ? "\n" : "\n\n";
}

export type PlacedParagraph = RichParagraph & {
  // UTF-16 offset of the paragraph's text in the block.
  offset: number;
  // Index of the paragraph in the CE.SDK text block (each "\n" starts a new one).
  index: number;
};

// Lays paragraphs out as the text of one CE.SDK text block.
export function layoutRichText(paragraphs: RichParagraph[]) {
  let text = "";
  let index = 0;
  const placed: PlacedParagraph[] = [];
  paragraphs.forEach((paragraph, position) => {
    if (position > 0) {
      const separator = paragraphSeparator(paragraphs[position - 1], paragraph);
      text += separator;
      index += separator.length;
    }
    placed.push({ ...paragraph, offset: text.length, index });
    text += paragraph.text;
  });
  return { text, paragraphs: placed };
}

// Splits a paragraph's spans into non-overlapping segments with the combined marks of each.
export function markSegments(paragraph: RichParagraph) {
  const bounds = new Set<number>();
  for (const span of paragraph.spans) {
    bounds.add(span.from);
    bounds.add(span.to);
  }
  const points = [...bounds].sort((a, b) => a - b);
  const segments: (TextMarks & { from: number; to: number })[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const marks: TextMarks = {};
    for (const span of paragraph.spans) {
      if (span.from > from || span.to < to) continue;
      for (const key of MARK_KEYS) if (span[key]) marks[key] = true;
    }
    if (hasMarks(marks)) segments.push({ ...marks, from, to });
  }
  return segments;
}

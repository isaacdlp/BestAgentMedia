import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { z } from "zod";
import { articleImageDirectory } from "@/lib/article-images";
import { effortFor } from "@/lib/claude-request";
import type { TaskStep } from "@/lib/agent-task-runner";
import {
  composeIssue,
  countWords,
  describeTemplates,
  MAX_COMPOSED_PAGES,
  repairPlan,
  type CompositionContext,
  type CompositionPlan,
  type ComposedIssue,
} from "@/lib/issue-composition";
import { plainTextExcerpt } from "@/lib/issue-templates";
import { ISSUE_PAGE_TEMPLATES } from "@/lib/issue-templates";

/** Composition is a hard planning problem; Opus 5.5 at high effort balances quality and cost. */
export const DEFAULT_LAYOUT_MODEL = "claude-opus-5-5";
export const DEFAULT_LAYOUT_EFFORT = "high";
export const DEFAULT_LAYOUT_MAX_OUTPUT_TOKENS = 128_000;
// Model turns: the first plan plus revisions after the server's checks.
const MAX_TURNS = 5;
// Lead photos shown to the model so it can choose the cover image.
const MAX_PREVIEW_PHOTOS = 16;

type Effort = NonNullable<Anthropic.OutputConfig["effort"]>;

export type ComposerSettings = { model: string; effort: Effort; maxOutputTokens: number };

export function readComposerSettings(settings: Record<string, unknown>): ComposerSettings {
  const efforts: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  return {
    model: typeof settings.layoutModel === "string" && settings.layoutModel.trim() ? settings.layoutModel.trim() : DEFAULT_LAYOUT_MODEL,
    effort: efforts.includes(settings.layoutEffort as Effort) ? (settings.layoutEffort as Effort) : DEFAULT_LAYOUT_EFFORT,
    maxOutputTokens:
      typeof settings.layoutMaxOutputTokens === "number" && settings.layoutMaxOutputTokens >= 16_000
        ? Math.floor(settings.layoutMaxOutputTokens)
        : DEFAULT_LAYOUT_MAX_OUTPUT_TOKENS,
  };
}

export type ComposerInput = {
  publication: { name: string; zipCodes: string[]; coverImagePath: string | null };
  issue: { name: string; description: string | null; publicationDate: Date };
  context: CompositionContext;
  // Article photo file names, by article ID, in saved order (for the photo previews).
  articlePhotoFiles: Map<string, string[]>;
  instructions: string;
  apiKey: string;
  settings: ComposerSettings;
  log: (level: TaskStep["level"], message: string) => void;
};

export type ComposerResult = {
  contentType: "layout-composition";
  model: string;
  effort: Effort;
  instructions: string;
  turns: number;
  // How the final plan came about: the Designer's own valid plan, or one the server completed.
  outcome: "designer" | "repaired" | "fallback";
  repairs: string[];
  warnings: string[];
  summary: string;
  pageCount: number;
  articleCount: number;
  adCount: number;
  inputTokens: number;
  outputTokens: number;
  plan: CompositionPlan;
  composition: ComposedIssue;
};

const nullableString = { type: ["string", "null"] };

function submitLayoutTool(): Anthropic.Beta.BetaTool {
  return {
    name: "submit_layout",
    description:
      "Submit the complete page plan for the issue, from the front cover to the back cover. The server checks it and simulates the text flow; it answers with the problems to fix, or accepts the plan.",
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "pages"],
      properties: {
        summary: {
          type: "string",
          description: "Two to five sentences for the publication team: the running order and the main choices behind it.",
        },
        pages: {
          type: "array",
          description: "Every page in print order. The first is the COVER, the last the BACK_COVER, all others INNER.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["page_type", "template_id", "stories", "ad_ids", "headline", "intro", "note"],
            properties: {
              page_type: { type: "string", enum: ["COVER", "INNER", "BACK_COVER"] },
              template_id: { type: "string", enum: ISSUE_PAGE_TEMPLATES.map((template) => template.id) },
              stories: {
                type: "array",
                description: "Articles placed in the template's stories.",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["story", "article_id", "headline", "teaser"],
                  properties: {
                    story: { type: "integer", description: "Story number in the template (0 = continued text)." },
                    article_id: { type: "string" },
                    headline: { ...nullableString, description: "Optional cover line or headline; null uses the article title." },
                    teaser: { ...nullableString, description: "Optional teaser for cover and back-cover stories; null uses the article's opening." },
                  },
                },
              },
              ad_ids: { type: "array", items: { type: "string" }, description: "Ads for the template's ad slots, in slot order." },
              headline: { ...nullableString, description: "Back cover only: headline when the page shows an ad instead of a story." },
              intro: { ...nullableString, description: "Back cover only: short introduction under that headline." },
              note: { type: "string", description: "One short line on why this page is laid out this way." },
            },
          },
        },
      },
    },
  };
}

const planInputSchema = z.object({
  summary: z.string().max(4000),
  pages: z
    .array(
      z.object({
        page_type: z.enum(["COVER", "INNER", "BACK_COVER"]),
        template_id: z.string().max(80),
        stories: z
          .array(
            z.object({
              story: z.number().int().min(0).max(20),
              article_id: z.string().max(64),
              headline: z.string().max(200).nullable(),
              teaser: z.string().max(400).nullable(),
            }),
          )
          .max(8),
        ad_ids: z.array(z.string().max(64)).max(8),
        headline: z.string().max(200).nullable(),
        intro: z.string().max(600).nullable(),
        note: z.string().max(600),
      }),
    )
    .max(MAX_COMPOSED_PAGES * 2),
});

function toPlan(input: z.infer<typeof planInputSchema>): CompositionPlan {
  return {
    summary: input.summary.trim(),
    pages: input.pages.map((page) => ({
      type: page.page_type,
      templateId: page.template_id,
      stories: page.stories.map((entry) => ({
        story: entry.story,
        articleId: entry.article_id,
        headline: entry.headline,
        teaser: entry.teaser,
      })),
      adIds: page.ad_ids,
      headline: page.headline,
      intro: page.intro,
      note: page.note.trim(),
    })),
  };
}

const SYSTEM_PROMPT = `You are the Designer at Best Version Media, which publishes premium, professionally printed community magazines mailed to every home in a local area. You compose complete issues: you decide the running order and choose a page template for every page, then assign the issue's articles to the templates' stories and its ads to their ad slots. You never invent articles, facts, quotes or ads. The only words you write are optional cover lines, cover teasers, and a back-cover headline and introduction, all drawn from the articles and ads you are given.

You submit the layout with the submit_layout tool. The server checks the plan and simulates exactly how every article's text flows through the body columns, then either accepts it or lists what to fix. When it lists problems, fix all of them and call submit_layout again with the complete corrected plan.`;

function rules(adCount: number) {
  return `How composition works
- Page 1 is the COVER and uses "journer-cover"; the last page is the BACK_COVER and uses "journer-back-cover". Every page in between is INNER. Use as many inner pages as the content needs (at most ${MAX_COMPOSED_PAGES - 2}), and no empty or filler pages.
- Each template has numbered stories. A story groups a headline, an introduction or caption, photos, a pull quote and body columns. "bodyWords" estimates how many words a story's columns hold; the server's simulation is exact, so use its feedback to adjust.
- Every article must be printed in full on inner pages. An article's first inner placement shows its title, opening and photos, and its text then flows automatically, in page order, through every later story assigned to the same article. A long article therefore continues on later pages: give it more stories (for example "text-columns", a "quarter-page-ad" or "half-page-ad" story, or story 0 of "two-stories", which exists only for text continued from an earlier page). Continuation headlines read "<title> (continued)" automatically.
- Every photo is printed once in the issue. The cover's lead story and a featured back-cover story each take one of their article's photos; the inner pages use the article's remaining photos in order. An article leading the cover or back cover should therefore have a spare photo; one with a single photo cannot also show it inside. Photo slots, and ad slots whose ad has no artwork, that still have no photo are filled with an unused photo of another article, so prefer templates whose photo slots an article can fill itself. Articles without photos suit "text-columns", "half-page-ad" and "quarter-page-ad".
- Avoid blank areas: when a template has two columns, give the story enough text for both, or choose a template with fewer columns.
- Cover: story 1 is the lead (cover photo and cover line, best from a story with a strong photo); stories 2 to 4 are teasers (headline and a teaser of at most 100 characters), each for a different article than the lead and each other; leave teaser stories out when there are not enough articles. Cover and back-cover stories are teasers only; they do not count as printing the article.
- Back cover: either feature one article in story 1, or put one ad (full or half page suits best) in its photo frame and write the page "headline" and "intro" (for example a thank-you to local sponsors or an invitation to advertise; never invent contact details).
- Ads: ${adCount ? "every ad must be placed exactly once, in an ad slot of its size" : "this issue has no ads"}. Full page: "full-page-ad" (or the back cover). Half page: "half-page-ad" or "two-half-page-ads". Quarter page or business card: "quarter-page-ad" or "four-quarter-page-ads". Every ad slot of a chosen template must be filled, and every story of an inner template must have an article.

Editorial judgement
- Open the inner pages with the strongest, most local and timely story; vary templates so consecutive pages do not look the same; spread ads through the issue rather than bunching them at the back, and keep an article's continuation close to its start.
- Sponsored features (articles with a sponsoredStyle) were paid for by a business: give them a complete, prominent placement and never put a competitor's ad on the same page.
- Articles in Draft status are still included; mention it in the page note so the team checks them before printing.
- Headlines and teasers you write must be accurate to the article, short, and free of invented facts.`;
}

async function photoPreview(file: string) {
  try {
    const buffer = await readFile(resolve(articleImageDirectory, file));
    const resized = await sharp(buffer, { limitInputPixels: 40_000_000 })
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    return resized.toString("base64");
  } catch {
    return null;
  }
}

async function coverPreview(coverImagePath: string | null) {
  const filename = coverImagePath?.match(/^media\/publications\/([a-z0-9-]+\.(?:png|jpe?g))$/i)?.[1];
  if (!filename) return null;
  try {
    const buffer = await readFile(resolve(process.cwd(), "media", "publications", filename));
    const resized = await sharp(buffer).resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    return resized.toString("base64");
  } catch {
    return null;
  }
}

async function buildUserContent(input: ComposerInput) {
  const { publication, issue, context } = input;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const cover = await coverPreview(publication.coverImagePath);
  if (cover) {
    content.push({ type: "text", text: `A recent cover of ${publication.name}, for its look and tone:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: cover } });
    input.log("info", "Added the publication cover as a style reference");
  }
  let previews = 0;
  for (const article of context.articles) {
    const file = input.articlePhotoFiles.get(article.id)?.[0];
    if (!file || previews >= MAX_PREVIEW_PHOTOS) continue;
    const data = await photoPreview(file);
    if (!data) continue;
    content.push({ type: "text", text: `First photo of article ${article.id} ("${article.title}"):` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
    previews += 1;
  }
  if (previews) input.log("info", `Added ${previews} lead photo preview(s) so the Designer can choose the cover image`);

  const articles = context.articles.map((article) => ({
    id: article.id,
    title: article.title,
    status: article.status,
    words: countWords(article.body),
    photos: article.imageUrls.length,
    sponsoredStyle: article.sponsoredStyle,
    business: article.businessName,
    opening: plainTextExcerpt(article.body, 600),
  }));
  const ads = context.ads.map((ad) => ({
    id: ad.id,
    title: ad.title,
    business: ad.businessName,
    size: ad.size,
    status: ad.status,
    hasArtwork: !!ad.imageUrl,
  }));
  const data = {
    publication: { name: publication.name, zipCodes: publication.zipCodes },
    issue: {
      name: issue.name,
      description: issue.description,
      publicationDate: issue.publicationDate.toISOString().slice(0, 10),
    },
    templates: describeTemplates(),
    articles,
    ads,
  };
  content.push({
    type: "text",
    text: `Compose the complete layout of this issue. It has ${articles.length} article(s) and ${ads.length} ad(s), and every one of them must appear.

${rules(ads.length)}

<issue_data>
${JSON.stringify(data, null, 2)}
</issue_data>
${
  input.instructions
    ? `
<editor_instructions>
${input.instructions}
</editor_instructions>
These instructions from the publication's editor take precedence over the editorial judgement above, but not over the rules on how composition works (every article in full, every ad exactly once, every slot filled).
`
    : ""
}
Plan the whole issue, then call submit_layout with every page.`,
  });
  return content;
}

function fallbackModels(model: string) {
  // Server-side refusal fallbacks are supported on the current top models.
  return /^claude-(fable-5|mythos-5|opus-5|sonnet-5-5)/.test(model);
}

/** Runs the Designer: Claude plans the issue, the server checks and simulates each plan. */
export async function composeIssueLayout(input: ComposerInput): Promise<ComposerResult> {
  const { context, settings, log } = input;
  const client = new Anthropic({ apiKey: input.apiKey });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: await buildUserContent(input) }];
  const tools = [submitLayoutTool()];
  let inputTokens = 0;
  let outputTokens = 0;
  let accepted: { plan: CompositionPlan; warnings: string[] } | null = null;
  let lastPlan: CompositionPlan | null = null;
  // The latest plan that passed every check (it may still have notes).
  let lastValid: { plan: CompositionPlan; warnings: string[] } | null = null;
  let warningsShown = false;
  let turns = 0;

  for (; turns < MAX_TURNS && !accepted; ) {
    turns += 1;
    log("info", turns === 1 ? `Composing with ${settings.model} (effort ${settings.effort})…` : `Revising the plan (turn ${turns})…`);
    const stream = client.beta.messages.stream({
      model: settings.model,
      max_tokens: settings.maxOutputTokens,
      thinking: { type: "adaptive" },
      output_config: effortFor(settings.model, settings.effort),
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools,
      tool_choice: { type: "auto" },
      messages,
      ...(fallbackModels(settings.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const message = await stream.finalMessage();
    inputTokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    outputTokens += message.usage.output_tokens;
    if (message.model !== settings.model) log("info", `This turn was answered by ${message.model} (refusal fallback)`);
    if (message.stop_reason === "refusal") {
      throw new Error(`The model declined to compose the layout${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : "."}`);
    }
    if (message.stop_reason === "max_tokens") {
      log("error", "The response hit the output limit before the plan was complete");
      break;
    }
    messages.push({ role: "assistant", content: message.content });

    const calls = message.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use" && block.name === "submit_layout",
    );
    if (!calls.length) {
      // A reply without a new plan after warnings means the Designer keeps the last valid one.
      if (lastValid) {
        accepted = lastValid;
        break;
      }
      messages.push({ role: "user", content: "Call submit_layout with the complete plan for every page." });
      continue;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const [index, call] of calls.entries()) {
      if (index > 0) {
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "Submit one plan at a time; only the first call was checked." });
        continue;
      }
      const parsed = planInputSchema.safeParse(call.input);
      if (!parsed.success) {
        log("error", "The plan did not match the expected structure; asking for a corrected one");
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          is_error: true,
          content: `The plan is incomplete or malformed: ${parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. Submit the complete plan again.`,
        });
        continue;
      }
      const plan = toPlan(parsed.data);
      lastPlan = plan;
      const { errors, warnings } = composeIssue(plan, context);
      if (errors.length) {
        log("info", `Plan ${turns}: ${plan.pages.length} pages, ${errors.length} problem(s) to fix`);
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          is_error: true,
          content: `The plan has ${errors.length} problem(s). Fix all of them and call submit_layout again with the complete plan:\n${errors.map((error) => `- ${error}`).join("\n")}${
            warnings.length ? `\n\nAlso worth improving:\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : ""
          }`,
        });
      } else if (warnings.length && !warningsShown && turns < MAX_TURNS) {
        warningsShown = true;
        lastValid = { plan, warnings };
        log("info", `Plan ${turns}: valid with ${warnings.length} note(s); giving the Designer one chance to refine it`);
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `The plan is valid (${plan.pages.length} pages). Notes:\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n\nIf you can resolve these without breaking the rules, call submit_layout again with the improved complete plan. Otherwise reply "keep" and this plan is used.`,
        });
      } else {
        log("success", `Plan ${turns} accepted: ${plan.pages.length} pages`);
        accepted = { plan, warnings };
        results.push({ type: "tool_result", tool_use_id: call.id, content: "Accepted." });
      }
    }
    if (!accepted) messages.push({ role: "user", content: results });
  }

  let plan: CompositionPlan;
  let repairs: string[] = [];
  let outcome: ComposerResult["outcome"] = "designer";
  accepted ??= lastValid;
  if (accepted) {
    plan = accepted.plan;
  } else {
    outcome = lastPlan ? "repaired" : "fallback";
    log("info", lastPlan ? "The Designer's last plan still had problems; completing it automatically" : "No usable plan was returned; building a layout automatically");
    const repaired = repairPlan(lastPlan ?? { summary: "", pages: [] }, context);
    plan = repaired.plan;
    repairs = repaired.changes;
    if (!plan.summary) plan.summary = "Automatic layout: every article and ad in its own pages, in the order they were assigned.";
    for (const change of repairs) log("info", `Repair: ${change}`);
  }

  const composed = composeIssue(plan, context, { strict: outcome === "designer" });
  if (composed.errors.length) {
    throw new Error(`The layout could not be completed: ${composed.errors.slice(0, 3).join(" ")}`);
  }
  const articleCount = new Set(composed.issue.pages.flatMap((page) => (page.type === "INNER" ? page.articleIds : []))).size;
  const adCount = new Set(composed.issue.pages.flatMap((page) => page.adIds)).size;
  log(
    "success",
    `Layout composed: ${composed.issue.pages.length} pages with ${articleCount}/${context.articles.length} articles and ${adCount}/${context.ads.length} ads`,
  );
  return {
    contentType: "layout-composition",
    model: settings.model,
    effort: settings.effort,
    instructions: input.instructions,
    turns,
    outcome,
    repairs,
    warnings: composed.warnings,
    summary: plan.summary,
    pageCount: composed.issue.pages.length,
    articleCount,
    adCount,
    inputTokens,
    outputTokens,
    plan,
    composition: composed.issue,
  };
}

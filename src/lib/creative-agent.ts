import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import {
  PRINT_DPI,
  closestGeminiAspectRatio,
  describePrintSize,
  parseStoredPrintSpec,
  printPixels,
  resolveAdPrintSize,
  type AdPrintSpec,
  type ResolvedAdPrintSpec,
} from "@/lib/ad-print-specs";
import { prisma } from "@/lib/db";
import { launchAgentTask, step, type TaskStep } from "@/lib/agent-task-runner";
import type { RegistryTaskRef } from "@/lib/tasks";

export const creativeImageDirectory = resolve(process.cwd(), "media", "creative");

const DEFAULT_GENERIC_INSTRUCTIONS =
  "Upscale and sharpen the image to the highest possible resolution and clarity. " +
  "Correct exposure, white balance, and color grading for professional print reproduction. " +
  "Remove noise, grain, JPEG artifacts, and compression banding. " +
  "Enhance contrast and microcontrast so fine details read clearly on a printed page. " +
  "Ensure skin tones are natural and neutral backgrounds are clean. " +
  "Make the image look polished and editorial — suitable for the cover or inside spread of a community lifestyle magazine.";

export type ImageType = "submission" | "article" | "business" | "ad" | "publication";

export type CreativeTaskResult = {
  trigger: "enhance" | "generate-ad";
  imageType: ImageType;
  imageId: string;
  parentId: string;
  originalFileName: string;
  originalDir: "submissions" | "articles" | "businesses" | "ads" | "publications";
  originalMimeType: string;
  enhancedFileName: string;
  enhancedMimeType: string;
  enhancedSize: number;
  genericInstructions: string;
  customInstructions: string;
  status: "pending_review" | "accepted_overwrite" | "accepted_keep" | "discarded" | "iterating";
  iterateFromTaskId?: string;
  /** Ad generation only: the ad images used as references, so the task can be iterated. */
  referenceImageIds?: string[];
  /** Ad generation only: the print size the ad was made at, kept when it is iterated. */
  printSpec?: AdPrintSpec;
};

async function getCreativeAgent() {
  const agent = await prisma.agent.findUnique({
    where: { slug: "creative" },
    select: { id: true, enabled: true, settings: true },
  });
  if (!agent) throw new Error("Creative agent is not configured. Run the database seed.");
  if (!agent.enabled) throw new Error("The Creative agent is currently disabled. Enable it in the Agents section.");

  const geminiKey = process.env.GEMINI_KEY;
  if (!geminiKey?.trim()) throw new Error("GEMINI_KEY is not configured in the environment.");

  const settings = (agent.settings as Record<string, unknown>) ?? {};
  const geminiModel = typeof settings.model === "string" ? settings.model : "gemini-3-pro-image";
  return { agentId: agent.id, settings, geminiKey, geminiModel };
}

function instructionsStep(customInstructions: string, fallback: string): TaskStep {
  return step(
    "info",
    customInstructions.trim()
      ? `Custom instructions provided: "${customInstructions.slice(0, 80)}${customInstructions.length > 80 ? "…" : ""}"`
      : fallback,
  );
}

async function generateGeminiImage({
  geminiKey,
  geminiModel,
  prompt,
  images,
  imageConfig,
  failureMessage,
}: {
  geminiKey: string;
  geminiModel: string;
  prompt: string;
  images: { mimeType: string; data: string }[];
  imageConfig?: { aspectRatio?: string; imageSize?: string };
  failureMessage: string;
}): Promise<{ data: string; mimeType: string }> {
  type GeminiResponse = {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> };
      finishReason?: string;
    }>;
    error?: { message: string; code: number };
  };

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
  try {
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, ...images.map((inlineData) => ({ inlineData }))] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"], ...(imageConfig ? { imageConfig } : {}) },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "(no body)");
      throw new Error(`Gemini API returned ${response.status}: ${errorText.slice(0, 300)}`);
    }

    const data = (await response.json()) as GeminiResponse;
    if (data.error) throw new Error(`Gemini API error: ${data.error.message}`);

    const imagePart = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!imagePart?.inlineData) {
      throw new Error(
        "Gemini did not return an image in the response. The model may not support image output for this request.",
      );
    }
    return imagePart.inlineData;
  } catch (error) {
    // Never surface the request URL, which carries the API key.
    throw new Error(error instanceof Error ? error.message : failureMessage);
  }
}

async function saveCreativeImage(image: { data: string; mimeType: string }) {
  await mkdir(creativeImageDirectory, { recursive: true });
  const ext = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png";
  const fileName = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(image.data, "base64");
  await writeFile(resolve(creativeImageDirectory, fileName), buffer, { flag: "wx" });
  return { fileName, size: buffer.byteLength };
}

/**
 * Scales and centre-crops a generated image to the exact print size and tags it at PRINT_DPI.
 * The model renders at the closest supported aspect ratio, so only a few percent is cropped.
 */
async function fitToPrintSize(image: { data: string; mimeType: string }, size: { width: number; height: number }) {
  const input = sharp(Buffer.from(image.data, "base64"));
  const { width: sourceWidth = 0, height: sourceHeight = 0 } = await input.metadata();
  const buffer = await input
    .resize(size.width, size.height, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .withMetadata({ density: PRINT_DPI })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { image: { data: buffer.toString("base64"), mimeType: "image/jpeg" }, sourceWidth, sourceHeight };
}

/**
 * Launches an image enhancement Task. Configuration problems are thrown immediately; the
 * Gemini call runs in the background and the result waits on the task page for review.
 */
export async function launchEnhanceImage({
  imageType,
  imageId,
  parentId,
  originalFileName,
  originalDir,
  originalMimeType,
  customInstructions,
  triggeredById,
  iterateFromTaskId,
}: {
  imageType: ImageType;
  imageId: string;
  parentId: string;
  originalFileName: string;
  originalDir: CreativeTaskResult["originalDir"];
  originalMimeType: string;
  customInstructions: string;
  triggeredById?: string;
  iterateFromTaskId?: string;
}): Promise<RegistryTaskRef> {
  const { agentId, settings, geminiKey, geminiModel } = await getCreativeAgent();
  const genericInstructions =
    typeof settings.genericInstructions === "string" && settings.genericInstructions.trim()
      ? settings.genericInstructions.trim()
      : DEFAULT_GENERIC_INSTRUCTIONS;

  const steps: TaskStep[] = [
    step("info", `Trigger: image enhancement for ${imageType} image (id: ${imageId})`),
    step("info", `Parent: ${imageType} ${parentId}`),
    instructionsStep(customInstructions, "No custom instructions — using generic enhancement profile only"),
  ];

  let sourceFilePath = resolve(process.cwd(), "media", originalDir, originalFileName);
  let sourceMimeType = originalMimeType;
  if (iterateFromTaskId) {
    const prevTask = await prisma.agentTask.findUnique({
      where: { id: iterateFromTaskId },
      select: { result: true, agentId: true },
    });
    if (!prevTask || prevTask.agentId !== agentId) {
      throw new Error("Referenced iteration task not found or does not belong to the Creative agent.");
    }
    const prevResult = prevTask.result as CreativeTaskResult | null;
    if (!prevResult?.enhancedFileName) {
      throw new Error("The previous task has no enhanced image to iterate from.");
    }
    sourceFilePath = resolve(creativeImageDirectory, prevResult.enhancedFileName);
    sourceMimeType = prevResult.enhancedMimeType;
    steps.push(step("info", `Iterating from task ${iterateFromTaskId} — using its enhanced output as source`));
  }

  return launchAgentTask({
    agentId,
    label: `Image enhancement — ${imageType} · ${originalFileName}`,
    ...(imageType === "submission" || imageType === "article" || imageType === "ad"
      ? { subject: { type: imageType, id: parentId } }
      : {}),
    triggeredById,
    steps,
    work: async ({ log }) => {
      let imageBuffer: Buffer;
      try {
        imageBuffer = await readFile(sourceFilePath);
      } catch {
        throw new Error("Source image file not found on disk.");
      }

      log("info", `Calling Gemini API (model: ${geminiModel})…`);
      const prompt =
        `You are a professional photo editor at Best Version Media, a premium local lifestyle magazine publisher.\n\n` +
        `Your task is to enhance the provided image for professional magazine publication.\n\n` +
        `Generic enhancement requirements:\n${genericInstructions}` +
        (customInstructions.trim() ? `\n\nAdditional editor instructions:\n${customInstructions.trim()}` : "") +
        `\n\nReturn only the enhanced image. Maintain the original subject, composition, and story — improve only technical quality and visual presentation.`;

      const enhanced = await generateGeminiImage({
        geminiKey,
        geminiModel,
        prompt,
        images: [{ mimeType: sourceMimeType, data: imageBuffer.toString("base64") }],
        failureMessage: "Image enhancement failed.",
      });
      const saved = await saveCreativeImage(enhanced);
      log("success", `Enhanced image saved — ${saved.fileName} (${(saved.size / 1024).toFixed(1)} KB, ${enhanced.mimeType})`);
      log("success", "Pending editor review — no original modified yet");

      const result: CreativeTaskResult = {
        trigger: "enhance",
        imageType,
        imageId,
        parentId,
        originalFileName,
        originalDir,
        originalMimeType,
        enhancedFileName: saved.fileName,
        enhancedMimeType: enhanced.mimeType,
        enhancedSize: saved.size,
        genericInstructions,
        customInstructions: customInstructions.trim(),
        status: "pending_review",
        ...(iterateFromTaskId ? { iterateFromTaskId } : {}),
      };
      return result;
    },
  });
}

const DEFAULT_AD_GENERATION_INSTRUCTIONS =
  "Design a high-quality, print-ready advertisement for a premium, professionally printed local lifestyle magazine. " +
  "Compose the layout professionally with a clear visual hierarchy: headline, imagery, supporting copy, call to action, and the business's identity and booking details. " +
  "Use the provided reference images as primary visual material. " +
  "Typography must be crisp, correctly spelled, and legible at its printed size; use a restrained palette and generous white space. " +
  "The overall design should feel polished, local, and trustworthy — on par with national-brand ads in an upscale magazine.";

/** Everything the Creative knows about the ad it designs, loaded by the generate-ad route. */
export type AdGenerationContext = {
  ad: { id: string; title: string; description: string | null };
  /** The rate the ad was priced on; null when no style was chosen. */
  style: { name: string; description: string | null; publicationName: string | null } | null;
  business: {
    name: string;
    description: string | null;
    primaryCategory: string | null;
    categories: string[];
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
  };
  publications: { name: string; description: string | null; zipCodes: string[] }[];
  issues: { name: string; publicationName: string; publicationDate: string; description: string | null }[];
  /** The advertiser's reviews of the ad, oldest first (empty when not requested). */
  reviews: {
    number: number;
    date: string;
    decision: "APPROVED" | "CHANGES_REQUESTED";
    comments: string;
    /** Whether the review was made on the artwork the ad has now. */
    onCurrentArtwork: boolean;
  }[];
};

/** Most recent reviews passed to the Creative; older ones are summarized by count. */
const MAX_PROMPT_REVIEWS = 10;

function reviewsSection(reviews: AdGenerationContext["reviews"]): string | null {
  if (!reviews.length) return null;
  const recent = reviews.slice(-MAX_PROMPT_REVIEWS);
  const lines = recent.map(
    (r) =>
      `- Review #${r.number} (${r.date}, ${r.onCurrentArtwork ? "on the current artwork" : "on an earlier version"}): ` +
      `${r.decision === "APPROVED" ? "APPROVED" : "CHANGES REQUESTED"}${r.comments ? ` — "${r.comments.replace(/\s+/g, " ").slice(0, 1000)}"` : ""}`,
  );
  return (
    `ADVERTISER REVIEWS (the client's feedback on this ad, oldest first; later reviews take precedence${reviews.length > recent.length ? `; ${reviews.length - recent.length} older review(s) omitted` : ""})\n` +
    `${lines.join("\n")}\n` +
    "- Apply every change the advertiser requested that has not been superseded, and keep what they approved. " +
    "Use new contact details, prices or offers only when the advertiser wrote them here, character for character; the mandatory content rules still apply."
  );
}

const PRINT_SIZE_SOURCES: Record<ResolvedAdPrintSpec["source"], string> = {
  instructions: "as requested in the editor's instructions",
  previous: "same size as the version being revised",
  style: "from the ad's style",
  default: "default half page — no size given by the style or the editor",
};

function adContextSections(
  { ad, style, business, publications, issues }: AdGenerationContext,
  { spec, source }: ResolvedAdPrintSpec,
): string {
  const field = (label: string, value: string | null | undefined) => (value?.trim() ? `- ${label}: ${value.trim()}` : null);
  const lines = (...items: (string | null)[]) => items.filter(Boolean).join("\n");

  const adSection = lines(
    field("Headline / ad name", ad.title),
    field("Ad copy / brief", ad.description),
    field("Style (purchased size)", style ? `${style.name}${style.publicationName ? ` (${style.publicationName} rate card)` : ""}` : "not chosen"),
    field("Style description", style?.description),
    `- Printed size: ${describePrintSize(spec)} (${PRINT_SIZE_SOURCES[source]})`,
  );

  const businessSection = lines(
    field("Name", business.name),
    field("Category", [business.primaryCategory, ...business.categories.filter((c) => c !== business.primaryCategory)].filter(Boolean).join(", ")),
    field("Description", business.description),
    field("Address", business.address),
    field("Phone", business.phone),
    field("Website", business.website?.replace(/^https?:\/\//i, "").replace(/\/$/, "")),
    field("Email", business.email),
  );

  const publicationSection = publications.length
    ? publications
        .map((p) =>
          lines(
            `- ${p.name}${p.zipCodes.length ? ` — distributed to homes in ZIP code${p.zipCodes.length === 1 ? "" : "s"} ${p.zipCodes.join(", ")}` : ""}`,
            p.description?.trim() ? `  About: ${p.description.trim()}` : null,
          ),
        )
        .join("\n")
    : "- Not assigned to a publication yet";

  const issueSection = issues.length
    ? issues
        .map((i) => `- ${i.publicationName} · ${i.name} (publication date ${i.publicationDate})${i.description?.trim() ? ` — ${i.description.trim()}` : ""}`)
        .join("\n")
    : "- Not assigned to an issue yet";

  return (
    `ADVERTISEMENT\n${adSection}\n\n` +
    `ADVERTISER\n${businessSection}\n\n` +
    `PUBLICATION (context only)\n${publicationSection}\n\n` +
    `ISSUE(S) (context only)\n${issueSection}`
  );
}

function printRules(spec: AdPrintSpec): string {
  const { width, height } = printPixels(spec);
  const ratio = `${spec.widthIn}:${spec.heightIn}`;
  return [
    `- The ad will be printed in the magazine at exactly ${spec.widthIn} in wide x ${spec.heightIn} in high (${spec.orientation}, width:height ${ratio}; delivered at ${width} x ${height} px, ${PRINT_DPI} dpi). Compose the canvas for exactly that ${spec.orientation} proportion; the delivered image is trimmed to it.`,
    spec.fullBleed
      ? `- Full-page, full-bleed ad: extend the background and imagery to every edge of the canvas. Keep the headline, copy, logo and contact details at least ${spec.safeInsetIn} in from every edge, because the outer edges are trimmed at the bindery.`
      : `- Fractional ad that sits on a page beside editorial content: fill the whole canvas edge to edge with the ad's own background so it reads as a self-contained box. Keep the headline, copy, logo and contact details at least ${spec.safeInsetIn} in from every edge.`,
    `- Content scaled to the size: ${spec.copyGuidance}. Do not crowd the space; cut copy rather than shrink it.`,
    `- Smallest text must still read at ${spec.minBodyPt} pt at the printed size; headlines clearly larger. Avoid thin hairline type and small reversed-out text.`,
    `- Do not draw borders, frames, crop marks, bleed guides, page numbers, mock-up surroundings, or explanatory notes — deliver only the ad artwork itself, flat and front-on.`,
  ].join("\n");
}

const CONTENT_RULES = [
  "- This is a print ad: no clickable buttons, QR codes, social-media icons, \"click here\", \"tap\" or \"swipe\" wording. Calls to action are spoken or visited: \"Call to book\", \"Visit us\", \"Reserve your table\".",
  "- For booking, show the business's phone number, street address and/or website exactly as given above, character for character. Choose the details that fit the space and the business (a phone number for appointments, an address for walk-in shops). Never invent, guess or alter a phone number, address, website, price, offer, award or date that is not given above.",
  "- The publication and issue details are context for tone, audience and season only. Do not quote text from the publication or issue, and do not print the publication's name, masthead or issue date in the ad.",
  "- Spell the business name exactly as given. Use the ad's headline and brief as the basis for the copy; tighten the wording if needed, but do not change the offer.",
].join("\n");

const REVISION_BRIEF =
  "The FIRST attached image is the previous version of this advertisement; any further images are the original reference images. " +
  "Revise the previous version rather than starting over: keep its layout, imagery, palette and copy wherever they work, and change what the editor's instructions below ask for. " +
  "Fix any misspellings, illegible text or rule violations you notice. If no instructions are given, refine its typography, hierarchy and finish for print.";

/**
 * Launches an ad generation Task; the generated image waits on the task page for review.
 * With `iterateFromTaskId`, the Creative revises that task's generated ad instead of starting over.
 */
export async function launchGenerateAd({
  context,
  images,
  customInstructions,
  triggeredById,
  iterateFromTaskId,
}: {
  context: AdGenerationContext;
  images: { id: string; fileName: string; mimeType: string; originalName: string }[];
  customInstructions: string;
  triggeredById?: string;
  iterateFromTaskId?: string;
}): Promise<RegistryTaskRef> {
  const { agentId, settings, geminiKey, geminiModel } = await getCreativeAgent();
  const genericInstructions =
    typeof settings.adGenerationInstructions === "string" && settings.adGenerationInstructions.trim()
      ? settings.adGenerationInstructions.trim()
      : DEFAULT_AD_GENERATION_INSTRUCTIONS;

  const { ad, business } = context;

  let previous: { fileName: string; mimeType: string; spec: AdPrintSpec | null } | null = null;
  if (iterateFromTaskId) {
    const prevTask = await prisma.agentTask.findUnique({
      where: { id: iterateFromTaskId },
      select: { result: true, agentId: true },
    });
    const prevResult = prevTask?.result as CreativeTaskResult | null;
    if (!prevTask || prevTask.agentId !== agentId || prevResult?.trigger !== "generate-ad" || prevResult.parentId !== ad.id) {
      throw new Error("Referenced iteration task not found for this advertisement.");
    }
    if (!prevResult.enhancedFileName || (prevResult.status !== "pending_review" && prevResult.status !== "iterating")) {
      throw new Error("The previous task has no generated ad left to iterate from.");
    }
    previous = {
      fileName: prevResult.enhancedFileName,
      mimeType: prevResult.enhancedMimeType,
      spec: parseStoredPrintSpec(prevResult.printSpec),
    };
  }

  const printSize = resolveAdPrintSize({
    customInstructions,
    previous: previous?.spec,
    styleName: context.style?.name,
    styleDescription: context.style?.description,
  });
  const { spec } = printSize;
  const pixels = printPixels(spec);
  const aspectRatio = closestGeminiAspectRatio(spec);
  // Gemini 3 image models can render at 4K; older ones reject imageSize.
  const imageConfig = /gemini-3/i.test(geminiModel) ? { aspectRatio, imageSize: "4K" } : { aspectRatio };

  const steps: TaskStep[] = [
    step("info", `Trigger: ad generation for advertisement ${ad.id} — "${ad.title}"`),
    step("info", `Business: ${business.name} · using ${images.length} reference image(s)`),
    ...(iterateFromTaskId
      ? [step("info", `Iterating from task ${iterateFromTaskId} — revising its generated ad`)]
      : []),
    step(
      "info",
      `Style: ${context.style?.name ?? "none"} → ${describePrintSize(spec)} (${PRINT_SIZE_SOURCES[printSize.source]})`,
    ),
    step(
      "info",
      `Context: ${context.publications.map((p) => p.name).join(", ") || "no publication"} · ${context.issues.length} issue(s)` +
        ` · booking details: ${[business.phone && "phone", business.address && "address", business.website && "website"].filter(Boolean).join(", ") || "none on file"}`,
    ),
    instructionsStep(customInstructions, "No custom instructions — using default ad generation profile"),
    step(
      "info",
      context.reviews.length
        ? `Advertiser reviews included: ${context.reviews.length} (latest: ${context.reviews[context.reviews.length - 1].decision === "APPROVED" ? "approved" : "changes requested"})`
        : "No advertiser reviews included",
    ),
  ];

  const prompt =
    `You are a senior print advertising designer at Best Version Media, a publisher of premium, professionally printed local lifestyle magazines mailed to homes in their community.\n\n` +
    `${previous ? "Revise" : "Design"} the advertisement described below. It will be printed on paper in the magazine, never shown on screen.\n\n` +
    (previous ? `REVISION\n${REVISION_BRIEF}\n\n` : "") +
    `${adContextSections(context, printSize)}\n\n` +
    (reviewsSection(context.reviews) ? `${reviewsSection(context.reviews)}\n\n` : "") +
    `PRINT SIZE\n${printRules(spec)}\n\n` +
    `CONTENT RULES — MANDATORY\n${CONTENT_RULES}\n\n` +
    `DESIGN DIRECTION\n${genericInstructions}` +
    (customInstructions.trim()
      ? `\n\nADDITIONAL INSTRUCTIONS FROM THE EDITOR (these take precedence over the print size guidance and design direction above — margins, amount of copy, type sizes, bleed; the canvas size already reflects any size they request — but never over the mandatory content rules)\n${customInstructions.trim()}`
      : "") +
    `\n\nReturn only the finished advertisement image.`;

  return launchAgentTask({
    agentId,
    label: `${previous ? "Ad iteration" : "Ad generation"} — ${business.name} · "${ad.title}"`,
    subject: { type: "ad", id: ad.id },
    triggeredById,
    steps,
    work: async ({ log }) => {
      const imageParts: { mimeType: string; data: string }[] = [];
      if (previous) {
        let buf: Buffer;
        try {
          buf = await readFile(resolve(creativeImageDirectory, previous.fileName));
        } catch {
          throw new Error("The previous generated ad was not found on disk.");
        }
        imageParts.push({ mimeType: previous.mimeType, data: buf.toString("base64") });
      }
      for (const img of images) {
        let buf: Buffer;
        try {
          buf = await readFile(resolve(process.cwd(), "media", "ads", img.fileName));
        } catch {
          throw new Error(`Reference image "${img.originalName}" not found on disk.`);
        }
        imageParts.push({ mimeType: img.mimeType, data: buf.toString("base64") });
      }

      log(
        "info",
        `Calling Gemini API (model: ${geminiModel}, aspect ${aspectRatio}) with ${previous ? "the previous version and " : ""}${images.length} reference image(s)…`,
      );
      const generated = await generateGeminiImage({
        geminiKey,
        geminiModel,
        prompt,
        images: imageParts,
        imageConfig,
        failureMessage: "Ad generation failed.",
      });
      const printReady = await fitToPrintSize(generated, pixels);
      log("info", `Fitted ${printReady.sourceWidth} x ${printReady.sourceHeight} px output to ${pixels.width} x ${pixels.height} px at ${PRINT_DPI} dpi`);
      const saved = await saveCreativeImage(printReady.image);
      log("success", `Generated ad image saved — ${saved.fileName} (${(saved.size / 1024).toFixed(1)} KB, ${printReady.image.mimeType})`);
      log("success", "Pending editor review — no image saved to ad yet");

      const result: CreativeTaskResult = {
        trigger: "generate-ad",
        imageType: "ad",
        imageId: "",
        parentId: ad.id,
        originalFileName: "generated-ad",
        originalDir: "ads",
        originalMimeType: "",
        enhancedFileName: saved.fileName,
        enhancedMimeType: printReady.image.mimeType,
        enhancedSize: saved.size,
        genericInstructions,
        customInstructions: customInstructions.trim(),
        status: "pending_review",
        referenceImageIds: images.map((img) => img.id),
        printSpec: spec,
        ...(iterateFromTaskId ? { iterateFromTaskId } : {}),
      };
      return result;
    },
  });
}

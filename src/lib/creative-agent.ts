import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  failureMessage,
}: {
  geminiKey: string;
  geminiModel: string;
  prompt: string;
  images: { mimeType: string; data: string }[];
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
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
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
  "Design a high-quality, print-ready advertisement suitable for a premium local lifestyle magazine. " +
  "Compose the layout professionally with a clear visual hierarchy: headline, imagery, supporting copy, and call to action. " +
  "Use the provided reference images as primary visual material. " +
  "Ensure text is legible and the overall design feels polished, local, and trustworthy. " +
  "Output a single full-bleed advertisement image at the highest possible quality.";

/** Launches an ad generation Task; the generated image waits on the task page for review. */
export async function launchGenerateAd({
  adId,
  adTitle,
  adDescription,
  adCta,
  businessName,
  businessDescription,
  images,
  customInstructions,
  triggeredById,
}: {
  adId: string;
  adTitle: string;
  adDescription: string | null;
  adCta: string | null;
  businessName: string;
  businessDescription: string | null;
  images: { id: string; fileName: string; mimeType: string; originalName: string }[];
  customInstructions: string;
  triggeredById?: string;
}): Promise<RegistryTaskRef> {
  const { agentId, settings, geminiKey, geminiModel } = await getCreativeAgent();
  const genericInstructions =
    typeof settings.adGenerationInstructions === "string" && settings.adGenerationInstructions.trim()
      ? settings.adGenerationInstructions.trim()
      : DEFAULT_AD_GENERATION_INSTRUCTIONS;

  const steps: TaskStep[] = [
    step("info", `Trigger: ad generation for advertisement ${adId} — "${adTitle}"`),
    step("info", `Business: ${businessName} · using ${images.length} reference image(s)`),
    instructionsStep(customInstructions, "No custom instructions — using default ad generation profile"),
  ];

  const contextLines: string[] = [`Business name: ${businessName}`];
  if (businessDescription?.trim()) contextLines.push(`Business description: ${businessDescription.trim()}`);
  if (adTitle.trim()) contextLines.push(`Ad title: ${adTitle.trim()}`);
  if (adDescription?.trim()) contextLines.push(`Ad copy / description: ${adDescription.trim()}`);
  if (adCta?.trim()) contextLines.push(`Call to action: ${adCta.trim()}`);

  const prompt =
    `You are a professional advertising designer at Best Version Media, a premium local lifestyle magazine publisher.\n\n` +
    `Create a high-quality, print-ready advertisement using the following business and ad details:\n` +
    contextLines.join("\n") +
    `\n\nDesign requirements:\n${genericInstructions}` +
    (customInstructions.trim() ? `\n\nAdditional instructions from the editor:\n${customInstructions.trim()}` : "") +
    `\n\nReturn only the finished advertisement image. Do not include borders, crop marks, or explanatory text.`;

  return launchAgentTask({
    agentId,
    label: `Ad generation — ${businessName} · "${adTitle}"`,
    triggeredById,
    steps,
    work: async ({ log }) => {
      const imageParts: { mimeType: string; data: string }[] = [];
      for (const img of images) {
        let buf: Buffer;
        try {
          buf = await readFile(resolve(process.cwd(), "media", "ads", img.fileName));
        } catch {
          throw new Error(`Reference image "${img.originalName}" not found on disk.`);
        }
        imageParts.push({ mimeType: img.mimeType, data: buf.toString("base64") });
      }

      log("info", `Calling Gemini API (model: ${geminiModel}) with ${imageParts.length} reference image(s)…`);
      const generated = await generateGeminiImage({
        geminiKey,
        geminiModel,
        prompt,
        images: imageParts,
        failureMessage: "Ad generation failed.",
      });
      const saved = await saveCreativeImage(generated);
      log("success", `Generated ad image saved — ${saved.fileName} (${(saved.size / 1024).toFixed(1)} KB, ${generated.mimeType})`);
      log("success", "Pending editor review — no image saved to ad yet");

      const result: CreativeTaskResult = {
        trigger: "generate-ad",
        imageType: "ad",
        imageId: "",
        parentId: adId,
        originalFileName: "generated-ad",
        originalDir: "ads",
        originalMimeType: "",
        enhancedFileName: saved.fileName,
        enhancedMimeType: generated.mimeType,
        enhancedSize: saved.size,
        genericInstructions,
        customInstructions: customInstructions.trim(),
        status: "pending_review",
        referenceImageIds: images.map((img) => img.id),
      };
      return result;
    },
  });
}

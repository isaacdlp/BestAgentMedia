import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentTaskStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const creativeImageDirectory = resolve(process.cwd(), "media", "creative");

const DEFAULT_GENERIC_INSTRUCTIONS =
  "Upscale and sharpen the image to the highest possible resolution and clarity. " +
  "Correct exposure, white balance, and color grading for professional print reproduction. " +
  "Remove noise, grain, JPEG artifacts, and compression banding. " +
  "Enhance contrast and microcontrast so fine details read clearly on a printed page. " +
  "Ensure skin tones are natural and neutral backgrounds are clean. " +
  "Make the image look polished and editorial — suitable for the cover or inside spread of a community lifestyle magazine.";

type TaskStep = { at: string; level: "info" | "success" | "error"; message: string };

function step(level: TaskStep["level"], message: string): TaskStep {
  return { at: new Date().toISOString(), level, message };
}

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
};

export async function enhanceImage({
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
  originalDir: "submissions" | "articles" | "businesses" | "ads" | "publications";
  originalMimeType: string;
  customInstructions: string;
  triggeredById?: string;
  iterateFromTaskId?: string;
}): Promise<string> {
  const agent = await prisma.agent.findUnique({
    where: { slug: "creative" },
    select: { id: true, enabled: true, settings: true },
  });
  if (!agent) throw new Error("Creative agent is not configured. Run the database seed.");
  if (!agent.enabled) throw new Error("The Creative agent is currently disabled. Enable it in the Agents section.");

  const geminiKey = process.env.GEMINI_KEY;
  if (!geminiKey?.trim()) throw new Error("GEMINI_KEY is not configured in the environment.");

  const settings = (agent.settings as Record<string, unknown>) ?? {};
  const geminiModel =
    typeof settings.model === "string" ? settings.model : "gemini-3-pro-image";
  const genericInstructions =
    typeof settings.genericInstructions === "string" && settings.genericInstructions.trim()
      ? settings.genericInstructions.trim()
      : DEFAULT_GENERIC_INSTRUCTIONS;

  const steps: TaskStep[] = [
    step("info", `Trigger: image enhancement for ${imageType} image (id: ${imageId})`),
    step("info", `Parent: ${imageType} ${parentId}`),
    step(
      "info",
      customInstructions.trim()
        ? `Custom instructions provided: "${customInstructions.slice(0, 80)}${customInstructions.length > 80 ? "…" : ""}"`
        : "No custom instructions — using generic enhancement profile only",
    ),
  ];

  // Determine the source image file location
  let sourceFilePath: string;
  let sourceMimeType: string;

  if (iterateFromTaskId) {
    const prevTask = await prisma.agentTask.findUnique({
      where: { id: iterateFromTaskId },
      select: { result: true, agentId: true },
    });
    if (!prevTask || prevTask.agentId !== agent.id) {
      throw new Error("Referenced iteration task not found or does not belong to the Creative agent.");
    }
    const prevResult = prevTask.result as CreativeTaskResult | null;
    if (!prevResult?.enhancedFileName) {
      throw new Error("The previous task has no enhanced image to iterate from.");
    }
    sourceFilePath = resolve(creativeImageDirectory, prevResult.enhancedFileName);
    sourceMimeType = prevResult.enhancedMimeType;
    steps.push(step("info", `Iterating from task ${iterateFromTaskId} — using its enhanced output as source`));
  } else {
    sourceFilePath = resolve(process.cwd(), "media", originalDir, originalFileName);
    sourceMimeType = originalMimeType;
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = await readFile(sourceFilePath);
  } catch {
    throw new Error("Source image file not found on disk.");
  }

  steps.push(step("info", `Calling Gemini API (model: ${geminiModel})…`));

  const fullPrompt =
    `You are a professional photo editor at Best Version Media, a premium local lifestyle magazine publisher.\n\n` +
    `Your task is to enhance the provided image for professional magazine publication.\n\n` +
    `Generic enhancement requirements:\n${genericInstructions}` +
    (customInstructions.trim()
      ? `\n\nAdditional editor instructions:\n${customInstructions.trim()}`
      : "") +
    `\n\nReturn only the enhanced image. Maintain the original subject, composition, and story — improve only technical quality and visual presentation.`;

  const imageBase64 = imageBuffer.toString("base64");

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: fullPrompt },
          { inlineData: { mimeType: sourceMimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  };

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

  type GeminiResponse = {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { mimeType: string; data: string };
        }>;
      };
      finishReason?: string;
    }>;
    error?: { message: string; code: number };
  };

  let enhancedBase64: string;
  let enhancedMimeType: string;

  try {
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "(no body)");
      throw new Error(`Gemini API returned ${response.status}: ${errorText.slice(0, 300)}`);
    }

    const data = (await response.json()) as GeminiResponse;

    if (data.error) {
      throw new Error(`Gemini API error: ${data.error.message}`);
    }

    const candidate = data.candidates?.[0];
    const imagePart = candidate?.content?.parts?.find((p) => p.inlineData);
    if (!imagePart?.inlineData) {
      throw new Error(
        "Gemini did not return an image in the response. The model may not support image output for this request.",
      );
    }

    enhancedBase64 = imagePart.inlineData.data;
    enhancedMimeType = imagePart.inlineData.mimeType;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image enhancement failed.";
    throw new Error(message);
  }

  // Persist the enhanced image
  await mkdir(creativeImageDirectory, { recursive: true });

  const ext = enhancedMimeType === "image/jpeg" ? "jpg" : enhancedMimeType === "image/webp" ? "webp" : "png";
  const enhancedFileName = `${randomUUID()}.${ext}`;
  const enhancedBuffer = Buffer.from(enhancedBase64, "base64");

  await writeFile(resolve(creativeImageDirectory, enhancedFileName), enhancedBuffer, { flag: "wx" });

  steps.push(
    step(
      "success",
      `Enhanced image saved — ${enhancedFileName} (${(enhancedBuffer.byteLength / 1024).toFixed(1)} KB, ${enhancedMimeType})`,
    ),
  );
  steps.push(step("success", "Pending editor review — no original modified yet"));

  const result: CreativeTaskResult = {
    trigger: "enhance",
    imageType,
    imageId,
    parentId,
    originalFileName,
    originalDir,
    originalMimeType,
    enhancedFileName,
    enhancedMimeType,
    enhancedSize: enhancedBuffer.byteLength,
    genericInstructions,
    customInstructions: customInstructions.trim(),
    status: "pending_review",
    ...(iterateFromTaskId ? { iterateFromTaskId } : {}),
  };

  const task = await prisma.agentTask.create({
    data: {
      agentId: agent.id,
      status: AgentTaskStatus.SUCCEEDED,
      label: `Image enhancement — ${imageType} · ${originalFileName}`,
      startedAt: new Date(),
      completedAt: new Date(),
      triggeredById: triggeredById ?? null,
      steps: steps as unknown as Prisma.InputJsonValue,
      result: result as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return task.id;
}

const DEFAULT_AD_GENERATION_INSTRUCTIONS =
  "Design a high-quality, print-ready advertisement suitable for a premium local lifestyle magazine. " +
  "Compose the layout professionally with a clear visual hierarchy: headline, imagery, supporting copy, and call to action. " +
  "Use the provided reference images as primary visual material. " +
  "Ensure text is legible and the overall design feels polished, local, and trustworthy. " +
  "Output a single full-bleed advertisement image at the highest possible quality.";

export async function generateAd({
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
}): Promise<string> {
  const agent = await prisma.agent.findUnique({
    where: { slug: "creative" },
    select: { id: true, enabled: true, settings: true },
  });
  if (!agent) throw new Error("Creative agent is not configured. Run the database seed.");
  if (!agent.enabled) throw new Error("The Creative agent is currently disabled. Enable it in the Agents section.");

  const geminiKey = process.env.GEMINI_KEY;
  if (!geminiKey?.trim()) throw new Error("GEMINI_KEY is not configured in the environment.");

  const settings = (agent.settings as Record<string, unknown>) ?? {};
  const geminiModel =
    typeof settings.model === "string" ? settings.model : "gemini-3-pro-image";
  const genericInstructions =
    typeof settings.adGenerationInstructions === "string" && settings.adGenerationInstructions.trim()
      ? settings.adGenerationInstructions.trim()
      : DEFAULT_AD_GENERATION_INSTRUCTIONS;

  const steps: TaskStep[] = [
    step("info", `Trigger: ad generation for advertisement ${adId} — "${adTitle}"`),
    step("info", `Business: ${businessName} · using ${images.length} reference image(s)`),
    step(
      "info",
      customInstructions.trim()
        ? `Custom instructions provided: "${customInstructions.slice(0, 80)}${customInstructions.length > 80 ? "…" : ""}"`
        : "No custom instructions — using default ad generation profile",
    ),
  ];

  // Build prompt
  const contextLines: string[] = [
    `Business name: ${businessName}`,
  ];
  if (businessDescription?.trim()) contextLines.push(`Business description: ${businessDescription.trim()}`);
  if (adTitle.trim()) contextLines.push(`Ad title: ${adTitle.trim()}`);
  if (adDescription?.trim()) contextLines.push(`Ad copy / description: ${adDescription.trim()}`);
  if (adCta?.trim()) contextLines.push(`Call to action: ${adCta.trim()}`);

  const fullPrompt =
    `You are a professional advertising designer at Best Version Media, a premium local lifestyle magazine publisher.\n\n` +
    `Create a high-quality, print-ready advertisement using the following business and ad details:\n` +
    contextLines.join("\n") +
    `\n\nDesign requirements:\n${genericInstructions}` +
    (customInstructions.trim()
      ? `\n\nAdditional instructions from the editor:\n${customInstructions.trim()}`
      : "") +
    `\n\nReturn only the finished advertisement image. Do not include borders, crop marks, or explanatory text.`;

  // Read all selected image files
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

  steps.push(step("info", `Calling Gemini API (model: ${geminiModel}) with ${imageParts.length} reference image(s)…`));

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: fullPrompt },
          ...imageParts.map((p) => ({ inlineData: p })),
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  };

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

  type GeminiResponse = {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { mimeType: string; data: string };
        }>;
      };
      finishReason?: string;
    }>;
    error?: { message: string; code: number };
  };

  let enhancedBase64: string;
  let enhancedMimeType: string;

  try {
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "(no body)");
      throw new Error(`Gemini API returned ${response.status}: ${errorText.slice(0, 300)}`);
    }

    const data = (await response.json()) as GeminiResponse;
    if (data.error) throw new Error(`Gemini API error: ${data.error.message}`);

    const candidate = data.candidates?.[0];
    const imagePart = candidate?.content?.parts?.find((p) => p.inlineData);
    if (!imagePart?.inlineData) {
      throw new Error(
        "Gemini did not return an image in the response. The model may not support image output for this request.",
      );
    }

    enhancedBase64 = imagePart.inlineData.data;
    enhancedMimeType = imagePart.inlineData.mimeType;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ad generation failed.";
    throw new Error(message);
  }

  await mkdir(creativeImageDirectory, { recursive: true });

  const ext = enhancedMimeType === "image/jpeg" ? "jpg" : enhancedMimeType === "image/webp" ? "webp" : "png";
  const enhancedFileName = `${randomUUID()}.${ext}`;
  const enhancedBuffer = Buffer.from(enhancedBase64, "base64");

  await writeFile(resolve(creativeImageDirectory, enhancedFileName), enhancedBuffer, { flag: "wx" });

  steps.push(
    step(
      "success",
      `Generated ad image saved — ${enhancedFileName} (${(enhancedBuffer.byteLength / 1024).toFixed(1)} KB, ${enhancedMimeType})`,
    ),
  );
  steps.push(step("success", "Pending editor review — no image saved to ad yet"));

  const result: CreativeTaskResult = {
    trigger: "generate-ad",
    imageType: "ad",
    imageId: "",
    parentId: adId,
    originalFileName: "generated-ad",
    originalDir: "ads",
    originalMimeType: "",
    enhancedFileName,
    enhancedMimeType,
    enhancedSize: enhancedBuffer.byteLength,
    genericInstructions,
    customInstructions: customInstructions.trim(),
    status: "pending_review",
  };

  const task = await prisma.agentTask.create({
    data: {
      agentId: agent.id,
      status: AgentTaskStatus.SUCCEEDED,
      label: `Ad generation — ${businessName} · "${adTitle}"`,
      startedAt: new Date(),
      completedAt: new Date(),
      triggeredById: triggeredById ?? null,
      steps: steps as unknown as Prisma.InputJsonValue,
      result: result as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return task.id;
}

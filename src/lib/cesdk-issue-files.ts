// Browser-only Import / Export menu for the issue editor's navigation bar. Exports are rendered
// locally by CE.SDK and downloaded to the user's computer; nothing is sent to another service.

import type CreativeEditorSDK from "@cesdk/cesdk-js";
import type { CreativeEngine } from "@cesdk/cesdk-js";

// The engine detects scenes and archives from the file content; these only narrow the picker.
export const SCENE_FILE_TYPES = ".imgly,.scene,.zip";

// Resource types the issue image endpoint accepts when imported archive assets are stored.
const UPLOADABLE_RESOURCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"]);
const RESOURCE_CHUNK_BYTES = 1024 * 1024;

type ImageFormat = { mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/x-tga" | "image/svg+xml"; label: string; extension: string };
type AudioFormat = { mimeType: "audio/wav" | "audio/mp4"; label: string; extension: string };

const IMAGE_FORMATS: ImageFormat[] = [
  { mimeType: "image/png", label: "PNG", extension: "png" },
  { mimeType: "image/jpeg", label: "JPEG", extension: "jpg" },
  { mimeType: "image/webp", label: "WebP", extension: "webp" },
  { mimeType: "image/x-tga", label: "TGA", extension: "tga" },
  { mimeType: "image/svg+xml", label: "SVG", extension: "svg" },
];
const AUDIO_FORMATS: AudioFormat[] = [
  { mimeType: "audio/wav", label: "WAV", extension: "wav" },
  { mimeType: "audio/mp4", label: "M4A", extension: "m4a" },
];

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function currentPage(engine: CreativeEngine) {
  const page = engine.scene.getCurrentPage() ?? engine.scene.getPages()[0];
  if (page === undefined || page === null) throw new Error("The issue has no pages to export.");
  return { page, number: engine.scene.getPages().indexOf(page) + 1 };
}

// Runs an export behind a loading notification and reports failures in the editor.
async function withProgress(cesdk: CreativeEditorSDK, message: string, task: () => Promise<void>) {
  const id = cesdk.ui.showNotification({ type: "loading", message, duration: "infinite" });
  try {
    await task();
  } catch (error) {
    cesdk.ui.showNotification({
      type: "error",
      message: error instanceof Error ? error.message : "The export failed.",
      duration: "long",
    });
  } finally {
    cesdk.ui.dismissNotification(id);
  }
}

type IssueFileMenuOptions = {
  // File name stem for downloads, for example "issue-12".
  baseName: string;
  // Replaces the issue layout with a scene or archive file chosen by the user.
  importScene: () => Promise<void>;
};

export function setupIssueFileMenu(cesdk: CreativeEditorSDK, { baseName, importScene }: IssueFileMenuOptions) {
  const { engine } = cesdk;

  const exportImage = (format: ImageFormat) =>
    withProgress(cesdk, `Exporting ${format.label}…`, async () => {
      const { page, number } = currentPage(engine);
      const blob = await engine.block.export(page, { mimeType: format.mimeType });
      downloadBlob(blob, `${baseName}-page-${number}.${format.extension}`);
    });

  // A single multi-page PDF of the whole issue.
  const exportPdf = () =>
    withProgress(cesdk, "Exporting PDF…", async () => {
      const scene = engine.scene.get();
      if (scene === null) throw new Error("The issue has no pages to export.");
      const blob = await engine.block.export(scene, { mimeType: "application/pdf" });
      downloadBlob(blob, `${baseName}.pdf`);
    });

  // Design pages are static, so the video holds the current page (and any animation on it).
  const exportVideo = () =>
    withProgress(cesdk, "Exporting MP4 video…", async () => {
      const { page, number } = currentPage(engine);
      const duration = engine.block.supportsDuration(page) ? engine.block.getDuration(page) : 0;
      const blob = await engine.block.exportVideo(page, { mimeType: "video/mp4", duration: duration > 0 ? duration : 5 });
      downloadBlob(blob, `${baseName}-page-${number}.mp4`);
    });

  // CE.SDK exports audio per audio block; issues only have audio if a scene with audio was imported.
  const exportAudio = (format: AudioFormat) =>
    withProgress(cesdk, `Exporting ${format.label} audio…`, async () => {
      const blocks = engine.block.findByType("audio");
      if (!blocks.length) throw new Error("This issue has no audio to export.");
      for (const [index, block] of blocks.entries()) {
        const blob = await engine.block.exportAudio(block, { mimeType: format.mimeType });
        const suffix = blocks.length > 1 ? `-audio-${index + 1}` : "-audio";
        downloadBlob(blob, `${baseName}${suffix}.${format.extension}`);
      }
    });

  const exportScene = (format: "scene" | "archive") =>
    withProgress(cesdk, format === "archive" ? "Exporting archive…" : "Exporting scene…", async () => {
      if (format === "archive") {
        downloadBlob(await engine.scene.saveToArchive(), `${baseName}-archive.imgly`);
      } else {
        downloadBlob(new Blob([await engine.scene.saveToString()], { type: "text/plain" }), `${baseName}.imgly`);
      }
    });

  // Built-in buttons and shortcuts that call these actions use the issue-aware versions.
  cesdk.actions.register("importScene", importScene);
  cesdk.actions.register("exportScene", ({ format }) => exportScene(format));

  cesdk.feature.enable("ly.img.navigation.actions");
  cesdk.ui.insertOrderComponent({ in: "ly.img.navigation.bar", after: "ly.img.preview.navigationBar" }, {
    id: "ly.img.actions.navigationBar",
    children: [
      { id: "ly.img.action.navigationBar", key: "issue.importScene", label: "Import scene or archive…", icon: "@imgly/Upload", onClick: importScene },
      "ly.img.separator",
      ...IMAGE_FORMATS.map((format) => ({
        id: "ly.img.action.navigationBar" as const,
        key: `issue.export.${format.extension}`,
        label: `Export page as ${format.label}`,
        icon: "@imgly/Image",
        onClick: () => exportImage(format),
      })),
      { id: "ly.img.action.navigationBar", key: "issue.export.pdf", label: "Export issue as PDF", icon: "@imgly/Download", onClick: exportPdf },
      { id: "ly.img.action.navigationBar", key: "issue.export.mp4", label: "Export page as MP4 video", icon: "@imgly/Video", onClick: exportVideo },
      ...AUDIO_FORMATS.map((format) => ({
        id: "ly.img.action.navigationBar" as const,
        key: `issue.export.${format.extension}`,
        label: `Export audio as ${format.label}`,
        icon: "@imgly/Audio",
        onClick: () => exportAudio(format),
      })),
      "ly.img.separator",
      { id: "ly.img.action.navigationBar", key: "issue.export.scene", label: "Export scene (.imgly)", icon: "@imgly/Save", onClick: () => exportScene("scene") },
      { id: "ly.img.action.navigationBar", key: "issue.export.archive", label: "Export archive with assets (.imgly)", icon: "@imgly/Save", onClick: () => exportScene("archive") },
    ],
  });
}

function readResource(engine: CreativeEngine, url: string, size: number) {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  engine.editor.getResourceData(url, RESOURCE_CHUNK_BYTES, (chunk) => {
    // Chunks may be views into engine memory, so they are copied.
    chunks.push(chunk.slice());
    length += chunk.byteLength;
    return true;
  });
  if (length !== size) throw new Error(`Could not read ${url}.`);
  return chunks;
}

// Assets embedded in an imported archive only exist in the engine's memory. Supported images are
// uploaded to the issue's media folder and relocated so the saved scene references stored files.
// Returns the number of resources that could not be stored (for example fonts or video).
export async function persistTransientResources(
  engine: CreativeEngine,
  upload: (file: File) => Promise<string>,
) {
  let skipped = 0;
  for (const [index, resource] of engine.editor.findAllTransientResources().entries()) {
    try {
      const type = await engine.editor.getMimeType(resource.URL);
      if (!UPLOADABLE_RESOURCE_TYPES.has(type)) {
        skipped += 1;
        continue;
      }
      const file = new File(readResource(engine, resource.URL, resource.size), `imported-${index + 1}`, { type });
      engine.editor.relocateResource(resource.URL, await upload(file));
    } catch (error) {
      console.warn("Could not store an imported resource:", error);
      skipped += 1;
    }
  }
  return skipped;
}

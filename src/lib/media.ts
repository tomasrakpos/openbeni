// Shared logic media; change this helper here and update callers if its contract changes.
import type { Attachment, AttachmentKind } from "@/lib/types";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 2048;
export const MAX_TEXT_CHARS = 200_000;

export interface ProcessedFile {
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  width?: number;
  height?: number;
  durationSec?: number;
  blob?: Blob;
  text?: string;
  frames?: string[];
  warning?: string;
}

export function kindForMime(mime: string, name: string): AttachmentKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (
    mime.startsWith("text/") ||
    /json|xml|javascript|typescript|markdown|x-yaml|csv|x-sh|x-python|pdf/.test(mime) ||
    /\.(md|txt|json|ya?ml|csv|ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h|css|html|sql|sh|toml|ini|log)$/i.test(name)
  ) {
    return "file";
  }
  return null;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(blob);
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob);
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

export function attachmentToBase64(attachment: Attachment): Promise<string> {
  if (!attachment.blob) return Promise.resolve("");
  return blobToBase64(attachment.blob);
}

async function compressImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { blob: file, width: bitmap.width, height: bitmap.height };
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.87),
  );
  return { blob: blob ?? file, width, height };
}

export async function extractVideoFrames(
  file: File,
  count = 6,
): Promise<{ frames: string[]; durationSec: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Video metadata timed out")), 12_000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("This video could not be decoded by the browser"));
      };
    });
    const durationSec = Number.isFinite(video.duration) ? video.duration : 0;
    if (!durationSec) throw new Error("Unknown video duration");
    const width = video.videoWidth;
    const height = video.videoHeight;
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    const frames: string[] = [];
    const safeCount = Math.max(1, Math.min(count, 12));
    for (let i = 0; i < safeCount; i++) {
      const time = ((i + 0.5) / safeCount) * durationSec;
      const target = Math.min(time, Math.max(0, durationSec - 0.05));
      await new Promise<void>((resolve, reject) => {
        const onSeeked = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          video.removeEventListener("seeked", onSeeked);
          reject(new Error("Seeking timed out"));
        }, 8000);
        video.addEventListener("seeked", onSeeked, { once: true });
        video.currentTime = target;
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.82));
    }
    return { frames, durationSec, width, height };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, useWorkerFetch: false });
  const doc = await task.promise;
  const chunks: string[] = [];
  const pages = Math.min(doc.numPages, 80);
  for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) chunks.push(`[page ${pageNumber}]\n${text}`);
    if (chunks.join("\n").length > MAX_TEXT_CHARS) break;
  }
  await task.destroy();
  return chunks.join("\n\n").slice(0, MAX_TEXT_CHARS);
}

export async function readTextFile(file: File): Promise<string> {
  const text = await file.text();
  return text.slice(0, MAX_TEXT_CHARS);
}

export interface ProcessOptions {
  preferNativeVideo?: boolean;
  frameCount?: number;
}

export async function processFile(file: File, options: ProcessOptions = {}): Promise<ProcessedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File exceeds the 25 MB limit");
  }
  const mime = file.type || "application/octet-stream";
  const kind = kindForMime(mime, file.name);
  if (!kind) throw new Error("Unsupported file type");

  if (kind === "image") {
    try {
      const { blob, width, height } = await compressImage(file);
      return {
        name: file.name,
        mimeType: "image/jpeg",
        size: blob.size,
        kind,
        width,
        height,
        blob,
      };
    } catch {
      return { name: file.name, mimeType: mime, size: file.size, kind, blob: file };
    }
  }

  if (kind === "audio") {
    return { name: file.name, mimeType: mime, size: file.size, kind, blob: file };
  }

  if (kind === "video") {
    if (options.preferNativeVideo) {
      return { name: file.name, mimeType: mime, size: file.size, kind, blob: file };
    }
    const { frames, durationSec, width, height } = await extractVideoFrames(file, options.frameCount ?? 6);
    return {
      name: file.name,
      mimeType: mime,
      size: file.size,
      kind,
      durationSec,
      width,
      height,
      frames,
      warning: `${frames.length} frames extracted in the browser`,
    };
  }

  if (mime === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const text = await extractPdfText(file);
    return {
      name: file.name,
      mimeType: "text/plain",
      size: file.size,
      kind: "file",
      text,
      warning: "PDF text extracted",
    };
  }

  const text = await readTextFile(file);
  return { name: file.name, mimeType: mime, size: file.size, kind: "file", text };
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

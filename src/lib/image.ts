export type CompressOptions = {
  maxEdge?: number;
  quality?: number;
};

const DEFAULT_MEAL: Required<CompressOptions> = { maxEdge: 1280, quality: 0.7 };
/** Higher fidelity for small nutrition-panel text. */
const DEFAULT_LABEL: Required<CompressOptions> = { maxEdge: 2048, quality: 0.92 };

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

export async function compressImage(
  file: Blob,
  options: CompressOptions = {},
): Promise<Blob> {
  const { maxEdge, quality } = { ...DEFAULT_MEAL, ...options };
  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("Failed to compress image");
  return blob;
}

export function compressOptionsForMode(mode: "meal" | "label"): CompressOptions {
  return mode === "label" ? DEFAULT_LABEL : DEFAULT_MEAL;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Failed to encode image");
  return dataUrl.slice(comma + 1);
}
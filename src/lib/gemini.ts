import { GoogleGenerativeAI } from "@google/generative-ai";
import { blobToBase64 } from "@/lib/image";
import { roundMacro } from "@/lib/dates";
import { scaleMacros, type MealPhotoEstimate } from "@/lib/meal-items";
import type { MealItem, ScanMode } from "@/lib/types";

export type { ScanMode };

export type ScanResult = {
  label: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/** Nutrition values as printed on the label for a specific basis weight. */
export type LabelScanResult = ScanResult & {
  /** Grams the printed values apply to (often 100, or a serving size). */
  basisGrams: number;
};

/** Flash-Lite for meal estimates and label OCR (cost-efficient). */
export const GEMINI_MEAL_MODEL = "gemini-3.5-flash-lite";

/** Same cheap Flash-Lite for nutrition-label OCR / portion scaling. */
export const GEMINI_LABEL_MODEL = "gemini-3.5-flash-lite";

export function modelForMode(mode: ScanMode): string {
  return mode === "meal" ? GEMINI_MEAL_MODEL : GEMINI_LABEL_MODEL;
}

/** Cap image tokens; meal needs less detail than label OCR. */
export type MediaResolution =
  | "MEDIA_RESOLUTION_LOW"
  | "MEDIA_RESOLUTION_MEDIUM"
  | "MEDIA_RESOLUTION_HIGH";

/** Gemini 3.x thinking depth; flash / flash-lite support these levels. */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export function mediaResolutionForMode(mode: ScanMode): MediaResolution {
  // Labels need readable small text; meals only need plate-level detail.
  return mode === "label" ? "MEDIA_RESOLUTION_MEDIUM" : "MEDIA_RESOLUTION_LOW";
}

/** Low effort for plate estimates; keep labels cheapest (OCR-ish). */
export function thinkingLevelForMode(mode: ScanMode): ThinkingLevel {
  return mode === "meal" ? "low" : "minimal";
}

const SENTINEL_LABELS = new Set([
  "not food",
  "not a nutrition label",
]);

const MAX_MEAL_ITEMS = 8;

const MEAL_PROMPT = `You are a nutrition estimator. Analyze this meal photo.
Estimate the full plate as served (one serving unless clearly multiple).
Return ONLY valid JSON with this exact shape (no markdown):
{"label":"short dish name","items":[{"name":"component name","estimatedGrams":number,"calories":number,"proteinG":number,"carbsG":number,"fatG":number}]}
Split into 1–8 user-recognizable components (protein, starch, veg, and calorically significant oils/sauces). Combine inseparable mixed dishes into one item. One item is valid for a soup or smoothie.
Each item's calories and macros describe exactly that item's estimatedGrams, not per 100g. Do not emit plate-level totals.
Use grams for macros. Keep numeric precision; do not round away decimals.
If the image is not food, return JSON with label "Not food" and "items":[].`;

const LABEL_PROMPT = `You are reading a packaged-food nutrition facts label (not a barcode).
Extract the product name and the nutrition numbers exactly as printed for ONE stated basis
(prefer "per 100g" if present; otherwise use the serving size).
Return ONLY valid JSON with this exact shape (no markdown):
{"label":"product name","calories":number,"proteinG":number,"carbsG":number,"fatG":number,"basisGrams":number}
- calories / proteinG / carbsG / fatG must match the label for basisGrams grams of food
- basisGrams is the weight those values apply to (e.g. 100 for per 100g, or 28 for a 28g serving)
- If energy is in kJ only, convert to kcal (÷ 4.184)
- If the image is not a nutrition label, return label "Not a nutrition label", zeros, and basisGrams 100`;

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence?.[1]?.trim() ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in model response");
  return JSON.parse(raw.slice(start, end + 1));
}

function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Scan response missing a valid ${field}`);
  }
  return value;
}

function assertNotSentinel(label: string) {
  if (SENTINEL_LABELS.has(label.trim().toLowerCase())) {
    throw new Error(
      label.toLowerCase().includes("nutrition")
        ? "That doesn't look like a nutrition label — photograph the facts panel, not the barcode."
        : "That doesn't look like food. Try another photo.",
    );
  }
}

/** Parse meal-estimate JSON. Keeps full precision until final rounding for display/storage. */
export function parseScanResult(data: unknown, options?: { round?: boolean }): ScanResult {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid scan response");
  }
  const obj = data as Record<string, unknown>;
  const label = String(obj.label ?? "").trim() || "Meal";
  assertNotSentinel(label);
  const calories = readFiniteNumber(obj.calories, "calories");
  const proteinG = readFiniteNumber(obj.proteinG, "proteinG");
  const carbsG = readFiniteNumber(obj.carbsG, "carbsG");
  const fatG = readFiniteNumber(obj.fatG, "fatG");
  const round = options?.round ?? true;
  return {
    label,
    calories: Math.max(0, round ? Math.round(calories) : calories),
    proteinG: Math.max(0, round ? roundMacro(proteinG) : proteinG),
    carbsG: Math.max(0, round ? roundMacro(carbsG) : carbsG),
    fatG: Math.max(0, round ? roundMacro(fatG) : fatG),
  };
}

export function parseLabelScanResult(data: unknown): LabelScanResult {
  // Keep unrounded macros for accurate portion scaling.
  const base = parseScanResult(data, { round: false });
  const obj = data as Record<string, unknown>;
  const basisRaw = readFiniteNumber(obj.basisGrams, "basisGrams");
  const basisGrams = roundMacro(basisRaw);
  if (basisGrams <= 0) {
    throw new Error("Label scan missing serving / per-100g basis");
  }
  return {
    ...base,
    basisGrams,
  };
}

async function runVision(
  apiKey: string,
  image: Blob,
  prompt: string,
  mode: ScanMode = "meal",
): Promise<string> {
  if (!apiKey.trim()) {
    throw new Error("Missing Gemini API key");
  }
  const genAI = new GoogleGenerativeAI(apiKey.trim());
  // thinkingConfig / mediaResolution are accepted by the API; SDK types lag.
  // Gemini 3.x rejects thinkingBudget; use thinkingLevel (minimal = fastest).
  const thinkingLevel = thinkingLevelForMode(mode);
  const generationConfig = {
    responseMimeType: "application/json",
    // Meal thinking can consume output budget; leave headroom for JSON.
    maxOutputTokens: mode === "meal" ? 4096 : 512,
    thinkingConfig: { thinkingLevel },
    mediaResolution: mediaResolutionForMode(mode),
  };
  const model = genAI.getGenerativeModel({
    model: modelForMode(mode),
    generationConfig,
  });
  const base64 = await blobToBase64(image);
  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType: image.type || "image/jpeg",
        data: base64,
      },
    },
  ]);
  return result.response.text();
}

export function buildMealPrompt(extraContext?: string): string {
  const hint = extraContext?.trim();
  if (!hint) return MEAL_PROMPT;
  return `${MEAL_PROMPT}

User-provided context (use this to resolve ambiguities such as meat type, dish identity, or serving size):
"${hint}"`;
}

function readNonNegativeNumber(value: unknown, field: string): number {
  const n = readFiniteNumber(value, field);
  if (n < 0) {
    throw new Error(`Scan response has a negative ${field}`);
  }
  return n;
}

function parseMealItemJson(value: unknown, index: number): MealItem {
  if (!value || typeof value !== "object") {
    throw new Error(`Meal item ${index + 1} is invalid`);
  }
  const obj = value as Record<string, unknown>;
  const name = String(obj.name ?? "").trim();
  if (!name) {
    throw new Error(`Meal item ${index + 1} is missing a name`);
  }
  const estimatedGrams = readFiniteNumber(obj.estimatedGrams, "estimatedGrams");
  if (estimatedGrams <= 0) {
    throw new Error(`Meal item ${index + 1} has invalid estimatedGrams`);
  }
  const nutrition = {
    calories: readNonNegativeNumber(obj.calories, "calories"),
    proteinG: readNonNegativeNumber(obj.proteinG, "proteinG"),
    carbsG: readNonNegativeNumber(obj.carbsG, "carbsG"),
    fatG: readNonNegativeNumber(obj.fatG, "fatG"),
  };
  return {
    id: crypto.randomUUID(),
    name,
    grams: estimatedGrams,
    basis: { grams: estimatedGrams, nutrition },
  };
}

export function parseMealPhotoEstimate(data: unknown): MealPhotoEstimate {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid scan response");
  }
  const obj = data as Record<string, unknown>;
  const label = String(obj.label ?? "").trim() || "Meal";
  assertNotSentinel(label);
  if (!Array.isArray(obj.items)) {
    throw new Error("Meal estimate is missing items");
  }
  if (obj.items.length === 0) {
    throw new Error("Meal estimate has no items");
  }
  if (obj.items.length > MAX_MEAL_ITEMS) {
    throw new Error(`Meal estimate has more than ${MAX_MEAL_ITEMS} items`);
  }
  return {
    label,
    items: obj.items.map(parseMealItemJson),
  };
}

export async function analyzeMealImage(
  apiKey: string,
  image: Blob,
  extraContext?: string,
): Promise<MealPhotoEstimate> {
  const text = await runVision(
    apiKey,
    image,
    buildMealPrompt(extraContext),
    "meal",
  );
  return parseMealPhotoEstimate(extractJson(text));
}

export async function analyzeNutritionLabel(
  apiKey: string,
  image: Blob,
): Promise<LabelScanResult> {
  const text = await runVision(apiKey, image, LABEL_PROMPT, "label");
  return parseLabelScanResult(extractJson(text));
}

/** Scale label nutrition from its printed basis to the grams the user ate. */
export function scaleLabelNutrition(
  label: LabelScanResult,
  gramsEaten: number,
): ScanResult | null {
  const scaled = scaleMacros(
    {
      calories: label.calories,
      proteinG: label.proteinG,
      carbsG: label.carbsG,
      fatG: label.fatG,
    },
    label.basisGrams,
    gramsEaten,
  );
  if (!scaled) return null;
  return { label: label.label, ...scaled };
}

export type PortionInput =
  | { kind: "grams"; grams: number }
  | { kind: "description"; text: string };

/**
 * Accept either a gram weight ("150", "40g") or a portion phrase
 * ("1 row of chocolate", "one teaspoon").
 */
export function parsePortionInput(raw: string): PortionInput | null {
  const text = raw.trim();
  if (!text) return null;
  const gramsMatch = text.match(/^(\d+(?:\.\d+)?)\s*(?:g|grams?)?$/i);
  if (gramsMatch) {
    const grams = Number(gramsMatch[1]);
    if (!Number.isFinite(grams) || grams <= 0) return null;
    return { kind: "grams", grams };
  }
  return { kind: "description", text };
}

export function parsePortionGramsResult(data: unknown): number {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid portion estimate response");
  }
  const grams = roundMacro(
    readFiniteNumber((data as Record<string, unknown>).grams, "grams"),
  );
  if (grams <= 0) {
    throw new Error("Could not estimate that portion — try grams instead");
  }
  return grams;
}

/** Estimate grams for a free-text portion using the label photo for context. */
export async function estimatePortionGrams(
  apiKey: string,
  image: Blob,
  productName: string,
  basisGrams: number,
  portionDescription: string,
): Promise<number> {
  const description = portionDescription.trim();
  if (!description) {
    throw new Error("Enter a portion description");
  }
  const prompt = `You are estimating how much of a packaged food was eaten.
This photo is the product's nutrition facts label for "${productName}"
(printed values apply to ${basisGrams}g).
The user describes their portion as: "${description}"
Estimate the weight of that portion in grams for this specific product.
Use serving sizes or package clues on the label when helpful; otherwise use
typical kitchen weights (e.g. teaspoon ≈ 5g for dense foods, tablespoon ≈ 15g,
chocolate row ≈ a fraction of a standard bar).
Return ONLY valid JSON with this exact shape (no markdown):
{"grams":number}
grams must be a positive number.`;
  const text = await runVision(apiKey, image, prompt, "label");
  return parsePortionGramsResult(extractJson(text));
}

/** Meal name suffix: "150g" or "1 teaspoon · ~5g". */
export function formatPortionSuffix(
  portion: PortionInput,
  gramsEaten: number,
): string {
  const g = roundMacro(gramsEaten);
  if (portion.kind === "grams") return `${g}g`;
  return `${portion.text} · ~${g}g`;
}
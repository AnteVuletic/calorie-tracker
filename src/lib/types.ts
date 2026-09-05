import type { ScanMode } from "@/lib/gemini";

export type MealStatus = "pending" | "processing" | "logged" | "fail";

export type { ScanMode };

export type Meal = {
  id: string;
  createdAt: string;
  dayKey: string;
  imageBlob: Blob;
  label: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /**
   * pending = queued for Gemini;
   * processing = currently analyzing;
   * logged = successfully analyzed;
   * fail = exhausted retries
   */
  status: MealStatus;
  scanMode: ScanMode;
  /** Portion text for label scans (grams or description), required when scanMode is label */
  portionRaw?: string;
  /** Optional user hints for meal-photo AI (e.g. meat type, bowl size) */
  extraContext?: string;
  /** Failed attempts so far (used for exponential backoff) */
  retryCount?: number;
  /** ISO time when a pending meal may be attempted again */
  nextAttemptAt?: string;
  /** Last scan/queue error, if any */
  lastError?: string;
};

export type MacroTotals = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/** Max failed attempts before status becomes fail (1 initial + 3 retries). */
export const MAX_SCAN_RETRIES = 3;

export function emptyTotals(): MacroTotals {
  return { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
}

/** Only successfully logged meals contribute to daily totals. */
export function isCountedMeal(meal: Pick<Meal, "status">): boolean {
  return meal.status === "logged";
}

export function sumMeals(
  meals: (Pick<Meal, keyof MacroTotals> & Pick<Meal, "status">)[],
): MacroTotals {
  return meals.filter(isCountedMeal).reduce(
    (acc, meal) => ({
      calories: acc.calories + meal.calories,
      proteinG: acc.proteinG + meal.proteinG,
      carbsG: acc.carbsG + meal.carbsG,
      fatG: acc.fatG + meal.fatG,
    }),
    emptyTotals(),
  );
}

import type { ScanMode } from "@/lib/gemini";

export type MealStatus = "pending" | "scanned" | "logged";

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
  /** pending = awaiting Gemini; scanned = auto-filled; logged = user-confirmed */
  status: MealStatus;
  scanMode: ScanMode;
  /** Last scan/queue error, if any */
  lastError?: string;
};

export type MacroTotals = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export const RETENTION_DAYS = 30;

export function emptyTotals(): MacroTotals {
  return { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
}

/** Only meals with filled macros contribute to daily totals. */
export function isCountedMeal(meal: Pick<Meal, "status">): boolean {
  return meal.status === "scanned" || meal.status === "logged";
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

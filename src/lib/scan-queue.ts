import { toast } from "sonner";
import {
  getGeminiApiKey,
  getPendingMeals,
  updateMeal,
} from "@/lib/db";
import {
  analyzeMealImage,
  analyzeNutritionLabel,
  formatPortionSuffix,
  scaleLabelNutrition,
} from "@/lib/gemini";
import type { Meal } from "@/lib/types";

const MEALS_CHANGED = "calorie-tracker:meals-changed";

let processing = false;

/** Notify UI hooks that meal data changed (queue / rescan). */
export function notifyMealsChanged() {
  window.dispatchEvent(new Event(MEALS_CHANGED));
}

export function subscribeMealsChanged(listener: () => void) {
  window.addEventListener(MEALS_CHANGED, listener);
  return () => window.removeEventListener(MEALS_CHANGED, listener);
}

export async function markMealPending(mealId: string): Promise<Meal> {
  const updated = await updateMeal(mealId, {
    status: "pending",
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    lastError: undefined,
    label: "Pending scan…",
  });
  notifyMealsChanged();
  return updated;
}

async function processOne(apiKey: string, meal: Meal): Promise<boolean> {
  try {
    if (meal.scanMode === "label") {
      const label = await analyzeNutritionLabel(apiKey, meal.imageBlob);
      const scaled = scaleLabelNutrition(label, label.basisGrams);
      if (!scaled) {
        throw new Error("Could not scale label nutrition");
      }
      await updateMeal(meal.id, {
        status: "scanned",
        label: `${scaled.label} (${formatPortionSuffix(
          { kind: "grams", grams: label.basisGrams },
          label.basisGrams,
        )})`,
        calories: scaled.calories,
        proteinG: scaled.proteinG,
        carbsG: scaled.carbsG,
        fatG: scaled.fatG,
        lastError: undefined,
      });
    } else {
      const result = await analyzeMealImage(apiKey, meal.imageBlob);
      await updateMeal(meal.id, {
        status: "scanned",
        label: result.label,
        calories: result.calories,
        proteinG: result.proteinG,
        carbsG: result.carbsG,
        fatG: result.fatG,
        lastError: undefined,
      });
    }
    return true;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Scan failed — will retry later";
    await updateMeal(meal.id, {
      status: "pending",
      lastError: message,
    });
    return false;
  }
}

/**
 * Process all pending meals one-by-one. Safe to call concurrently —
 * overlapping calls share a single run.
 */
export async function processPendingScans(options?: {
  silent?: boolean;
}): Promise<{ processed: number; failed: number }> {
  if (processing) {
    return { processed: 0, failed: 0 };
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { processed: 0, failed: 0 };
  }

  processing = true;
  let processed = 0;
  let failed = 0;

  try {
    const apiKey = await getGeminiApiKey();
    if (!apiKey?.trim()) {
      return { processed: 0, failed: 0 };
    }

    const pending = await getPendingMeals();
    if (pending.length === 0) {
      return { processed: 0, failed: 0 };
    }

    if (!options?.silent) {
      toast.message(
        pending.length === 1
          ? "Scanning 1 pending meal…"
          : `Scanning ${pending.length} pending meals…`,
      );
    }

    for (const meal of pending) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        break;
      }
      const ok = await processOne(apiKey, meal);
      if (ok) processed += 1;
      else failed += 1;
    }

    if (processed > 0 || failed > 0) {
      notifyMealsChanged();
    }

    if (!options?.silent) {
      if (processed > 0 && failed === 0) {
        toast.success(
          processed === 1
            ? "Pending meal scanned"
            : `${processed} pending meals scanned`,
        );
      } else if (processed > 0 && failed > 0) {
        toast.warning(
          `${processed} scanned, ${failed} still pending`,
        );
      } else if (failed > 0) {
        toast.error(
          failed === 1
            ? "Pending scan failed — tap Rescan to try again"
            : `${failed} pending scans failed`,
        );
      }
    }
  } finally {
    processing = false;
  }

  return { processed, failed };
}

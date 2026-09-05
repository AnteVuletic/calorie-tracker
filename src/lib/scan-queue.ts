import { toast } from "sonner";
import {
  getEarliestPendingAttemptAt,
  getGeminiApiKey,
  getPendingMeals,
  updateMeal,
} from "@/lib/db";
import {
  analyzeMealImage,
  analyzeNutritionLabel,
  estimatePortionGrams,
  formatPortionSuffix,
  parsePortionInput,
  scaleLabelNutrition,
} from "@/lib/gemini";
import { MAX_SCAN_RETRIES, type Meal } from "@/lib/types";

const MEALS_CHANGED = "calorie-tracker:meals-changed";
const BASE_BACKOFF_MS = 1000;

let processing = false;
let rerunRequested = false;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;

/** Notify UI hooks that meal data changed (queue / rescan). */
export function notifyMealsChanged() {
  window.dispatchEvent(new Event(MEALS_CHANGED));
}

export function subscribeMealsChanged(listener: () => void) {
  window.addEventListener(MEALS_CHANGED, listener);
  return () => window.removeEventListener(MEALS_CHANGED, listener);
}

function clearBackoffTimer() {
  if (backoffTimer != null) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

function scheduleBackoffDrain() {
  clearBackoffTimer();
  void (async () => {
    const nextAt = await getEarliestPendingAttemptAt();
    if (!nextAt) return;
    const delay = Math.max(0, Date.parse(nextAt) - Date.now());
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      void processPendingScans({ silent: true });
    }, delay);
  })();
}

export async function markMealPending(mealId: string): Promise<Meal> {
  const updated = await updateMeal(mealId, {
    status: "pending",
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    lastError: undefined,
    retryCount: 0,
    nextAttemptAt: undefined,
    label: "Pending scan…",
  });
  notifyMealsChanged();
  return updated;
}

/**
 * Update a label scan's portion and re-queue it for analysis.
 */
export async function updateLabelPortionAndRescan(
  mealId: string,
  portionRaw: string,
): Promise<Meal> {
  const trimmed = portionRaw.trim();
  const portion = parsePortionInput(trimmed);
  if (!portion) {
    throw new Error('Enter grams or a portion like "1 teaspoon"');
  }
  const updated = await updateMeal(mealId, {
    portionRaw: trimmed,
    status: "pending",
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    lastError: undefined,
    retryCount: 0,
    nextAttemptAt: undefined,
    label: "Pending scan…",
  });
  notifyMealsChanged();
  if (typeof navigator !== "undefined" && navigator.onLine) {
    void processPendingScans({ silent: true });
  }
  return updated;
}

async function handleFailure(meal: Meal, message: string): Promise<void> {
  const nextRetry = (meal.retryCount ?? 0) + 1;
  if (nextRetry > MAX_SCAN_RETRIES) {
    await updateMeal(meal.id, {
      status: "fail",
      retryCount: nextRetry,
      nextAttemptAt: undefined,
      lastError: message,
      label: meal.label === "Pending scan…" ? "Scan failed" : meal.label,
    });
    return;
  }
  const delayMs = BASE_BACKOFF_MS * 2 ** (nextRetry - 1);
  await updateMeal(meal.id, {
    status: "pending",
    retryCount: nextRetry,
    nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
    lastError: message,
  });
}

async function processOne(apiKey: string, meal: Meal): Promise<boolean> {
  await updateMeal(meal.id, {
    status: "processing",
    lastError: undefined,
    nextAttemptAt: undefined,
  });
  notifyMealsChanged();

  try {
    if (meal.scanMode === "label") {
      const portionRaw = meal.portionRaw?.trim() ?? "";
      const portion = parsePortionInput(portionRaw);
      if (!portion) {
        throw new Error('Enter grams or a portion like "1 teaspoon"');
      }

      const label = await analyzeNutritionLabel(apiKey, meal.imageBlob);
      const grams =
        portion.kind === "grams"
          ? portion.grams
          : await estimatePortionGrams(
              apiKey,
              meal.imageBlob,
              label.label,
              label.basisGrams,
              portion.text,
            );
      const scaled = scaleLabelNutrition(label, grams);
      if (!scaled) {
        throw new Error("Could not scale label nutrition");
      }
      await updateMeal(meal.id, {
        status: "logged",
        label: `${scaled.label} (${formatPortionSuffix(portion, grams)})`,
        calories: scaled.calories,
        proteinG: scaled.proteinG,
        carbsG: scaled.carbsG,
        fatG: scaled.fatG,
        retryCount: 0,
        nextAttemptAt: undefined,
        lastError: undefined,
      });
    } else {
      const result = await analyzeMealImage(apiKey, meal.imageBlob);
      await updateMeal(meal.id, {
        status: "logged",
        label: result.label,
        calories: result.calories,
        proteinG: result.proteinG,
        carbsG: result.carbsG,
        fatG: result.fatG,
        retryCount: 0,
        nextAttemptAt: undefined,
        lastError: undefined,
      });
    }
    return true;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Scan failed — will retry later";
    await handleFailure(meal, message);
    return false;
  }
}

/**
 * Process all ready pending meals one-by-one. Safe to call concurrently —
 * overlapping calls share a single run (and request a follow-up pass).
 */
export async function processPendingScans(options?: {
  silent?: boolean;
}): Promise<{ processed: number; failed: number }> {
  if (processing) {
    rerunRequested = true;
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

    let announced = false;

    while (true) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        break;
      }

      const pending = await getPendingMeals();
      if (pending.length === 0) {
        break;
      }

      if (!options?.silent && !announced) {
        announced = true;
        toast.message(
          pending.length === 1
            ? "Scanning 1 pending meal…"
            : `Scanning ${pending.length} pending meals…`,
        );
      }

      // One item at a time; re-fetch after each so backoff skips apply.
      const meal = pending[0];
      const ok = await processOne(apiKey, meal);
      if (ok) processed += 1;
      else failed += 1;
      notifyMealsChanged();
    }

    if (!options?.silent) {
      if (processed > 0 && failed === 0) {
        toast.success(
          processed === 1 ? "Meal logged" : `${processed} meals logged`,
        );
      } else if (processed > 0 && failed > 0) {
        toast.warning(
          `${processed} logged, ${failed} still pending or failed`,
        );
      } else if (failed > 0) {
        toast.error(
          failed === 1
            ? "Scan failed — will retry or tap Rescan"
            : `${failed} scans failed`,
        );
      }
    }
  } finally {
    processing = false;
    if (rerunRequested) {
      rerunRequested = false;
      void processPendingScans({ silent: true });
    } else {
      scheduleBackoffDrain();
    }
  }

  return { processed, failed };
}

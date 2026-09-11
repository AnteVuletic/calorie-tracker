import { roundMacro } from "@/lib/dates";
import { getMeal, updateMeal } from "@/lib/db";
import {
  emptyTotals,
  type MacroTotals,
  type Meal,
  type MealItem,
  type MealItemEdit,
} from "@/lib/types";

export type MealPhotoEstimate = {
  label: string;
  items: MealItem[];
};

export function mealHasEditableItems(
  meal: Pick<Meal, "scanMode" | "status" | "items">,
): boolean {
  return (
    meal.scanMode === "meal" &&
    meal.status === "logged" &&
    Array.isArray(meal.items) &&
    meal.items.length > 0
  );
}

function cloneItem(item: MealItem): MealItem {
  return {
    id: item.id,
    name: item.name,
    grams: item.grams,
    basis: {
      grams: item.basis.grams,
      nutrition: { ...item.basis.nutrition },
    },
  };
}

/** Shared by meal items and label portion scaling. Null when weights are invalid. */
export function scaleMacros(
  nutrition: MacroTotals,
  fromGrams: number,
  toGrams: number,
): MacroTotals | null {
  if (!Number.isFinite(fromGrams) || fromGrams <= 0) return null;
  if (!Number.isFinite(toGrams) || toGrams <= 0) return null;
  const factor = toGrams / fromGrams;
  const calories = nutrition.calories * factor;
  const proteinG = nutrition.proteinG * factor;
  const carbsG = nutrition.carbsG * factor;
  const fatG = nutrition.fatG * factor;
  if (![calories, proteinG, carbsG, fatG].every((n) => Number.isFinite(n))) {
    return null;
  }
  return {
    calories: Math.max(0, Math.round(calories)),
    proteinG: Math.max(0, roundMacro(proteinG)),
    carbsG: Math.max(0, roundMacro(carbsG)),
    fatG: Math.max(0, roundMacro(fatG)),
  };
}

/** Unrounded nutrition at the item's current grams, from the frozen basis pair. */
export function scaleItem(item: MealItem): MacroTotals {
  const fromGrams = item.basis.grams;
  const toGrams = item.grams;
  if (!Number.isFinite(fromGrams) || fromGrams <= 0) {
    throw new Error("Item is missing a valid basis weight");
  }
  if (!Number.isFinite(toGrams) || toGrams <= 0) {
    throw new Error("Item grams must be a positive number");
  }
  const factor = toGrams / fromGrams;
  const nutrition = item.basis.nutrition;
  return {
    calories: nutrition.calories * factor,
    proteinG: nutrition.proteinG * factor,
    carbsG: nutrition.carbsG * factor,
    fatG: nutrition.fatG * factor,
  };
}

/** Rounded macros shown on a row, matching label-scan rounding. */
export function macrosForItem(item: MealItem): MacroTotals {
  const scaled = scaleMacros(
    item.basis.nutrition,
    item.basis.grams,
    item.grams,
  );
  if (!scaled) {
    throw new Error("Item is missing a valid basis weight");
  }
  return scaled;
}

/** Meal header cache: sum of the rounded per-item macros the UI displays. */
export function sumItems(items: readonly MealItem[]): MacroTotals {
  return items.reduce((acc, item) => {
    const row = macrosForItem(item);
    return {
      calories: Math.round(acc.calories + row.calories),
      proteinG: roundMacro(acc.proteinG + row.proteinG),
      carbsG: roundMacro(acc.carbsG + row.carbsG),
      fatG: roundMacro(acc.fatG + row.fatG),
    };
  }, emptyTotals());
}

export function applyMealItemEdits(
  items: readonly MealItem[],
  edits: readonly MealItemEdit[],
): MealItem[] {
  if (items.length === 0) {
    throw new Error("This meal has no item list to edit — Rescan first");
  }

  let next = items.map(cloneItem);

  for (const edit of edits) {
    switch (edit.kind) {
      case "setGrams": {
        if (!Number.isFinite(edit.grams) || edit.grams <= 0) {
          throw new Error("Grams must be a positive number");
        }
        const index = next.findIndex((item) => item.id === edit.itemId);
        if (index === -1) {
          throw new Error("Item not found");
        }
        next[index] = { ...next[index], grams: edit.grams };
        break;
      }
      case "remove": {
        const filtered = next.filter((item) => item.id !== edit.itemId);
        if (filtered.length === next.length) {
          throw new Error("Item not found");
        }
        if (filtered.length === 0) {
          throw new Error("Cannot remove the last item");
        }
        next = filtered;
        break;
      }
      case "scalePlate": {
        if (!Number.isFinite(edit.factor) || edit.factor <= 0) {
          throw new Error("Scale factor must be a positive number");
        }
        next = next.map((item) => ({
          ...item,
          grams: item.grams * edit.factor,
        }));
        break;
      }
      default: {
        const _exhaustive: never = edit;
        throw new Error(`Unsupported meal item edit: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  return next;
}

export async function saveMealPhotoEstimate(
  mealId: string,
  estimate: MealPhotoEstimate,
): Promise<Meal> {
  if (estimate.items.length === 0) {
    throw new Error("Meal estimate has no items");
  }
  const totals = sumItems(estimate.items);
  return updateMeal(mealId, {
    status: "logged",
    label: estimate.label,
    items: estimate.items,
    calories: totals.calories,
    proteinG: totals.proteinG,
    carbsG: totals.carbsG,
    fatG: totals.fatG,
    retryCount: 0,
    nextAttemptAt: undefined,
    lastError: undefined,
  });
}

export async function saveMealItemEdits(
  mealId: string,
  edits: readonly MealItemEdit[],
): Promise<Meal> {
  const meal = await getMeal(mealId);
  if (!meal || !mealHasEditableItems(meal) || !meal.items) {
    throw new Error("This meal has no item list to edit — Rescan first");
  }
  const items = applyMealItemEdits(meal.items, edits);
  const totals = sumItems(items);
  return updateMeal(mealId, {
    items,
    calories: totals.calories,
    proteinG: totals.proteinG,
    carbsG: totals.carbsG,
    fatG: totals.fatG,
  });
}

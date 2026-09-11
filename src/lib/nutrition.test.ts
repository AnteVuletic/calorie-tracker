import { describe, expect, it } from "vitest";
import {
  buildMealPrompt,
  extractJson,
  formatPortionSuffix,
  GEMINI_LABEL_MODEL,
  GEMINI_MEAL_MODEL,
  mediaResolutionForMode,
  modelForMode,
  parseLabelScanResult,
  parseMealPhotoEstimate,
  parsePortionGramsResult,
  parsePortionInput,
  parseScanResult,
  scaleLabelNutrition,
  thinkingLevelForMode,
} from "@/lib/gemini";
import {
  compressOptionsForMode,
  DEFAULT_LABEL,
  DEFAULT_MEAL,
} from "@/lib/image";
import {
  dedupeBySimilarName,
  filterByFoodQuery,
  nameSimilarity,
  productNameFromLabel,
} from "@/lib/food-match";
import {
  applyMealItemEdits,
  macrosForItem,
  mealHasEditableItems,
  scaleItem,
  sumItems,
} from "@/lib/meal-items";
import { sumMeals, type MealItem } from "@/lib/types";

describe("mediaResolutionForMode", () => {
  it("uses low for meals and medium for labels", () => {
    expect(mediaResolutionForMode("meal")).toBe("MEDIA_RESOLUTION_LOW");
    expect(mediaResolutionForMode("label")).toBe("MEDIA_RESOLUTION_MEDIUM");
  });
});

describe("thinkingLevelForMode", () => {
  it("uses low thinking for meals and minimal for labels", () => {
    expect(thinkingLevelForMode("meal")).toBe("low");
    expect(thinkingLevelForMode("label")).toBe("minimal");
  });
});

describe("modelForMode", () => {
  it("uses flash-lite for meals and labels", () => {
    expect(modelForMode("meal")).toBe(GEMINI_MEAL_MODEL);
    expect(modelForMode("label")).toBe(GEMINI_LABEL_MODEL);
    expect(GEMINI_MEAL_MODEL).toBe("gemini-3.5-flash-lite");
    expect(GEMINI_LABEL_MODEL).toBe("gemini-3.5-flash-lite");
  });
});

describe("compressOptionsForMode", () => {
  it("keeps meal images near one vision tile and labels sharper", () => {
    expect(compressOptionsForMode("meal")).toEqual(DEFAULT_MEAL);
    expect(compressOptionsForMode("label")).toEqual(DEFAULT_LABEL);
    expect(DEFAULT_MEAL.maxEdge).toBeLessThanOrEqual(768);
    expect(DEFAULT_LABEL.maxEdge).toBeLessThanOrEqual(1280);
    expect(DEFAULT_LABEL.maxEdge).toBeGreaterThan(DEFAULT_MEAL.maxEdge);
  });
});

describe("buildMealPrompt", () => {
  it("returns the base prompt when context is missing or blank", () => {
    const base = buildMealPrompt();
    expect(base).toContain("nutrition estimator");
    expect(base).toContain("estimatedGrams");
    expect(base).toContain('"items"');
    expect(base).not.toContain("User-provided context");
    expect(buildMealPrompt("   ")).toBe(base);
  });

  it("appends trimmed user context for meat / size ambiguities", () => {
    const prompt = buildMealPrompt("  the meat is veal  ");
    expect(prompt).toContain("User-provided context");
    expect(prompt).toContain('"the meat is veal"');
    expect(prompt).toContain("meat type");
    expect(prompt.indexOf("User-provided context")).toBeGreaterThan(
      prompt.indexOf("nutrition estimator"),
    );
  });
});

describe("extractJson", () => {
  it("parses fenced json", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses raw object text", () => {
    expect(extractJson('Here you go {"label":"Soup","calories":100,"proteinG":1,"carbsG":2,"fatG":3} done')).toEqual({
      label: "Soup",
      calories: 100,
      proteinG: 1,
      carbsG: 2,
      fatG: 3,
    });
  });
});

describe("parseScanResult", () => {
  it("rejects sentinel not food", () => {
    expect(() =>
      parseScanResult({
        label: "Not food",
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
      }),
    ).toThrow(/doesn't look like food/i);
  });

  it("rejects null nutrition fields", () => {
    expect(() =>
      parseScanResult({
        label: "Salad",
        calories: 200,
        proteinG: null,
        carbsG: 10,
        fatG: 5,
      }),
    ).toThrow(/proteinG/);
  });

  it("accepts valid meal json", () => {
    expect(
      parseScanResult({
        label: "Oatmeal",
        calories: 350,
        proteinG: 12.34,
        carbsG: 50,
        fatG: 8,
      }),
    ).toEqual({
      label: "Oatmeal",
      calories: 350,
      proteinG: 12.3,
      carbsG: 50,
      fatG: 8,
    });
  });
});

describe("parseMealPhotoEstimate", () => {
  const chickenItem = {
    name: "  Grilled chicken  ",
    estimatedGrams: 140,
    calories: 231,
    proteinG: 43.4,
    carbsG: 0,
    fatG: 5,
  };

  it("assigns ids, trims names, and keeps unrounded basis grams", () => {
    const estimate = parseMealPhotoEstimate({
      label: "Chicken rice bowl",
      items: [
        chickenItem,
        {
          name: "Rice",
          estimatedGrams: 180.25,
          calories: 234.2,
          proteinG: 4.81,
          carbsG: 49.5,
          fatG: 0.5,
        },
      ],
    });
    expect(estimate.label).toBe("Chicken rice bowl");
    expect(estimate.items).toHaveLength(2);
    expect(estimate.items[0].name).toBe("Grilled chicken");
    expect(estimate.items[0].grams).toBe(140);
    expect(estimate.items[0].basis.grams).toBe(140);
    expect(estimate.items[0].basis.nutrition).toEqual({
      calories: 231,
      proteinG: 43.4,
      carbsG: 0,
      fatG: 5,
    });
    expect(estimate.items[1].grams).toBe(180.25);
    expect(estimate.items[1].basis.nutrition.proteinG).toBe(4.81);
    expect(estimate.items[0].id).not.toBe(estimate.items[1].id);
    expect(estimate.items[0].id.length).toBeGreaterThan(0);
  });

  it("rejects an empty item list instead of fabricating grams", () => {
    expect(() =>
      parseMealPhotoEstimate({ label: "Soup", items: [] }),
    ).toThrow(/no items/i);
    expect(() =>
      parseMealPhotoEstimate({
        label: "Soup",
        calories: 200,
        proteinG: 10,
        carbsG: 20,
        fatG: 5,
      }),
    ).toThrow(/missing items/i);
  });

  it("rejects invalid, incomplete, or oversized item lists", () => {
    expect(() =>
      parseMealPhotoEstimate({
        label: "Soup",
        items: [
          {
            name: "Soup",
            estimatedGrams: 0,
            calories: 100,
            proteinG: 1,
            carbsG: 10,
            fatG: 1,
          },
        ],
      }),
    ).toThrow(/estimatedGrams/i);
    expect(() =>
      parseMealPhotoEstimate({
        label: "Soup",
        items: [
          {
            name: "Soup",
            estimatedGrams: null,
            calories: 100,
            proteinG: 1,
            carbsG: 10,
            fatG: 1,
          },
        ],
      }),
    ).toThrow(/estimatedGrams/i);
    expect(() =>
      parseMealPhotoEstimate({
        label: "Salad",
        items: [
          {
            name: "Oil",
            estimatedGrams: 10,
            calories: -5,
            proteinG: 0,
            carbsG: 0,
            fatG: 10,
          },
        ],
      }),
    ).toThrow(/negative calories/i);
    expect(() =>
      parseMealPhotoEstimate({
        label: "Plate",
        items: Array.from({ length: 9 }, (_, i) => ({
          name: `Item ${i + 1}`,
          estimatedGrams: 10,
          calories: 10,
          proteinG: 1,
          carbsG: 1,
          fatG: 1,
        })),
      }),
    ).toThrow(/more than 8/i);
  });

  it("rejects a not-food sentinel even with an empty list", () => {
    expect(() =>
      parseMealPhotoEstimate({ label: "Not food", items: [] }),
    ).toThrow(/doesn't look like food/i);
  });
});

describe("parseLabelScanResult + scaleLabelNutrition", () => {
  it("rejects tiny basis that rounds to zero", () => {
    expect(() =>
      parseLabelScanResult({
        label: "Snack",
        calories: 10,
        proteinG: 1,
        carbsG: 1,
        fatG: 1,
        basisGrams: 0.04,
      }),
    ).toThrow(/basis/i);
  });

  it("scales a 28g serving to 100g", () => {
    const label = parseLabelScanResult({
      label: "Bar",
      calories: 140,
      proteinG: 5,
      carbsG: 15,
      fatG: 6,
      basisGrams: 28,
    });
    const scaled = scaleLabelNutrition(label, 100);
    expect(scaled).not.toBeNull();
    expect(scaled!.calories).toBe(Math.round((140 * 100) / 28));
    expect(scaled!.proteinG).toBeCloseTo((5 * 100) / 28, 1);
  });

  it("returns null for invalid grams", () => {
    const label = parseLabelScanResult({
      label: "Bar",
      calories: 100,
      proteinG: 1,
      carbsG: 1,
      fatG: 1,
      basisGrams: 100,
    });
    expect(scaleLabelNutrition(label, 0)).toBeNull();
    expect(scaleLabelNutrition(label, -5)).toBeNull();
  });

  it("rejects not a nutrition label sentinel", () => {
    expect(() =>
      parseLabelScanResult({
        label: "Not a nutrition label",
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        basisGrams: 100,
      }),
    ).toThrow(/nutrition label/i);
  });
});

describe("parsePortionInput", () => {
  it("parses plain grams and g suffix", () => {
    expect(parsePortionInput("150")).toEqual({ kind: "grams", grams: 150 });
    expect(parsePortionInput("40.5g")).toEqual({ kind: "grams", grams: 40.5 });
    expect(parsePortionInput("12 grams")).toEqual({ kind: "grams", grams: 12 });
  });

  it("treats portion phrases as descriptions", () => {
    expect(parsePortionInput("1 row of chocolate")).toEqual({
      kind: "description",
      text: "1 row of chocolate",
    });
    expect(parsePortionInput("one teaspoon")).toEqual({
      kind: "description",
      text: "one teaspoon",
    });
  });

  it("rejects empty or non-positive grams", () => {
    expect(parsePortionInput("")).toBeNull();
    expect(parsePortionInput("0")).toBeNull();
    expect(parsePortionInput("  ")).toBeNull();
  });
});

describe("parsePortionGramsResult + formatPortionSuffix", () => {
  it("parses positive grams", () => {
    expect(parsePortionGramsResult({ grams: 5.25 })).toBe(5.3);
  });

  it("rejects non-positive grams", () => {
    expect(() => parsePortionGramsResult({ grams: 0 })).toThrow(/portion/i);
  });

  it("formats gram and description suffixes", () => {
    expect(formatPortionSuffix({ kind: "grams", grams: 40 }, 40)).toBe("40g");
    expect(
      formatPortionSuffix(
        { kind: "description", text: "one teaspoon" },
        5,
      ),
    ).toBe("one teaspoon · ~5g");
  });
});

function chickenRicePlate(): MealItem[] {
  return [
    {
      id: "chicken",
      name: "Grilled chicken",
      grams: 180,
      basis: {
        grams: 180,
        nutrition: { calories: 297, proteinG: 55.8, carbsG: 0, fatG: 6.5 },
      },
    },
    {
      id: "rice",
      name: "White rice",
      grams: 150,
      basis: {
        grams: 150,
        nutrition: { calories: 195, proteinG: 4.1, carbsG: 42, fatG: 0.4 },
      },
    },
  ];
}

const PLATE_TOTALS = {
  calories: 492,
  proteinG: 59.9,
  carbsG: 42,
  fatG: 6.9,
};

describe("meal item algebra", () => {
  it("scales an item from the frozen basis, not from a previous edit", () => {
    const [chicken] = chickenRicePlate();
    expect(scaleItem(chicken)).toEqual({
      calories: 297,
      proteinG: 55.8,
      carbsG: 0,
      fatG: 6.5,
    });
    const doubled = applyMealItemEdits([chicken], [
      { kind: "setGrams", itemId: "chicken", grams: 360 },
    ])[0];
    expect(scaleItem(doubled)).toEqual({
      calories: 594,
      proteinG: 111.6,
      carbsG: 0,
      fatG: 13,
    });
  });

  it("uses the sum of rounded row macros as the meal cache", () => {
    const items = chickenRicePlate();
    expect(macrosForItem(items[0])).toEqual({
      calories: 297,
      proteinG: 55.8,
      carbsG: 0,
      fatG: 6.5,
    });
    expect(macrosForItem(items[1])).toEqual({
      calories: 195,
      proteinG: 4.1,
      carbsG: 42,
      fatG: 0.4,
    });
    expect(sumItems(items)).toEqual(PLATE_TOTALS);
  });

  it("returns original totals after scaling grams up then back", () => {
    const items = chickenRicePlate();
    const up = applyMealItemEdits(items, [
      { kind: "setGrams", itemId: "chicken", grams: 240 },
    ]);
    expect(sumItems(up)).toEqual({
      calories: 591,
      proteinG: 78.5,
      carbsG: 42,
      fatG: 9.1,
    });
    const back = applyMealItemEdits(up, [
      { kind: "setGrams", itemId: "chicken", grams: 180 },
    ]);
    expect(sumItems(back)).toEqual(PLATE_TOTALS);
    expect(back[0].basis).toEqual(items[0].basis);
  });

  it("rejects removing the last item", () => {
    const items = chickenRicePlate();
    const withoutRice = applyMealItemEdits(items, [
      { kind: "remove", itemId: "rice" },
    ]);
    expect(withoutRice).toHaveLength(1);
    expect(withoutRice[0].id).toBe("chicken");
    expect(sumItems(withoutRice)).toEqual({
      calories: 297,
      proteinG: 55.8,
      carbsG: 0,
      fatG: 6.5,
    });
    expect(() =>
      applyMealItemEdits(withoutRice, [{ kind: "remove", itemId: "chicken" }]),
    ).toThrow(/last item/i);
  });

  it("rewrites current grams on scalePlate and can scale back", () => {
    const items = chickenRicePlate();
    const half = applyMealItemEdits(items, [
      { kind: "scalePlate", factor: 0.5 },
    ]);
    expect(half.map((item) => item.grams)).toEqual([90, 75]);
    expect(half[0].basis.grams).toBe(180);
    expect(sumItems(half)).toEqual({
      calories: 247,
      proteinG: 30,
      carbsG: 21,
      fatG: 3.5,
    });
    const restored = applyMealItemEdits(half, [
      { kind: "scalePlate", factor: 2 },
    ]);
    expect(restored.map((item) => item.grams)).toEqual([180, 150]);
    expect(sumItems(restored)).toEqual(PLATE_TOTALS);
  });

  it("hides the editor for labels, pending rows, and legacy meals", () => {
    const items = chickenRicePlate();
    expect(
      mealHasEditableItems({
        scanMode: "meal",
        status: "logged",
        items,
      }),
    ).toBe(true);
    expect(
      mealHasEditableItems({
        scanMode: "meal",
        status: "logged",
      }),
    ).toBe(false);
    expect(
      mealHasEditableItems({
        scanMode: "label",
        status: "logged",
        items,
      }),
    ).toBe(false);
    expect(
      mealHasEditableItems({
        scanMode: "meal",
        status: "pending",
        items,
      }),
    ).toBe(false);
  });
});

describe("sumMeals", () => {
  it("only counts logged meals in totals", () => {
    expect(
      sumMeals([
        {
          status: "logged",
          calories: 100,
          proteinG: 10,
          carbsG: 10,
          fatG: 5,
        },
        {
          status: "pending",
          calories: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
        },
        {
          status: "processing",
          calories: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
        },
        {
          status: "fail",
          calories: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
        },
        {
          status: "logged",
          calories: 200,
          proteinG: 20,
          carbsG: 20,
          fatG: 10,
        },
      ]),
    ).toEqual({
      calories: 300,
      proteinG: 30,
      carbsG: 30,
      fatG: 15,
    });
  });
});

describe("food-match", () => {
  it("strips portion suffixes from labels", () => {
    expect(productNameFromLabel("Protein Bar (40g)")).toBe("Protein Bar");
    expect(productNameFromLabel("Dark Chocolate (1 row · ~12g)")).toBe(
      "Dark Chocolate",
    );
    expect(productNameFromLabel("Soup")).toBe("Soup");
  });

  it("scores near-identical names highly", () => {
    expect(nameSimilarity("Greek Yogurt", "greek yoghurt")).toBeGreaterThan(
      0.8,
    );
    expect(nameSimilarity("Oat Milk", "Almond Milk")).toBeLessThan(0.8);
  });

  it("dedupes entries when names match at least 80%", () => {
    const kept = dedupeBySimilarName([
      {
        id: "1",
        createdAt: "2026-09-01T10:00:00.000Z",
        label: "Choco Bar (40g)",
      },
      {
        id: "2",
        createdAt: "2026-09-03T10:00:00.000Z",
        label: "Choco Bar (80g)",
      },
      {
        id: "3",
        createdAt: "2026-09-02T10:00:00.000Z",
        label: "Greek Yogurt (150g)",
      },
    ]);
    expect(kept.map((e) => e.id)).toEqual(["2", "3"]);
  });

  it("filters previous entries by search query", () => {
    const entries = [
      {
        id: "1",
        createdAt: "2026-09-01T10:00:00.000Z",
        label: "Almond Butter (20g)",
      },
      {
        id: "2",
        createdAt: "2026-09-02T10:00:00.000Z",
        label: "Peanut Butter (30g)",
      },
    ];
    expect(filterByFoodQuery(entries, "almond").map((e) => e.id)).toEqual([
      "1",
    ]);
    expect(filterByFoodQuery(entries, "").map((e) => e.id)).toEqual([
      "1",
      "2",
    ]);
  });
});

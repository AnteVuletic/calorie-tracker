import { describe, expect, it } from "vitest";
import {
  buildMealPrompt,
  extractJson,
  formatPortionSuffix,
  parseLabelScanResult,
  parsePortionGramsResult,
  parsePortionInput,
  parseScanResult,
  scaleLabelNutrition,
} from "@/lib/gemini";
import {
  dedupeBySimilarName,
  filterByFoodQuery,
  nameSimilarity,
  productNameFromLabel,
} from "@/lib/food-match";
import { sumMeals } from "@/lib/types";

describe("buildMealPrompt", () => {
  it("returns the base prompt when context is missing or blank", () => {
    const base = buildMealPrompt();
    expect(base).toContain("nutrition estimator");
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

import { describe, expect, it } from "vitest";
import {
  extractJson,
  formatPortionSuffix,
  parseLabelScanResult,
  parsePortionGramsResult,
  parsePortionInput,
  parseScanResult,
  scaleLabelNutrition,
} from "@/lib/gemini";
import {
  isWithinRetention,
  retentionCutoff,
  toDayKey,
} from "@/lib/dates";
import { RETENTION_DAYS, sumMeals } from "@/lib/types";
import { subDays, startOfDay } from "date-fns";

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
  it("excludes pending meals from totals", () => {
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
          status: "scanned",
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

describe("retention", () => {
  it("keeps an inclusive RETENTION_DAYS window", () => {
    const now = new Date("2026-09-04T15:00:00");
    const cutoff = retentionCutoff(now);
    expect(toDayKey(cutoff)).toBe(
      toDayKey(startOfDay(subDays(now, RETENTION_DAYS - 1))),
    );
    expect(isWithinRetention(toDayKey(cutoff), now)).toBe(true);
    expect(
      isWithinRetention(toDayKey(subDays(cutoff, 1)), now),
    ).toBe(false);
    expect(isWithinRetention(toDayKey(now), now)).toBe(true);
  });
});

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addMeal,
  clearAllMeals,
  deleteMeal,
  getGeminiApiKey,
  getMealsByDay,
  getMealsInRange,
  setGeminiApiKey,
  clearGeminiApiKey,
  requestPersistentStorage,
  updateMeal,
  migrateMeals,
  type NewMealInput,
} from "@/lib/db";
import { msUntilNextLocalMidnight, toDayKey } from "@/lib/dates";
import type { Meal } from "@/lib/types";
import { sumMeals } from "@/lib/types";
import {
  markMealPending,
  processPendingScans,
  subscribeMealsChanged,
  updateLabelPortionAndRescan,
} from "@/lib/scan-queue";

export function useLocalDayKey() {
  const [dayKey, setDayKey] = useState(() => toDayKey());

  useEffect(() => {
    const sync = () => setDayKey(toDayKey());
    const id = window.setTimeout(sync, msUntilNextLocalMidnight());
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", sync);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", sync);
    };
  }, [dayKey]);

  return dayKey;
}

export function useMealsForDay(dayKey: string) {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
    const gen = ++genRef.current;
    // Quiet refreshes (scan queue) keep cards mounted so blob: URLs stay valid.
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      const next = await getMealsByDay(dayKey);
      if (gen !== genRef.current) return;
      setMeals(next);
    } catch (err) {
      if (gen !== genRef.current) return;
      setError(err instanceof Error ? err.message : "Could not load meals");
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [dayKey]);

  useEffect(() => {
    void refresh();
    return () => {
      genRef.current += 1;
    };
  }, [refresh]);

  useEffect(
    () => subscribeMealsChanged(() => void refresh({ quiet: true })),
    [refresh],
  )

  return {
    meals,
    loading,
    error,
    totals: sumMeals(meals),
    refresh,
    remove: async (id: string) => {
      await deleteMeal(id);
      await refresh();
    },
    create: async (input: NewMealInput) => {
      const meal = await addMeal(input);
      await requestPersistentStorage();
      await refresh();
      return meal;
    },
    update: async (
      id: string,
      patch: Partial<Omit<Meal, "id" | "createdAt" | "dayKey">>,
    ) => {
      const meal = await updateMeal(id, patch);
      await refresh();
      return meal;
    },
    rescan: async (id: string) => {
      await markMealPending(id);
      await refresh();
      if (navigator.onLine) {
        void processPendingScans();
      }
    },
    updatePortion: async (id: string, portionRaw: string) => {
      const meal = await updateLabelPortionAndRescan(id, portionRaw);
      await refresh();
      return meal;
    },
  };
}

export function useMealsRange(fromKey: string, toKey: string) {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
    const gen = ++genRef.current;
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      const next = await getMealsInRange(fromKey, toKey);
      if (gen !== genRef.current) return;
      setMeals(next);
    } catch (err) {
      if (gen !== genRef.current) return;
      setError(err instanceof Error ? err.message : "Could not load history");
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [fromKey, toKey]);

  useEffect(() => {
    void refresh();
    return () => {
      genRef.current += 1;
    };
  }, [refresh]);

  useEffect(
    () => subscribeMealsChanged(() => void refresh({ quiet: true })),
    [refresh],
  )

  const caloriesByDay = meals.reduce<Record<string, number>>((acc, meal) => {
    if (meal.status !== "logged") return acc;
    acc[meal.dayKey] = (acc[meal.dayKey] ?? 0) + meal.calories;
    return acc;
  }, {});

  return {
    meals,
    caloriesByDay,
    loading,
    error,
    refresh,
    totals: sumMeals(meals),
  };
}

export function useApiKey() {
  const [apiKey, setApiKeyState] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const key = await getGeminiApiKey();
        setApiKeyState(key ?? "");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  return {
    apiKey,
    loaded,
    hasKey: Boolean(apiKey.trim()),
    save: async (value: string) => {
      await setGeminiApiKey(value);
      setApiKeyState(value.trim());
      if (value.trim() && navigator.onLine) {
        void processPendingScans();
      }
    },
    clear: async () => {
      await clearGeminiApiKey();
      setApiKeyState("");
    },
    wipeAll: async () => {
      await clearAllMeals();
      await clearGeminiApiKey();
      setApiKeyState("");
    },
  };
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}

/** Migrate IDB + drain pending queue when online / on mount. */
export function useScanQueue() {
  useEffect(() => {
    void migrateMeals().catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    const run = () => {
      if (navigator.onLine) void processPendingScans();
    };
    run();
    window.addEventListener("online", run);
    const onVis = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
}

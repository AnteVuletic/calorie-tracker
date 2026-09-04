import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { retentionCutoff, toDayKey } from "@/lib/dates";
import type { Meal, MealStatus, ScanMode } from "@/lib/types";

interface CalorieDB extends DBSchema {
  meals: {
    key: string;
    value: Meal;
    indexes: { "by-day": string; "by-status": MealStatus };
  };
  settings: {
    key: string;
    value: { key: string; value: string };
  };
}

const DB_NAME = "calorie-tracker";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<CalorieDB>> | null = null;

function normalizeMeal(raw: Meal): Meal {
  return {
    ...raw,
    status: raw.status ?? "logged",
    scanMode: raw.scanMode ?? "meal",
    lastError: raw.lastError,
  };
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<CalorieDB>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains("meals")) {
          const meals = db.createObjectStore("meals", { keyPath: "id" });
          meals.createIndex("by-day", "dayKey");
          meals.createIndex("by-status", "status");
        } else if (oldVersion < 2) {
          const store = transaction.objectStore("meals");
          let cursor = await store.openCursor();
          while (cursor) {
            const value = cursor.value as Meal & {
              status?: MealStatus;
              scanMode?: ScanMode;
            };
            if (!value.status || !value.scanMode) {
              await cursor.update({
                ...value,
                status: value.status ?? "logged",
                scanMode: value.scanMode ?? "meal",
              });
            }
            cursor = await cursor.continue();
          }
          if (!store.indexNames.contains("by-status")) {
            store.createIndex("by-status", "status");
          }
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

/** Backfill status/scanMode on existing rows after upgrade. */
export async function migrateMeals(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("meals", "readwrite");
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const value = cursor.value as Meal & {
      status?: MealStatus;
      scanMode?: ScanMode;
    };
    if (!value.status || !value.scanMode) {
      await cursor.update({
        ...value,
        status: value.status ?? "logged",
        scanMode: value.scanMode ?? "meal",
      });
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function purgeOldMeals(now = new Date()): Promise<number> {
  const db = await getDb();
  const cutoffKey = toDayKey(retentionCutoff(now));
  const tx = db.transaction("meals", "readwrite");
  const index = tx.store.index("by-day");
  let deleted = 0;
  let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoffKey, true));
  while (cursor) {
    await cursor.delete();
    deleted += 1;
    cursor = await cursor.continue();
  }
  await tx.done;
  return deleted;
}

export type NewMealInput = Omit<Meal, "id" | "createdAt" | "dayKey">;

export async function addMeal(meal: NewMealInput): Promise<Meal> {
  const db = await getDb();
  const now = new Date();
  const record: Meal = {
    id: crypto.randomUUID(),
    createdAt: now.toISOString(),
    dayKey: toDayKey(now),
    imageBlob: meal.imageBlob,
    label: meal.label,
    calories: meal.calories,
    proteinG: meal.proteinG,
    carbsG: meal.carbsG,
    fatG: meal.fatG,
    status: meal.status,
    scanMode: meal.scanMode,
    lastError: meal.lastError,
  };
  try {
    await db.put("meals", record);
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      throw new Error(
        "Storage full. Delete older meals or clear data in Settings.",
      );
    }
    throw err;
  }
  return record;
}

export async function updateMeal(
  id: string,
  patch: Partial<Omit<Meal, "id" | "createdAt" | "dayKey">>,
): Promise<Meal> {
  const db = await getDb();
  const existing = await db.get("meals", id);
  if (!existing) {
    throw new Error("Meal not found");
  }
  const next: Meal = normalizeMeal({ ...existing, ...patch, id });
  try {
    await db.put("meals", next);
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      throw new Error(
        "Storage full. Delete older meals or clear data in Settings.",
      );
    }
    throw err;
  }
  return next;
}

export async function getMeal(id: string): Promise<Meal | undefined> {
  const db = await getDb();
  const meal = await db.get("meals", id);
  return meal ? normalizeMeal(meal) : undefined;
}

export async function deleteMeal(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("meals", id);
}

export async function getMealsByDay(dayKey: string): Promise<Meal[]> {
  const db = await getDb();
  const meals = await db.getAllFromIndex("meals", "by-day", dayKey);
  return meals.map(normalizeMeal).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMealsInRange(
  fromKey: string,
  toKey: string,
): Promise<Meal[]> {
  const db = await getDb();
  const meals = await db.getAllFromIndex(
    "meals",
    "by-day",
    IDBKeyRange.bound(fromKey, toKey),
  );
  return meals
    .map(normalizeMeal)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPendingMeals(): Promise<Meal[]> {
  const db = await getDb();
  const meals = await db.getAllFromIndex("meals", "by-status", "pending");
  return meals
    .map(normalizeMeal)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function clearAllMeals(): Promise<void> {
  const db = await getDb();
  await db.clear("meals");
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.get("settings", key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put("settings", { key, value });
}

export async function getGeminiApiKey(): Promise<string | null> {
  return getSetting("geminiApiKey");
}

export async function setGeminiApiKey(value: string): Promise<void> {
  await setSetting("geminiApiKey", value.trim());
}

export async function clearGeminiApiKey(): Promise<void> {
  const db = await getDb();
  await db.delete("settings", "geminiApiKey");
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}

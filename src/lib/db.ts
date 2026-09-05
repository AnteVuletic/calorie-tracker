import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { toDayKey } from "@/lib/dates";
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
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<CalorieDB>> | null = null;

/** Map legacy "scanned" (and missing) statuses onto the current set. */
function normalizeStatus(
  status: MealStatus | "scanned" | undefined,
): MealStatus {
  if (status === "scanned") return "logged";
  if (
    status === "pending" ||
    status === "processing" ||
    status === "logged" ||
    status === "fail"
  ) {
    return status;
  }
  return "logged";
}

function normalizeMeal(raw: Meal): Meal {
  return {
    ...raw,
    status: normalizeStatus(raw.status as MealStatus | "scanned" | undefined),
    scanMode: raw.scanMode ?? "meal",
    portionRaw: raw.portionRaw,
    retryCount: raw.retryCount,
    nextAttemptAt: raw.nextAttemptAt,
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
              status?: MealStatus | "scanned";
              scanMode?: ScanMode;
            };
            if (!value.status || !value.scanMode) {
              await cursor.update({
                ...value,
                status: normalizeStatus(value.status),
                scanMode: value.scanMode ?? "meal",
              });
            }
            cursor = await cursor.continue();
          }
          if (!store.indexNames.contains("by-status")) {
            store.createIndex("by-status", "status");
          }
        }
        if (oldVersion < 3 && db.objectStoreNames.contains("meals")) {
          const store = transaction.objectStore("meals");
          let cursor = await store.openCursor();
          while (cursor) {
            const value = cursor.value as Meal & {
              status?: MealStatus | "scanned";
            };
            const nextStatus = normalizeStatus(value.status);
            if (value.status !== nextStatus) {
              await cursor.update({ ...value, status: nextStatus });
            }
            cursor = await cursor.continue();
          }
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      },
      blocked() {
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    })
      .then((db) => {
        // Close on versionchange so upgrades during app update aren't blocked;
        // IndexedDB data is preserved and the next getDb() reopens.
        db.addEventListener("versionchange", () => {
          db.close();
          dbPromise = null;
        });
        return db;
      })
      .catch((err) => {
        dbPromise = null;
        throw err;
      });
  }
  return dbPromise;
}

/** Backfill status/scanMode and migrate legacy scanned → logged. */
export async function migrateMeals(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("meals", "readwrite");
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const value = cursor.value as Meal & {
      status?: MealStatus | "scanned";
      scanMode?: ScanMode;
    };
    const nextStatus = normalizeStatus(value.status);
    const nextMode = value.scanMode ?? "meal";
    // Stuck processing from a crashed tab should re-enter the queue.
    const resetProcessing =
      nextStatus === "processing" ? ("pending" as const) : nextStatus;
    if (
      value.status !== resetProcessing ||
      value.scanMode !== nextMode ||
      !value.status ||
      !value.scanMode
    ) {
      await cursor.update({
        ...value,
        status: resetProcessing,
        scanMode: nextMode,
      });
    }
    cursor = await cursor.continue();
  }
  await tx.done;
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
    portionRaw: meal.portionRaw,
    retryCount: meal.retryCount,
    nextAttemptAt: meal.nextAttemptAt,
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

/** Logged nutrition-label meals (newest first). */
export async function getLoggedLabelMeals(): Promise<Meal[]> {
  const db = await getDb();
  const meals = await db.getAll("meals");
  return meals
    .map(normalizeMeal)
    .filter((meal) => meal.scanMode === "label" && meal.status === "logged")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Pending meals ready to process (backoff elapsed), oldest first. */
export async function getPendingMeals(now = new Date()): Promise<Meal[]> {
  const db = await getDb();
  const meals = await db.getAllFromIndex("meals", "by-status", "pending");
  const nowMs = now.getTime();
  return meals
    .map(normalizeMeal)
    .filter((meal) => {
      if (!meal.nextAttemptAt) return true;
      const at = Date.parse(meal.nextAttemptAt);
      return !Number.isFinite(at) || at <= nowMs;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Earliest nextAttemptAt among pending meals that are still waiting on backoff. */
export async function getEarliestPendingAttemptAt(): Promise<string | null> {
  const db = await getDb();
  const meals = await db.getAllFromIndex("meals", "by-status", "pending");
  let earliest: string | null = null;
  let earliestMs = Infinity;
  const nowMs = Date.now();
  for (const raw of meals) {
    const meal = normalizeMeal(raw);
    if (!meal.nextAttemptAt) continue;
    const at = Date.parse(meal.nextAttemptAt);
    if (!Number.isFinite(at) || at <= nowMs) continue;
    if (at < earliestMs) {
      earliestMs = at;
      earliest = meal.nextAttemptAt;
    }
  }
  return earliest;
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

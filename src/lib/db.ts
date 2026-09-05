import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { toDayKey } from "@/lib/dates";
import type { Meal, MealStatus, ScanMode } from "@/lib/types";

/**
 * IndexedDB row shape. Photos are stored as ArrayBuffer (+ mime), not Blob.
 * Re-putting an IDB-retrieved Blob can leave a dead blob reference; browsers
 * then throw NotFoundError ("The object can not be found here") on rescan.
 */
type MealRecord = Omit<Meal, "imageBlob"> & {
  imageBytes?: ArrayBuffer;
  imageMimeType?: string;
  /** Legacy — converted to imageBytes on the next write */
  imageBlob?: Blob;
};

interface CalorieDB extends DBSchema {
  meals: {
    key: string;
    value: MealRecord;
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

const MISSING_PHOTO =
  "Meal photo is missing — re-add the photo to scan";

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

function hasImageBytes(
  raw: MealRecord,
): raw is MealRecord & { imageBytes: ArrayBuffer } {
  return raw.imageBytes instanceof ArrayBuffer && raw.imageBytes.byteLength > 0;
}

async function blobToImageBytes(
  blob: Blob,
): Promise<{ imageBytes: ArrayBuffer; imageMimeType: string }> {
  try {
    const imageBytes = await blob.arrayBuffer();
    if (imageBytes.byteLength <= 0) {
      throw new Error("Meal photo is empty — re-add the photo to scan");
    }
    return {
      imageBytes,
      imageMimeType: blob.type || "image/jpeg",
    };
  } catch (err) {
    if (err instanceof Error && /re-add the photo/i.test(err.message)) {
      throw err;
    }
    throw new Error(MISSING_PHOTO);
  }
}

function mealFromRecord(raw: MealRecord): Meal {
  let imageBlob: Blob;
  if (hasImageBytes(raw)) {
    imageBlob = new Blob([raw.imageBytes], {
      type: raw.imageMimeType || "image/jpeg",
    });
  } else if (raw.imageBlob instanceof Blob) {
    imageBlob = raw.imageBlob;
  } else {
    imageBlob = new Blob();
  }

  return {
    id: raw.id,
    createdAt: raw.createdAt,
    dayKey: raw.dayKey,
    imageBlob,
    label: raw.label,
    calories: raw.calories,
    proteinG: raw.proteinG,
    carbsG: raw.carbsG,
    fatG: raw.fatG,
    status: normalizeStatus(raw.status as MealStatus | "scanned" | undefined),
    scanMode: raw.scanMode ?? "meal",
    portionRaw: raw.portionRaw,
    extraContext: raw.extraContext,
    retryCount: raw.retryCount,
    nextAttemptAt: raw.nextAttemptAt,
    lastError: raw.lastError,
  };
}

async function toMealRecord(
  meal: Meal,
  existing?: MealRecord,
): Promise<MealRecord> {
  const { imageBlob: _discard, ...meta } = meal;

  if (existing && hasImageBytes(existing)) {
    return {
      ...meta,
      imageBytes: existing.imageBytes,
      imageMimeType: existing.imageMimeType || "image/jpeg",
    };
  }

  const sourceBlob =
    meal.imageBlob?.size > 0
      ? meal.imageBlob
      : existing?.imageBlob instanceof Blob && existing.imageBlob.size > 0
        ? existing.imageBlob
        : null;

  if (!sourceBlob) {
    throw new Error(MISSING_PHOTO);
  }

  const { imageBytes, imageMimeType } = await blobToImageBytes(sourceBlob);
  return { ...meta, imageBytes, imageMimeType };
}

async function putMealRecord(
  db: IDBPDatabase<CalorieDB>,
  record: MealRecord,
): Promise<Meal> {
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
  return mealFromRecord(record);
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
            const value = cursor.value as MealRecord & {
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
            const value = cursor.value as MealRecord & {
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

/**
 * Backfill status/scanMode, re-queue stuck processing/fail, and convert legacy
 * Blob photos to durable ArrayBuffers (outside long-lived cursors).
 */
export async function migrateMeals(): Promise<void> {
  const db = await getDb();
  const all = await db.getAll("meals");

  for (const value of all) {
    const nextStatus = normalizeStatus(value.status);
    const nextMode = value.scanMode ?? "meal";
    const resetQueue =
      nextStatus === "processing" || nextStatus === "fail"
        ? ("pending" as const)
        : nextStatus;
    const shouldResetRetries =
      resetQueue === "pending" && nextStatus !== "pending";
    const needsStatusFix =
      value.status !== resetQueue ||
      value.scanMode !== nextMode ||
      !value.status ||
      !value.scanMode ||
      (shouldResetRetries && (value.retryCount || value.nextAttemptAt));
    const needsByteMigration = !hasImageBytes(value);

    if (!needsStatusFix && !needsByteMigration) continue;

    const meal = mealFromRecord({
      ...value,
      status: resetQueue,
      scanMode: nextMode,
      ...(shouldResetRetries
        ? { retryCount: 0, nextAttemptAt: undefined }
        : {}),
    });

    try {
      const record = await toMealRecord(meal, value);
      await putMealRecord(db, {
        ...record,
        status: resetQueue,
        scanMode: nextMode,
        ...(shouldResetRetries
          ? { retryCount: 0, nextAttemptAt: undefined }
          : {}),
      });
    } catch (err) {
      // Photo unreadable — still apply status migration so the card shows fail.
      if (!needsStatusFix) continue;
      try {
        await db.put("meals", {
          ...value,
          status: "fail",
          scanMode: nextMode,
          retryCount: value.retryCount ?? 0,
          nextAttemptAt: undefined,
          lastError:
            err instanceof Error ? err.message : MISSING_PHOTO,
        });
      } catch {
        /* ignore secondary write errors */
      }
    }
  }
}

export type NewMealInput = Omit<Meal, "id" | "createdAt" | "dayKey">;

export async function addMeal(meal: NewMealInput): Promise<Meal> {
  const db = await getDb();
  const now = new Date();
  const draft: Meal = {
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
    extraContext: meal.extraContext,
    retryCount: meal.retryCount,
    nextAttemptAt: meal.nextAttemptAt,
    lastError: meal.lastError,
  };
  const record = await toMealRecord(draft);
  return putMealRecord(db, record);
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

  // Replacing the photo — encode fresh bytes and drop any legacy Blob field.
  if (patch.imageBlob) {
    const current = mealFromRecord(existing);
    const next: Meal = { ...current, ...patch, id, imageBlob: patch.imageBlob };
    const { imageBlob: _b, ...meta } = next;
    const { imageBytes, imageMimeType } = await blobToImageBytes(patch.imageBlob);
    return putMealRecord(db, { ...meta, imageBytes, imageMimeType });
  }

  // Durable bytes already stored — copy them; never re-put a Blob handle.
  if (hasImageBytes(existing)) {
    const current = mealFromRecord(existing);
    const next: Meal = { ...current, ...patch, id };
    const { imageBlob: _b, ...meta } = next;
    return putMealRecord(db, {
      ...meta,
      imageBytes: existing.imageBytes,
      imageMimeType: existing.imageMimeType || "image/jpeg",
    });
  }

  // Legacy Blob row: convert once to bytes. If the Blob is already dead,
  // still allow metadata updates so Rescan can surface a clear error.
  const current = mealFromRecord(existing);
  const next: Meal = {
    ...current,
    ...patch,
    id,
    imageBlob: current.imageBlob,
  };
  try {
    const record = await toMealRecord(next, existing);
    return putMealRecord(db, record);
  } catch {
    const { imageBlob: _b, ...meta } = next;
    return putMealRecord(db, {
      ...meta,
      imageBlob: existing.imageBlob,
    });
  }
}

export async function getMeal(id: string): Promise<Meal | undefined> {
  const db = await getDb();
  const meal = await db.get("meals", id);
  return meal ? mealFromRecord(meal) : undefined;
}

export async function deleteMeal(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("meals", id);
}

export async function getMealsByDay(dayKey: string): Promise<Meal[]> {
  const db = await getDb();
  const meals = await db.getAllFromIndex("meals", "by-day", dayKey);
  return meals
    .map(mealFromRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    .map(mealFromRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Logged nutrition-label meals (newest first). */
export async function getLoggedLabelMeals(): Promise<Meal[]> {
  const db = await getDb();
  const meals = await db.getAll("meals");
  return meals
    .map(mealFromRecord)
    .filter((meal) => meal.scanMode === "label" && meal.status === "logged")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Pending meals ready to process (backoff elapsed), oldest first. */
export async function getPendingMeals(now = new Date()): Promise<Meal[]> {
  const db = await getDb();
  const meals = await db.getAllFromIndex("meals", "by-status", "pending");
  const nowMs = now.getTime();
  return meals
    .map(mealFromRecord)
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
    const meal = mealFromRecord(raw);
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

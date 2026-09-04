import {
  format,
  parseISO,
  startOfDay,
  subDays,
  isBefore,
  isAfter,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  differenceInMilliseconds,
  addDays,
} from "date-fns";
import { RETENTION_DAYS } from "@/lib/types";

export { RETENTION_DAYS };

export function toDayKey(date: Date = new Date()): string {
  return format(date, "yyyy-MM-dd");
}

export function parseDayKey(dayKey: string): Date {
  return startOfDay(parseISO(dayKey));
}

/** Inclusive window of RETENTION_DAYS ending today (e.g. 30 → today and previous 29 days). */
export function retentionCutoff(now = new Date()): Date {
  return startOfDay(subDays(now, RETENTION_DAYS - 1));
}

export function retentionFromKey(now = new Date()): string {
  return toDayKey(retentionCutoff(now));
}

export function isWithinRetention(dayKey: string, now = new Date()): boolean {
  const day = parseDayKey(dayKey);
  const cutoff = retentionCutoff(now);
  const today = startOfDay(now);
  return !isBefore(day, cutoff) && !isAfter(day, today);
}

export function formatDisplayDate(dayKey: string): string {
  return format(parseDayKey(dayKey), "EEEE, MMM d");
}

export function weekDayKeys(anchor: Date = new Date()): string[] {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const end = endOfWeek(anchor, { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map((d) => toDayKey(d));
}

export function clampDateToRetention(date: Date, now = new Date()): Date {
  const cutoff = retentionCutoff(now);
  const today = startOfDay(now);
  const day = startOfDay(date);
  if (isBefore(day, cutoff)) return cutoff;
  if (isAfter(day, today)) return today;
  return day;
}

/** Ms until next local midnight (or slightly after). */
export function msUntilNextLocalMidnight(now = new Date()): number {
  const next = startOfDay(addDays(now, 1));
  return Math.max(1000, differenceInMilliseconds(next, now) + 50);
}

export function roundMacro(n: number): number {
  return Math.round(n * 10) / 10;
}

export function formatMacro(n: number): string {
  return roundMacro(n).toFixed(1).replace(/\.0$/, "");
}
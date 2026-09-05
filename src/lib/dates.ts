import {
  format,
  parseISO,
  startOfDay,
  isAfter,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  differenceInMilliseconds,
  addDays,
} from "date-fns";

export function toDayKey(date: Date = new Date()): string {
  return format(date, "yyyy-MM-dd");
}

export function parseDayKey(dayKey: string): Date {
  return startOfDay(parseISO(dayKey));
}

/** True when dayKey is today or earlier (local calendar). */
export function isNotFuture(dayKey: string, now = new Date()): boolean {
  return !isAfter(parseDayKey(dayKey), startOfDay(now));
}

/** Clamp a date to today if it is in the future. */
export function clampToToday(date: Date, now = new Date()): Date {
  const today = startOfDay(now);
  const day = startOfDay(date);
  if (isAfter(day, today)) return today;
  return day;
}

export function formatDisplayDate(dayKey: string): string {
  return format(parseDayKey(dayKey), "EEEE, MMM d");
}

export function weekDayKeys(anchor: Date = new Date()): string[] {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const end = endOfWeek(anchor, { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map((d) => toDayKey(d));
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

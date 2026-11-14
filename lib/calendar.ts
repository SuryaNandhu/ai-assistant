/**
 * Month grid helpers for the Progress screen, built by hand.
 *
 * Everything works on IST day keys (`YYYY-MM-DD`) so the calendar, the
 * `daily_completions` view and the journal agree on where a day starts.
 * Weeks run Monday to Sunday, like the rest of the app. Nothing here touches
 * the database, so the client can import it too.
 */

import { istParts, shiftDayKey } from "@/lib/week";

export const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** A calendar month. `month` is 0-based, like `Date.getUTCMonth()`. */
export type MonthRef = { year: number; month: number };

export function currentMonth(now: Date = new Date()): MonthRef {
  const { year, month } = istParts(now);
  return { year, month };
}

export function sameMonth(a: MonthRef, b: MonthRef): boolean {
  return a.year === b.year && a.month === b.month;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** `2026-11` — what the `?month=` query string carries. */
export function monthKey(ref: MonthRef): string {
  return `${ref.year}-${twoDigits(ref.month + 1)}`;
}

/** Strict `YYYY-MM` parse; null for anything else (bad input is never trusted). */
export function parseMonthKey(value: unknown): MonthRef | null {
  if (typeof value !== "string") return null;

  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;

  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (month < 0 || month > 11) return null;

  return { year, month };
}

/** Steps whole months forwards or backwards, carrying the year. */
export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const index = ref.year * 12 + ref.month + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function firstDayKey(ref: MonthRef): string {
  return `${monthKey(ref)}-01`;
}

export function lastDayKey(ref: MonthRef): string {
  return `${monthKey(ref)}-${twoDigits(daysInMonth(ref.year, ref.month))}`;
}

/**
 * Inclusive IST day range plus the exclusive timestamp range used for
 * `completions.completed_at`. Both boundaries are 00:00 IST, so a completion
 * just after midnight cannot leak into the previous month.
 */
export function monthRange(ref: MonthRef): {
  startDayKey: string;
  endDayKey: string;
  startIso: string;
  endIso: string;
} {
  const startDay = firstDayKey(ref);
  const nextStartDay = firstDayKey(shiftMonth(ref, 1));

  return {
    startDayKey: startDay,
    endDayKey: lastDayKey(ref),
    startIso: `${startDay}T00:00:00+05:30`,
    endIso: `${nextStartDay}T00:00:00+05:30`,
  };
}

export type CalendarCell = {
  dayKey: string;
  /** Day of the month, for the label in the cell. */
  day: number;
  inMonth: boolean;
};

export type CalendarMonth = {
  ref: MonthRef;
  /** "November 2026". */
  label: string;
  /** `YYYY-MM` for the previous/next month links. */
  prevKey: string;
  nextKey: string;
  /** Monday-first weeks, padded so every row has seven cells. */
  weeks: CalendarCell[][];
};

/** Builds the grid for a month: Monday-first, six rows at most. */
export function buildMonth(ref: MonthRef): CalendarMonth {
  const total = daysInMonth(ref.year, ref.month);
  const weekdayOfFirst = new Date(Date.UTC(ref.year, ref.month, 1)).getUTCDay();
  // 0 = Sunday … 6 = Saturday → how many days of the previous month to show.
  const offset = (weekdayOfFirst + 6) % 7;

  const startKey = shiftDayKey(firstDayKey(ref), -offset);
  const cellCount = Math.ceil((offset + total) / 7) * 7;

  const weeks: CalendarCell[][] = [];

  for (let index = 0; index < cellCount; index += 1) {
    const dayKey = shiftDayKey(startKey, index);
    const cell: CalendarCell = {
      dayKey,
      day: Number(dayKey.slice(8, 10)),
      inMonth: index >= offset && index < offset + total,
    };

    const week = Math.floor(index / 7);
    (weeks[week] ??= []).push(cell);
  }

  return {
    ref,
    label: `${MONTH_NAMES[ref.month]} ${ref.year}`,
    prevKey: monthKey(shiftMonth(ref, -1)),
    nextKey: monthKey(shiftMonth(ref, 1)),
    weeks,
  };
}

/** 0, 1, 2 or "3 or more" completions in a day. */
export type Intensity = 0 | 1 | 2 | 3;

export function intensityFor(count: number): Intensity {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

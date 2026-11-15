/**
 * The edit window: today and the seven days before it stay editable; anything
 * older is locked. Pure and timezone-free — day keys are Asia/Kolkata keys, so
 * the comparison is plain string ordering.
 *
 * The rule lives in one place because the quick log, the journal, screen time,
 * suggestions, rest days and the calendar panel all have to agree. Viewing an
 * old day is always fine; only writes stop.
 */

import { istDayKey, shiftDayKey } from "@/lib/week";

/** How many days before today stay editable (plus today itself). */
export const EDIT_WINDOW_DAYS = 7;

export const LOCKED_MESSAGE =
  "That day is locked: entries older than 7 days can't be changed";

/** `now` as an IST day key, or a key the caller already computed. */
function todayKeyOf(now: Date | string): string {
  return typeof now === "string" ? now : istDayKey(now);
}

/** The oldest day that can still be edited: today − 7 days. */
export function earliestEditableDayKey(now: Date | string = new Date()): string {
  return shiftDayKey(todayKeyOf(now), -EDIT_WINDOW_DAYS);
}

/**
 * True when `dayKey` is older than the edit window. A `now` string is read as
 * today's IST day key, which lets client components pass the server's key.
 */
export function isLocked(dayKey: string, now: Date | string = new Date()): boolean {
  return dayKey < earliestEditableDayKey(now);
}

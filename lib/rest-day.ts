/**
 * Rest-day rules, as pure functions so Home, the calendar, the chat tool and the
 * weekly summary all decide the same way.
 *
 * One rest day per Monday–Sunday week. It can be taken for today or yesterday,
 * only while that day has no completion, and the allowance belongs to the week
 * the chosen day sits in — so on Monday morning last week's unused Sunday can
 * still be rested. Unused rest days never carry over.
 */

import { isDayKey, shiftDayKey } from "@/lib/week";

/** Monday of the Mon–Sun week containing `dayKey`. */
export function weekStartOf(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  // 0 = Sunday … 6 = Saturday → how many days back Monday is.
  return shiftDayKey(dayKey, -((weekday + 6) % 7));
}

/** True when both days sit in the same Monday–Sunday week. */
export function sameWeek(a: string, b: string): boolean {
  return weekStartOf(a) === weekStartOf(b);
}

/** Rest days that belong to one Mon–Sun week. */
export function restDaysInWeek(
  restDays: Iterable<string>,
  weekStartKey: string,
): string[] {
  const end = shiftDayKey(weekStartKey, 6);

  return [...new Set(restDays)]
    .filter(isDayKey)
    .filter((day) => day >= weekStartKey && day <= end)
    .sort();
}

export type RestDayCheck = {
  dayKey: string;
  todayKey: string;
  /** Rest day already set in the week that owns `dayKey`, if any. */
  weekRestDay: string | null;
  /** Completions logged on `dayKey`. */
  completions: number;
};

/**
 * Why a rest day cannot be set, or null when it can. The caller must already
 * know the day is today or yesterday and that it belongs to the edit window.
 */
export function restDayBlocker({
  dayKey,
  todayKey,
  weekRestDay,
  completions,
}: RestDayCheck): string | null {
  const yesterdayKey = shiftDayKey(todayKey, -1);

  if (dayKey !== todayKey && dayKey !== yesterdayKey) {
    return "A rest day can only be set for today or yesterday.";
  }

  if (completions > 0) {
    return "That day has a completion, so it can't be a rest day.";
  }

  if (weekRestDay && weekRestDay !== dayKey) {
    return "This week's rest day is already used.";
  }

  return null;
}

/**
 * Day and week helpers for Asia/Kolkata, the timezone the app plans in.
 *
 * IST is a fixed +05:30 offset with no daylight saving, so plain arithmetic is
 * exact and we never need a timezone library. Weeks run Monday to Sunday.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type IstParts = {
  year: number;
  /** 0-based, like `Date.getUTCMonth()`. */
  month: number;
  day: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

/** Calendar pieces of an instant as seen in IST. */
export function istParts(date: Date): IstParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * `YYYY-MM-DD` for the IST day containing `date`. Matches the `day` column of
 * the `daily_completions` view so streak math lines up with the database.
 */
export function istDayKey(date: Date): string {
  const { year, month, day } = istParts(date);
  return `${year}-${twoDigits(month + 1)}-${twoDigits(day)}`;
}

/** Shifts a `YYYY-MM-DD` key by whole days without any timezone surprises. */
export function shiftDayKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return `${shifted.getUTCFullYear()}-${twoDigits(
    shifted.getUTCMonth() + 1,
  )}-${twoDigits(shifted.getUTCDate())}`;
}

/** `YYYY-MM-DD` for an instant, asserted as an IST day key. */
export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Monday 00:00 IST of the week containing `date`. */
export function startOfIstWeek(date: Date): Date {
  const { year, month, day, weekday } = istParts(date);
  const daysSinceMonday = (weekday + 6) % 7;
  const mondayUtc = Date.UTC(year, month, day) - daysSinceMonday * DAY_MS;
  // Date.UTC(...) is the IST wall clock; subtracting the offset gives the
  // matching UTC instant for 00:00 IST.
  return new Date(mondayUtc - IST_OFFSET_MS);
}

/** Monday 00:00 IST of the next week — the exclusive end of the range. */
export function startOfNextIstWeek(date: Date): Date {
  return new Date(startOfIstWeek(date).getTime() + 7 * DAY_MS);
}

/** Short label such as `3–9 Nov` or `30 Nov – 6 Dec`. */
export function istWeekLabel(weekStart: Date, weekEndExclusive: Date): string {
  const start = istParts(weekStart);
  const end = istParts(new Date(weekEndExclusive.getTime() - DAY_MS));
  const sameMonth = start.month === end.month;

  return sameMonth
    ? `${start.day}–${end.day} ${MONTHS[end.month]}`
    : `${start.day} ${MONTHS[start.month]} – ${end.day} ${MONTHS[end.month]}`;
}

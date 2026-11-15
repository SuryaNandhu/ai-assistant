import type { SupabaseClient } from "@supabase/supabase-js";

import { istDayKey, shiftDayKey } from "@/lib/week";

/**
 * Screen time is one number per completed IST day: minutes spent on the
 * phone/laptop outside work. There is no default limit — the limit only exists
 * once the user sets one in `user_settings`, so everything here accepts null.
 * Pure except the loaders, so client components may import the formatters too.
 */

export const SCREEN_LIMIT_MIN = 30;
export const SCREEN_LIMIT_MAX = 720;

/** Chips in the limit sheet. */
export const SCREEN_LIMIT_OPTIONS = [60, 90, 120, 150, 180, 240] as const;

export const SCREEN_TIME_MAX_MINUTES = 1440;

/**
 * Screen time describes a day that has ended, so Home asks about the last three
 * completed days (yesterday and the two before it) and never about today.
 */
export const SCREEN_PROMPT_DAYS = 3;

/**
 * How far back a day can still be edited — the Home card, the chat tool and the
 * /progress day panel all use this one window.
 */
export const SCREEN_TIME_MAX_DAYS_BACK = 30;

/** How many days the sparkline and the weekly average look at. */
export const SCREEN_TIME_DAYS = 14;
export const SCREEN_WEEK_DAYS = 7;

export type ScreenTimeEntry = {
  /** IST day key, `YYYY-MM-DD`. */
  day: string;
  minutes: number;
};

export type ScreenTimeDay = {
  dayKey: string;
  /** null = nothing logged that day (not the same as zero minutes). */
  minutes: number | null;
};

export type ScreenTimeSummary = {
  todayKey: string;
  todayMinutes: number | null;
  /** Last completed day — the number the panel leads with. */
  yesterdayMinutes: number | null;
  /** null means the user has not set a limit; nothing is flagged as over. */
  limitMinutes: number | null;
  /** Average over the last seven days that have an entry. */
  weekAverage: number | null;
  weekLoggedDays: number;
  /** Logged days in the last seven where minutes went over the limit. */
  daysOverLimit: number;
  /** Oldest first, always exactly `SCREEN_TIME_DAYS` entries. */
  series: ScreenTimeDay[];
};

/** `90` → `1 h 30 m`, `45` → `45 min`, `120` → `2 h`. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${String(rest).padStart(2, "0")} m`;
}

export function isOverLimit(
  minutes: number | null,
  limit: number | null,
): boolean {
  return minutes !== null && limit !== null && minutes > limit;
}

export type ScreenStatus = "under" | "over" | "none";

/** `none` covers both "not logged" and "no limit set". */
export function screenStatus(
  minutes: number | null,
  limit: number | null,
): ScreenStatus {
  if (minutes === null || limit === null) return "none";
  return minutes > limit ? "over" : "under";
}

/** Today's minutes, or null when the day has not been logged yet. */
export async function loadScreenTimeEntry(
  supabase: SupabaseClient,
  userId: string,
  day: string = istDayKey(new Date()),
): Promise<number | null> {
  const { data, error } = await supabase
    .from("screen_time_entries")
    .select("minutes")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load screen time: ${error.message}`);
  }

  return typeof data?.minutes === "number" ? data.minutes : null;
}

/** Entries for the last `days` days (today included), oldest first. */
export async function loadScreenTimeSince(
  supabase: SupabaseClient,
  userId: string,
  days: number = SCREEN_TIME_DAYS,
  now: Date = new Date(),
): Promise<ScreenTimeEntry[]> {
  const todayKey = istDayKey(now);
  const earliestKey = shiftDayKey(todayKey, -(days - 1));

  const { data, error } = await supabase
    .from("screen_time_entries")
    .select("day, minutes")
    .eq("user_id", userId)
    .gte("day", earliestKey)
    .lte("day", todayKey)
    .order("day", { ascending: true })
    .limit(days);

  if (error) {
    throw new Error(`Could not load screen time: ${error.message}`);
  }

  return ((data ?? []) as { day: string; minutes: number | string }[])
    .map((row) => ({
      day: String(row.day).slice(0, 10),
      minutes: Number(row.minutes),
    }))
    .filter((row) => Number.isFinite(row.minutes));
}

/**
 * The limit is optional: no `user_settings` row (or a null column) means the
 * user has not set one, and nothing is ever compared against a made-up number.
 */
export async function loadScreenLimit(
  supabase: SupabaseClient,
  userId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("screen_limit_minutes")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load your screen-time limit: ${error.message}`);
  }

  const stored = data?.screen_limit_minutes;
  return typeof stored === "number" && Number.isFinite(stored) ? stored : null;
}

/**
 * The last `SCREEN_PROMPT_DAYS` completed days (yesterday backwards) that have
 * no screen time yet, oldest first. Today is never included: a day only counts
 * once it is over.
 */
export async function loadMissingScreenDays(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const todayKey = istDayKey(now);
  const oldestKey = shiftDayKey(todayKey, -SCREEN_PROMPT_DAYS);

  const { data, error } = await supabase
    .from("screen_time_entries")
    .select("day, minutes")
    .eq("user_id", userId)
    .gte("day", oldestKey)
    .lt("day", todayKey);

  if (error) {
    throw new Error(`Could not load screen time: ${error.message}`);
  }

  const logged = new Set(
    ((data ?? []) as { day: string; minutes: number | string | null }[])
      .filter((row) => row.minutes !== null)
      .map((row) => String(row.day).slice(0, 10)),
  );

  return missingScreenDays(logged, now);
}

/** Pure half of `loadMissingScreenDays`, oldest missing day first. */
export function missingScreenDays(
  logged: Iterable<string>,
  now: Date = new Date(),
): string[] {
  const todayKey = istDayKey(now);
  const days = new Set(logged);
  const missing: string[] = [];

  for (let offset = SCREEN_PROMPT_DAYS; offset >= 1; offset -= 1) {
    const dayKey = shiftDayKey(todayKey, -offset);
    if (!days.has(dayKey)) missing.push(dayKey);
  }

  return missing;
}

/**
 * Builds the fixed 14-day series plus the seven-day average. Days without an
 * entry stay null: they are skipped in the average instead of counting as a
 * perfect zero-screen day.
 */
export function summariseScreenTime(
  entries: readonly ScreenTimeEntry[],
  limitMinutes: number | null,
  now: Date = new Date(),
): ScreenTimeSummary {
  const todayKey = istDayKey(now);
  const yesterdayKey = shiftDayKey(todayKey, -1);
  const byDay = new Map(entries.map((entry) => [entry.day, entry.minutes]));

  const series: ScreenTimeDay[] = Array.from(
    { length: SCREEN_TIME_DAYS },
    (_, index) => {
      const dayKey = shiftDayKey(todayKey, index - (SCREEN_TIME_DAYS - 1));
      return { dayKey, minutes: byDay.get(dayKey) ?? null };
    },
  );

  const week = series.slice(-SCREEN_WEEK_DAYS);
  const logged = week.filter(
    (day): day is ScreenTimeDay & { minutes: number } => day.minutes !== null,
  );
  const total = logged.reduce((sum, day) => sum + day.minutes, 0);

  return {
    todayKey,
    todayMinutes: byDay.get(todayKey) ?? null,
    yesterdayMinutes: byDay.get(yesterdayKey) ?? null,
    limitMinutes,
    weekAverage: logged.length > 0 ? Math.round(total / logged.length) : null,
    weekLoggedDays: logged.length,
    daysOverLimit:
      limitMinutes === null
        ? 0
        : logged.filter((day) => day.minutes > limitMinutes).length,
    series,
  };
}

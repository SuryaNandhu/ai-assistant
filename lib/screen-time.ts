import type { SupabaseClient } from "@supabase/supabase-js";

import { EDIT_WINDOW_DAYS } from "@/lib/lock";
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
 * Screen time describes a day that has ended, and tracking only starts once the
 * user logs the first entry: Home never asks about days before that first day.
 * Today is never asked about either.
 */
export const SCREEN_PROMPT_DAYS = 3;

/**
 * How far back a day can still be edited — the Home card, the chat tool and the
 * /progress day panel all use this one window, which is the shared edit lock.
 */
export const SCREEN_TIME_MAX_DAYS_BACK = EDIT_WINDOW_DAYS;

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
 * Which completed days still need a number, plus the day tracking began.
 *
 * - `start` is the earliest day with a row in `screen_time_entries`; null means
 *   nothing has been logged yet, so the only day worth asking about is
 *   yesterday — older days were never being tracked.
 * - `missing` only ever contains days on or after `start`, inside the last
 *   `SCREEN_PROMPT_DAYS` completed days, oldest first.
 */
export type ScreenTimeTracking = {
  /** `YYYY-MM-DD` of the first logged day, or null before the first entry. */
  start: string | null;
  missing: string[];
};

/**
 * The last `SCREEN_PROMPT_DAYS` completed days (yesterday backwards) that have
 * no screen time yet, oldest first, never earlier than the first logged day.
 * Today is never included: a day only counts once it is over.
 */
export async function loadMissingScreenDays(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const { missing } = await loadScreenTimeTracking(supabase, userId, now);
  return missing;
}

/**
 * Reads the first logged day and the days still missing, in one place so the
 * Home card and the `get_status` tool cannot disagree about what is missing.
 */
export async function loadScreenTimeTracking(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<ScreenTimeTracking> {
  const todayKey = istDayKey(now);
  const windowStartKey = shiftDayKey(todayKey, -SCREEN_PROMPT_DAYS);

  const first = await supabase
    .from("screen_time_entries")
    .select("day")
    .eq("user_id", userId)
    .order("day", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (first.error) {
    throw new Error(`Could not load screen time: ${first.error.message}`);
  }

  const start = first.data?.day ? String(first.data.day).slice(0, 10) : null;
  const logged = new Set<string>();

  if (start !== null) {
    // Only the part of the window that overlaps tracking has to be read.
    const fromKey = start > windowStartKey ? start : windowStartKey;

    const { data, error } = await supabase
      .from("screen_time_entries")
      .select("day")
      .eq("user_id", userId)
      .gte("day", fromKey)
      .lt("day", todayKey);

    if (error) {
      throw new Error(`Could not load screen time: ${error.message}`);
    }

    for (const row of (data ?? []) as { day: string }[]) {
      logged.add(String(row.day).slice(0, 10));
    }
  }

  return { start, missing: missingScreenDays(logged, now, start) };
}

/**
 * Pure half of `loadScreenTimeTracking`, oldest missing day first. With no
 * tracking start yet, yesterday is the only day asked about.
 */
export function missingScreenDays(
  logged: Iterable<string>,
  now: Date = new Date(),
  trackingStart: string | null = null,
): string[] {
  const todayKey = istDayKey(now);
  const days = new Set(logged);

  if (trackingStart === null) {
    const yesterdayKey = shiftDayKey(todayKey, -1);
    return days.has(yesterdayKey) ? [] : [yesterdayKey];
  }

  const missing: string[] = [];

  for (let offset = SCREEN_PROMPT_DAYS; offset >= 1; offset -= 1) {
    const dayKey = shiftDayKey(todayKey, -offset);
    // Days before the first entry were never tracked, so never ask for them.
    if (dayKey < trackingStart) continue;
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

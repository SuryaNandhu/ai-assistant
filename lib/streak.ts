import type { SupabaseClient } from "@supabase/supabase-js";

import { isDayKey, istDayKey, shiftDayKey } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back we look for consecutive days. A year is plenty. */
const LOOKBACK_DAYS = 400;

export type Streak = {
  /** Consecutive days with at least one completion, counting back from `asOf`. */
  days: number;
  /** Longest run of consecutive active days inside the lookback window. */
  longest: number;
  completedToday: boolean;
};

export type StreakOptions = {
  /** Rest days: skipped without adding to the run and without breaking it. */
  restDays?: Iterable<string>;
  /** Measure the streak at the end of this day instead of today. */
  asOf?: string;
};

/**
 * Streak length from a set of IST day keys (`YYYY-MM-DD`).
 *
 * A rest day is skipped: it neither extends the run nor ends it. While today is
 * still running, a day with no completion yet does not break the streak; a past
 * `asOf` day is judged as finished, so a missing day there does break it.
 */
export function computeStreak(
  dayKeys: Iterable<string>,
  todayKey: string,
  options: StreakOptions = {},
): Streak {
  const days = new Set([...dayKeys].filter(isDayKey));
  const restDays = new Set([...(options.restDays ?? [])].filter(isDayKey));
  const asOf =
    options.asOf && isDayKey(options.asOf) ? options.asOf : todayKey;
  const completedToday = days.has(todayKey);

  const doneAtAsOf = days.has(asOf);
  const restingAtAsOf = restDays.has(asOf);

  // A finished past day with nothing logged has already broken the streak.
  if (!doneAtAsOf && !restingAtAsOf && asOf !== todayKey) {
    return { days: 0, longest: longestStreak(days, restDays), completedToday };
  }

  let cursor = doneAtAsOf || restingAtAsOf ? asOf : shiftDayKey(asOf, -1);
  let length = 0;
  let guard = 0;

  while (guard < LOOKBACK_DAYS * 2) {
    if (days.has(cursor)) {
      length += 1;
    } else if (!restDays.has(cursor)) {
      break;
    }

    cursor = shiftDayKey(cursor, -1);
    guard += 1;
  }

  return { days: length, longest: longestStreak(days, restDays), completedToday };
}

/**
 * Longest run of consecutive active days. Rest days bridge a gap without adding
 * to the run, so Mon + Tue(rest) + Wed counts as three days of momentum.
 *
 * Day keys sort correctly as strings, and `shiftDayKey` keeps the comparison in
 * plain calendar days, so this needs no timezone math of its own.
 */
export function longestStreak(
  dayKeys: Iterable<string>,
  restDays: Iterable<string> = [],
): number {
  const days = new Set([...dayKeys].filter(isDayKey));
  const rest = new Set([...restDays].filter(isDayKey));
  const keys = [...new Set([...days, ...rest])].sort();

  let longest = 0;
  let run = 0;
  let previous: string | null = null;

  for (const key of keys) {
    // A gap of a calendar day or more starts a fresh run.
    if (previous !== null && shiftDayKey(previous, 1) !== key) run = 0;

    if (days.has(key)) {
      run += 1;
      if (run > longest) longest = run;
    }

    previous = key;
  }

  return longest;
}

/**
 * Rest days inside the lookback window. If migration 008 has not been applied
 * yet the column is missing; the streak then simply behaves as it used to.
 */
async function loadRestDays(
  supabase: SupabaseClient,
  userId: string,
  sinceKey: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("journal_entries")
    .select("day")
    .eq("user_id", userId)
    .eq("is_rest_day", true)
    .gte("day", sinceKey)
    .limit(LOOKBACK_DAYS);

  if (error) {
    console.error("Could not read rest days:", error.message);
    return [];
  }

  return ((data ?? []) as { day: string | null }[])
    .map((row) => (row.day ? String(row.day).slice(0, 10) : ""))
    .filter(isDayKey);
}

/**
 * Reads the streak from the `daily_completions` view, which already buckets
 * completions per IST day. If the view is missing (an older database), it falls
 * back to bucketing `completions` here so Home still renders.
 */
export async function loadStreak(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
  options: { asOf?: string } = {},
): Promise<Streak> {
  const todayKey = istDayKey(now);
  const restDays = await loadRestDays(
    supabase,
    userId,
    shiftDayKey(todayKey, -LOOKBACK_DAYS),
  );
  const streakOptions: StreakOptions = { restDays, asOf: options.asOf };

  const { data, error } = await supabase
    .from("daily_completions")
    .select("day")
    .eq("user_id", userId)
    .order("day", { ascending: false })
    .limit(LOOKBACK_DAYS);

  if (!error) {
    const keys = ((data ?? []) as { day: string | null }[])
      .map((row) => row.day)
      .filter(isDayKey);
    return computeStreak(keys, todayKey, streakOptions);
  }

  console.error("Could not read daily_completions:", error.message);

  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString();
  const { data: rows, error: fallbackError } = await supabase
    .from("completions")
    .select("completed_at")
    .eq("user_id", userId)
    .gte("completed_at", since)
    .limit(2000);

  if (fallbackError) {
    throw new Error(`Could not load your completions: ${fallbackError.message}`);
  }

  const keys = ((rows ?? []) as { completed_at: string }[]).map((row) =>
    istDayKey(new Date(row.completed_at)),
  );

  return computeStreak(keys, todayKey, streakOptions);
}

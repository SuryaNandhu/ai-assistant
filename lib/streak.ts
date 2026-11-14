import type { SupabaseClient } from "@supabase/supabase-js";

import { isDayKey, istDayKey, shiftDayKey } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back we look for consecutive days. A year is plenty. */
const LOOKBACK_DAYS = 400;

export type Streak = {
  /** Consecutive days with at least one completion, counting back from today. */
  days: number;
  completedToday: boolean;
};

/**
 * Streak length from a set of IST day keys (`YYYY-MM-DD`).
 *
 * A streak stays alive if today has no completion yet but yesterday does, so it
 * only resets once a whole day has been missed.
 */
export function computeStreak(
  dayKeys: Iterable<string>,
  todayKey: string,
): Streak {
  const days = new Set(dayKeys);
  const completedToday = days.has(todayKey);

  let cursor = completedToday ? todayKey : shiftDayKey(todayKey, -1);
  let length = 0;

  while (days.has(cursor)) {
    length += 1;
    cursor = shiftDayKey(cursor, -1);
  }

  return { days: length, completedToday };
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
): Promise<Streak> {
  const todayKey = istDayKey(now);

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
    return computeStreak(keys, todayKey);
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

  return computeStreak(keys, todayKey);
}

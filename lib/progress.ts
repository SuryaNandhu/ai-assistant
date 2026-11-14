import type { SupabaseClient } from "@supabase/supabase-js";

import { startOfIstWeek, startOfNextIstWeek } from "@/lib/week";

/** One active weekly target plus how much of it is already done. */
export type GoalProgress = {
  goal: string;
  label: string;
  perWeek: number;
  /** Completions this week that count toward the target. */
  done: number;
  /** `walk_run` targets only count completions at or above this distance. */
  minDistanceKm: number | null;
};

export type WeeklyProgress = {
  /** Monday 00:00 IST, inclusive. */
  weekStart: Date;
  /** Next Monday 00:00 IST, exclusive. */
  weekEnd: Date;
  goals: GoalProgress[];
};

type TargetRow = {
  goal: string;
  label: string;
  per_week: number | string;
  min_distance_km: number | string | null;
};

type CompletionRow = {
  goal: string | null;
  distance_km: number | string | null;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * A completion counts toward a target when its goal matches and, for distance
 * targets, when it covered at least the minimum distance. Missing distances do
 * not count — "5 km walk/run" should never be satisfied by a 1 km stroll.
 */
export function countsTowardTarget(
  minDistanceKm: number | null,
  distanceKm: number | string | null,
): boolean {
  if (minDistanceKm === null) return true;
  const distance = toNumber(distanceKm);
  return distance !== null && distance >= minDistanceKm;
}

export function findGoalProgress(
  progress: WeeklyProgress,
  goal: string | null,
): GoalProgress | undefined {
  if (!goal) return undefined;
  return progress.goals.find((entry) => entry.goal === goal);
}

/**
 * Weekly targets and this week's completions, both read as the signed-in user
 * so RLS decides what is visible.
 */
export async function loadWeeklyProgress(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<WeeklyProgress> {
  const weekStart = startOfIstWeek(now);
  const weekEnd = startOfNextIstWeek(now);

  const { data: targetData, error: targetError } = await supabase
    .from("targets")
    .select("goal, label, per_week, min_distance_km")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .order("label", { ascending: true });

  if (targetError) {
    throw new Error(`Could not load your weekly targets: ${targetError.message}`);
  }

  const { data: completionData, error: completionError } = await supabase
    .from("completions")
    .select("goal, distance_km")
    .eq("user_id", userId)
    .gte("completed_at", weekStart.toISOString())
    .lt("completed_at", weekEnd.toISOString())
    .limit(500);

  if (completionError) {
    throw new Error(
      `Could not load this week's completions: ${completionError.message}`,
    );
  }

  const completions = (completionData ?? []) as CompletionRow[];

  const goals = ((targetData ?? []) as TargetRow[]).map((row) => {
    const minDistanceKm = toNumber(row.min_distance_km);
    const perWeek = Math.max(1, Math.round(toNumber(row.per_week) ?? 1));
    const done = completions.filter(
      (completion) =>
        completion.goal === row.goal &&
        countsTowardTarget(minDistanceKm, completion.distance_km),
    ).length;

    return {
      goal: row.goal,
      label: row.label,
      perWeek,
      done,
      minDistanceKm,
    } satisfies GoalProgress;
  });

  return { weekStart, weekEnd, goals };
}

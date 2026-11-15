import type { SupabaseClient } from "@supabase/supabase-js";

import type { Energy } from "@/lib/task";
import {
  istDayKey,
  istParts,
  shiftDayKey,
  startOfIstWeek,
  startOfNextIstWeek,
} from "@/lib/week";

/**
 * Targets are the numbers behind the Home pills, the /progress rings and the
 * picker. Three shapes exist, and they all live here so every screen agrees:
 *
 *   count    "LeetCode 3x this week"          — one completion per unit
 *   distance "5 km walk/run 3x this week"     — only runs at/above the minimum
 *   day      "Job search 3 days x 3 a day"    — a day counts once it reaches
 *                                               `min_quantity` applications
 *
 * `period` stretches any of those to a month, which is how the resume task
 * works: one update sometime this month.
 */

export type TargetPeriod = "week" | "month";

/** Names the add sheet can give a target; also the longest label kept. */
export const GOAL_LABEL_MAX = 40;

/** One Home pill per target, so sixteen would stop being a plan. */
export const CUSTOM_GOAL_MAX_ACTIVE = 15;

/** Default minutes for a target made in the add sheet. */
export const DEFAULT_TARGET_MINUTES = 30;

/**
 * One target row as the goal tab shows it: active ones first, paused ones still
 * listed so they can be resumed, and custom ones flagged so they can be deleted.
 */
export type GoalCard = {
  goal: string;
  label: string;
  /** false = paused: the target keeps its history but leaves Home. */
  active: boolean;
  /** true = created by the user, so it can also be deleted. */
  isCustom: boolean;
};


/** One active target plus how much of it is done in the current period. */
export type GoalProgress = {
  goal: string;
  label: string;
  /** Units required in the period: qualifying days for `day` targets. */
  perWeek: number;
  /** Completions (or qualifying days) already done in the period. */
  done: number;
  period: TargetPeriod;
  /** `walk_run` targets only count completions at or above this distance. */
  minDistanceKm: number | null;
  /** When set, only days that reach this many count toward `perWeek`. */
  minQuantity: number | null;
  /** Quantity logged today (IST); 0 when the goal has no daily minimum. */
  todayQuantity: number;
  /** Default minutes for the quick log and the picker's generic idea. */
  estMinutes: number | null;
  energy: Energy;
  /** True for goals the user invented in the add sheet. */
  isCustom: boolean;
};

export type TargetProgressSet = {
  /** Monday 00:00 IST, inclusive. */
  weekStart: Date;
  /** Next Monday 00:00 IST, exclusive. */
  weekEnd: Date;
  /** First day of the current IST month, inclusive. */
  monthStart: Date;
  /** First day of the next IST month, exclusive. */
  monthEnd: Date;
  goals: GoalProgress[];
};

export type TargetRow = {
  goal: string;
  label: string;
  per_week: number | string;
  period: string | null;
  min_distance_km: number | string | null;
  min_quantity: number | string | null;
  est_minutes: number | string | null;
  energy: string | null;
  is_custom: boolean | null;
};

export type CompletionSlice = {
  goal: string | null;
  distance_km: number | string | null;
  quantity: number | string | null;
  completed_at: string;
};

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toEnergy(value: string | null | undefined): Energy {
  return value === "low" || value === "high" ? value : "normal";
}

export function targetPeriod(value: string | null | undefined): TargetPeriod {
  return value === "month" ? "month" : "week";
}

export function periodLabel(period: TargetPeriod): string {
  return period === "month" ? "this month" : "this week";
}

/** First 00:00 IST of the month containing `date`. */
export function startOfIstMonth(date: Date): Date {
  const { year, month } = istParts(date);
  return new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS);
}

/** First 00:00 IST of the next month — the exclusive end of the range. */
export function startOfNextIstMonth(date: Date): Date {
  const { year, month } = istParts(date);
  return new Date(Date.UTC(year, month + 1, 1) - IST_OFFSET_MS);
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

/** What one completion adds to a daily total; a blank quantity counts as one. */
function quantityOf(completion: CompletionSlice): number {
  const quantity = toNumber(completion.quantity);
  return quantity !== null && quantity > 0 ? Math.round(quantity) : 1;
}

/**
 * Pure core: one target plus the completions of the current week/month in, one
 * progress row out. `now` decides the period, so the day/week edge is testable.
 */
export function targetProgress(
  target: TargetRow,
  completions: readonly CompletionSlice[],
  now: Date = new Date(),
): GoalProgress {
  const period = targetPeriod(target.period);
  const minDistanceKm = toNumber(target.min_distance_km);
  const minQuantity = toNumber(target.min_quantity);
  const todayKey = istDayKey(now);

  const weekStart = startOfIstWeek(now);
  const weekEnd = startOfNextIstWeek(now);
  const monthStart = startOfIstMonth(now);
  const monthEnd = startOfNextIstMonth(now);
  const windowStart = period === "month" ? monthStart : weekStart;
  const windowEnd = period === "month" ? monthEnd : weekEnd;

  const inPeriod = completions.filter((completion) => {
    if (completion.goal !== target.goal) return false;
    const at = Date.parse(completion.completed_at);
    if (!Number.isFinite(at)) return false;
    return (
      at >= windowStart.getTime() &&
      at < windowEnd.getTime() &&
      countsTowardTarget(minDistanceKm, completion.distance_km)
    );
  });

  const byDay = new Map<string, number>();
  for (const completion of inPeriod) {
    const day = istDayKey(new Date(completion.completed_at));
    byDay.set(day, (byDay.get(day) ?? 0) + quantityOf(completion));
  }

  const perWeek = Math.max(1, Math.round(toNumber(target.per_week) ?? 1));

  // A daily minimum turns "3x a week" into "3 days, each with 3 applications",
  // so a half-done day counts for nothing yet.
  const done =
    minQuantity === null
      ? inPeriod.length
      : [...byDay.values()].filter((total) => total >= minQuantity).length;

  const estMinutes = toNumber(target.est_minutes);

  return {
    goal: target.goal,
    label: target.label,
    perWeek,
    done,
    period,
    minDistanceKm,
    minQuantity: minQuantity === null ? null : Math.max(1, Math.round(minQuantity)),
    todayQuantity: minQuantity === null ? 0 : (byDay.get(todayKey) ?? 0),
    estMinutes:
      estMinutes !== null && estMinutes > 0 ? Math.round(estMinutes) : null,
    energy: toEnergy(target.energy),
    isCustom: target.is_custom === true,
  };
}

export function findGoalProgress(
  goals: readonly GoalProgress[],
  goal: string | null | undefined,
): GoalProgress | undefined {
  if (!goal) return undefined;
  return goals.find((entry) => entry.goal === goal);
}

/**
 * Targets plus the completions that matter, both read as the signed-in user so
 * RLS decides what is visible. One query each, whatever the number of goals.
 */
export async function loadTargetProgress(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<TargetProgressSet> {
  const weekStart = startOfIstWeek(now);
  const weekEnd = startOfNextIstWeek(now);
  const monthStart = startOfIstMonth(now);
  const monthEnd = startOfNextIstMonth(now);

  const { data: targetData, error: targetError } = await supabase
    .from("targets")
    .select(
      "goal, label, per_week, period, min_distance_km, min_quantity, est_minutes, energy, is_custom",
    )
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .order("label", { ascending: true });

  if (targetError) {
    throw new Error(
      `Could not load your targets: ${targetError.message}. On a fresh project, run supabase/migrations/007_job_rules_custom_goals.sql.`,
    );
  }

  const from = monthStart < weekStart ? monthStart : weekStart;
  const to = monthEnd > weekEnd ? monthEnd : weekEnd;

  const { data: completionData, error: completionError } = await supabase
    .from("completions")
    .select("goal, distance_km, quantity, completed_at")
    .eq("user_id", userId)
    .gte("completed_at", from.toISOString())
    .lt("completed_at", to.toISOString())
    .order("completed_at", { ascending: false })
    .limit(2000);

  if (completionError) {
    throw new Error(
      `Could not load recent completions: ${completionError.message}`,
    );
  }

  const completions = (completionData ?? []) as CompletionSlice[];

  return {
    weekStart,
    weekEnd,
    monthStart,
    monthEnd,
    goals: ((targetData ?? []) as TargetRow[]).map((row) =>
      targetProgress(row, completions, now),
    ),
  };
}

/** Short hint next to a pill: "today 2/3". */
export function targetHint(goal: GoalProgress): string | null {
  if (goal.minQuantity !== null) {
    return `today ${goal.todayQuantity}/${goal.minQuantity}`;
  }
  return null;
}

/** `2026-11-15` for a Date — used for the export filename. */
export function istDayKeyOf(date: Date): string {
  return istDayKey(date);
}

export { shiftDayKey };

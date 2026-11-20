/**
 * Quick-log presets: the chip row under the pick buttons.
 *
 * Goals come from the user's active targets, so the row always matches their
 * own setup. "Other" is always last and logs without a goal: it keeps the
 * streak alive without pretending to be one of the targets.
 *
 * A target with a daily minimum (job search: three applications on a search
 * day) prefills the quantity field, so the chip and the sheet agree on what
 * "done" means today.
 */

import { EDIT_WINDOW_DAYS } from "@/lib/lock";
import { DISTANCE_GOAL, JOB_SEARCH_GOAL } from "@/lib/task";
import type { GoalProgress, TargetPeriod } from "@/lib/targets";

export type QuickLogTarget = {
  /** null is the "Other" chip: no weekly goal, counts for the streak only. */
  goal: string | null;
  label: string;
  minutes: number;
  /** Count-only goal (job search): the sheet asks "how many?" and no time. */
  quantityOnly: boolean;
  /** Prefilled distance for walk/run goals, null for everything else. */
  distanceKm: number | null;
  /** Walk/run only: below this distance the log does not count this week. */
  minDistanceKm: number | null;
  /** Daily minimum for this goal; when set the sheet asks "how many?". */
  minQuantity: number | null;
  /** Prefilled quantity: what is still missing today (at least one). */
  quantity: number | null;
  /** Already logged today, for the hint under the quantity field. */
  todayQuantity: number;
  period: TargetPeriod;
};

/**
 * Minutes used when a target has no `est_minutes` of its own. The seeded
 * targets carry their own estimate, so this is only a safety net.
 */
const DEFAULT_MINUTES_BY_GOAL: Record<string, number> = {
  walk_run: 45,
  leetcode: 30,
  ai_learning: 25,
  bi: 30,
  job_search: 45,
  resume_update: 60,
};

export const QUICK_LOG_FALLBACK_MINUTES = 30;
export const QUICK_LOG_DEFAULT_DISTANCE_KM = 5;

/** Quick logs can be backdated this far, but never into the future. */
export const QUICK_LOG_MAX_DAYS_BACK = EDIT_WINDOW_DAYS;

export function defaultMinutes(goal: string | null): number {
  if (!goal) return QUICK_LOG_FALLBACK_MINUTES;
  return DEFAULT_MINUTES_BY_GOAL[goal] ?? QUICK_LOG_FALLBACK_MINUTES;
}

/** What is left of a daily minimum, so the sheet can prefill a useful number. */
export function remainingQuantity(goal: GoalProgress): number | null {
  if (goal.minQuantity === null) return null;
  return Math.max(1, goal.minQuantity - goal.todayQuantity);
}

/** Walk/run first (it is the one with a distance), then the user's order. */
export function quickLogTargets(
  goals: readonly GoalProgress[],
): QuickLogTarget[] {
  const walk = goals.filter((goal) => goal.goal === DISTANCE_GOAL);
  const rest = goals.filter((goal) => goal.goal !== DISTANCE_GOAL);

  return [
    ...[...walk, ...rest].map((goal) => ({
      goal: goal.goal,
      label: goal.label,
      minutes: goal.estMinutes ?? defaultMinutes(goal.goal),
      quantityOnly: goal.goal === JOB_SEARCH_GOAL,
      distanceKm:
        goal.goal === DISTANCE_GOAL ? QUICK_LOG_DEFAULT_DISTANCE_KM : null,
      minDistanceKm: goal.minDistanceKm,
      minQuantity: goal.minQuantity,
      quantity: remainingQuantity(goal),
      todayQuantity: goal.todayQuantity,
      period: goal.period,
    })),
    {
      goal: null,
      label: "Other",
      minutes: QUICK_LOG_FALLBACK_MINUTES,
      quantityOnly: false,
      distanceKm: null,
      minDistanceKm: null,
      minQuantity: null,
      quantity: null,
      todayQuantity: 0,
      period: "week",
    },
  ];
}

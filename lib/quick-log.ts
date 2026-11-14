/**
 * Quick-log presets: the chip row under the pick buttons.
 *
 * Goals come from the user's active weekly targets, so the row always matches
 * their own setup. "Other" is always last and logs without a goal: it keeps the
 * streak alive without pretending to be one of the targets.
 */

import type { GoalProgress } from "@/lib/progress";
import { DISTANCE_GOAL } from "@/lib/task";

export type QuickLogTarget = {
  /** null is the "Other" chip: no weekly goal, counts for the streak only. */
  goal: string | null;
  label: string;
  minutes: number;
  /** Prefilled distance for walk/run goals, null for everything else. */
  distanceKm: number | null;
  /** Walk/run only: below this distance the log does not count this week. */
  minDistanceKm: number | null;
};

const DEFAULT_MINUTES_BY_GOAL: Record<string, number> = {
  walk_run: 45,
  leetcode: 30,
  ai_learning: 25,
  bi: 30,
  job_search: 20,
};

export const QUICK_LOG_FALLBACK_MINUTES = 30;
export const QUICK_LOG_DEFAULT_DISTANCE_KM = 5;

/** Quick logs can be backdated this far, but never into the future. */
export const QUICK_LOG_MAX_DAYS_BACK = 14;

export function defaultMinutes(goal: string | null): number {
  if (!goal) return QUICK_LOG_FALLBACK_MINUTES;
  return DEFAULT_MINUTES_BY_GOAL[goal] ?? QUICK_LOG_FALLBACK_MINUTES;
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
      minutes: defaultMinutes(goal.goal),
      distanceKm:
        goal.goal === DISTANCE_GOAL ? QUICK_LOG_DEFAULT_DISTANCE_KM : null,
      minDistanceKm: goal.minDistanceKm,
    })),
    {
      goal: null,
      label: "Other",
      minutes: QUICK_LOG_FALLBACK_MINUTES,
      distanceKm: null,
      minDistanceKm: null,
    },
  ];
}

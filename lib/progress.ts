/**
 * The weekly/monthly target maths lives in `lib/targets.ts`. This module keeps
 * the older `WeeklyProgress` / `loadWeeklyProgress` names so the screens and the
 * picker did not all have to be renamed when monthly targets arrived.
 *
 * A "week" here now means "the current period of each target": the pills show
 * the week for weekly goals and the month for monthly ones.
 */

import {
  findGoalProgress as findGoalIn,
  loadTargetProgress,
  type GoalProgress,
  type TargetProgressSet,
} from "@/lib/targets";

export type WeeklyProgress = TargetProgressSet;

export type { GoalProgress };

export {
  countsTowardTarget,
  loadTargetProgress,
  periodLabel,
  targetHint,
} from "@/lib/targets";

export function loadWeeklyProgress(
  supabase: Parameters<typeof loadTargetProgress>[0],
  userId: string,
  now: Date = new Date(),
): Promise<WeeklyProgress> {
  return loadTargetProgress(supabase, userId, now);
}

/** Kept as a set-based lookup, matching the old call sites in the picker. */
export function findGoalProgress(
  progress: WeeklyProgress,
  goal: string | null,
): GoalProgress | undefined {
  return findGoalIn(progress.goals, goal);
}

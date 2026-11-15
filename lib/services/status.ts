import { loadWeeklyProgress } from "@/lib/progress";
import { loadMissingScreenDays } from "@/lib/screen-time";
import type { DbSession } from "@/lib/services/session";
import { loadStreak } from "@/lib/streak";
import { istDayKey, shiftDayKey } from "@/lib/week";

/** Numbers only: the assistant never sees journal text or task titles. */
export type StatusSummary = {
  streakDays: number;
  longestStreak: number;
  completedToday: boolean;
  /** Completions logged today, IST. */
  todayCompletions: number;
  /** This week's targets with how many completions count toward each. */
  week: { goal: string; done: number; perWeek: number }[];
  /** Completed days in the last three with no screen time, oldest first. */
  missingScreenDays: string[];
};

/**
 * One small read for the get_status tool: streak, this week's per-target
 * progress, today's completion count and which recent days lack screen time.
 * Only counts and day keys leave this function — no journal notes, no titles.
 */
export async function loadStatus(
  session: DbSession,
  now: Date = new Date(),
): Promise<StatusSummary> {
  const todayKey = istDayKey(now);
  const tomorrowKey = shiftDayKey(todayKey, 1);

  const [progress, streak, todayCount, missingScreenDays] = await Promise.all([
    loadWeeklyProgress(session.supabase, session.userId, now),
    loadStreak(session.supabase, session.userId, now),
    session.supabase
      .from("completions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.userId)
      .gte("completed_at", `${todayKey}T00:00:00+05:30`)
      .lt("completed_at", `${tomorrowKey}T00:00:00+05:30`),
    loadMissingScreenDays(session.supabase, session.userId, now).catch(
      (error: unknown) => {
        console.error("Could not load missing screen-time days:", error);
        return [] as string[];
      },
    ),
  ]);

  if (todayCount.error) {
    console.error("Could not count today's completions:", todayCount.error.message);
  }

  return {
    streakDays: streak.days,
    longestStreak: streak.longest,
    completedToday: streak.completedToday,
    todayCompletions: todayCount.error ? 0 : (todayCount.count ?? 0),
    week: progress.goals.map((goal) => ({
      goal: goal.goal,
      done: goal.done,
      perWeek: goal.perWeek,
    })),
    missingScreenDays,
  };
}

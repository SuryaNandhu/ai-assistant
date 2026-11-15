import { loadJournalBacklog, type JournalBacklog } from "@/lib/journal";
import { loadWeeklyProgress } from "@/lib/progress";
import {
  loadScreenTimeTracking,
  type ScreenTimeTracking,
} from "@/lib/screen-time";
import type { DbSession } from "@/lib/services/session";
import {
  loadRestDayState,
  REST_DAY_UNSUPPORTED,
} from "@/lib/services/rest-day";
import { loadStreak } from "@/lib/streak";
import type { TargetPeriod } from "@/lib/targets";
import { istDayKey, shiftDayKey } from "@/lib/week";

/** Numbers only: the assistant never sees journal text or task titles. */
export type StatusSummary = {
  streakDays: number;
  longestStreak: number;
  completedToday: boolean;
  /** Completions logged today, IST. */
  todayCompletions: number;
  /** Every active target, counted in its own period (week or month). */
  targets: {
    goal: string;
    label: string;
    done: number;
    perPeriod: number;
    period: TargetPeriod;
    /** Daily minimum for day-based targets (job search: 3 a day). */
    minQuantity: number | null;
    /** Quantity logged today, when the target has a daily minimum. */
    todayQuantity: number | null;
  }[];
  /** First day with screen time, or null if nothing is logged yet. */
  screenTrackingStart: string | null;
  /** Completed days since tracking began with no screen time, oldest first. */
  missingScreenDays: string[];
  /** Days since the journal began with no entry, newest first (keys only). */
  journalMissingDays: string[];
  /** The day taken as this week's rest day, or null if the week is unused. */
  restDayUsed: string | null;
  /** Which day can still be taken as a rest day this week, if any. */
  restDayAvailable: "today" | "yesterday" | null;
  /** Why neither day qualifies, when both are refused. */
  restDayBlockedReason: string | null;
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

  const [progress, streak, todayCount, tracking, journal, restDay] =
    await Promise.all([
      loadWeeklyProgress(session.supabase, session.userId, now),
      loadStreak(session.supabase, session.userId, now),
      session.supabase
        .from("completions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", session.userId)
        .gte("completed_at", `${todayKey}T00:00:00+05:30`)
        .lt("completed_at", `${tomorrowKey}T00:00:00+05:30`),
      loadScreenTimeTracking(session.supabase, session.userId, now).catch(
        (error: unknown) => {
          console.error("Could not load missing screen-time days:", error);
          return { start: null, missing: [] } satisfies ScreenTimeTracking;
        },
      ),
      loadJournalBacklog(session.supabase, session.userId, now).catch(
        (error: unknown) => {
          console.error("Could not load missing journal days:", error);
          return { start: null, missing: [] } satisfies JournalBacklog;
        },
      ),
      // Rest days are optional; a missing 008 column only hides the allowance.
      loadRestDayState(session, now).catch((error: unknown) => {
        console.error("Could not load the rest day:", error);
        return null;
      }),
    ]);

  if (todayCount.error) {
    console.error("Could not count today's completions:", todayCount.error.message);
  }

  const restDayAvailable =
    restDay === null
      ? null
      : restDay.today.allowed
        ? ("today" as const)
        : restDay.yesterday.allowed
          ? ("yesterday" as const)
          : null;

  return {
    streakDays: streak.days,
    longestStreak: streak.longest,
    completedToday: streak.completedToday,
    todayCompletions: todayCount.error ? 0 : (todayCount.count ?? 0),
    targets: progress.goals.map((goal) => ({
      goal: goal.goal,
      label: goal.label,
      done: goal.done,
      perPeriod: goal.perWeek,
      period: goal.period,
      minQuantity: goal.minQuantity,
      todayQuantity: goal.minQuantity === null ? null : goal.todayQuantity,
    })),
    screenTrackingStart: tracking.start,
    missingScreenDays: tracking.missing,
    journalMissingDays: journal.missing,
    restDayUsed: restDay?.thisWeekRestDay ?? null,
    restDayAvailable,
    restDayBlockedReason: restDayAvailable
      ? null
      : (restDay?.today.reason ??
        restDay?.yesterday.reason ??
        (restDay === null ? REST_DAY_UNSUPPORTED : "No rest day left this week.")),
  };
}


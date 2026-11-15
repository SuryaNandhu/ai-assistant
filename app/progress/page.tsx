import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { MonthCalendar } from "@/components/month-calendar";
import { ProgressRings } from "@/components/progress-rings";
import { ScreenTimePanel } from "@/components/screen-time-summary";
import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import {
  buildMonth,
  currentMonth,
  parseMonthKey,
  sameMonth,
} from "@/lib/calendar";
import { errorMessage, isSupabaseConfigured } from "@/lib/env";
import { loadWeeklyProgress, type WeeklyProgress } from "@/lib/progress";
import { QUICK_LOG_MAX_DAYS_BACK, quickLogTargets } from "@/lib/quick-log";
import { formatKm, loadMonthActivity, type MonthActivity } from "@/lib/report";
import {
  loadScreenLimit,
  loadScreenTimeSince,
  summariseScreenTime,
  type ScreenTimeSummary,
} from "@/lib/screen-time";
import { loadStreak, type Streak } from "@/lib/streak";
import { createClient } from "@/lib/supabase/server";
import { istDayKey, istWeekLabel, shiftDayKey } from "@/lib/week";

// Auth-gated page: always evaluate the session at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Progress",
};

type ProgressPageProps = {
  /** `?month=YYYY-MM`, validated below; anything else falls back to today. */
  searchParams: Promise<{ month?: string | string[] }>;
};

export default async function ProgressPage({ searchParams }: ProgressPageProps) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Progress</h1>
        <SetupNotice />
      </main>
    );
  }

  const user = await requireUser();
  const supabase = await createClient();

  const now = new Date();
  const todayKey = istDayKey(now);
  const minDayKey = shiftDayKey(todayKey, -QUICK_LOG_MAX_DAYS_BACK);

  const params = await searchParams;
  const rawMonth = Array.isArray(params.month) ? params.month[0] : params.month;
  const thisMonth = currentMonth(now);
  const visibleMonth = parseMonthKey(rawMonth) ?? thisMonth;

  let progress: WeeklyProgress | null = null;
  let streak: Streak | null = null;
  let statsError: string | null = null;

  try {
    [progress, streak] = await Promise.all([
      loadWeeklyProgress(supabase, user.id, now),
      loadStreak(supabase, user.id, now),
    ]);
  } catch (error) {
    console.error(error);
    statsError = errorMessage(error);
  }

  // One completions query and one journal query per month, IST-bounded.
  let activity: MonthActivity | null = null;
  let currentActivity: MonthActivity | null = null;
  let monthError: string | null = null;

  try {
    activity = await loadMonthActivity(supabase, user.id, visibleMonth);
    currentActivity = sameMonth(visibleMonth, thisMonth)
      ? activity
      : await loadMonthActivity(supabase, user.id, thisMonth);
  } catch (error) {
    console.error(error);
    monthError = "Could not load this month. Reload the page and try again.";
  }

  const totals = currentActivity?.totals ?? { completions: 0, distanceKm: 0 };
  const month = buildMonth(visibleMonth);
  const streakDays = streak?.days ?? 0;
  const longest = streak?.longest ?? 0;

  // Screen time: 14 fixed IST days plus the optional limit (null = not set).
  let screenSummary: ScreenTimeSummary | null = null;
  let screenError: string | null = null;

  try {
    const [entries, limit] = await Promise.all([
      loadScreenTimeSince(supabase, user.id, undefined, now),
      loadScreenLimit(supabase, user.id),
    ]);

    screenSummary = summariseScreenTime(entries, limit, now);
  } catch (error) {
    console.error(error);
    screenError = "Could not load screen time. Reload the page and try again.";
  }

  const screenLimit = screenSummary?.limitMinutes ?? null;

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AppHeader email={user.email} />
        <div className="mx-auto w-full max-w-md px-4 pt-4 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {progress
                  ? `This week · ${istWeekLabel(progress.weekStart, progress.weekEnd)}`
                  : "Streaks, weekly rings and the month at a glance."}
              </p>
            </div>
            {/* Home hides its journal card once the day is written. */}
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Link
                href="/journal"
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Journal
              </Link>
              <Link
                href="/progress/weeks"
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Weeks
              </Link>
            </div>
          </div>

          {statsError && (
            <p
              role="alert"
              className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {statsError}
            </p>
          )}

          <section className="mt-4 grid grid-cols-2 gap-2" aria-label="Streak">
            <div className="rounded-2xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Current streak</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {streakDays}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  {streakDays === 1 ? "day" : "days"}
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {streak?.completedToday
                  ? "Already logged today"
                  : "Log anything to keep it"}
              </p>
            </div>

            <div className="rounded-2xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Longest streak</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {longest}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  {longest === 1 ? "day" : "days"}
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Best run so far
              </p>
            </div>
          </section>

          <section className="mt-4 grid grid-cols-2 gap-2" aria-label="This month">
            <div className="rounded-2xl border border-border p-3">
              <p className="text-xs text-muted-foreground">This month</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {totals.completions}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {totals.completions === 1 ? "completion" : "completions"}
              </p>
            </div>

            <div className="rounded-2xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Walk / run</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatKm(totals.distanceKm)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                logged this month
              </p>
            </div>
          </section>

          <section className="mt-5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Weekly targets
            </h2>
            <div className="mt-3">
              <ProgressRings goals={progress?.goals ?? []} />
            </div>
          </section>

          {screenSummary ? (
            <ScreenTimePanel summary={screenSummary} error={screenError} />
          ) : (
            screenError && (
              <p
                role="alert"
                className="mt-5 rounded-xl border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              >
                {screenError}
              </p>
            )
          )}

          <div className="mt-6">
            <MonthCalendar
              month={month}
              activity={activity}
              error={monthError}
              todayKey={todayKey}
              minDayKey={minDayKey}
              targets={quickLogTargets(progress?.goals ?? [])}
              screenLimit={screenLimit}
            />
          </div>

          <section className="mt-6 rounded-2xl border border-border p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your data
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              One JSON file with your items, completions, targets, journal,
              screen time and chat. Five downloads an hour.
            </p>
            <a
              href="/api/export"
              download
              className="mt-3 inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-semibold underline-offset-2 hover:bg-muted"
            >
              Export my data
            </a>
          </section>
        </div>

      </div>
      <BottomNav />
    </main>
  );
}

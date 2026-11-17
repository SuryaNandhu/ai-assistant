import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { SetupNotice } from "@/components/setup-notice";
import { WeekBars } from "@/components/week-bars";
import { WeekPicker } from "@/components/week-picker";
import { requireUser } from "@/lib/auth";
import { errorMessage, isSupabaseConfigured } from "@/lib/env";
import { formatKm } from "@/lib/report";
import { formatMinutes } from "@/lib/screen-time";
import {
  loadWeeksPage,
  type WeekSummary,
  type WeeksPageData,
} from "@/lib/services/weekly";
import { createClient } from "@/lib/supabase/server";
import { dayKeyLabel } from "@/lib/week";

// Auth-gated page: always evaluate the session at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Weeks",
};

type WeeksPageProps = {
  /** `?week=YYYY-MM-DD`, a Monday; anything else falls back to this week. */
  searchParams: Promise<{ week?: string | string[] }>;
};

export default async function WeeksPage({ searchParams }: WeeksPageProps) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Weeks</h1>
        <SetupNotice />
      </main>
    );
  }

  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const rawWeek = Array.isArray(params.week) ? params.week[0] : params.week;

  let data: WeeksPageData | null = null;
  let loadError: string | null = null;

  try {
    data = await loadWeeksPage(
      { supabase, userId: user.id },
      { week: rawWeek ?? null },
    );
  } catch (error) {
    console.error(error);
    loadError = errorMessage(error);
  }

  const selected = data?.selected ?? null;
  const pastWeek = selected && !selected.isCurrent ? selected.startKey : null;

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AppHeader email={user.email} />

        <div className="mx-auto w-full max-w-md px-4 pt-4 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Weeks</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {selected?.isCurrent
                  ? "This week so far, counted from your own data."
                  : "One week at a time, counted from your own data."}
              </p>
            </div>
            <Link
              href="/progress"
              className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Progress
            </Link>
          </div>

          {loadError && (
            <p
              role="alert"
              className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {loadError}
            </p>
          )}

          {data && selected && (
            <WeekPicker options={data.pastWeeks} selected={pastWeek} />
          )}

          {selected && (
            <WeekCard week={selected} previous={data?.previous ?? null} />
          )}

          {!selected && !loadError && (
            <p className="mt-4 rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Nothing to summarise yet.
            </p>
          )}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-2 py-1.5">
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

/** `4× · 1 h 30 m` — only the parts that are non-zero. */
function goalDetail(count: number, minutes: number, distanceKm: number) {
  const parts = [`${count}×`];
  if (minutes > 0) parts.push(formatMinutes(minutes));
  if (distanceKm > 0) parts.push(formatKm(distanceKm));
  return parts.join(" · ");
}

function deltaLabel(week: WeekSummary, previous: WeekSummary) {
  const diff = week.completions - previous.completions;
  if (diff === 0) return "Same as the week before";
  return diff > 0
    ? `+${diff} vs the week before`
    : `−${Math.abs(diff)} vs the week before`;
}

function WeekCard({
  week,
  previous,
}: {
  week: WeekSummary;
  previous: WeekSummary | null;
}) {
  const quiet =
    week.completions === 0 && week.journalDays === 0 && week.screenDays === 0;

  return (
    <section className="mt-3 rounded-2xl border border-border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{week.label}</h2>
        {week.isCurrent ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            This week so far
          </span>
        ) : previous ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {deltaLabel(week, previous)}
          </span>
        ) : null}
      </div>

      {quiet ? (
        <p className="mt-2 text-xs text-muted-foreground">
          A quiet week — nothing logged.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat value={String(week.completions)} label="done" />
            <Stat value={`${week.activeDays}/7`} label="active days" />
            <Stat
              value={week.minutes > 0 ? formatMinutes(week.minutes) : "—"}
              label="logged"
            />
          </div>

          <div className="mt-3">
            <WeekBars days={week.days} />
          </div>

          {week.bestDay && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Best day {dayKeyLabel(week.bestDay.dayKey)} ·{" "}
              {week.bestDay.count} done
            </p>
          )}

          {week.goals.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-border pt-3">
              {week.goals.slice(0, 4).map((goal) => (
                <li
                  key={goal.goal}
                  className="flex items-baseline justify-between gap-3 text-xs"
                >
                  <span className="min-w-0 truncate">{goal.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {goalDetail(goal.count, goal.minutes, goal.distanceKm)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {week.goals.length > 4 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              +{week.goals.length - 4} more goal
              {week.goals.length - 4 === 1 ? "" : "s"}
            </p>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <span>
          {week.restDay
            ? `😴 Rest day ${dayKeyLabel(week.restDay)}`
            : week.isCurrent
              ? "Rest day not used yet"
              : "No rest day"}
        </span>
        <span>
          {week.averageMood === null
            ? "No mood logged"
            : `Mood ${week.averageMood}/5 · ${week.journalDays}/7 days`}
        </span>
        <span>
          {week.screenAverageMinutes === null
            ? "No screen log"
            : `Screen ${formatMinutes(week.screenAverageMinutes)}/day · ${week.screenDays} days`}
        </span>
        {week.distanceKm > 0 && <span>Ran {formatKm(week.distanceKm)}</span>}
      </div>
    </section>
  );
}

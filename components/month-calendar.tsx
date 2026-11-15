"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DaySheet } from "@/components/day-sheet";
import {
  WEEKDAY_INITIALS,
  intensityFor,
  monthKey,
  type CalendarMonth,
} from "@/lib/calendar";
import { moodEmoji } from "@/lib/journal";
import type { QuickLogTarget } from "@/lib/quick-log";
import type { MonthActivity, MonthDay } from "@/lib/report";
import { dayKeyLabel } from "@/lib/week";

type MonthCalendarProps = {
  month: CalendarMonth;
  activity: MonthActivity | null;
  error: string | null;
  todayKey: string;
  /** Earliest day the quick-log shortcut may use. */
  minDayKey: string;
  targets: readonly QuickLogTarget[];
  /** Daily screen-time limit, shown in the day panel. */
  screenLimit: number;
};

/** 0, 1, 2 and "3 or more" shades; all four flip with dark mode. */
const SHADES = [
  "border-border bg-background",
  "border-border bg-muted",
  "border-transparent bg-foreground/20",
  "border-transparent bg-foreground text-background",
] as const;

const ARROW_BUTTON =
  "flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

/**
 * A hand-built month grid: Monday first, today ringed, a shade per completion
 * count and a mood emoji when that day was journalled. Tapping a day opens the
 * day panel.
 */
export function MonthCalendar({
  month,
  activity,
  error,
  todayKey,
  minDayKey,
  targets,
  screenLimit,
}: MonthCalendarProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, MonthDay>();
    for (const day of activity?.days ?? []) {
      map.set(day.dayKey, day);
    }
    return map;
  }, [activity]);

  const visibleMonthKey = monthKey(month.ref);
  const isCurrentMonth = visibleMonthKey === todayKey.slice(0, 7);

  const selectedDay = selected ? byDay.get(selected) : undefined;

  return (
    <section className="rounded-2xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/progress?month=${month.prevKey}`}
          aria-label="Previous month"
          className={ARROW_BUTTON}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="m14 6-6 6 6 6" />
          </svg>
        </Link>

        <div className="min-w-0 text-center">
          <p className="text-sm font-semibold">{month.label}</p>
          {isCurrentMonth ? (
            <p className="text-[11px] text-muted-foreground">This month</p>
          ) : (
            <Link
              href="/progress"
              className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Back to this month
            </Link>
          )}
        </div>

        <Link
          href={`/progress?month=${month.nextKey}`}
          aria-label="Next month"
          className={ARROW_BUTTON}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="m10 6 6 6-6 6" />
          </svg>
        </Link>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <div
            key={`${initial}-${index}`}
            className="pb-1 text-center text-[11px] font-medium text-muted-foreground"
          >
            {initial}
          </div>
        ))}

        {month.weeks.flat().map((cell) => {
          if (!cell.inMonth) {
            return (
              <div key={cell.dayKey} aria-hidden="true" className="h-12" />
            );
          }

          const day = byDay.get(cell.dayKey);
          const count = day?.completions.length ?? 0;
          const isToday = cell.dayKey === todayKey;
          const mood = day?.journal?.mood;

          return (
            <button
              key={cell.dayKey}
              type="button"
              onClick={() => setSelected(cell.dayKey)}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${dayKeyLabel(cell.dayKey)}: ${count} ${
                count === 1 ? "completion" : "completions"
              }${mood ? ", journal written" : ""}`}
              className={[
                "relative flex h-12 flex-col items-center justify-center rounded-lg border transition-colors",
                SHADES[intensityFor(count)],
                isToday
                  ? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
                  : "",
                count > 0 ? "font-semibold" : "font-normal",
              ].join(" ")}
            >
              <span className="text-sm leading-none tabular-nums">
                {cell.day}
              </span>
              <span
                aria-hidden="true"
                className="mt-0.5 h-3 text-[11px] leading-none"
              >
                {mood ? moodEmoji(mood) : ""}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Tap a day to see what you did.
      </p>


      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
        <span>Less</span>
        {SHADES.map((shade, level) => (
          <span
            key={level}
            aria-hidden="true"
            className={`h-3 w-3 rounded-[3px] border ${shade}`}
          />
        ))}
        <span>More</span>
      </div>

      {selected && (
        <DaySheet
          dayKey={selected}
          completions={selectedDay?.completions ?? []}
          journal={selectedDay?.journal ?? null}
          screenMinutes={selectedDay?.screenMinutes ?? null}
          screenLimit={screenLimit}
          todayKey={todayKey}
          minDayKey={minDayKey}
          targets={targets}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

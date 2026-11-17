import Link from "next/link";

import { formatMinutes } from "@/lib/screen-time";
import type { WeekSummary } from "@/lib/services/weekly";
import { dayKeyLabel } from "@/lib/week";

type LastWeekCardProps = {
  week: WeekSummary;
};

/**
 * Home, Monday and Tuesday only: the week that just ended is still the news, so
 * one line points at its summary. Everything on the card comes from the same
 * rows the Weeks page counts.
 */
export function LastWeekCard({ week }: LastWeekCardProps) {
  return (
    <section className="mx-auto w-full max-w-md px-4 pb-6">
      <Link
        href={`/progress/weeks?week=${week.startKey}`}
        className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background p-4 transition-colors hover:bg-muted"
      >
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Last week · {week.label}
          </p>
          <p className="mt-0.5 truncate text-sm font-medium">
            {week.completions === 0
              ? "Nothing logged"
              : `${week.completions} done on ${week.activeDays} of 7 days`}
            {week.minutes > 0 ? ` · ${formatMinutes(week.minutes)}` : ""}
          </p>
          {week.restDay && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              😴 Rest day {dayKeyLabel(week.restDay)}
            </p>
          )}
        </div>
        <span className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2">
          Summary →
        </span>
      </Link>
    </section>
  );
}

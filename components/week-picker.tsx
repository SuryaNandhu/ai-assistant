"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import type { WeekOption } from "@/lib/services/weekly";

type WeekPickerProps = {
  /** Completed weeks, newest first. The current week is never in here. */
  options: readonly WeekOption[];
  /** The past week on screen, or null while this week is on screen. */
  selected: string | null;
};

const SELECT_CLASS =
  "h-9 rounded-xl border border-border bg-background px-2 text-sm font-medium outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10 disabled:opacity-50";

/**
 * "Past weeks" — one completed week at a time. Choosing a week only changes the
 * `?week=` parameter, so the page stays shareable and the back button works.
 */
export function WeekPicker({ options, selected }: WeekPickerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (options.length === 0) {
    return (
      <div className="mt-4">
        <select aria-label="Past weeks" className={SELECT_CLASS} disabled>
          <option>No past weeks yet</option>
        </select>
      </div>
    );
  }

  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <select
        aria-label="Past weeks"
        className={SELECT_CLASS}
        value={selected ?? ""}
        disabled={pending}
        onChange={(event) => {
          const week = event.target.value;
          startTransition(() => {
            router.push(
              week
                ? `/progress/weeks?week=${encodeURIComponent(week)}`
                : "/progress/weeks",
            );
          });
        }}
      >
        <option value="" disabled>
          Past weeks
        </option>
        {options.map((option) => (
          <option key={option.week} value={option.week}>
            {option.label}
          </option>
        ))}
      </select>

      {selected && (
        <Link
          href="/progress/weeks"
          className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          This week so far
        </Link>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveScreenLimitAction } from "@/app/screen-time-actions";
import {
  SCREEN_LIMIT_OPTIONS,
  formatMinutes,
  isOverLimit,
  screenStatus,
  type ScreenTimeSummary,
} from "@/lib/screen-time";
import { dayKeyLabel } from "@/lib/week";

type ScreenTimeSummaryProps = {
  summary: ScreenTimeSummary;
  /** Loader failure, shown above the numbers. */
  error?: string | null;
};

/** Colour for the small status line under each number. */
function statusClass(status: "none" | "under" | "over"): string {
  if (status === "over") return "text-red-600 dark:text-red-400";
  if (status === "under") return "text-emerald-700 dark:text-emerald-400";
  return "text-muted-foreground";
}

/**
 * The /progress screen-time block: today, the seven-day average, how many of
 * those days went over, a 14-day bar strip and a sheet to change the limit.
 */
export function ScreenTimePanel({ summary, error }: ScreenTimeSummaryProps) {
  const router = useRouter();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [limit, setLimit] = useState(summary.limitMinutes);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();

  const todayStatus = screenStatus(summary.todayMinutes, limit);
  const averageStatus = screenStatus(summary.weekAverage, limit);
  const peak = Math.max(
    limit,
    ...summary.series.map((day) => day.minutes ?? 0),
  );

  function saveLimit(minutes: number) {
    if (saving) return;

    setLimitError(null);

    startSaving(async () => {
      const result = await saveScreenLimitAction({ minutes });

      if (!result.ok) {
        setLimitError(result.message);
        return;
      }

      setLimit(result.limitMinutes);
      setNotice(result.message);
      setSheetOpen(false);
      router.refresh();
    });
  }

  return (
    <section className="mt-5" aria-label="Screen time">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Screen time
        </h2>
        <button
          type="button"
          onClick={() => {
            setLimitError(null);
            setNotice(null);
            setSheetOpen(true);
          }}
          className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Limit · {formatMinutes(limit)}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}


      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Today</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {summary.todayMinutes === null
              ? "—"
              : formatMinutes(summary.todayMinutes)}
          </p>
          <p
            className={`mt-0.5 text-[11px] font-medium ${statusClass(todayStatus)}`}
          >
            {todayStatus === "none"
              ? "Not logged"
              : todayStatus === "over"
                ? "Over limit"
                : "Under limit"}
          </p>
        </div>

        <div className="rounded-2xl border border-border p-3">
          <p className="text-xs text-muted-foreground">7-day avg</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {summary.weekAverage === null
              ? "—"
              : formatMinutes(summary.weekAverage)}
          </p>
          <p
            className={`mt-0.5 text-[11px] font-medium ${statusClass(averageStatus)}`}
          >
            {summary.weekLoggedDays === 0
              ? "No days yet"
              : `${summary.weekLoggedDays}/7 logged`}
          </p>
        </div>

        <div className="rounded-2xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Over limit</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {summary.daysOverLimit}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {summary.daysOverLimit === 1 ? "day" : "days"}
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Last 7 days</p>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-border p-3">
        <p className="text-[11px] text-muted-foreground">Last 14 days</p>
        <div className="mt-2 flex h-20 items-end gap-1">
          {summary.series.map((day) => {
            const logged = day.minutes !== null;
            const minutes = day.minutes ?? 0;
            const height = logged ? Math.max(4, (minutes / peak) * 100) : 2;
            const label = `${dayKeyLabel(day.dayKey)}: ${
              logged ? formatMinutes(minutes) : "not logged"
            }`;

            return (
              <div key={day.dayKey} className="flex h-full flex-1 items-end">
                <div
                  role="img"
                  aria-label={label}
                  title={label}
                  style={{ height: `${height}%` }}
                  className={[
                    "w-full rounded-t-[3px]",
                    !logged
                      ? "bg-muted"
                      : isOverLimit(day.minutes, limit)
                        ? "bg-red-500/80"
                        : "bg-foreground/30",
                  ].join(" ")}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>2 weeks ago</span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-red-500/80 align-middle" />
            over limit
          </span>
          <span>Today</span>
        </div>
      </div>

      {notice && !sheetOpen && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {notice}
        </p>
      )}

      {sheetOpen && (
        <LimitSheet
          limit={limit}
          saving={saving}
          error={limitError}
          onPick={saveLimit}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}

type LimitSheetProps = {
  limit: number;
  saving: boolean;
  error: string | null;
  onPick: (minutes: number) => void;
  onClose: () => void;
};

/** Bottom sheet with preset limits; picking one saves straight away. */
function LimitSheet({ limit, saving, error, onPick, onClose }: LimitSheetProps) {
  const [custom, setCustom] = useState("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const parsed = Number(custom);
  const customValid =
    custom.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed >= 30 &&
    parsed <= 720;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close the limit sheet"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-limit-title"
        className="relative z-10 w-full max-w-md rounded-t-3xl border border-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="screen-limit-title" className="text-base font-semibold">
            Daily screen-time limit
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          Days above this show as red.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {SCREEN_LIMIT_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => onPick(minutes)}
              disabled={saving}
              aria-pressed={minutes === limit}
              className={[
                "h-10 rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-50",
                minutes === limit
                  ? "border-transparent bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {formatMinutes(minutes)}
            </button>
          ))}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (customValid) onPick(Math.round(parsed));
          }}
          className="mt-4"
        >
          <label
            htmlFor="screen-limit-custom"
            className="block text-sm font-medium"
          >
            Custom
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="screen-limit-custom"
              type="number"
              inputMode="numeric"
              min={30}
              max={720}
              step={5}
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="135"
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
            />
            <button
              type="submit"
              disabled={saving || !customValid}
              className="h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Between 30 min and 12 h.
          </p>
        </form>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}


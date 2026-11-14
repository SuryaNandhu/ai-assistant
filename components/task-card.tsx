"use client";

import { useState } from "react";

import type { PickedTask } from "@/lib/task";

type TaskCardProps = {
  task: PickedTask;
  /** Seconds on the clock, or null when the timer has not started. */
  elapsedSeconds: number | null;
  busy: boolean;
  /** Cached summary for this task's item, if one has been generated. */
  summary?: string | null;
  /** Why the last summary attempt failed. */
  summaryError?: string | null;
  /** A summary request is in flight for this task. */
  summarizing?: boolean;
  onStart: () => void;
  onDone: () => void;
  onSkip: () => void;
  /** Only offered for saved inbox items. */
  onSummarize?: () => void;
};

function formatElapsed(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (totalMinutes >= 60) {
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
  }

  return `${totalMinutes}:${String(seconds).padStart(2, "0")}`;
}

/** The one task on screen, with big thumb-sized controls. */
export function TaskCard({
  task,
  elapsedSeconds,
  busy,
  summary = null,
  summaryError = null,
  summarizing = false,
  onStart,
  onDone,
  onSkip,
  onSummarize,
}: TaskCardProps) {
  const running = elapsedSeconds !== null;
  const [summaryOpen, setSummaryOpen] = useState(true);

  return (
    <section
      aria-label="Current task"
      aria-busy={busy}
      className="rounded-2xl border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-muted px-2.5 py-1 font-medium">
          {task.goalLabel}
        </span>
        <span className="text-muted-foreground">{task.minutes} min</span>
        {task.source === "generic" && (
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-muted-foreground">
            suggestion
          </span>
        )}
      </div>

      <h2 className="mt-3 text-xl font-semibold leading-snug tracking-tight">
        {task.title}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">{task.reason}</p>

      {running && (
        <p className="mt-2 text-xs tabular-nums text-muted-foreground">
          Elapsed {formatElapsed(elapsedSeconds)} · est. {task.minutes} min
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          className="h-12 rounded-xl bg-accent px-3 text-base font-semibold text-accent-foreground transition-opacity disabled:opacity-50"
        >
          {running ? "Reopen" : task.url ? "Open link" : "Start"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="h-12 rounded-xl border border-border px-3 text-base font-semibold transition-colors hover:bg-muted disabled:opacity-50"
        >
          Done
        </button>
      </div>

      {task.itemId !== null && onSummarize && (
        <div className="mt-2">
          <button
            type="button"
            onClick={onSummarize}
            disabled={busy || summarizing}
            className="h-11 w-full rounded-xl border border-dashed border-border text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {summarizing
              ? "Summarising…"
              : summary
                ? "Summarize again"
                : "Summarize first"}
          </button>

          {summaryError && (
            <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
              {summaryError}
            </p>
          )}

          {summary && (
            <div className="mt-2 rounded-xl bg-muted p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Summary
                </p>
                <button
                  type="button"
                  onClick={() => setSummaryOpen((open) => !open)}
                  className="text-xs font-medium text-muted-foreground underline"
                >
                  {summaryOpen ? "Hide" : "Show"}
                </button>
              </div>
              {summaryOpen && (
                <p className="mt-1 whitespace-pre-line text-sm">{summary}</p>
              )}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onSkip}
        disabled={busy}
        className="mt-2 h-11 w-full rounded-xl text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        {busy ? "Picking another…" : "Skip"}
      </button>
    </section>
  );
}

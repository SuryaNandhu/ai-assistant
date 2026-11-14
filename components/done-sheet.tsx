"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  DEFAULT_DISTANCE_KM,
  FELT_OPTIONS,
  type Felt,
  type PickedTask,
} from "@/lib/task";

type DoneSheetProps = {
  task: PickedTask;
  /** Distance is only asked for the walk/run goal. */
  isWalk: boolean;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: { felt: Felt; distanceKm: number | null }) => void;
};

/** Bottom sheet shown when a task is done: how it felt, plus km for a run. */
export function DoneSheet({
  task,
  isWalk,
  pending,
  error,
  onCancel,
  onConfirm,
}: DoneSheetProps) {
  const [felt, setFelt] = useState<Felt>("ok");
  const [distance, setDistance] = useState(String(DEFAULT_DISTANCE_KM));

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isWalk) {
      onConfirm({ felt, distanceKm: null });
      return;
    }

    const parsed = Number(distance.replace(",", "."));
    const distanceKm = Number.isFinite(parsed)
      ? Math.min(100, Math.max(0, parsed))
      : DEFAULT_DISTANCE_KM;

    onConfirm({ felt, distanceKm });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="done-sheet-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/40"
      />

      <form
        onSubmit={handleSubmit}
        className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-1 w-10 rounded-full bg-border"
        />

        <h2 id="done-sheet-title" className="text-base font-semibold">
          Log this task
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {task.goalLabel} · {task.minutes} min
        </p>
        <p className="mt-2 text-sm">{task.title}</p>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">How did it feel?</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {FELT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={felt === option.value}
                onClick={() => setFelt(option.value)}
                className={[
                  "h-12 rounded-xl border text-sm font-medium transition-colors",
                  felt === option.value
                    ? "border-transparent bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        {isWalk && (
          <div className="mt-4">
            <label htmlFor="distance-km" className="text-sm font-medium">
              Distance (km)
            </label>
            <input
              id="distance-km"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.1"
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Only runs at or above your target distance count towards the week.
            </p>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-12 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="h-12 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : "Log it"}
          </button>
        </div>
      </form>
    </div>
  );
}

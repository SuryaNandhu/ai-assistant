"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";

import { quickLogAction } from "@/app/quick-log-actions";
import { QUICK_LOG_MAX_DAYS_BACK, type QuickLogTarget } from "@/lib/quick-log";
import { FELT_OPTIONS, type Felt } from "@/lib/task";

export type QuickLogSaved = { id: string; message: string };

type QuickLogSheetProps = {
  /** Already ordered, walk/run first, "Other" last. */
  targets: readonly QuickLogTarget[];
  /** Goal to open on; falls back to the first target. */
  initialGoal?: string | null;
  /** IST day key the form starts on. */
  initialDay: string;
  todayKey: string;
  minDayKey: string;
  /** The day panel opens without a chip row, so it picks the goal in here. */
  showTargetPicker?: boolean;
  onClose: () => void;
  onSaved?: (result: QuickLogSaved) => void;
};

const INPUT_CLASS =
  "mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

/**
 * The prefilled quick-log form. Home opens it from a chip; the Progress day
 * panel opens it with a date already filled in.
 */
export function QuickLogSheet({
  targets,
  initialGoal = null,
  initialDay,
  todayKey,
  minDayKey,
  showTargetPicker = false,
  onClose,
  onSaved,
}: QuickLogSheetProps) {
  const [goal, setGoal] = useState<string | null>(
    initialGoal ?? targets[0]?.goal ?? null,
  );
  const target = targets.find((entry) => entry.goal === goal) ?? targets[0];

  const [minutes, setMinutes] = useState(target ? String(target.minutes) : "");
  const [distance, setDistance] = useState(
    target && target.distanceKm !== null ? String(target.distanceKm) : "",
  );
  const [felt, setFelt] = useState<Felt>("ok");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(initialDay);
  const [error, setError] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function chooseGoal(next: QuickLogTarget) {
    setGoal(next.goal);
    setMinutes(String(next.minutes));
    setDistance(next.distanceKm === null ? "" : String(next.distanceKm));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || saving) return;

    setError(null);

    const parsedMinutes = Number(minutes);
    if (
      !Number.isFinite(parsedMinutes) ||
      parsedMinutes < 1 ||
      parsedMinutes > 600
    ) {
      setError("Minutes should be between 1 and 600.");
      return;
    }

    let distanceKm: number | null = null;
    if (target.distanceKm !== null) {
      const parsedDistance = Number(distance.replace(",", "."));
      if (
        !Number.isFinite(parsedDistance) ||
        parsedDistance < 0 ||
        parsedDistance > 100
      ) {
        setError("Distance should be between 0 and 100 km.");
        return;
      }
      distanceKm = parsedDistance;
    }

    const trimmedNote = note.trim() ? note.trim().slice(0, 280) : null;

    startSaving(async () => {
      const result = await quickLogAction({
        goal: target.goal,
        minutes: Math.round(parsedMinutes),
        distanceKm,
        felt,
        note: trimmedNote,
        day,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      onSaved?.({ id: result.id, message: result.message });
      onClose();
    });
  }

  if (!target) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-log-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
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

        <h2 id="quick-log-title" className="text-base font-semibold">
          Log {target.label.toLowerCase()}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Filled in with your usual numbers. Change anything you like.
        </p>

        {showTargetPicker && targets.length > 1 && (
          <div className="mt-4">
            <p className="text-sm font-medium">What did you do?</p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {targets.map((option) => (
                <button
                  key={option.goal ?? "other"}
                  type="button"
                  aria-pressed={option.goal === goal}
                  onClick={() => chooseGoal(option)}
                  className={[
                    "h-11 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors",
                    option.goal === goal
                      ? "border-transparent bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">Minutes</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          {target.distanceKm !== null && (
            <label className="block">
              <span className="text-sm font-medium">Distance (km)</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.1"
                value={distance}
                onChange={(event) => setDistance(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          )}
        </div>

        {target.distanceKm !== null && (
          <p className="mt-1 text-xs text-muted-foreground">
            {target.minDistanceKm === null
              ? "Any distance counts towards the week."
              : `Only runs at or above ${target.minDistanceKm} km count towards the week.`}
          </p>
        )}

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

        <label className="mt-4 block">
          <span className="text-sm font-medium">Note (optional)</span>
          <input
            type="text"
            maxLength={280}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="One line about it"
            className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-medium">Day</span>
          <input
            type="date"
            value={day}
            min={minDayKey}
            max={todayKey}
            onChange={(event) => setDay(event.target.value)}
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Up to {QUICK_LOG_MAX_DAYS_BACK} days back, in IST.
          </span>
        </label>

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
            onClick={onClose}
            disabled={saving}
            className="h-12 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-12 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : "Log it"}
          </button>
        </div>
      </form>
    </div>
  );
}

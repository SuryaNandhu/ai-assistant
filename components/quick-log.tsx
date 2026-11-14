"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import { quickLogAction, undoQuickLogAction } from "@/app/quick-log-actions";
import { QUICK_LOG_MAX_DAYS_BACK, type QuickLogTarget } from "@/lib/quick-log";
import { FELT_OPTIONS, type Felt } from "@/lib/task";

type QuickLogProps = {
  targets: readonly QuickLogTarget[];
  /** Today's IST day key, computed on the server so the client cannot drift. */
  todayKey: string;
  /** The earliest day a quick log may use. */
  minDayKey: string;
};

/** The undo toast stays for eight seconds. */
const TOAST_MS = 8000;

/**
 * "Quick log" chips plus the prefilled sheet. Every chip logs a manual
 * completion: minutes, distance for a walk/run, how it felt, an optional note
 * and the day. Saving refreshes Home so the streak and weekly pills update.
 */
export function QuickLog({ targets, todayKey, minDayKey }: QuickLogProps) {
  const router = useRouter();

  const [active, setActive] = useState<QuickLogTarget | null>(null);
  const [minutes, setMinutes] = useState("");
  const [distance, setDistance] = useState("");
  const [felt, setFelt] = useState<Felt>("ok");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(todayKey);
  const [error, setError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ id: string | null; message: string } | null>(
    null,
  );

  const [saving, startSaving] = useTransition();
  const [undoing, startUndoing] = useTransition();

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActive(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  function openSheet(target: QuickLogTarget) {
    setActive(target);
    setMinutes(String(target.minutes));
    setDistance(target.distanceKm === null ? "" : String(target.distanceKm));
    setFelt("ok");
    setNote("");
    setDay(todayKey);
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || saving) return;

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
    if (active.distanceKm !== null) {
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

    const target = active;
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

      setActive(null);
      setToast({ id: result.id, message: result.message });
      router.refresh();
    });
  }

  function handleUndo(id: string) {
    if (undoing) return;

    startUndoing(async () => {
      const result = await undoQuickLogAction({ id });

      setToast({ id: null, message: result.message });
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Quick log
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Done away from the app
        </span>
      </div>

      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {targets.map((target) => (
          <button
            key={target.goal ?? "other"}
            type="button"
            onClick={() => openSheet(target)}
            className="shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            + {target.label}
          </button>
        ))}
      </div>

      {toast && (
        <div
          role="status"
          className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          <span className="min-w-0">{toast.message}</span>
          {toast.id && (
            <button
              type="button"
              onClick={() => {
                if (toast.id) handleUndo(toast.id);
              }}
              disabled={undoing}
              className="shrink-0 rounded-lg border border-emerald-400/60 px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
            >
              {undoing ? "Undoing…" : "Undo"}
            </button>
          )}
        </div>
      )}

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-log-title"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setActive(null)}
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
              Log {active.label.toLowerCase()}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Filled in with your usual numbers. Change anything you like.
            </p>

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
                  className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
                />
              </label>

              {active.distanceKm !== null && (
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
                    className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
                  />
                </label>
              )}
            </div>

            {active.distanceKm !== null && (
              <p className="mt-1 text-xs text-muted-foreground">
                {active.minDistanceKm === null
                  ? "Any distance counts towards the week."
                  : `Only runs at or above ${active.minDistanceKm} km count towards the week.`}
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
                className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
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
                onClick={() => setActive(null)}
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
      )}
    </section>
  );
}


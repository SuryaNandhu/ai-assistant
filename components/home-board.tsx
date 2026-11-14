"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { completeTaskAction, pickTaskAction, skipTaskAction } from "@/app/actions";
import { DoneSheet } from "@/components/done-sheet";
import { TaskCard } from "@/components/task-card";
import {
  DEFAULT_ENERGY,
  DEFAULT_MINUTES,
  DISTANCE_GOAL,
  ENERGY_LABELS,
  ENERGY_LEVELS,
  TIME_OPTIONS,
  type Energy,
  type Felt,
  type PickMode,
  type PickedTask,
  type TimeOption,
} from "@/lib/task";

function chipClass(active: boolean): string {
  return [
    "h-11 rounded-xl border text-sm font-medium transition-colors",
    active
      ? "border-transparent bg-accent text-accent-foreground"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
  ].join(" ");
}

/** Time/energy chips, the two pick buttons and the current task card. */
export function HomeBoard() {
  const router = useRouter();

  const [minutes, setMinutes] = useState<TimeOption>(DEFAULT_MINUTES);
  const [energy, setEnergy] = useState<Energy>(DEFAULT_ENERGY);
  const [mode, setMode] = useState<PickMode>("smart");

  const [task, setTask] = useState<PickedTask | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [noMatch, setNoMatch] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [picking, startPicking] = useTransition();
  const [saving, startSaving] = useTransition();

  // Elapsed timer for the task on screen.
  useEffect(() => {
    if (startedAt === null) return;

    const startedTime = startedAt;
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedTime) / 1000));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [startedAt]);

  function resetTaskUi() {
    setStartedAt(null);
    setElapsedSeconds(0);
    setSheetOpen(false);
    setSheetError(null);
    setError(null);
  }

  function handlePick(nextMode: PickMode) {
    if (picking) return;

    resetTaskUi();
    setSuccess(null);
    setMode(nextMode);

    startPicking(async () => {
      const result = await pickTaskAction({
        mode: nextMode,
        minutes,
        energy,
        exclude: [],
      });

      if (!result.ok) {
        setTask(null);
        setNoMatch(false);
        setError(result.message);
        return;
      }

      setTask(result.task);
      setNoMatch(result.task === null);
      setExcluded(result.task ? [result.task.key] : []);
    });
  }

  function handleSkip() {
    if (!task || picking) return;

    const current = task;
    resetTaskUi();
    setSuccess(null);

    startPicking(async () => {
      const result = await skipTaskAction({
        pick: { mode, minutes, energy, exclude: excluded },
        task: {
          source: current.source,
          itemId: current.itemId,
          goal: current.goal,
          key: current.key,
        },
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setTask(result.task);
      setNoMatch(result.task === null);
      setExcluded((keys) =>
        keys.includes(current.key) ? keys : [...keys, current.key],
      );
    });
  }

  function handleStart() {
    if (!task) return;

    if (task.url) {
      window.open(task.url, "_blank", "noopener,noreferrer");
    }

    if (startedAt === null) {
      setStartedAt(Date.now());
      setElapsedSeconds(0);
    }
  }

  function handleDone() {
    if (!task) return;
    setSheetError(null);
    setSheetOpen(true);
  }

  function handleConfirm(input: { felt: Felt; distanceKm: number | null }) {
    if (!task || saving) return;

    const current = task;
    const elapsedMinutes =
      elapsedSeconds >= 60 ? Math.max(1, Math.round(elapsedSeconds / 60)) : null;

    startSaving(async () => {
      const result = await completeTaskAction({
        task: {
          source: current.source,
          itemId: current.itemId,
          goal: current.goal,
          elapsedMinutes,
          distanceKm: input.distanceKm,
        },
        felt: input.felt,
      });

      if (!result.ok) {
        setSheetError(result.message);
        return;
      }

      resetTaskUi();
      setTask(null);
      setExcluded([]);
      setNoMatch(false);
      setSuccess(result.message);
      router.refresh();
    });
  }

  const busy = picking || saving;

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-4 pb-6">
      <section>
        <h2
          id="time-label"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Time
        </h2>
        <div
          role="group"
          aria-labelledby="time-label"
          className="mt-2 grid grid-cols-3 gap-2"
        >
          {TIME_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={minutes === option}
              onClick={() => setMinutes(option)}
              className={chipClass(minutes === option)}
            >
              {option} min
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <h2
          id="energy-label"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Energy
        </h2>
        <div
          role="group"
          aria-labelledby="energy-label"
          className="mt-2 grid grid-cols-3 gap-2"
        >
          {ENERGY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={energy === level}
              onClick={() => setEnergy(level)}
              className={chipClass(energy === level)}
            >
              {ENERGY_LABELS[level]}
            </button>
          ))}
        </div>
      </section>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => handlePick("smart")}
          disabled={busy}
          className="h-14 rounded-2xl bg-accent text-base font-semibold text-accent-foreground transition-opacity disabled:opacity-50"
        >
          {picking && mode === "smart" ? "Picking…" : "What now?"}
        </button>
        <button
          type="button"
          onClick={() => handlePick("surprise")}
          disabled={busy}
          className="h-14 rounded-2xl border border-border text-base font-semibold transition-colors hover:bg-muted disabled:opacity-50"
        >
          Surprise me
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {success && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {success}
        </p>
      )}

      <div className="mt-4">
        {task ? (
          <TaskCard
            task={task}
            elapsedSeconds={startedAt === null ? null : elapsedSeconds}
            busy={busy}
            onStart={handleStart}
            onDone={handleDone}
            onSkip={handleSkip}
          />
        ) : noMatch ? (
          <div className="rounded-2xl border border-dashed border-border p-4">
            <p className="text-sm font-medium">Nothing fits that slot</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No todo items match {minutes} min at{" "}
              {ENERGY_LABELS[energy].toLowerCase()} energy. Try a longer time or
              more energy.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center">
            <p className="text-sm font-medium">Ready when you are</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick a slot above, then tap What now? for one task.
            </p>
          </div>
        )}
      </div>

      {sheetOpen && task && (
        <DoneSheet
          task={task}
          isWalk={task.goal === DISTANCE_GOAL}
          pending={saving}
          error={sheetError}
          onCancel={() => setSheetOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}


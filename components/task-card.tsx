import type { PickedTask } from "@/lib/task";

type TaskCardProps = {
  task: PickedTask;
  /** Seconds on the clock, or null when the timer has not started. */
  elapsedSeconds: number | null;
  busy: boolean;
  onStart: () => void;
  onDone: () => void;
  onSkip: () => void;
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
  onStart,
  onDone,
  onSkip,
}: TaskCardProps) {
  const running = elapsedSeconds !== null;

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
          {running ? "Reopen" : "Start"}
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

import { targetHint, type GoalProgress, type WeeklyProgress } from "@/lib/progress";
import type { Streak } from "@/lib/streak";
import { istWeekLabel } from "@/lib/week";

type HomeHeaderProps = {
  progress: WeeklyProgress | null;
  streak: Streak | null;
  error: string | null;
};

/** Streak badge plus this week's target pills. */
export function HomeHeader({ progress, streak, error }: HomeHeaderProps) {
  return (
    <header className="border-b border-border px-4 pb-4 pt-4">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">What now?</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {progress
                ? `This week · ${istWeekLabel(progress.weekStart, progress.weekEnd)}`
                : "One thing at a time."}
            </p>
          </div>
          <StreakBadge streak={streak} />
        </div>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        {progress && progress.goals.length > 0 ? (
          <ul
            aria-label="Targets"
            className="mt-4 -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {progress.goals.map((goal) => (
              <li key={goal.goal} className="snap-start">
                <ProgressPill goal={goal} />
              </li>
            ))}
          </ul>
        ) : (
          !error && (
            <p className="mt-4 text-xs text-muted-foreground">
              No targets yet.
            </p>
          )
        )}
      </div>
    </header>
  );
}

function ProgressPill({ goal }: { goal: GoalProgress }) {
  const met = goal.done >= goal.perWeek;
  const hint = targetHint(goal);

  return (
    <span
      className={[
        "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs",
        met
          ? "border-foreground/25 bg-muted font-medium text-foreground"
          : "border-border text-muted-foreground",
      ].join(" ")}
    >
      <span className="max-w-40 truncate">{goal.label}</span>
      <span className="font-semibold tabular-nums text-foreground">
        {goal.done}/{goal.perWeek}
      </span>
      {goal.period === "month" && (
        <span className="text-[11px] text-muted-foreground">this month</span>
      )}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      {met && (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
        >
          <path d="m5 13 4 4L19 7" />
        </svg>
      )}
    </span>
  );
}

function StreakBadge({ streak }: { streak: Streak | null }) {
  const days = streak?.days ?? 0;

  return (
    <div
      className={[
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5",
        days > 0 ? "border-orange-300 dark:border-orange-900" : "border-border",
      ].join(" ")}
      title={
        streak?.completedToday
          ? "You already logged something today"
          : "Streak: consecutive days with a completion"
      }
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={[
          "h-4 w-4",
          days > 0 ? "text-orange-500" : "text-muted-foreground",
        ].join(" ")}
      >
        <path d="M12 3c2.5 3 4 5 4 7.5a4 4 0 0 1-8 0C8 8 9.5 6 12 3Z" />
        <path d="M12 21c3.9 0 6-2.4 6-5.5 0-1.7-.7-3.2-1.7-4.5.2 3-1.6 4.5-3.3 4.5-1.2 0-2-.7-2-1.8 0-1 .5-1.7.5-1.7-2.3 1.6-4.4 3.6-4.4 6.2C7.1 18.8 9.1 21 12 21Z" />
      </svg>
      <span className="text-sm font-semibold tabular-nums">{days}</span>
      <span className="text-xs text-muted-foreground">
        {days === 1 ? "day" : "days"}
      </span>
    </div>
  );
}

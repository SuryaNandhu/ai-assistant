import { periodLabel, type GoalProgress } from "@/lib/progress";

const SIZE = 40;
const RADIUS = 16;
const STROKE = 4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** One ring per active target: done / per period, weekly or monthly. */
export function ProgressRings({ goals }: { goals: readonly GoalProgress[] }) {
  if (goals.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        No targets yet.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4">
      {goals.map((goal) => (
        <Ring key={goal.goal} goal={goal} />
      ))}
    </ul>
  );
}

function Ring({ goal }: { goal: GoalProgress }) {
  const fraction =
    goal.perWeek > 0 ? Math.min(1, goal.done / goal.perWeek) : 0;
  const met = goal.done >= goal.perWeek;

  return (
    <li className="flex flex-col items-center gap-1.5 text-center">
      <div className="relative h-[76px] w-[76px]">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-hidden="true"
          className="h-full w-full -rotate-90"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-border"
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            className={met ? "stroke-emerald-500" : "stroke-foreground"}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
          {goal.done}
          <span className="text-xs font-normal text-muted-foreground">
            /{goal.perWeek}
          </span>
        </span>
      </div>
      <span className="line-clamp-2 text-xs leading-tight text-muted-foreground">
        {goal.label}
      </span>
      {goal.period === "month" && (
        <span className="text-[11px] leading-tight text-muted-foreground">
          this month
        </span>
      )}
      {goal.minQuantity !== null && (
        <span className="text-[11px] leading-tight text-muted-foreground tabular-nums">
          today {goal.todayQuantity}/{goal.minQuantity}
        </span>
      )}
      <span className="sr-only">
        {goal.done} of {goal.perWeek} {periodLabel(goal.period)}
        {goal.minQuantity !== null
          ? `, ${goal.todayQuantity} of ${goal.minQuantity} today`
          : ""}
        {met ? ", target met" : ""}
      </span>
    </li>
  );
}

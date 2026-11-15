import type { WeekDayCount } from "@/lib/services/weekly";

const BAR_WIDTH = 10;
const BAR_GAP = 8;
const CHART_HEIGHT = 44;
const LABEL_HEIGHT = 12;

/**
 * Seven bars, Monday to Sunday, drawn as one inline SVG: no chart library, no
 * client JavaScript, and the heights are the only data it needs. A day with
 * nothing logged keeps a 2px stub so the week still reads as seven days.
 */
export function WeekBars({ days }: { days: readonly WeekDayCount[] }) {
  const max = Math.max(1, ...days.map((day) => day.count));
  const width = days.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
  const height = CHART_HEIGHT + LABEL_HEIGHT;

  const label =
    days.length === 0
      ? "No days in this week."
      : days
          .map((day) =>
            day.count === 0
              ? `${day.weekday} none`
              : `${day.weekday} ${day.count}`,
          )
          .join(", ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Completions by day: ${label}.`}
      className="h-14 w-full"
      preserveAspectRatio="none"
    >
      {days.map((day, index) => {
        const barHeight =
          day.count === 0
            ? 2
            : Math.max(4, Math.round((day.count / max) * CHART_HEIGHT));
        const x = index * (BAR_WIDTH + BAR_GAP);

        return (
          <g key={day.dayKey}>
            <rect
              x={x}
              y={CHART_HEIGHT - barHeight}
              width={BAR_WIDTH}
              height={barHeight}
              rx={2}
              className="fill-foreground/70"
            />
            <text
              x={x + BAR_WIDTH / 2}
              y={CHART_HEIGHT + 10}
              textAnchor="middle"
              fontSize={8}
              className="fill-muted-foreground"
            >
              {day.weekday}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The weekly summary page: everything on it is computed from rows already in
 * the database. No model, no stored paragraphs, no extra table.
 *
 * One Monday–Sunday week per view. A week's numbers come from the completions,
 * journal moods, screen time and rest day that fall inside it, so the page
 * cannot disagree with Home, the calendar or the streak.
 *
 * There is no fixed look-back: the first week is the week of the earliest row,
 * clamped to the 16 Nov 2026 floor, and every week before it is ignored.
 */

import { weekStartOf } from "@/lib/rest-day";
import type { DbSession } from "@/lib/services/session";
import { DISTANCE_GOAL, goalLabel } from "@/lib/task";
import {
  isDayKey,
  istDayKey,
  istWeekLabel,
  shiftDayKey,
  startOfIstWeek,
} from "@/lib/week";

/** Nothing before this Monday is ever summarised, even if older rows exist. */
export const FIRST_WEEK_FLOOR = "2026-11-16";

/** Monday-first initials, the same order the calendar grid uses. */
const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export type WeekGoalCount = {
  goal: string;
  label: string;
  count: number;
  minutes: number;
  distanceKm: number;
};

/** One column of the inline chart, Monday → Sunday. */
export type WeekDayCount = {
  dayKey: string;
  weekday: string;
  count: number;
};

export type WeekSummary = {
  /** Monday of the week, IST day key. */
  startKey: string;
  /** Sunday of the week, IST day key. */
  endKey: string;
  /** `3–9 Nov`, from the same helper the header uses. */
  label: string;
  /** The week containing today. */
  isCurrent: boolean;
  completions: number;
  activeDays: number;
  minutes: number;
  distanceKm: number;
  /** The week's rest day, or null if it was not used. */
  restDay: string | null;
  journalDays: number;
  /** Mean mood over the days that have one, one decimal. */
  averageMood: number | null;
  /** Mean screen time over the days that were logged, in minutes. */
  screenAverageMinutes: number | null;
  screenDays: number;
  /** Goals touched this week, busiest first. */
  goals: WeekGoalCount[];
  bestDay: WeekDayCount | null;
  days: WeekDayCount[];
};

type CompletionRow = {
  goal: string | null;
  minutes: number | string | null;
  distance_km: number | string | null;
  completed_at: string;
};

type JournalRow = { day: string; mood: number | null };
type ScreenRow = { day: string; minutes: number | string | null };
type TargetRow = { goal: string; label: string | null };

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dayKeyOf(value: string): string {
  return String(value).slice(0, 10);
}

/**
 * The first week worth showing: the first Monday on or after the earliest row
 * (so a partial first week is never summarised), clamped to the floor.
 */
export function firstAvailableWeek(earliestDayKey: string | null): string {
  const floorWeek = weekStartOf(FIRST_WEEK_FLOOR);
  const floor =
    floorWeek === FIRST_WEEK_FLOOR ? floorWeek : shiftDayKey(floorWeek, 7);

  if (!earliestDayKey || !isDayKey(earliestDayKey)) return floor;

  const monday = weekStartOf(earliestDayKey);
  const start = monday === earliestDayKey ? monday : shiftDayKey(monday, 7);

  return start > floor ? start : floor;
}

/** True for a `YYYY-MM-DD` key that is itself a Monday. */
export function isWeekStart(value: string): boolean {
  return isDayKey(value) && weekStartOf(value) === value;
}

/** Completed weeks on or after `firstWeek`, newest first. */
export function completedWeeks(
  firstWeek: string,
  currentWeek: string,
): string[] {
  const weeks: string[] = [];

  for (
    let start = shiftDayKey(currentWeek, -7);
    start >= firstWeek;
    start = shiftDayKey(start, -7)
  ) {
    weeks.push(start);
  }

  return weeks;
}

/**
 * `?week=` when it names a Monday between the first available week and today's
 * week; anything else (too old, in the future, not a Monday) means this week.
 */
export function resolveWeek(
  requested: string | null | undefined,
  firstWeek: string,
  currentWeek: string,
): string {
  const value = typeof requested === "string" ? requested.trim() : "";

  if (!isWeekStart(value)) return currentWeek;
  if (value < firstWeek || value > currentWeek) return currentWeek;

  return value;
}

/** One option of the "Past weeks" dropdown. */
export type WeekOption = {
  week: string;
  /** `9–15 Nov`, the same label the card heading uses. */
  label: string;
};

export type WeeksPageData = {
  firstWeek: string;
  currentWeek: string;
  /** The week on screen, or null while the floor is still in the future. */
  selected: WeekSummary | null;
  /** The week before `selected`, only when it is on or after `firstWeek`. */
  previous: WeekSummary | null;
  /** Completed weeks, newest first; the current week is never an option. */
  pastWeeks: WeekOption[];
};

function weekLabelOf(startKey: string): string {
  return istWeekLabel(
    new Date(`${startKey}T00:00:00+05:30`),
    new Date(`${shiftDayKey(startKey, 7)}T00:00:00+05:30`),
  );
}

/**
 * Earliest day with a row anywhere: completions, journal or screen time. A
 * missing completions table is fatal, the optional ones just leave no vote.
 */
async function loadFirstWeek(session: DbSession): Promise<string> {
  const [completionResult, journalResult, screenResult] = await Promise.all([
    session.supabase
      .from("completions")
      .select("completed_at")
      .eq("user_id", session.userId)
      .order("completed_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    session.supabase
      .from("journal_entries")
      .select("day")
      .eq("user_id", session.userId)
      .order("day", { ascending: true })
      .limit(1)
      .maybeSingle(),
    session.supabase
      .from("screen_time_entries")
      .select("day")
      .eq("user_id", session.userId)
      .order("day", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (completionResult.error) {
    throw new Error(
      `Could not load your weeks: ${completionResult.error.message}`,
    );
  }

  if (journalResult.error) {
    console.error(
      "Could not load the first journal day:",
      journalResult.error.message,
    );
  }

  if (screenResult.error) {
    console.error(
      "Could not load the first screen-time day:",
      screenResult.error.message,
    );
  }

  const days: string[] = [];

  if (completionResult.data?.completed_at) {
    days.push(istDayKey(new Date(completionResult.data.completed_at)));
  }
  if (journalResult.data?.day) {
    days.push(dayKeyOf(journalResult.data.day));
  }
  if (screenResult.data?.day) {
    days.push(dayKeyOf(screenResult.data.day));
  }

  days.sort();

  return firstAvailableWeek(days[0] ?? null);
}

/**
 * The requested Mondays only, oldest first. Reads are bounded to those weeks
 * and errors are only fatal for completions: a missing journal table, screen
 * log or 008 column just leaves those numbers empty.
 */
async function loadWeekSummaries(
  session: DbSession,
  weekStarts: readonly string[],
  now: Date,
): Promise<WeekSummary[]> {
  const starts = [...new Set(weekStarts)].filter(isWeekStart).sort();
  if (starts.length === 0) return [];

  const thisWeekStart = istDayKey(startOfIstWeek(now));
  const rangeStart = starts[0];
  const rangeEnd = shiftDayKey(starts[starts.length - 1], 7);

  const [completionResult, journalResult, screenResult, restResult, targetResult] =
    await Promise.all([
      session.supabase
        .from("completions")
        .select("goal, minutes, distance_km, completed_at")
        .eq("user_id", session.userId)
        .gte("completed_at", `${rangeStart}T00:00:00+05:30`)
        .lt("completed_at", `${rangeEnd}T00:00:00+05:30`)
        .order("completed_at", { ascending: true })
        .limit(5000),
      session.supabase
        .from("journal_entries")
        .select("day, mood")
        .eq("user_id", session.userId)
        .gte("day", rangeStart)
        .lt("day", rangeEnd),
      session.supabase
        .from("screen_time_entries")
        .select("day, minutes")
        .eq("user_id", session.userId)
        .gte("day", rangeStart)
        .lt("day", rangeEnd),
      // Optional: the page still works before migration 008 is applied.
      session.supabase
        .from("journal_entries")
        .select("day")
        .eq("user_id", session.userId)
        .eq("is_rest_day", true)
        .gte("day", rangeStart)
        .lt("day", rangeEnd),
      // Custom goals carry the user's own label; built-ins fall back to `task`.
      session.supabase
        .from("targets")
        .select("goal, label")
        .eq("user_id", session.userId),
    ]);

  if (completionResult.error) {
    throw new Error(
      `Could not load your weeks: ${completionResult.error.message}`,
    );
  }

  if (journalResult.error) {
    console.error("Could not load weekly moods:", journalResult.error.message);
  }

  if (screenResult.error) {
    console.error("Could not load weekly screen time:", screenResult.error.message);
  }

  if (restResult.error) {
    console.error("Could not load weekly rest days:", restResult.error.message);
  }

  if (targetResult.error) {
    console.error("Could not load goal labels:", targetResult.error.message);
  }

  const labels = new Map<string, string>();
  for (const row of (targetResult.data ?? []) as TargetRow[]) {
    if (row.goal && row.label) labels.set(row.goal, row.label);
  }

  const restDays = ((restResult.data ?? []) as { day: string | null }[])
    .map((row) => (row.day ? dayKeyOf(row.day) : ""))
    .filter(Boolean);

  return summariseWeeks({
    completions: (completionResult.data ?? []) as CompletionRow[],
    journals: (journalResult.data ?? []) as JournalRow[],
    screens: (screenResult.data ?? []) as ScreenRow[],
    restDays,
    labels,
    weekStarts: starts,
    thisWeekStart,
  });
}

/**
 * Everything the Weeks page needs: the first available week, the week asked for
 * (or this week), the week before it for the comparison line, and the completed
 * weeks for the dropdown. Only one week is ever summarised for display.
 */
export async function loadWeeksPage(
  session: DbSession,
  options: { now?: Date; week?: string | null } = {},
): Promise<WeeksPageData> {
  const now = options.now ?? new Date();
  const currentWeek = istDayKey(startOfIstWeek(now));
  const firstWeek = await loadFirstWeek(session);
  const pastWeeks = completedWeeks(firstWeek, currentWeek).map((week) => ({
    week,
    label: weekLabelOf(week),
  }));

  if (currentWeek < firstWeek) {
    return {
      firstWeek,
      currentWeek,
      selected: null,
      previous: null,
      pastWeeks: [],
    };
  }

  const selectedWeek = resolveWeek(options.week, firstWeek, currentWeek);
  const previousWeek = shiftDayKey(selectedWeek, -7);
  const hasPrevious =
    previousWeek >= firstWeek && selectedWeek !== currentWeek;

  const summaries = await loadWeekSummaries(
    session,
    hasPrevious ? [previousWeek, selectedWeek] : [selectedWeek],
    now,
  );
  const byWeek = new Map(summaries.map((week) => [week.startKey, week]));

  return {
    firstWeek,
    currentWeek,
    selected: byWeek.get(selectedWeek) ?? null,
    previous: hasPrevious ? byWeek.get(previousWeek) ?? null : null,
    pastWeeks,
  };
}

/**
 * The week that just ended, or null while it sits before the first available
 * week. Home uses this so the "Last week" card first appears on 23 Nov 2026.
 */
export async function loadLastWeekSummary(
  session: DbSession,
  now: Date = new Date(),
): Promise<WeekSummary | null> {
  const firstWeek = await loadFirstWeek(session);
  const currentWeek = istDayKey(startOfIstWeek(now));
  const previousWeek = shiftDayKey(currentWeek, -7);

  if (previousWeek < firstWeek) return null;

  const [summary] = await loadWeekSummaries(session, [previousWeek], now);

  return summary ?? null;
}

type SummariseInput = {
  completions: CompletionRow[];
  journals: JournalRow[];
  screens: ScreenRow[];
  restDays: string[];
  labels: Map<string, string>;
  /** Mondays to build, ascending. */
  weekStarts: readonly string[];
  /** Monday of the week containing today. */
  thisWeekStart: string;
};

type Bucket = {
  summary: WeekSummary;
  goalMap: Map<string, WeekGoalCount>;
  moodTotal: number;
  moodDays: number;
  screenTotal: number;
  screenDays: number;
};

/** Plain arithmetic over the rows, kept separate so it stays easy to follow. */
function summariseWeeks({
  completions,
  journals,
  screens,
  restDays,
  labels,
  weekStarts,
  thisWeekStart,
}: SummariseInput): WeekSummary[] {
  const order: string[] = [];
  const buckets = new Map<string, Bucket>();

  for (const startKey of weekStarts) {
    const endKey = shiftDayKey(startKey, 6);
    const start = new Date(`${startKey}T00:00:00+05:30`);
    const end = new Date(`${shiftDayKey(startKey, 7)}T00:00:00+05:30`);

    const days: WeekDayCount[] = WEEKDAY_INITIALS.map((weekday, position) => ({
      dayKey: shiftDayKey(startKey, position),
      weekday,
      count: 0,
    }));

    order.push(startKey);
    buckets.set(startKey, {
      summary: {
        startKey,
        endKey,
        label: istWeekLabel(start, end),
        isCurrent: startKey === thisWeekStart,
        completions: 0,
        activeDays: 0,
        minutes: 0,
        distanceKm: 0,
        restDay: restDays.find((day) => weekStartOf(day) === startKey) ?? null,
        journalDays: 0,
        averageMood: null,
        screenAverageMinutes: null,
        screenDays: 0,
        goals: [],
        bestDay: null,
        days,
      },
      goalMap: new Map(),
      moodTotal: 0,
      moodDays: 0,
      screenTotal: 0,
      screenDays: 0,
    });
  }

  for (const row of completions) {
    const dayKey = istDayKey(new Date(row.completed_at));
    const bucket = buckets.get(weekStartOf(dayKey));
    if (!bucket) continue;

    const { summary } = bucket;
    const goal = row.goal ?? "other";
    const minutes = toNumber(row.minutes) ?? 0;
    const distanceKm =
      goal === DISTANCE_GOAL ? (toNumber(row.distance_km) ?? 0) : 0;

    summary.completions += 1;
    summary.minutes += minutes;
    summary.distanceKm += distanceKm;

    const column = summary.days.find((day) => day.dayKey === dayKey);
    if (column) column.count += 1;

    const existing = bucket.goalMap.get(goal);
    if (existing) {
      existing.count += 1;
      existing.minutes += minutes;
      existing.distanceKm += distanceKm;
    } else {
      bucket.goalMap.set(goal, {
        goal,
        label:
          goal === "other" ? "Other" : goalLabel(row.goal, labels.get(goal)),
        count: 1,
        minutes,
        distanceKm,
      });
    }
  }

  for (const row of journals) {
    const bucket = buckets.get(weekStartOf(dayKeyOf(row.day)));
    const mood = toNumber(row.mood);
    if (!bucket || mood === null) continue;

    bucket.summary.journalDays += 1;
    bucket.moodTotal += mood;
    bucket.moodDays += 1;
  }

  for (const row of screens) {
    const bucket = buckets.get(weekStartOf(dayKeyOf(row.day)));
    const minutes = toNumber(row.minutes);
    if (!bucket || minutes === null) continue;

    bucket.screenTotal += minutes;
    bucket.screenDays += 1;
  }

  return order
    .map((startKey) => {
      const bucket = buckets.get(startKey)!;
      const { summary } = bucket;

      summary.goals = [...bucket.goalMap.values()].sort(
        (a, b) => b.count - a.count || b.minutes - a.minutes,
      );
      summary.activeDays = summary.days.filter((day) => day.count > 0).length;
      summary.averageMood =
        bucket.moodDays === 0
          ? null
          : Math.round((bucket.moodTotal / bucket.moodDays) * 10) / 10;
      summary.screenDays = bucket.screenDays;
      summary.screenAverageMinutes =
        bucket.screenDays === 0
          ? null
          : Math.round(bucket.screenTotal / bucket.screenDays);
      summary.bestDay = summary.days.reduce<WeekDayCount | null>(
        (best, day) =>
          day.count > 0 && (!best || day.count > best.count) ? day : best,
        null,
      );

      return summary;
    });
}

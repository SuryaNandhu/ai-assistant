/**
 * The weekly summary page: everything on it is computed from rows already in
 * the database. No model, no stored paragraphs, no extra table.
 *
 * One Monday–Sunday week per card, newest first. A week's numbers come from the
 * completions, journal moods, screen time and rest day that fall inside it, so
 * the page cannot disagree with Home, the calendar or the streak.
 */

import { weekStartOf } from "@/lib/rest-day";
import type { DbSession } from "@/lib/services/session";
import { DISTANCE_GOAL, goalLabel } from "@/lib/task";
import {
  istDayKey,
  istWeekLabel,
  shiftDayKey,
  startOfIstWeek,
} from "@/lib/week";

/** Weeks shown on the page, including the one in progress. */
export const WEEKLY_SUMMARY_WEEKS = 8;

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
 * `weeks` Monday–Sunday summaries, newest first. Reads are bounded to the range
 * and errors are only fatal for completions: a missing journal table, screen
 * log or 008 column just leaves those numbers empty.
 */
export async function loadWeeklySummary(
  session: DbSession,
  now: Date = new Date(),
  weeks: number = WEEKLY_SUMMARY_WEEKS,
): Promise<WeekSummary[]> {
  const total = Math.min(Math.max(Math.round(weeks), 1), 26);
  const todayKey = istDayKey(now);
  const thisWeekStart = istDayKey(startOfIstWeek(now));
  const firstStart = shiftDayKey(thisWeekStart, -7 * (total - 1));
  const rangeStart = `${firstStart}T00:00:00+05:30`;
  const rangeEnd = `${shiftDayKey(thisWeekStart, 7)}T00:00:00+05:30`;

  const [completionResult, journalResult, screenResult, restResult, targetResult] =
    await Promise.all([
      session.supabase
        .from("completions")
        .select("goal, minutes, distance_km, completed_at")
        .eq("user_id", session.userId)
        .gte("completed_at", rangeStart)
        .lt("completed_at", rangeEnd)
        .order("completed_at", { ascending: true })
        .limit(5000),
      session.supabase
        .from("journal_entries")
        .select("day, mood")
        .eq("user_id", session.userId)
        .gte("day", firstStart)
        .lte("day", todayKey),
      session.supabase
        .from("screen_time_entries")
        .select("day, minutes")
        .eq("user_id", session.userId)
        .gte("day", firstStart)
        .lte("day", todayKey),
      // Optional: the page still works before migration 008 is applied.
      session.supabase
        .from("journal_entries")
        .select("day")
        .eq("user_id", session.userId)
        .eq("is_rest_day", true)
        .gte("day", firstStart)
        .lte("day", todayKey),
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
    firstStart,
    total,
    thisWeekStart,
  });
}

type SummariseInput = {
  completions: CompletionRow[];
  journals: JournalRow[];
  screens: ScreenRow[];
  restDays: string[];
  labels: Map<string, string>;
  /** Monday of the oldest week. */
  firstStart: string;
  /** Weeks to render. */
  total: number;
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
  firstStart,
  total,
  thisWeekStart,
}: SummariseInput): WeekSummary[] {
  const order: string[] = [];
  const buckets = new Map<string, Bucket>();

  for (let index = 0; index < total; index += 1) {
    const startKey = shiftDayKey(firstStart, index * 7);
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
    })
    .reverse();
}

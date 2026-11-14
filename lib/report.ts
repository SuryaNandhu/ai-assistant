import type { SupabaseClient } from "@supabase/supabase-js";

import { monthRange, type MonthRef } from "@/lib/calendar";
import { DISTANCE_GOAL, goalLabel } from "@/lib/task";
import { istDayKey } from "@/lib/week";

/** One completion as the day panel shows it. */
export type CompletionEntry = {
  id: string;
  /** Title of the saved link, when the completion came from one. */
  title: string | null;
  goal: string | null;
  /** Label for the goal column ("LeetCode", "5 km walk/run", …). */
  goalLabel: string;
  minutes: number | null;
  distanceKm: number | null;
  felt: "easy" | "ok" | "hard" | null;
  /** `manual` = quick log or Saved screen, `suggestion` = picked on Home. */
  source: "suggestion" | "manual";
  note: string | null;
  completedAt: string;
};

export type DayJournal = {
  mood: number | null;
  note: string | null;
};

/** Everything that happened on one IST day of the visible month. */
export type MonthDay = {
  dayKey: string;
  completions: CompletionEntry[];
  journal: DayJournal | null;
};

export type MonthTotals = {
  completions: number;
  /** Sum of `walk_run` distances, in km. */
  distanceKm: number;
};

export type MonthActivity = {
  ref: MonthRef;
  days: MonthDay[];
  totals: MonthTotals;
};

type CompletionRow = {
  id: string;
  item_id: string | null;
  goal: string | null;
  minutes: number | string | null;
  distance_km: number | string | null;
  felt: string | null;
  source: string | null;
  note: string | null;
  completed_at: string;
  items: { title: string | null } | { title: string | null }[] | null;
};

type JournalRow = {
  day: string;
  mood: number | null;
  note: string | null;
};

const COMPLETION_COLUMNS =
  "id, item_id, goal, minutes, distance_km, felt, source, note, completed_at, items(title)";

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toFelt(value: string | null): CompletionEntry["felt"] {
  return value === "easy" || value === "ok" || value === "hard" ? value : null;
}

function itemTitle(embedded: CompletionRow["items"]): string | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  return row?.title ?? null;
}

/** `12.4 km`, but `5 km` for round numbers. */
export function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} km`;
}

/**
 * One query for the month's completions and one for its journal entries, both
 * bounded by 00:00 IST on the 1st and 00:00 IST on the 1st of the next month.
 *
 * Days with a journal entry but no completion are included too, so a mood emoji
 * never goes missing. Runs as the signed-in user, so RLS does the filtering.
 */
export async function loadMonthActivity(
  supabase: SupabaseClient,
  userId: string,
  ref: MonthRef,
): Promise<MonthActivity> {
  const { startDayKey, endDayKey, startIso, endIso } = monthRange(ref);

  const [completionResult, journalResult] = await Promise.all([
    supabase
      .from("completions")
      .select(COMPLETION_COLUMNS)
      .eq("user_id", userId)
      .gte("completed_at", startIso)
      .lt("completed_at", endIso)
      .order("completed_at", { ascending: true })
      .limit(1000),
    supabase
      .from("journal_entries")
      .select("day, mood, note")
      .eq("user_id", userId)
      .gte("day", startDayKey)
      .lte("day", endDayKey),
  ]);

  if (completionResult.error) {
    throw new Error(
      `Could not load this month's activity: ${completionResult.error.message}`,
    );
  }

  // A database without the journal table still gets a calendar, just no moods.
  if (journalResult.error) {
    console.error("Could not load this month's journal:", journalResult.error.message);
  }

  const days = new Map<string, MonthDay>();
  const totals: MonthTotals = { completions: 0, distanceKm: 0 };

  for (const row of (completionResult.data ?? []) as CompletionRow[]) {
    const dayKey = istDayKey(new Date(row.completed_at));
    const minutes = toNumber(row.minutes);
    const distanceKm = toNumber(row.distance_km);
    const goal = row.goal ?? null;

    const entry: CompletionEntry = {
      id: String(row.id),
      title: itemTitle(row.items),
      goal,
      goalLabel: goalLabel(goal),
      minutes,
      distanceKm,
      felt: toFelt(row.felt),
      source: row.source === "manual" ? "manual" : "suggestion",
      note: row.note ?? null,
      completedAt: row.completed_at,
    };

    const day = days.get(dayKey) ?? { dayKey, completions: [], journal: null };
    day.completions.push(entry);
    days.set(dayKey, day);

    totals.completions += 1;
    if (goal === DISTANCE_GOAL && distanceKm !== null) {
      totals.distanceKm += distanceKm;
    }
  }

  for (const row of (journalResult.data ?? []) as JournalRow[]) {
    const dayKey = String(row.day).slice(0, 10);
    const day = days.get(dayKey) ?? { dayKey, completions: [], journal: null };
    day.journal = { mood: toNumber(row.mood), note: row.note ?? null };
    days.set(dayKey, day);
  }

  return {
    ref,
    days: [...days.values()].sort((a, b) => (a.dayKey < b.dayKey ? -1 : 1)),
    totals,
  };
}

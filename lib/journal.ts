import type { SupabaseClient } from "@supabase/supabase-js";

import { istDayKey, shiftDayKey } from "@/lib/week";

export type JournalMood = 1 | 2 | 3 | 4 | 5;

/** One small daily entry. The note never leaves the app UI (no LLM calls). */
export type JournalEntry = {
  /** IST day key, `YYYY-MM-DD`. */
  day: string;
  mood: number | null;
  note: string | null;
  updated_at: string;
};

export const JOURNAL_MOODS = [
  { value: 1, emoji: "😞", label: "Rough" },
  { value: 2, emoji: "🙁", label: "Meh" },
  { value: 3, emoji: "😐", label: "Okay" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "😄", label: "Great" },
] as const satisfies readonly { value: JournalMood; emoji: string; label: string }[];

export const JOURNAL_NOTE_MAX = 200;

/**
 * How many missed days the backlog card asks about. Three is enough to close a
 * gap without turning the journal into homework; older days stay on /progress.
 */
export const JOURNAL_BACKLOG_DAYS = 3;

export function moodEmoji(mood: number | null): string {
  return JOURNAL_MOODS.find((entry) => entry.value === mood)?.emoji ?? "•";
}

export const JOURNAL_COLUMNS = "day, mood, note, updated_at";

type JournalRow = {
  day: string;
  mood: number | null;
  note: string | null;
  updated_at: string;
};

export function toJournalEntry(row: JournalRow): JournalEntry {
  return {
    day: String(row.day).slice(0, 10),
    mood: typeof row.mood === "number" ? row.mood : null,
    note: row.note ?? null,
    updated_at: row.updated_at,
  };
}

/** Today's entry, or null when the day has not been written yet. */
export async function loadJournalEntry(
  supabase: SupabaseClient,
  userId: string,
  day: string = istDayKey(new Date()),
): Promise<JournalEntry | null> {
  const { data, error } = await supabase
    .from("journal_entries")
    .select(JOURNAL_COLUMNS)
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load today's journal entry: ${error.message}`);
  }

  return data ? toJournalEntry(data as JournalRow) : null;
}

/** Past entries, newest first. */
export async function loadJournalEntries(
  supabase: SupabaseClient,
  userId: string,
  limit = 60,
): Promise<JournalEntry[]> {
  const { data, error } = await supabase
    .from("journal_entries")
    .select(JOURNAL_COLUMNS)
    .eq("user_id", userId)
    .order("day", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Could not load your journal: ${error.message}`);
  }

  return ((data ?? []) as JournalRow[]).map(toJournalEntry);
}

export type JournalBacklog = {
  /** First day with a mood, or null when the journal was never written. */
  start: string | null;
  /** Missed days since then, newest first, at most `JOURNAL_BACKLOG_DAYS`. */
  missing: string[];
};

/**
 * Days with no entry that are worth asking about. The journal only asks about
 * days after the first mood was written, so a new user never gets asked about
 * the weeks before they started, and today is never asked about here.
 */
export function missingJournalDays(
  logged: Iterable<string>,
  now: Date = new Date(),
  start: string | null = null,
): string[] {
  if (start === null) return [];

  const todayKey = istDayKey(now);
  const days = new Set(logged);
  const missing: string[] = [];

  // Newest first: yesterday is the day the user can still remember.
  for (let offset = 1; offset <= JOURNAL_BACKLOG_DAYS; offset += 1) {
    const dayKey = shiftDayKey(todayKey, -offset);
    if (dayKey < start) continue;
    if (!days.has(dayKey)) missing.push(dayKey);
  }

  return missing;
}

/**
 * First mood plus the days still missing after it, in two small reads. A
 * missing table throws, so Home can hide the card instead of breaking.
 */
export async function loadJournalBacklog(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<JournalBacklog> {
  const todayKey = istDayKey(now);
  const windowStartKey = shiftDayKey(todayKey, -JOURNAL_BACKLOG_DAYS);

  const first = await supabase
    .from("journal_entries")
    .select("day")
    .eq("user_id", userId)
    .not("mood", "is", null)
    .order("day", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (first.error) {
    throw new Error(`Could not load your journal: ${first.error.message}`);
  }

  const start = first.data?.day ? String(first.data.day).slice(0, 10) : null;
  if (start === null) return { start: null, missing: [] };

  const fromKey = start > windowStartKey ? start : windowStartKey;

  const { data, error } = await supabase
    .from("journal_entries")
    .select("day")
    .eq("user_id", userId)
    .not("mood", "is", null)
    .gte("day", fromKey)
    .lt("day", todayKey);

  if (error) {
    throw new Error(`Could not load your journal: ${error.message}`);
  }

  // Only a mood counts as saved: a rest-day row (mood left empty) still leaves
  // the day waiting for a rating.
  const logged = new Set(
    ((data ?? []) as { day: string }[]).map((row) =>
      String(row.day).slice(0, 10),
    ),
  );

  return { start, missing: missingJournalDays(logged, now, start) };
}

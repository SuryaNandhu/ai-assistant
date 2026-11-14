import type { SupabaseClient } from "@supabase/supabase-js";

import { istDayKey, istParts } from "@/lib/week";

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

/** From 7 pm IST the day is winding down, so Home asks how it went. */
export const JOURNAL_PROMPT_HOUR = 19;

export function isJournalPromptTime(now: Date = new Date()): boolean {
  return istParts(now).hour >= JOURNAL_PROMPT_HOUR;
}

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

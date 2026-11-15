import { describeDbError } from "@/lib/errors";
import {
  JOURNAL_COLUMNS,
  JOURNAL_NOTE_MAX,
  toJournalEntry,
  type JournalEntry,
} from "@/lib/journal";
import type { DbSession } from "@/lib/services/session";
import { istDayKey, shiftDayKey } from "@/lib/week";

/** How far back a journal entry may be edited (the day panel's window). */
export const JOURNAL_MAX_DAYS_BACK = 400;

export type SaveJournalInput = {
  /** 1 (rough) … 5 (great); null/undefined leaves the mood untouched. */
  mood?: number | null;
  /** One line, 200 characters at most. */
  note?: string | null;
  /** IST day key; defaults to today. */
  day?: string;
};

export type SaveJournalResult =
  | { ok: true; entry: JournalEntry }
  | { ok: false; message: string };

/**
 * Upserts one entry per IST day. `updated_at` is set here rather than by a
 * trigger so the write stays a single round trip. Shared by the journal card,
 * the day panel and the chat tool; the note never leaves the app UI.
 */
export async function saveJournalEntry(
  session: DbSession,
  input: SaveJournalInput,
  now: Date = new Date(),
): Promise<SaveJournalResult> {
  const todayKey = istDayKey(now);
  const day = input.day ?? todayKey;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, message: "Use a day like 2026-11-13." };
  }

  if (day > todayKey) {
    return { ok: false, message: "That day has not happened yet." };
  }

  if (day < shiftDayKey(todayKey, -JOURNAL_MAX_DAYS_BACK)) {
    return { ok: false, message: "That day is too far back to edit here." };
  }

  const mood =
    typeof input.mood === "number" && Number.isInteger(input.mood) && input.mood >= 1 && input.mood <= 5
      ? input.mood
      : null;

  if (input.mood != null && mood === null) {
    return { ok: false, message: "Pick a mood between 1 and 5." };
  }

  const trimmed = input.note?.trim() ?? "";
  if (trimmed.length > JOURNAL_NOTE_MAX) {
    return {
      ok: false,
      message: `Keep the note to ${JOURNAL_NOTE_MAX} characters.`,
    };
  }

  const note = trimmed ? trimmed : null;

  if (mood === null && !note) {
    return { ok: false, message: "Pick a mood or write a line." };
  }

  const { data, error } = await session.supabase
    .from("journal_entries")
    .upsert(
      {
        user_id: session.userId,
        day,
        mood,
        note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" },
    )
    .select(JOURNAL_COLUMNS)
    .single();

  if (error) {
    console.error("Could not save the journal entry:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  return { ok: true, entry: toJournalEntry(data) };
}

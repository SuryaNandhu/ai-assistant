"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import {
  JOURNAL_COLUMNS,
  JOURNAL_NOTE_MAX,
  toJournalEntry,
  type JournalEntry,
} from "@/lib/journal";
import { createClient } from "@/lib/supabase/server";
import { istDayKey, shiftDayKey } from "@/lib/week";

export type JournalResult =
  | { ok: true; entry: JournalEntry }
  | { ok: false; message: string };

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

/** How far back the day panel lets you edit a journal entry. */
const JOURNAL_MAX_DAYS_BACK = 400;

const journalSchema = z.object({
  mood: z.number().int().min(1).max(5).nullable().default(null),
  note: z.string().trim().max(JOURNAL_NOTE_MAX).nullable().default(null),
});

const dayJournalSchema = journalSchema.extend({
  /** IST day key, `YYYY-MM-DD`. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Writes one entry per IST day. `updated_at` is set here rather than by a
 * trigger so the upsert stays a single round trip.
 */
async function persistJournal(
  day: string,
  mood: number | null,
  note: string | null,
): Promise<JournalResult> {
  if (mood === null && !note) {
    return { ok: false, message: "Pick a mood or write a line." };
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();

  if (authError || !auth?.claims) {
    if (authError) console.error("Could not read Supabase session:", authError.message);
    return { ok: false, message: SIGNED_OUT };
  }

  const { data, error } = await supabase
    .from("journal_entries")
    .upsert(
      {
        user_id: auth.claims.sub,
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

  revalidatePath("/");
  revalidatePath("/journal");
  revalidatePath("/progress");

  return { ok: true, entry: toJournalEntry(data) };
}

/**
 * Upserts today's journal entry. Editing again on the same day simply replaces
 * it; the note is only ever read by the journal screens.
 */
export async function saveJournalAction(input: unknown): Promise<JournalResult> {
  const parsed = journalSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Could not save that. Reload the page and try again.",
    };
  }

  const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null;
  return persistJournal(istDayKey(new Date()), parsed.data.mood, note);
}

/**
 * Saves (or fixes) the entry for one past day from the Progress day panel.
 * Today and yesterday are both fair game; the future never is.
 */
export async function saveJournalDayAction(input: unknown): Promise<JournalResult> {
  const parsed = dayJournalSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Could not save that day. Reload the page and try again.",
    };
  }

  const { day, mood } = parsed.data;
  const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null;

  const todayKey = istDayKey(new Date());

  if (day > todayKey) {
    return { ok: false, message: "That day has not happened yet." };
  }

  if (day < shiftDayKey(todayKey, -JOURNAL_MAX_DAYS_BACK)) {
    return { ok: false, message: "That day is too far back to edit here." };
  }

  return persistJournal(day, mood, note);
}


"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  JOURNAL_COLUMNS,
  JOURNAL_NOTE_MAX,
  toJournalEntry,
  type JournalEntry,
} from "@/lib/journal";
import { createClient } from "@/lib/supabase/server";
import { istDayKey } from "@/lib/week";

export type JournalResult =
  | { ok: true; entry: JournalEntry }
  | { ok: false; message: string };

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

const journalSchema = z.object({
  mood: z.number().int().min(1).max(5).nullable().default(null),
  note: z.string().trim().max(JOURNAL_NOTE_MAX).nullable().default(null),
});

/**
 * Upserts today's journal entry (one per IST day). Editing again on the same
 * day simply replaces it; the note is only ever read by the journal screens.
 */
export async function saveJournalAction(input: unknown): Promise<JournalResult> {
  const parsed = journalSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Could not save that. Reload the page and try again.",
    };
  }

  const { mood } = parsed.data;
  const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null;

  if (mood === null && !note) {
    return { ok: false, message: "Pick a mood or write a line." };
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();

  if (authError || !auth?.claims) {
    if (authError) console.error("Could not read Supabase session:", authError.message);
    return { ok: false, message: SIGNED_OUT };
  }

  const day = istDayKey(new Date());

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
    return {
      ok: false,
      message: "Could not save your day. Please try again.",
    };
  }

  revalidatePath("/");
  revalidatePath("/journal");

  return { ok: true, entry: toJournalEntry(data) };
}

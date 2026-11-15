"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import { JOURNAL_NOTE_MAX, type JournalEntry } from "@/lib/journal";
import { saveJournalEntry } from "@/lib/services/journal";
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

const dayJournalSchema = journalSchema.extend({
  /** IST day key, `YYYY-MM-DD`. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** The write itself lives in `lib/services/journal` (the chat tool shares it). */
async function persist(
  input: z.infer<typeof dayJournalSchema>,
): Promise<JournalResult> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();

  if (authError || !auth?.claims) {
    if (authError) console.error("Could not read Supabase session:", authError.message);
    return { ok: false, message: SIGNED_OUT };
  }

  try {
    const result = await saveJournalEntry(
      { supabase, userId: auth.claims.sub },
      input,
    );

    if (!result.ok) return result;

    revalidatePath("/");
    revalidatePath("/journal");
    revalidatePath("/progress");

    return result;
  } catch (error) {
    console.error("Could not save the journal entry:", error);
    return { ok: false, message: describeDbError(error) };
  }
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

  return persist({ ...parsed.data, day: istDayKey(new Date()) });
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

  return persist(parsed.data);
}


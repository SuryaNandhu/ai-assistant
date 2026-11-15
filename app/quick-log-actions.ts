"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logActivity, undoLog } from "@/lib/services/log";
import { createClient } from "@/lib/supabase/server";

type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

export type QuickLogResult =
  | { ok: true; id: string; message: string }
  | { ok: false; message: string };

export type UndoLogResult = { ok: true; message: string } | { ok: false; message: string };

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

/**
 * The action only parses untrusted input and revalidates. All the rules live in
 * `lib/services/log.ts`, which the chat tools call as well.
 */
const quickLogSchema = z.object({
  goal: z.string().trim().max(60).nullable().default(null),
  minutes: z.number().int().min(1).max(600),
  distanceKm: z.number().min(0).max(100).nullable().default(null),
  felt: z.enum(["easy", "ok", "hard"]).nullable().default(null),
  note: z.string().trim().max(280).nullable().default(null),
  /** IST day key, `YYYY-MM-DD`. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const undoSchema = z.object({ id: z.uuid() });

async function requireSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    if (error) console.error("Could not read Supabase session:", error.message);
    return null;
  }

  return { supabase, userId: data.claims.sub };
}

export async function quickLogAction(input: unknown): Promise<QuickLogResult> {
  const parsed = quickLogSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Could not read that log. Reload the page and try again.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const result = await logActivity(session, parsed.data);
  if (!result.ok) return result;

  revalidatePath("/");

  return { ok: true, id: result.id, message: result.message };
}

/** Undo for the eight second toast: removes the row it just created. */
export async function undoQuickLogAction(input: unknown): Promise<UndoLogResult> {
  const parsed = undoSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Could not undo that log." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const result = await undoLog(session, parsed.data.id);
  if (!result.ok) return result;

  revalidatePath("/");
  return result;
}

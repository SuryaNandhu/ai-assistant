"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import { formatMinutes } from "@/lib/screen-time";
import {
  saveScreenLimit,
  saveScreenTime,
} from "@/lib/services/screen-time";
import { createClient } from "@/lib/supabase/server";

export type ScreenTimeActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type ScreenLimitActionResult =
  | { ok: true; limitMinutes: number; message: string }
  | { ok: false; message: string };

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

const screenTimeSchema = z.object({
  /** Missing means today. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minutes: z.number().int().min(0).max(1440),
});

const limitSchema = z.object({
  minutes: z.number().int().min(30).max(720),
});

async function requireSession() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    if (error) console.error("Could not read Supabase session:", error.message);
    return null;
  }

  return { supabase, userId: data.claims.sub };
}

/**
 * Saves screen time for one day. The form on Home and the day panel on
 * /progress both use this; the chat tool calls the same service directly.
 */
export async function saveScreenTimeAction(
  input: unknown,
): Promise<ScreenTimeActionResult> {
  const parsed = screenTimeSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Screen time should be a whole number of minutes, 0 to 1440.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await saveScreenTime(session, parsed.data);

    if (!result.ok) return result;

    revalidatePath("/");
    revalidatePath("/progress");

    return {
      ok: true,
      message: `Screen time saved: ${formatMinutes(result.minutes)}.`,
    };
  } catch (error) {
    console.error("Could not save screen time:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

/** Saves the daily limit shown on the Progress screen. */
export async function saveScreenLimitAction(
  input: unknown,
): Promise<ScreenLimitActionResult> {
  const parsed = limitSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Pick a limit between 30 and 720 minutes.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await saveScreenLimit(session, parsed.data.minutes);

    if (!result.ok) return result;

    revalidatePath("/");
    revalidatePath("/progress");

    return {
      ok: true,
      limitMinutes: result.limitMinutes,
      message: `Daily limit set to ${formatMinutes(result.limitMinutes)}.`,
    };
  } catch (error) {
    console.error("Could not save the screen-time limit:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

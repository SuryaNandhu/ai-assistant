"use server";

import { revalidatePath } from "next/cache";

import { describeDbError } from "@/lib/errors";
import { formatMinutes } from "@/lib/screen-time";
import {
  clearScreenLimit,
  saveScreenLimit,
  saveScreenTime,
  screenLimitSchema,
  screenTimeEntrySchema,
} from "@/lib/services/screen-time";
import { createClient } from "@/lib/supabase/server";
import { dayKeyLabel } from "@/lib/week";

export type ScreenTimeActionResult =
  | { ok: true; day: string; message: string }
  | { ok: false; message: string };

export type ScreenLimitActionResult =
  | { ok: true; limitMinutes: number | null; message: string }
  | { ok: false; message: string };

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

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
 * Saves screen time for one completed day. The Home card and the day panel on
 * /progress both use this; the chat tool calls the same service directly.
 */
export async function saveScreenTimeAction(
  input: unknown,
): Promise<ScreenTimeActionResult> {
  const parsed = screenTimeEntrySchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Screen time should be whole minutes, 0 to 1440.",
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
      day: result.day,
      message: `Screen time for ${dayKeyLabel(result.day)} saved: ${formatMinutes(result.minutes)}.`,
    };
  } catch (error) {
    console.error("Could not save screen time:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

/** Saves the optional daily limit shown on the Progress screen. */
export async function saveScreenLimitAction(
  input: unknown,
): Promise<ScreenLimitActionResult> {
  const parsed = screenLimitSchema.safeParse(input);

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

/** Removes the limit again, so no day is flagged as over. */
export async function clearScreenLimitAction(): Promise<ScreenLimitActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await clearScreenLimit(session);

    if (!result.ok) return result;

    revalidatePath("/");
    revalidatePath("/progress");

    return {
      ok: true,
      limitMinutes: null,
      message: "Daily limit cleared.",
    };
  } catch (error) {
    console.error("Could not clear the screen-time limit:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

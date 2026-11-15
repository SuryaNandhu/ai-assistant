"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import { clearRestDay, setRestDay } from "@/lib/services/rest-day";
import { createClient } from "@/lib/supabase/server";

export type RestDayActionResult =
  | { ok: true; day: string; message: string }
  | { ok: false; message: string };

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

const daySchema = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("IST day key, YYYY-MM-DD."),
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

function revalidateRestDay() {
  revalidatePath("/");
  revalidatePath("/progress");
  revalidatePath("/chat");
}

/** The Home button and the day panel both land here; the chat tool calls the service. */
export async function takeRestDayAction(
  input: unknown,
): Promise<RestDayActionResult> {
  const parsed = daySchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Pick today or yesterday." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await setRestDay(session, { day: parsed.data.day });

    if (!result.ok) return result;

    revalidateRestDay();
    return { ok: true, day: result.day, message: result.message };
  } catch (error) {
    console.error("Could not save the rest day:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

/** Undo, offered on the calendar day panel while the day is still editable. */
export async function undoRestDayAction(
  input: unknown,
): Promise<RestDayActionResult> {
  const parsed = daySchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That day is not a rest day any more." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await clearRestDay(session, { day: parsed.data.day });

    if (!result.ok) return result;

    revalidateRestDay();
    return { ok: true, day: result.day, message: result.message };
  } catch (error) {
    console.error("Could not clear the rest day:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

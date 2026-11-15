import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import {
  SCREEN_LIMIT_MAX,
  SCREEN_LIMIT_MIN,
  SCREEN_TIME_MAX_DAYS_BACK,
  SCREEN_TIME_MAX_MINUTES,
} from "@/lib/screen-time";
import type { DbSession } from "@/lib/services/session";
import { istDayKey, shiftDayKey } from "@/lib/week";

export type SaveScreenTimeResult =
  | { ok: true; day: string; minutes: number }
  | { ok: false; message: string };

export type SaveScreenLimitResult =
  | { ok: true; limitMinutes: number }
  | { ok: false; message: string };

/** Everything a screen-time write must satisfy, checked once on the server. */
export const screenTimeEntrySchema = z.object({
  /** IST day key. Missing means yesterday: a day only counts once it is over. */
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a day like 2026-11-13.")
    .optional(),
  minutes: z
    .number()
    .int()
    .min(0)
    .max(SCREEN_TIME_MAX_MINUTES),
});

export const screenLimitSchema = z.object({
  minutes: z.number().int().min(SCREEN_LIMIT_MIN).max(SCREEN_LIMIT_MAX),
});

/**
 * Upserts one day of screen time. The day defaults to yesterday because screen
 * time describes a finished day; backdating is allowed for the last 30 days and
 * the future never is. Kept here (not in the action) so the chat tool and the
 * Home card share the same rules.
 */
export async function saveScreenTime(
  session: DbSession,
  input: { day?: string; minutes: number },
  now: Date = new Date(),
): Promise<SaveScreenTimeResult> {
  const parsed = screenTimeEntrySchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: `Screen time should be whole minutes between 0 and ${SCREEN_TIME_MAX_MINUTES}.`,
    };
  }

  const todayKey = istDayKey(now);
  const day = parsed.data.day ?? shiftDayKey(todayKey, -1);
  const minutes = parsed.data.minutes;

  if (day > todayKey) {
    return { ok: false, message: "That day has not happened yet." };
  }

  if (day < shiftDayKey(todayKey, -SCREEN_TIME_MAX_DAYS_BACK)) {
    return {
      ok: false,
      message: `Screen time can be logged for the last ${SCREEN_TIME_MAX_DAYS_BACK} days.`,
    };
  }

  const { error } = await session.supabase.from("screen_time_entries").upsert(
    {
      user_id: session.userId,
      day,
      minutes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,day" },
  );

  if (error) {
    console.error("Could not save screen time:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  return { ok: true, day, minutes };
}

/**
 * Upserts a limit the user chose. There is no default: a limit only exists
 * because someone typed or tapped one, and `clearScreenLimit` removes it again.
 */
export async function saveScreenLimit(
  session: DbSession,
  minutes: number,
): Promise<SaveScreenLimitResult> {
  const parsed = screenLimitSchema.safeParse({ minutes });

  if (!parsed.success) {
    return {
      ok: false,
      message: `Pick a limit between ${SCREEN_LIMIT_MIN} and ${SCREEN_LIMIT_MAX} minutes.`,
    };
  }

  const limit = parsed.data.minutes;

  const { error } = await session.supabase.from("user_settings").upsert(
    {
      user_id: session.userId,
      screen_limit_minutes: limit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("Could not save the screen-time limit:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  return { ok: true, limitMinutes: limit };
}

export type ClearScreenLimitResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Removes the limit row. Absence is how "no limit" is stored: the column is
 * not nullable in the schema, so deleting the row is the honest way to say the
 * user has not set one.
 */
export async function clearScreenLimit(
  session: DbSession,
): Promise<ClearScreenLimitResult> {
  const { error } = await session.supabase
    .from("user_settings")
    .delete()
    .eq("user_id", session.userId);

  if (error) {
    console.error("Could not clear the screen-time limit:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  return { ok: true };
}

import { describeDbError } from "@/lib/errors";
import {
  SCREEN_LIMIT_MAX,
  SCREEN_LIMIT_MIN,
  SCREEN_TIME_MAX_MINUTES,
} from "@/lib/screen-time";
import type { DbSession } from "@/lib/services/session";
import { istDayKey, shiftDayKey } from "@/lib/week";

/** How far back the day panel may edit screen time (mirrors the journal). */
export const SCREEN_TIME_MAX_DAYS_BACK = 400;

export type SaveScreenTimeResult =
  | { ok: true; day: string; minutes: number }
  | { ok: false; message: string };

export type SaveScreenLimitResult =
  | { ok: true; limitMinutes: number }
  | { ok: false; message: string };

/**
 * Upserts one day of screen time. Today is the default; backdating is allowed
 * for the journal window, the future never is. Kept here (not in the action)
 * so the chat tool and the UI share the same rules.
 */
export async function saveScreenTime(
  session: DbSession,
  input: { day?: string; minutes: number },
  now: Date = new Date(),
): Promise<SaveScreenTimeResult> {
  const day = input.day ?? istDayKey(now);
  const minutes = Math.round(input.minutes);

  if (!Number.isFinite(minutes) || minutes < 0 || minutes > SCREEN_TIME_MAX_MINUTES) {
    return {
      ok: false,
      message: `Screen time should be between 0 and ${SCREEN_TIME_MAX_MINUTES} minutes.`,
    };
  }

  const todayKey = istDayKey(now);

  if (day > todayKey) {
    return { ok: false, message: "That day has not happened yet." };
  }

  if (day < shiftDayKey(todayKey, -SCREEN_TIME_MAX_DAYS_BACK)) {
    return { ok: false, message: "That day is too far back to edit here." };
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

/** Upserts the daily limit in `user_settings`. */
export async function saveScreenLimit(
  session: DbSession,
  minutes: number,
): Promise<SaveScreenLimitResult> {
  const limit = Math.round(minutes);

  if (
    !Number.isFinite(limit) ||
    limit < SCREEN_LIMIT_MIN ||
    limit > SCREEN_LIMIT_MAX
  ) {
    return {
      ok: false,
      message: `Pick a limit between ${SCREEN_LIMIT_MIN} and ${SCREEN_LIMIT_MAX} minutes.`,
    };
  }

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

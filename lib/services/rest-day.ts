import { describeDbError } from "@/lib/errors";
import { isLocked, LOCKED_MESSAGE } from "@/lib/lock";
import {
  restDayBlocker,
  restDaysInWeek,
  weekStartOf,
} from "@/lib/rest-day";
import type { DbSession } from "@/lib/services/session";
import { dayKeyLabel, isDayKey, istDayKey, shiftDayKey } from "@/lib/week";

/** One of the two days a rest day can be taken for. */
export type RestDayOption = {
  /** IST day key. */
  day: string;
  /** True when setting it right now would succeed. */
  allowed: boolean;
  /** Why it cannot be used, when `allowed` is false and the day is not used. */
  reason: string | null;
  /** That day is already this week's rest day. */
  used: boolean;
};

export type RestDayState = {
  todayKey: string;
  /** Today's Monday–Sunday week's rest day, if one is set. */
  thisWeekRestDay: string | null;
  today: RestDayOption;
  yesterday: RestDayOption;
  /**
   * False when the `is_rest_day` column is missing (migration 008 not applied).
   * The rest of the app keeps working; only rest days are unavailable.
   */
  supported: boolean;
};

export type RestDayResult =
  | { ok: true; message: string; day: string }
  | { ok: false; message: string };

export const REST_DAY_UNSUPPORTED =
  "Rest days need migration 008 before they can be used.";

const ONLY_TODAY_OR_YESTERDAY =
  "A rest day can only be set for today or yesterday.";

/**
 * Everything the Home button and the day panel need: whether this week's rest
 * day is free, and whether today and yesterday qualify. Two small reads; a
 * missing 008 column only disables rest days.
 */
export async function loadRestDayState(
  session: DbSession,
  now: Date = new Date(),
): Promise<RestDayState> {
  const todayKey = istDayKey(now);
  const yesterdayKey = shiftDayKey(todayKey, -1);
  const tomorrowKey = shiftDayKey(todayKey, 1);
  // Yesterday may belong to last week, so the window starts at its Monday.
  const fromKey = weekStartOf(yesterdayKey);

  const [restResult, completionResult] = await Promise.all([
    session.supabase
      .from("journal_entries")
      .select("day")
      .eq("user_id", session.userId)
      .eq("is_rest_day", true)
      .gte("day", fromKey)
      .lte("day", todayKey),
    session.supabase
      .from("completions")
      .select("completed_at")
      .eq("user_id", session.userId)
      .gte("completed_at", `${yesterdayKey}T00:00:00+05:30`)
      .lt("completed_at", `${tomorrowKey}T00:00:00+05:30`),
  ]);

  const supported = !restResult.error;

  if (restResult.error) {
    console.error("Could not read rest days:", restResult.error.message);
  }

  if (completionResult.error) {
    console.error(
      "Could not count completions for rest days:",
      completionResult.error.message,
    );
  }

  const restDays = supported
    ? ((restResult.data ?? []) as { day: string | null }[])
        .map((row) => (row.day ? String(row.day).slice(0, 10) : ""))
        .filter(isDayKey)
    : [];

  const completedDays = new Set(
    ((completionResult.data ?? []) as { completed_at: string }[]).map((row) =>
      istDayKey(new Date(row.completed_at)),
    ),
  );

  function optionFor(day: string): RestDayOption {
    const used = restDays.includes(day);
    const weekRestDay = restDaysInWeek(restDays, weekStartOf(day))[0] ?? null;

    if (used) {
      return { day, allowed: false, reason: null, used };
    }

    const reason = !supported
      ? REST_DAY_UNSUPPORTED
      : restDayBlocker({
          dayKey: day,
          todayKey,
          weekRestDay,
          completions: completedDays.has(day) ? 1 : 0,
        });

    return { day, allowed: reason === null, reason, used };
  }

  return {
    todayKey,
    thisWeekRestDay: restDaysInWeek(restDays, weekStartOf(todayKey))[0] ?? null,
    today: optionFor(todayKey),
    yesterday: optionFor(yesterdayKey),
    supported,
  };
}

/**
 * Marks a day as the week's rest day. The row is the journal row for that day;
 * mood and note are left exactly as they were.
 */
export async function setRestDay(
  session: DbSession,
  input: { day?: string | null } = {},
  now: Date = new Date(),
): Promise<RestDayResult> {
  const todayKey = istDayKey(now);
  const day = input.day ?? todayKey;

  if (!isDayKey(day)) {
    return { ok: false, message: "Use a day like 2026-11-13." };
  }

  if (day > todayKey) {
    return { ok: false, message: "That day has not happened yet." };
  }

  if (isLocked(day, todayKey)) {
    return { ok: false, message: LOCKED_MESSAGE };
  }

  const state = await loadRestDayState(session, now);
  const option =
    day === state.today.day
      ? state.today
      : day === state.yesterday.day
        ? state.yesterday
        : null;

  if (!option) {
    return { ok: false, message: ONLY_TODAY_OR_YESTERDAY };
  }

  if (option.used) {
    return {
      ok: true,
      message: `${dayKeyLabel(day)} is already the rest day for that week.`,
      day,
    };
  }

  if (!option.allowed) {
    return { ok: false, message: option.reason ?? REST_DAY_UNSUPPORTED };
  }

  const { error } = await session.supabase.from("journal_entries").upsert(
    { user_id: session.userId, day, is_rest_day: true },
    { onConflict: "user_id,day" },
  );

  if (error) {
    console.error("Could not save the rest day:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  return {
    ok: true,
    message: `Rest day saved for ${dayKeyLabel(day)}. The streak holds.`,
    day,
  };
}

/** Undo, while the day is still inside the edit window. */
export async function clearRestDay(
  session: DbSession,
  input: { day?: string | null } = {},
  now: Date = new Date(),
): Promise<RestDayResult> {
  const todayKey = istDayKey(now);
  const day = input.day ?? todayKey;

  if (!isDayKey(day)) {
    return { ok: false, message: "Use a day like 2026-11-13." };
  }

  if (day > todayKey) {
    return { ok: false, message: "That day has not happened yet." };
  }

  if (isLocked(day, todayKey)) {
    return { ok: false, message: LOCKED_MESSAGE };
  }

  const { error } = await session.supabase
    .from("journal_entries")
    .update({ is_rest_day: false })
    .eq("user_id", session.userId)
    .eq("day", day)
    .eq("is_rest_day", true);

  if (error) {
    console.error("Could not clear the rest day:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  return {
    ok: true,
    message: `Rest day removed from ${dayKeyLabel(day)}.`,
    day,
  };
}

/**
 * Work always wins: a completion logged on a rest day clears the flag, because
 * the streak now has something to count. Best effort — the completion itself
 * must never fail because of this.
 */
export async function clearRestDayForCompletion(
  session: DbSession,
  dayKey: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isDayKey(dayKey) || isLocked(dayKey, now)) return;

  const { error } = await session.supabase
    .from("journal_entries")
    .update({ is_rest_day: false })
    .eq("user_id", session.userId)
    .eq("day", dayKey)
    .eq("is_rest_day", true);

  if (error) {
    console.error("Could not clear the rest day:", error.message);
  }
}


import { describeDbError } from "@/lib/errors";
import {
  QUICK_LOG_DEFAULT_DISTANCE_KM,
  QUICK_LOG_MAX_DAYS_BACK,
} from "@/lib/quick-log";
import type { DbSession } from "@/lib/services/session";
import { DISTANCE_GOAL } from "@/lib/task";
import { istDayKey, shiftDayKey } from "@/lib/week";

export type LogActivityInput = {
  /** Goal key from the weekly targets, or null for "Other". */
  goal: string | null;
  minutes: number;
  distanceKm?: number | null;
  felt?: "easy" | "ok" | "hard" | null;
  note?: string | null;
  /** IST day key; defaults to today. */
  day?: string;
};

export type LogActivityResult =
  | {
      ok: true;
      id: string;
      /** What was saved, for the toast. */
      message: string;
      /** False when a walk/run fell below the target's minimum distance. */
      counts: boolean;
    }
  | { ok: false; message: string };

function toNumber(value: number | string | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Logs something that was done away from the app (a walk, a LeetCode session)
 * as a manual completion.
 *
 * This used to live inside the quick-log server action; it moved here so the
 * chat tool and the buttons share one validation path. The goal is checked
 * against the user's own active targets, and a backdated log lands at noon IST
 * so it cannot drift a day.
 */
export async function logActivity(
  session: DbSession,
  input: LogActivityInput,
  now: Date = new Date(),
): Promise<LogActivityResult> {
  const minutes = Math.round(input.minutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
    return {
      ok: false,
      message: "Minutes should be a whole number between 1 and 600.",
    };
  }

  const goal = input.goal?.trim() ? input.goal.trim() : null;
  const distanceKm =
    typeof input.distanceKm === "number" && Number.isFinite(input.distanceKm)
      ? Math.min(100, Math.max(0, input.distanceKm))
      : null;
  const note = input.note?.trim() ? input.note.trim().slice(0, 280) : null;
  const felt =
    input.felt === "easy" || input.felt === "ok" || input.felt === "hard"
      ? input.felt
      : null;

  const todayKey = istDayKey(now);
  const day = input.day ?? todayKey;
  const earliestKey = shiftDayKey(todayKey, -QUICK_LOG_MAX_DAYS_BACK);

  if (day > todayKey || day < earliestKey) {
    return {
      ok: false,
      message: `Pick a date from the last ${QUICK_LOG_MAX_DAYS_BACK} days.`,
    };
  }

  let label = "Other";
  let minDistanceKm: number | null = null;

  if (goal) {
    const { data: target, error: targetError } = await session.supabase
      .from("targets")
      .select("goal, label, min_distance_km")
      .eq("user_id", session.userId)
      .eq("goal", goal)
      .eq("active", true)
      .maybeSingle();

    if (targetError) {
      console.error("Could not load the target:", targetError.message);
      return { ok: false, message: describeDbError(targetError) };
    }

    if (!target) {
      return {
        ok: false,
        message: "That goal is not one of your active targets any more.",
      };
    }

    label = typeof target.label === "string" ? target.label : goal;
    minDistanceKm = toNumber(target.min_distance_km);
  }

  const isWalk = goal === DISTANCE_GOAL;
  const distance = isWalk
    ? (distanceKm ?? QUICK_LOG_DEFAULT_DISTANCE_KM)
    : null;

  const completedAt =
    day === todayKey ? new Date().toISOString() : `${day}T12:00:00+05:30`;

  const { data: inserted, error } = await session.supabase
    .from("completions")
    .insert({
      user_id: session.userId,
      item_id: null,
      goal,
      kind: goal ?? "manual",
      minutes,
      felt,
      note,
      distance_km: distance,
      source: "manual",
      completed_at: completedAt,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Could not log the quick entry:", error.message);
    return {
      ok: false,
      message: "Could not save that log. Please try again.",
    };
  }

  const counts =
    !isWalk || minDistanceKm === null || (distance ?? 0) >= minDistanceKm;

  return {
    ok: true,
    id: String(inserted.id),
    counts,
    message: counts
      ? `Logged ${minutes} min · ${label}`
      : `Logged ${minutes} min · ${label} (under ${minDistanceKm} km, does not count this week)`,
  };
}

export type UndoLogResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** Undo for the eight second toast: removes the manual row it just created. */
export async function undoLog(
  session: DbSession,
  id: string,
): Promise<UndoLogResult> {
  const { error } = await session.supabase
    .from("completions")
    .delete()
    .eq("id", id)
    .eq("user_id", session.userId)
    .eq("source", "manual");

  if (error) {
    console.error("Could not undo the quick entry:", error.message);
    return { ok: false, message: "Could not undo that log." };
  }

  return { ok: true, message: "Log removed." };
}

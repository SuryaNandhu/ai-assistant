"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import {
  QUICK_LOG_DEFAULT_DISTANCE_KM,
  QUICK_LOG_MAX_DAYS_BACK,
} from "@/lib/quick-log";
import { createClient } from "@/lib/supabase/server";
import { DISTANCE_GOAL } from "@/lib/task";
import { istDayKey, shiftDayKey } from "@/lib/week";

type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

export type QuickLogResult =
  | { ok: true; id: string; message: string }
  | { ok: false; message: string };

export type UndoLogResult = { ok: true; message: string } | { ok: false; message: string };

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

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
 * as a manual completion. The goal is checked against the user's own active
 * targets, and a backdated log lands at noon IST so it cannot drift a day.
 */
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

  const { minutes, distanceKm, felt, note, day } = parsed.data;
  const goal = parsed.data.goal;

  const todayKey = istDayKey(new Date());
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

  revalidatePath("/");

  const counts =
    !isWalk ||
    minDistanceKm === null ||
    (distance ?? 0) >= minDistanceKm;

  return {
    ok: true,
    id: String(inserted.id),
    message: counts
      ? `Logged ${minutes} min · ${label}`
      : `Logged ${minutes} min · ${label} (under ${minDistanceKm} km, does not count this week)`,
  };
}

/** Undo for the eight second toast: removes the row it just created. */
export async function undoQuickLogAction(input: unknown): Promise<UndoLogResult> {
  const parsed = undoSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Could not undo that log." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const { error } = await session.supabase
    .from("completions")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", session.userId)
    .eq("source", "manual");

  if (error) {
    console.error("Could not undo the quick entry:", error.message);
    return { ok: false, message: "Could not undo that log." };
  }

  revalidatePath("/");
  return { ok: true, message: "Log removed." };
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { DISTANCE_GOAL } from "@/lib/task";

type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

export type CompletionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

const editSchema = z.object({
  id: z.uuid(),
  minutes: z.number().int().min(1).max(600),
  felt: z.enum(["easy", "ok", "hard"]).nullable().default(null),
  note: z.string().trim().max(280).nullable().default(null),
  /** Only meaningful for walk/run; omitted means "leave the stored value". */
  distanceKm: z.number().min(0).max(100).nullable().optional(),
});

const idSchema = z.object({ id: z.uuid() });

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

function revalidateProgress() {
  revalidatePath("/progress");
  revalidatePath("/");
}

/**
 * Fixes a completion from the day panel: minutes, how it felt, the note, and
 * the distance for a walk/run. The goal is read from the row, never the client,
 * so a forged request cannot turn a LeetCode session into 5 km.
 */
export async function updateCompletionAction(input: unknown): Promise<CompletionResult> {
  const parsed = editSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the numbers and try again.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const { id, minutes, felt, note, distanceKm } = parsed.data;

  const { data: row, error: readError } = await session.supabase
    .from("completions")
    .select("id, goal, distance_km")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle<{ id: string; goal: string | null; distance_km: number | string | null }>();

  if (readError) {
    console.error("Could not load the completion:", readError.message);
    return { ok: false, message: describeDbError(readError) };
  }

  if (!row) {
    return { ok: false, message: "That completion is no longer there." };
  }

  const storedDistance = toNumber(row.distance_km);
  const distance =
    row.goal === DISTANCE_GOAL
      ? (distanceKm ?? storedDistance ?? 0)
      : storedDistance;

  const { error } = await session.supabase
    .from("completions")
    .update({
      minutes,
      felt,
      note: note ? note : null,
      distance_km: distance,
    })
    .eq("id", id)
    .eq("user_id", session.userId);

  if (error) {
    console.error("Could not update the completion:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  revalidateProgress();
  return { ok: true, message: "Completion updated." };
}

/** Deletes one completion, after the panel's confirmation step. */
export async function deleteCompletionAction(input: unknown): Promise<CompletionResult> {
  const parsed = idSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That completion could not be found." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const { data, error } = await session.supabase
    .from("completions")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", session.userId)
    .select("id");

  if (error) {
    console.error("Could not delete the completion:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  if (!data || data.length === 0) {
    return { ok: false, message: "That completion was already removed." };
  }

  revalidateProgress();
  return { ok: true, message: "Completion deleted." };
}

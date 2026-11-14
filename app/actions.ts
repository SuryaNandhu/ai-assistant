"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { errorMessage } from "@/lib/env";
import { pickTask, type PickRequest } from "@/lib/picker";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_DISTANCE_KM,
  DEFAULT_MINUTES,
  DISTANCE_GOAL,
  findGenericTask,
  goalLabel,
  type PickedTask,
} from "@/lib/task";

type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

export type PickResult =
  | { ok: true; task: PickedTask | null }
  | { ok: false; message: string };

export type CompleteResult = { ok: true; message: string } | { ok: false; message: string };

const timeSchema = z.union([z.literal(15), z.literal(30), z.literal(60)]);
const energySchema = z.enum(["low", "normal", "high"]);
const feltSchema = z.enum(["easy", "ok", "hard"]);

const pickSchema = z.object({
  mode: z.enum(["smart", "surprise"]),
  minutes: timeSchema,
  energy: energySchema,
  exclude: z.array(z.string().max(120)).max(25).default([]),
});

const taskRefSchema = z.object({
  source: z.enum(["item", "generic"]),
  itemId: z.uuid().nullable().default(null),
  goal: z.string().max(60).nullable().default(null),
  key: z.string().min(1).max(120),
});

const skipSchema = z.object({ pick: pickSchema, task: taskRefSchema });

const completeSchema = z.object({
  task: z.object({
    source: z.enum(["item", "generic"]),
    itemId: z.uuid().nullable().default(null),
    goal: z.string().max(60).nullable().default(null),
    /** Whole minutes on the clock; null means "use the estimate". */
    elapsedMinutes: z.number().int().min(1).max(600).nullable().default(null),
    distanceKm: z.number().min(0).max(100).nullable().default(null),
  }),
  felt: feltSchema,
});

const SIGNED_OUT =
  "You are signed out. Refresh the page and sign in again.";

async function requireSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    if (error) console.error("Could not read Supabase session:", error.message);
    return null;
  }

  return { supabase, userId: data.claims.sub };
}

/** Turns low-level Postgres errors into something the user can act on. */
function describeError(error: unknown): string {
  const message = errorMessage(error);
  if (/does not exist|schema cache|relation|column .* does not exist/i.test(message)) {
    return "Your database is missing part of the schema. Run supabase/schema.sql in the Supabase SQL editor, then reload.";
  }
  return message;
}

function toPickRequest(input: z.infer<typeof pickSchema>): PickRequest {
  return {
    mode: input.mode,
    minutes: input.minutes,
    energy: input.energy,
    exclude: input.exclude,
  };
}

/** "What now?" and "Surprise me" both land here. */
export async function pickTaskAction(input: unknown): Promise<PickResult> {
  const parsed = pickSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Pick one of the available time and energy options.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const task = await pickTask(session, toPickRequest(parsed.data));
    return { ok: true, task };
  } catch (error) {
    console.error("Could not pick a task:", error);
    return { ok: false, message: describeError(error) };
  }
}

/**
 * Records the skip on a real item (generic suggestions have nothing to record)
 * and immediately returns another task.
 */
export async function skipTaskAction(input: unknown): Promise<PickResult> {
  const parsed = skipSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Could not skip that task. Reload the page and try again.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const { pick, task } = parsed.data;
  if (task.source === "item" && task.itemId) {
    await recordSkip(session, task.itemId);
  }

  try {
    const next = await pickTask(session, {
      ...toPickRequest(pick),
      exclude: [...pick.exclude, task.key],
    });
    return { ok: true, task: next };
  } catch (error) {
    console.error("Could not pick a task after skipping:", error);
    return { ok: false, message: describeError(error) };
  }
}

/**
 * Supabase's REST API cannot express `skipped_count + 1`, so read the current
 * value first. One user, one device at a time — good enough here.
 */
async function recordSkip(session: Session, itemId: string): Promise<void> {
  const { data, error } = await session.supabase
    .from("items")
    .select("skipped_count")
    .eq("id", itemId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (error) {
    console.error("Could not read skipped_count:", error.message);
    return;
  }

  const current = typeof data?.skipped_count === "number" ? data.skipped_count : 0;
  const { error: updateError } = await session.supabase
    .from("items")
    .update({
      skipped_count: current + 1,
      last_skipped_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("user_id", session.userId);

  if (updateError) {
    console.error("Could not record the skip:", updateError.message);
  }
}

function distanceFor(value: number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(100, value);
  }
  return DEFAULT_DISTANCE_KM;
}

function loggedMessage(minutes: number, label: string): string {
  return `Logged ${minutes} min · ${label}`;
}

/**
 * Saves a completion, marks the underlying item done and refreshes Home so the
 * streak and weekly pills update.
 *
 * Titles, goals and estimates are re-read from the database (items) or the
 * generic catalog, never trusted from the client.
 */
export async function completeTaskAction(
  input: unknown,
): Promise<CompleteResult> {
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Could not log that. Reload the page and try again.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const { task, felt } = parsed.data;

  if (task.source === "generic") {
    const template = findGenericTask(task.goal);
    if (!template) {
      return {
        ok: false,
        message: "That suggestion is no longer available. Try What now? again.",
      };
    }

    const minutes = task.elapsedMinutes ?? template.minutes;
    const { error } = await session.supabase.from("completions").insert({
      user_id: session.userId,
      item_id: null,
      goal: template.goal,
      kind: template.goal,
      minutes,
      felt,
      distance_km:
        template.goal === DISTANCE_GOAL ? distanceFor(task.distanceKm) : null,
    });

    if (error) {
      console.error("Could not log the completed task:", error.message);
      return {
        ok: false,
        message: "Could not save that completion. Please try again.",
      };
    }

    revalidatePath("/");
    return { ok: true, message: loggedMessage(minutes, goalLabel(template.goal)) };
  }

  if (!task.itemId) {
    return { ok: false, message: "That task is no longer in your list." };
  }

  const { data: item, error: itemError } = await session.supabase
    .from("items")
    .select("id, type, goal, est_minutes")
    .eq("id", task.itemId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (itemError) {
    console.error("Could not load the item:", itemError.message);
    return { ok: false, message: describeError(itemError) };
  }

  if (!item) {
    return { ok: false, message: "That task is no longer in your list." };
  }

  const goal = typeof item.goal === "string" && item.goal ? item.goal : null;
  const estimate =
    typeof item.est_minutes === "number" && item.est_minutes > 0
      ? item.est_minutes
      : DEFAULT_MINUTES;
  const minutes = task.elapsedMinutes ?? estimate;

  const { error: insertError } = await session.supabase
    .from("completions")
    .insert({
      user_id: session.userId,
      item_id: item.id,
      goal,
      kind: typeof item.type === "string" && item.type ? item.type : "item",
      minutes,
      felt,
      distance_km: goal === DISTANCE_GOAL ? distanceFor(task.distanceKm) : null,
    });

  if (insertError) {
    console.error("Could not log the completed item:", insertError.message);
    return {
      ok: false,
      message: "Could not save that completion. Please try again.",
    };
  }

  const { error: updateError } = await session.supabase
    .from("items")
    .update({ status: "done" })
    .eq("id", item.id)
    .eq("user_id", session.userId);

  if (updateError) {
    // The completion is saved; this only leaves the item in the backlog.
    console.error("Could not mark the item done:", updateError.message);
  }

  revalidatePath("/");
  return { ok: true, message: loggedMessage(minutes, goalLabel(goal)) };
}

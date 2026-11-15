"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import { pickTask, type PickRequest } from "@/lib/pick-service";
import { completePickedTask, skipPickedTask } from "@/lib/services/tasks";
import { SKIP_REASON_VALUES } from "@/lib/suggestions";
import { createClient } from "@/lib/supabase/server";
import { type PickedTask } from "@/lib/task";

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
  /** `suggestions` row logged when the task was picked. */
  suggestionId: z.uuid().nullable().default(null),
});

const skipSchema = z.object({
  pick: pickSchema,
  task: taskRefSchema,
  reason: z.enum(SKIP_REASON_VALUES),
});

const completeSchema = z.object({
  task: z.object({
    source: z.enum(["item", "generic"]),
    itemId: z.uuid().nullable().default(null),
    goal: z.string().max(60).nullable().default(null),
    /** Whole minutes on the clock; null means "use the estimate". */
    elapsedMinutes: z.number().int().min(1).max(600).nullable().default(null),
    distanceKm: z.number().min(0).max(100).nullable().default(null),
    /** One-line takeaway for a link; ignored for generic suggestions. */
    takeaway: z.string().trim().max(280).nullable().default(null),
    suggestionId: z.uuid().nullable().default(null),
  }),
  felt: feltSchema,
  /** "More like this?" — null means the user did not answer. */
  liked: z.boolean().nullable().default(null),
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
    return { ok: false, message: describeDbError(error) };
  }
}

/**
 * Records the skip and immediately returns another task. The skip itself lives
 * in `lib/services/tasks` so the chat tool closes suggestions the same way.
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

  const { pick, task, reason } = parsed.data;

  await skipPickedTask(session, {
    task: {
      source: task.source,
      itemId: task.itemId,
      suggestionId: task.suggestionId,
    },
    reason,
  });

  try {
    const next = await pickTask(session, {
      ...toPickRequest(pick),
      exclude: [...pick.exclude, task.key],
    });
    return { ok: true, task: next };
  } catch (error) {
    console.error("Could not pick a task after skipping:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

/**
 * Saves a completion, marks the underlying item done and refreshes Home so the
 * streak and weekly pills update. The write rules live in `lib/services/tasks`
 * (the chat tool calls the same function); this wrapper only adds revalidation.
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

  const result = await completePickedTask(session, parsed.data);

  if (!result.ok) return result;

  revalidatePath("/");
  revalidatePath("/saved");
  return result;
}

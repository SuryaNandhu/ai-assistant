"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import { ITEM_TITLE_MAX } from "@/lib/inbox";
import {
  createCustomGoal,
  createTaskItem,
  deleteCustomGoal,
  setGoalActive,
} from "@/lib/services/quick-add";
import { createClient } from "@/lib/supabase/server";
import { GOAL_LABEL_MAX, type GoalCard } from "@/lib/targets";

type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

export type QuickAddResult =
  | { ok: true; message: string; goal: GoalCard | null }
  | { ok: false; message: string };

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

const taskSchema = z.object({
  title: z.string().trim().min(1).max(ITEM_TITLE_MAX),
  /** Whole minutes; null means the default in `lib/services/quick-add`. */
  estMinutes: z.number().int().min(1).max(600).nullable().default(null),
});

const goalSchema = z.object({
  label: z.string().trim().min(1).max(GOAL_LABEL_MAX),
  perWeek: z.number().int().min(1).max(7),
});

const goalToggleSchema = z.object({
  goal: z.string().min(1).max(60),
  active: z.boolean(),
});

const goalRefSchema = z.object({ goal: z.string().min(1).max(60) });

async function requireSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    if (error) console.error("Could not read Supabase session:", error.message);
    return null;
  }

  return { supabase, userId: data.claims.sub };
}

/** Home, Saved and Progress all show the result of these four actions. */
function revalidateBoards() {
  revalidatePath("/");
  revalidatePath("/progress");
  revalidatePath("/saved");
}

export async function addTaskAction(input: unknown): Promise<QuickAddResult> {
  const parsed = taskSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Give the task a name." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await createTaskItem(session, parsed.data);
    if (!result.ok) return result;

    revalidateBoards();
    return { ok: true, message: result.message, goal: null };
  } catch (error) {
    console.error("Could not add the task:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

export async function addGoalAction(input: unknown): Promise<QuickAddResult> {
  const parsed = goalSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Pick a name and 1–7 times a week." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await createCustomGoal(session, parsed.data);
    if (!result.ok) return result;

    revalidateBoards();
    return { ok: true, message: result.message, goal: result.goal };
  } catch (error) {
    console.error("Could not add the goal:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

export async function setGoalActiveAction(
  input: unknown,
): Promise<QuickAddResult> {
  const parsed = goalToggleSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Could not find that target." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await setGoalActive(session, parsed.data);
    if (!result.ok) return result;

    revalidateBoards();
    return { ok: true, message: result.message, goal: result.goal };
  } catch (error) {
    console.error("Could not update the goal:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

export async function deleteGoalAction(input: unknown): Promise<QuickAddResult> {
  const parsed = goalRefSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Could not find that target." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await deleteCustomGoal(session, parsed.data.goal);
    if (!result.ok) return result;

    revalidateBoards();
    return { ok: true, message: result.message, goal: null };
  } catch (error) {
    console.error("Could not delete the goal:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

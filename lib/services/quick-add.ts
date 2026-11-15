import type { SupabaseClient } from "@supabase/supabase-js";

import { describeDbError } from "@/lib/errors";
import {
  INBOX_ITEM_COLUMNS,
  ITEM_TITLE_MAX,
  TASK_ITEM_TYPE,
  type InboxItem,
} from "@/lib/inbox";
import type { DbSession } from "@/lib/services/session";
import {
  CUSTOM_GOAL_MAX_ACTIVE,
  DEFAULT_TARGET_MINUTES,
  GOAL_LABEL_MAX,
  type GoalCard,
} from "@/lib/targets";
import type { Energy } from "@/lib/task";

/**
 * The two quick-adds that are not links: a one-off task (a saved item with a
 * title and no URL) and a custom weekly target. Both are written here because
 * the "+" sheet and the chat tools must behave the same way.
 */

/** `"Read non-fiction"` → `"read_non_fiction"`; the key never changes later. */
export function goalKeyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, GOAL_LABEL_MAX);

  return key || "goal";
}

/**
 * First free key: `gym`, then `gym_2`, `gym_3` … so a second "Gym" never
 * collides with the first one's completions. Null when even that runs out.
 */
export function uniqueGoalKey(
  base: string,
  taken: Iterable<string>,
): string | null {
  const used = new Set(taken);
  if (!used.has(base)) return base;

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!used.has(candidate)) return candidate;
  }

  return null;
}

/** A tidy one-line title: trimmed, single-spaced and capped. */
function cleanTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").slice(0, ITEM_TITLE_MAX);
}

export type CreateTaskResult =
  | { ok: true; item: InboxItem; message: string }
  | { ok: false; message: string };

/**
 * A one-off task is an `items` row with `type = 'task'`, no URL and the usual
 * todo status, so it shows up in Saved and can be picked like any other task.
 */
export async function createTaskItem(
  session: DbSession,
  input: { title: string; estMinutes?: number | null; energy?: Energy | null },
): Promise<CreateTaskResult> {
  const title = cleanTitle(input.title);

  if (title.length < 2) {
    return { ok: false, message: "Give the task a name." };
  }

  const minutes =
    input.estMinutes === null || input.estMinutes === undefined
      ? DEFAULT_TARGET_MINUTES
      : Math.round(input.estMinutes);

  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
    return { ok: false, message: "Use 1–600 minutes for a task." };
  }

  const { data, error } = await session.supabase
    .from("items")
    .insert({
      user_id: session.userId,
      type: TASK_ITEM_TYPE,
      title,
      url: null,
      goal: null,
      est_minutes: minutes,
      energy: input.energy ?? "normal",
      status: "todo",
      added_via: "manual",
    })
    .select(INBOX_ITEM_COLUMNS)
    .single();

  if (error) {
    console.error("Could not add the task:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  return {
    ok: true,
    item: data as InboxItem,
    message: `Added “${title}” as a one-off task.`,
  };
}

type GoalRow = {
  goal: string;
  label: string;
  active: boolean | null;
  is_custom: boolean | null;
};

function toGoalCard(row: GoalRow): GoalCard {
  return {
    goal: row.goal,
    label: row.label,
    active: row.active !== false,
    isCustom: row.is_custom === true,
  };
}

/**
 * Every target for the goal tab, active first. A missing 007 migration throws,
 * and the caller hides the tab instead of breaking the sheet.
 */
export async function loadGoalCards(
  supabase: SupabaseClient,
  userId: string,
): Promise<GoalCard[]> {
  const { data, error } = await supabase
    .from("targets")
    .select("goal, label, active, is_custom")
    .eq("user_id", userId)
    .order("active", { ascending: false })
    .order("label", { ascending: true });

  if (error) {
    throw new Error(`Could not load your targets: ${error.message}`);
  }

  return ((data ?? []) as GoalRow[]).map(toGoalCard);
}

export type CreateGoalResult =
  | { ok: true; goal: GoalCard; message: string }
  | { ok: false; message: string };

/**
 * Adds a weekly target the user invented. The key comes from the label, with a
 * numeric suffix when that key is taken; past completions keep their own key,
 * so renaming a goal later never rewrites history.
 */
export async function createCustomGoal(
  session: DbSession,
  input: { label: string; perWeek: number },
): Promise<CreateGoalResult> {
  const label = cleanTitle(input.label).slice(0, GOAL_LABEL_MAX);

  if (label.length < 2) {
    return { ok: false, message: "Give the goal a name." };
  }

  const perWeek = Math.round(input.perWeek);

  if (!Number.isFinite(perWeek) || perWeek < 1 || perWeek > 7) {
    return { ok: false, message: "Pick 1–7 times a week." };
  }

  const [active, existing] = await Promise.all([
    session.supabase
      .from("targets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.userId)
      .eq("active", true),
    session.supabase
      .from("targets")
      .select("goal")
      .eq("user_id", session.userId),
  ]);

  if (active.error || existing.error) {
    const error = active.error ?? existing.error;
    console.error("Could not read the targets:", error?.message);
    return {
      ok: false,
      message: describeDbError(error ?? new Error("Unknown error")),
    };
  }

  if ((active.count ?? 0) >= CUSTOM_GOAL_MAX_ACTIVE) {
    return {
      ok: false,
      message: `You already have ${CUSTOM_GOAL_MAX_ACTIVE} active targets. Pause or delete one first.`,
    };
  }

  const key = uniqueGoalKey(
    goalKeyFromLabel(label),
    ((existing.data ?? []) as { goal: string }[]).map((row) => row.goal),
  );

  if (key === null) {
    return { ok: false, message: "That name is taken. Try a different one." };
  }

  const { data, error } = await session.supabase
    .from("targets")
    .insert({
      user_id: session.userId,
      goal: key,
      label,
      per_week: perWeek,
      min_distance_km: null,
      period: "week",
      min_quantity: null,
      est_minutes: DEFAULT_TARGET_MINUTES,
      energy: "normal",
      is_custom: true,
      active: true,
    })
    .select("goal, label, active, is_custom")
    .single();

  if (error) {
    console.error("Could not add the goal:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  return {
    ok: true,
    goal: toGoalCard(data as GoalRow),
    message: `Added “${label}” at ${perWeek}× a week.`,
  };
}

export type GoalMutationResult =
  | { ok: true; goal: GoalCard; message: string }
  | { ok: false; message: string };

/** Pause hides a target from Home and the picker without touching history. */
export async function setGoalActive(
  session: DbSession,
  input: { goal: string; active: boolean },
): Promise<GoalMutationResult> {
  const { data, error } = await session.supabase
    .from("targets")
    .update({ active: input.active })
    .eq("user_id", session.userId)
    .eq("goal", input.goal)
    .select("goal, label, active, is_custom")
    .maybeSingle();

  if (error) {
    console.error("Could not update the goal:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  if (!data) {
    return { ok: false, message: "That target no longer exists." };
  }

  const card = toGoalCard(data as GoalRow);

  return {
    ok: true,
    goal: card,
    message: `${card.label} ${card.active ? "is back on Home" : "is paused"}.`,
  };
}

/**
 * Deleting is limited to custom goals: the seeded targets are the app's own
 * vocabulary and are better paused. Completions keep the goal key either way.
 */
export async function deleteCustomGoal(
  session: DbSession,
  goal: string,
): Promise<GoalMutationResult> {
  const { data: existing, error: findError } = await session.supabase
    .from("targets")
    .select("goal, label, active, is_custom")
    .eq("user_id", session.userId)
    .eq("goal", goal)
    .maybeSingle();

  if (findError) {
    console.error("Could not read the goal:", findError.message);
    return { ok: false, message: describeDbError(findError) };
  }

  if (!existing) {
    return { ok: false, message: "That target no longer exists." };
  }

  const card = toGoalCard(existing as GoalRow);

  if (!card.isCustom) {
    return { ok: false, message: "Built-in targets can be paused, not deleted." };
  }

  const { error } = await session.supabase
    .from("targets")
    .delete()
    .eq("user_id", session.userId)
    .eq("goal", goal);

  if (error) {
    console.error("Could not delete the goal:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  return { ok: true, goal: card, message: `Deleted ${card.label}.` };
}

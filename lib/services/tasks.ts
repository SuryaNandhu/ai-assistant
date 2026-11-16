import {
  pickTask,
  type PickRequest,
} from "@/lib/pick-service";
import { isLocked, LOCKED_MESSAGE } from "@/lib/lock";
import { clearRestDayForCompletion } from "@/lib/services/rest-day";
import type { DbSession } from "@/lib/services/session";
import {
  effectiveOutcome,
  toSuggestionFelt,
  type SkipReason,
  type SuggestionFelt,
} from "@/lib/suggestions";
import {
  DEFAULT_DISTANCE_KM,
  DEFAULT_MINUTES,
  DISTANCE_GOAL,
  findGenericTask,
  goalLabel,
  noFitMessage,
  taskKey,
  type Felt,
  type PickedTask,
  type TaskSource,
} from "@/lib/task";
import { istDayKey } from "@/lib/week";

/** The slot sizes the Home screen offers; the chat tools accept the same. */
export const PICK_MINUTES = [15, 30, 60] as const;

/**
 * The chat has to say something when a slot comes back empty instead of
 * rendering an empty state, so the picker hands back a sentence as well as the
 * task.
 */
export type PickTaskOutcome =
  | { ok: true; task: PickedTask }
  | { ok: false; message: string };

/**
 * Thin wrapper over `pickTask` for the chat tool. A null pick becomes the same
 * "try a longer slot" wording the Home card shows.
 */
export async function pickTaskForSession(
  session: DbSession,
  request: PickRequest,
  now: Date = new Date(),
): Promise<PickTaskOutcome> {
  const task = await pickTask(
    { supabase: session.supabase, userId: session.userId, now },
    request,
  );

  if (task) return { ok: true, task };

  return {
    ok: false,
    message: noFitMessage(request.minutes, request.energy),
  };
}

/** The parts of a picked task the write paths need, by value only. */
export type TaskRef = {
  source: TaskSource;
  itemId: string | null;
  goal: string | null;
  /** Whole minutes; null means "use the estimate". */
  elapsedMinutes: number | null;
  distanceKm: number | null;
  /** How many things this sitting covered (3 applications); null means one. */
  quantity?: number | null;
  /** One-line takeaway for a link; ignored for generic suggestions. */
  takeaway: string | null;
  suggestionId: string | null;
};

export type CompleteTaskInput = {
  task: TaskRef;
  /** `completions.felt` vocabulary — "right" is stored as "ok". */
  felt: Felt;
  /** "More like this?" — null means the user did not answer. */
  liked: boolean | null;
};

export type CompleteTaskResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

type SuggestionPatch = {
  outcome: "done" | "skipped";
  felt?: SuggestionFelt;
  liked?: boolean | null;
  actualMinutes?: number;
  skipReason?: SkipReason;
};

/**
 * Closes out the suggestion behind a task. Losing this write only costs a bit
 * of learning, so it is logged rather than shown as an error.
 */
async function finishSuggestion(
  session: DbSession,
  suggestionId: string | null,
  patch: SuggestionPatch,
): Promise<void> {
  if (!suggestionId) return;

  const update: Record<string, unknown> = { outcome: patch.outcome };
  if (patch.felt) update.felt = patch.felt;
  if (patch.liked !== undefined) update.liked = patch.liked;
  if (typeof patch.actualMinutes === "number" && patch.actualMinutes > 0) {
    update.actual_minutes = patch.actualMinutes;
  }
  if (patch.skipReason) update.skip_reason = patch.skipReason;

  const { error } = await session.supabase
    .from("suggestions")
    .update(update)
    .eq("id", suggestionId)
    .eq("user_id", session.userId);

  if (error) {
    console.error("Could not update the suggestion:", error.message);
  }
}

/**
 * A suggestion older than the edit window is closed: its outcome and feedback
 * can no longer change. Pending rows expire after 12 hours, so this only guards
 * against a stale id arriving from an old tab or conversation.
 */
async function closedSuggestionMessage(
  session: DbSession,
  suggestionId: string | null,
): Promise<string | null> {
  if (!suggestionId) return null;

  const { data, error } = await session.supabase
    .from("suggestions")
    .select("shown_at")
    .eq("id", suggestionId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (error) {
    console.error("Could not read the suggestion day:", error.message);
    return null;
  }

  if (!data?.shown_at) return null;

  return isLocked(istDayKey(new Date(String(data.shown_at))))
    ? LOCKED_MESSAGE
    : null;
}

/**
 * Supabase's REST API cannot express `skipped_count + 1`, so read the current
 * value first. One user, one device at a time — good enough here.
 */
async function recordSkip(session: DbSession, itemId: string): Promise<void> {
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

/**
 * A daily-minimum target needs a number on the completion ("3 applications").
 * Anything blank or silly is stored as NULL, which every reader treats as one.
 */
function quantityFor(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1) return null;
  return Math.min(1000, rounded);
}

function loggedMessage(
  minutes: number,
  label: string,
  quantity?: number | null,
): string {
  const count =
    typeof quantity === "number" && quantity > 1 ? ` · ${quantity} done` : "";
  return `Logged ${minutes} min · ${label}${count}`;
}

/**
 * Saves a completion and marks the underlying item done. Titles, goals and
 * estimates are re-read from the database (items) or the generic catalog,
 * never trusted from the caller. Shared by the Done button and the chat tool.
 */
export async function completePickedTask(
  session: DbSession,
  input: CompleteTaskInput,
): Promise<CompleteTaskResult> {
  const { task, felt, liked } = input;

  const closed = await closedSuggestionMessage(session, task.suggestionId);
  if (closed) return { ok: false, message: closed };

  if (task.source === "generic") {
    // Built-in goals have a catalog entry; a custom goal only has its key, and
    // the timer (or the default 30 minutes) is enough to log it.
    const template = findGenericTask(task.goal);
    const goal = task.goal ?? template?.goal ?? null;

    if (!goal) {
      return {
        ok: false,
        message: "That suggestion is no longer available. Try What now? again.",
      };
    }

    const minutes = task.elapsedMinutes ?? template?.minutes ?? DEFAULT_MINUTES;
    const { error } = await session.supabase.from("completions").insert({
      user_id: session.userId,
      item_id: null,
      goal,
      kind: goal,
      minutes,
      felt,
      source: "suggestion",
      quantity: quantityFor(task.quantity),
      distance_km:
        goal === DISTANCE_GOAL ? distanceFor(task.distanceKm) : null,
    });

    if (error) {
      console.error("Could not log the completed task:", error.message);
      return {
        ok: false,
        message: "Could not save that completion. Please try again.",
      };
    }

    const today = istDayKey(new Date());
    await clearRestDayForCompletion(session, today);

    await finishSuggestion(session, task.suggestionId, {
      outcome: "done",
      felt: toSuggestionFelt(felt),
      liked,
      actualMinutes: minutes,
    });

    return {
      ok: true,
      message: loggedMessage(minutes, goalLabel(goal)),
    };
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
    return { ok: false, message: "Could not load that item. Please try again." };
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
      source: "suggestion",
      quantity: quantityFor(task.quantity),
      distance_km: goal === DISTANCE_GOAL ? distanceFor(task.distanceKm) : null,
    });

  if (insertError) {
    console.error("Could not log the completed item:", insertError.message);
    return {
      ok: false,
      message: "Could not save that completion. Please try again.",
    };
  }

  const today = istDayKey(new Date());
  await clearRestDayForCompletion(session, today);

  await finishSuggestion(session, task.suggestionId, {
    outcome: "done",
    felt: toSuggestionFelt(felt),
    liked,
    actualMinutes: minutes,
  });

  // The takeaway is optional; only write it when the user typed one so an
  // earlier note is never wiped by an empty field.
  const itemUpdate: { status: string; takeaway?: string } = { status: "done" };
  if (task.takeaway) itemUpdate.takeaway = task.takeaway;

  const { error: updateError } = await session.supabase
    .from("items")
    .update(itemUpdate)
    .eq("id", item.id)
    .eq("user_id", session.userId);

  if (updateError) {
    // The completion is saved; this only leaves the item in the backlog.
    console.error("Could not mark the item done:", updateError.message);
  }

  return { ok: true, message: loggedMessage(minutes, goalLabel(goal)) };
}

export type SkipTaskInput = {
  task: {
    source: TaskSource;
    itemId: string | null;
    suggestionId: string | null;
  };
  reason: SkipReason;
};

export type SkipTaskResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Records the skip on a real item (generic suggestions have nothing to record)
 * and closes the suggestion. The Home button then picks the next task itself;
 * the chat tool just reports what happened.
 */
export async function skipPickedTask(
  session: DbSession,
  input: SkipTaskInput,
): Promise<SkipTaskResult> {
  const { task, reason } = input;

  const closed = await closedSuggestionMessage(session, task.suggestionId);
  if (closed) return { ok: false, message: closed };

  if (task.source === "item" && task.itemId) {
    await recordSkip(session, task.itemId);
  }

  await finishSuggestion(session, task.suggestionId, {
    outcome: "skipped",
    skipReason: reason,
  });

  return { ok: true, message: `Skipped · ${reason.replaceAll("_", " ")}` };
}

/** A suggestion still open for a completion or a skip, by id only. */
export type SuggestionRef = {
  suggestionId: string;
  source: TaskSource;
  itemId: string | null;
  goal: string | null;
  title: string;
  key: string;
};

export type SuggestionRefResult =
  | { ok: true; task: SuggestionRef }
  | { ok: false; message: string };

type SuggestionRow = {
  id: string;
  item_id: string | null;
  title: string | null;
  goal: string | null;
  type: string | null;
  outcome: string;
  shown_at: string;
  meta: { key?: unknown; source?: unknown } | null;
};

/**
 * Rebuilds the task behind a suggestion id, so the chat assistant can finish
 * something it suggested a turn or two ago. Only pending suggestions count:
 * a stale row is already read as "ignored" by the picker's own rules.
 */
export async function loadOpenSuggestion(
  session: DbSession,
  suggestionId: string,
  now: Date = new Date(),
): Promise<SuggestionRefResult> {
  const { data, error } = await session.supabase
    .from("suggestions")
    .select("id, item_id, title, goal, type, outcome, shown_at, meta")
    .eq("id", suggestionId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (error) {
    console.error("Could not load the suggestion:", error.message);
    return { ok: false, message: "Could not load that suggestion." };
  }

  if (!data) {
    return { ok: false, message: "I could not find that suggestion." };
  }

  const row = data as SuggestionRow;

  if (isLocked(istDayKey(new Date(row.shown_at)))) {
    return { ok: false, message: LOCKED_MESSAGE };
  }

  if (effectiveOutcome(row, now) !== "pending") {
    return {
      ok: false,
      message: "That suggestion is already closed. Pick a new task first.",
    };
  }

  const source: TaskSource =
    row.meta?.source === "generic" || !row.item_id ? "generic" : "item";
  const goal = typeof row.goal === "string" ? row.goal : null;
  const metaKey = row.meta?.key;

  return {
    ok: true,
    task: {
      suggestionId: String(row.id),
      source,
      itemId: row.item_id ?? null,
      goal,
      title: row.title ?? goalLabel(goal),
      key:
        typeof metaKey === "string" && metaKey
          ? metaKey
          : taskKey(source, row.item_id, goal),
    },
  };
}

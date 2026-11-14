import type { SupabaseClient } from "@supabase/supabase-js";

import { revisitDueAt } from "@/lib/inbox";
import { toSuggestionMode } from "@/lib/suggestions";
import {
  findGoalProgress,
  loadWeeklyProgress,
  type GoalProgress,
  type WeeklyProgress,
} from "@/lib/progress";
import {
  DEFAULT_MINUTES,
  GENERIC_TASKS,
  energyRank,
  goalLabel,
  taskKey,
  type Energy,
  type GenericTask,
  type PickMode,
  type PickedTask,
} from "@/lib/task";

/** A skipped task stays out of the rotation for a day. */
export const SKIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type ItemRow = {
  id: string;
  title: string;
  url: string | null;
  type: string;
  goal: string | null;
  est_minutes: number | null;
  energy: string | null;
  last_skipped_at: string | null;
  takeaway: string | null;
  /** Set while the item is parked for later; null means it is fair game. */
  revisit_at: string | null;
  /** Topic tags, used to learn which subjects the user actually finishes. */
  tags: string[] | null;
};

export type PickRequest = {
  mode: PickMode;
  /** Minutes the user has right now. */
  minutes: number;
  /** Energy the user has right now. */
  energy: Energy;
  /** Task keys already shown this round, so a re-roll moves on. */
  exclude?: readonly string[];
};

export type PickContext = {
  supabase: SupabaseClient;
  userId: string;
  /** Injectable clock, which keeps the tests deterministic. */
  now?: Date;
};

type Candidate = {
  task: PickedTask;
  weight: number;
  /** Copied onto the suggestion row so feedback can be per tag/type. */
  tags: string[];
  estMinutes: number;
};

function itemMinutes(item: ItemRow): number {
  const est = item.est_minutes;
  return typeof est === "number" && est > 0 ? est : DEFAULT_MINUTES;
}

function itemEnergy(item: ItemRow): Energy {
  return item.energy === "low" || item.energy === "high" ? item.energy : "normal";
}

function skippedRecently(item: ItemRow, now: Date): boolean {
  if (!item.last_skipped_at) return false;
  const skippedAt = Date.parse(item.last_skipped_at);
  if (!Number.isFinite(skippedAt)) return false;
  return now.getTime() - skippedAt < SKIP_COOLDOWN_MS;
}

/** Time, energy, the 24 hour skip cooldown and any active revisit date. */
function isEligible(item: ItemRow, request: PickRequest, now: Date): boolean {
  if (!revisitDueAt(item.revisit_at, now)) return false;
  if (itemMinutes(item) > request.minutes) return false;
  if (energyRank(itemEnergy(item)) > energyRank(request.energy)) return false;
  return !skippedRecently(item, now);
}

/**
 * Weight for a goal. Goals further behind carry more weight, so the picker
 * tends to surface the neglected one without ever becoming deterministic:
 *  smart     → 1 + 3 × behind   (a fully behind goal is 4× as likely)
 *  surprise  → 1 + 1 × behind   (a light nudge, still mostly random)
 */
function weightFor(progress: GoalProgress | undefined, mode: PickMode): number {
  if (!progress || progress.perWeek <= 0) return 1;
  const deficit = Math.max(0, progress.perWeek - progress.done);
  const behind = deficit / progress.perWeek;
  return mode === "smart" ? 1 + 3 * behind : 1 + behind;
}

/** One line explaining the pick, e.g. "LeetCode is 0/3 this week". */
function reasonFor(label: string, progress: GoalProgress | undefined): string {
  if (!progress) return `No weekly target for ${label} yet`;
  if (progress.done >= progress.perWeek) {
    return `${label} is already ${progress.done}/${progress.perWeek} this week`;
  }
  return `${label} is ${progress.done}/${progress.perWeek} this week`;
}

/** Picks one candidate with probability proportional to its weight. */
export function pickWeighted<T extends { weight: number }>(
  candidates: readonly T[],
  random: () => number = Math.random,
): T | null {
  if (candidates.length === 0) return null;

  const total = candidates.reduce(
    (sum, candidate) => sum + Math.max(0, candidate.weight),
    0,
  );

  if (total <= 0) {
    const index = Math.min(
      candidates.length - 1,
      Math.floor(random() * candidates.length),
    );
    return candidates[index];
  }

  let threshold = random() * total;
  for (const candidate of candidates) {
    threshold -= Math.max(0, candidate.weight);
    if (threshold < 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

async function loadTodoItems(
  supabase: SupabaseClient,
  userId: string,
): Promise<ItemRow[]> {
  const { data, error } = await supabase
    .from("items")
    .select(
      "id, title, url, type, goal, est_minutes, energy, last_skipped_at, takeaway, revisit_at, tags",
    )
    .eq("user_id", userId)
    .eq("status", "todo")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    throw new Error(`Could not load your items: ${error.message}`);
  }

  return (data ?? []) as ItemRow[];
}

function itemCandidate(
  item: ItemRow,
  progress: WeeklyProgress,
  mode: PickMode,
): Candidate {
  const target = findGoalProgress(progress, item.goal);
  const label = goalLabel(item.goal, target?.label);

  return {
    task: {
      key: taskKey("item", item.id, item.goal),
      suggestionId: null,
      source: "item",
      itemId: item.id,
      title: item.title,
      type: typeof item.type === "string" && item.type ? item.type : "item",
      goal: item.goal,
      goalLabel: label,
      minutes: itemMinutes(item),
      energy: itemEnergy(item),
      url: item.url,
      // Items without a goal have nothing to compare against.
      reason: item.goal ? reasonFor(label, target) : "From your backlog",
      takeaway: item.takeaway ?? null,
    },
    weight: weightFor(target, mode),
    tags: Array.isArray(item.tags) ? item.tags : [],
    estMinutes: itemMinutes(item),
  };
}

function genericCandidate(
  template: GenericTask,
  progress: WeeklyProgress,
  mode: PickMode,
): Candidate {
  const target = findGoalProgress(progress, template.goal);
  const label = goalLabel(template.goal, target?.label);

  return {
    task: {
      key: taskKey("generic", null, template.goal),
      suggestionId: null,
      source: "generic",
      itemId: null,
      title: template.title,
      type: "generic",
      goal: template.goal,
      goalLabel: label,
      minutes: template.minutes,
      energy: template.energy,
      url: null,
      reason: reasonFor(label, target),
    },
    weight: weightFor(target, mode),
    tags: [],
    estMinutes: template.minutes,
  };
}

/** Generic ideas that fit the chosen slot and energy level. */
function genericCandidates(
  progress: WeeklyProgress,
  request: PickRequest,
): Candidate[] {
  return GENERIC_TASKS.filter(
    (template) =>
      template.minutes <= request.minutes &&
      energyRank(template.energy) <= energyRank(request.energy),
  ).map((template) => genericCandidate(template, progress, request.mode));
}

/**
 * The `type` stored on a suggestion. Generic ideas have no item type of their
 * own, so their goal ("leetcode", "walk_run") is the useful label — that is
 * also what completions record as `kind`.
 */
function suggestionType(task: PickedTask): string {
  if (task.source === "generic") return task.goal ?? "generic";
  return task.type;
}

/**
 * Writes the suggestion the user is about to see. The row starts as 'pending'
 * and is updated when the task is done or skipped; pending rows older than 12
 * hours are read as 'ignored', so nothing has to sweep them.
 */
async function logSuggestion(
  context: PickContext,
  request: PickRequest,
  candidate: Candidate,
  now: Date,
): Promise<string> {
  const { task } = candidate;

  const { data, error } = await context.supabase
    .from("suggestions")
    .insert({
      user_id: context.userId,
      item_id: task.itemId,
      title: task.title,
      goal: task.goal,
      type: suggestionType(task),
      tags: candidate.tags,
      shown_at: now.toISOString(),
      time_available: request.minutes,
      energy: request.energy,
      mode: toSuggestionMode(request.mode),
      outcome: "pending",
      meta: {
        key: task.key,
        source: task.source,
        est_minutes: candidate.estMinutes,
        score: Number(candidate.weight.toFixed(3)),
        reason: task.reason,
      },
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not log the suggestion: ${error.message}`);
  }

  return String(data.id);
}

/**
 * Chooses one task for the user.
 *
 * "smart" looks at real backlog items first and prefers the goal that is
 * furthest behind this week; "surprise" mixes items and generic ideas with a
 * light bias towards neglected goals. Both fall back to the generic catalog
 * when the backlog has nothing that fits. Returns null when even the catalog
 * has no task for this time/energy combination.
 *
 * Every task that goes out is logged to `suggestions` first, so the picker can
 * learn from what happens next.
 */
export async function pickTask(
  context: PickContext,
  request: PickRequest,
): Promise<PickedTask | null> {
  const now = context.now ?? new Date();
  const exclude = new Set(request.exclude ?? []);

  const [items, progress] = await Promise.all([
    loadTodoItems(context.supabase, context.userId),
    loadWeeklyProgress(context.supabase, context.userId, now),
  ]);

  const availableItems = items
    .filter((item) => isEligible(item, request, now))
    .map((item) => itemCandidate(item, progress, request.mode))
    .filter((candidate) => !exclude.has(candidate.task.key));

  const availableGeneric = genericCandidates(progress, request).filter(
    (candidate) => !exclude.has(candidate.task.key),
  );

  const chosen =
    request.mode === "surprise"
      ? pickWeighted([...availableItems, ...availableGeneric])
      : pickWeighted(
          availableItems.length > 0 ? availableItems : availableGeneric,
        );

  if (!chosen) return null;

  const suggestionId = await logSuggestion(context, request, chosen, now);
  return { ...chosen.task, suggestionId };
}


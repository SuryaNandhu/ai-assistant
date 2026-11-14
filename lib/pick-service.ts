import type { SupabaseClient } from "@supabase/supabase-js";

import { revisitDueAt } from "@/lib/inbox";
import {
  FEEDBACK_WINDOW_DAYS,
  TIME_GRACE,
  buildPreferences,
  calibrationFactors,
  calibratedMinutes,
  chooseCandidate,
  goalGapWeight,
  scoreSources,
  type CandidateFeatures,
  type FeedbackEvent,
  type Scored,
  type ScoreFactors,
} from "@/lib/picker";
import {
  findGoalProgress,
  loadWeeklyProgress,
  type GoalProgress,
  type WeeklyProgress,
} from "@/lib/progress";
import { effectiveOutcome, toSuggestionMode } from "@/lib/suggestions";
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

const DAY_MS = 24 * 60 * 60 * 1000;

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
  /** Topic tags, which the preference model learns from. */
  tags: string[] | null;
};

type SuggestionRow = {
  type: string | null;
  tags: string[] | null;
  energy: string | null;
  outcome: string;
  liked: boolean | null;
  skip_reason: string | null;
  shown_at: string;
};

type CalibrationRow = {
  type: string | null;
  actual_minutes: number | null;
  meta: { est_minutes?: unknown } | null;
};

/** A candidate task plus everything scoring and logging need. */
type Source = {
  task: PickedTask;
  features: CandidateFeatures;
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

function itemType(item: ItemRow): string {
  return typeof item.type === "string" && item.type ? item.type : "item";
}

function itemTags(item: ItemRow): string[] {
  return Array.isArray(item.tags) ? item.tags : [];
}

function skippedAt(item: ItemRow): Date | null {
  if (!item.last_skipped_at) return null;
  const parsed = Date.parse(item.last_skipped_at);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

/**
 * Time and energy still gate what can be shown, but a soft 50% time grace
 * replaces the old hard cut-off: something a little over the slot is still
 * allowed, just down-weighted by `fit`.
 */
function isEligible(
  item: ItemRow,
  request: PickRequest,
  now: Date,
  minutes: number,
): boolean {
  if (!revisitDueAt(item.revisit_at, now)) return false;
  if (minutes > request.minutes * TIME_GRACE) return false;
  return energyRank(itemEnergy(item)) <= energyRank(request.energy);
}

/** One line explaining the pick, e.g. "LeetCode is 0/3 this week". */
function reasonFor(label: string, progress: GoalProgress | undefined): string {
  if (!progress) return `No weekly target for ${label} yet`;
  if (progress.done >= progress.perWeek) {
    return `${label} is already ${progress.done}/${progress.perWeek} this week`;
  }
  return `${label} is ${progress.done}/${progress.perWeek} this week`;
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

/** The last 60 days of suggestions, already normalised for scoring. */
async function loadFeedback(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
): Promise<FeedbackEvent[]> {
  const since = new Date(
    now.getTime() - FEEDBACK_WINDOW_DAYS * DAY_MS,
  ).toISOString();

  const { data, error } = await supabase
    .from("suggestions")
    .select("type, tags, energy, outcome, liked, skip_reason, shown_at")
    .eq("user_id", userId)
    .gte("shown_at", since)
    .order("shown_at", { ascending: false })
    .limit(300);

  if (error) {
    throw new Error(`Could not load your suggestion history: ${error.message}`);
  }

  return ((data ?? []) as SuggestionRow[]).map((row) => ({
    type: row.type,
    tags: row.tags,
    energy: row.energy,
    outcome: effectiveOutcome(row, now),
    liked: row.liked,
    skipReason: row.skip_reason,
    shownAt: new Date(row.shown_at),
  }));
}

/** Per-type "how long did it really take" factors from finished suggestions. */
async function loadCalibration(
  supabase: SupabaseClient,
  userId: string,
): Promise<ReadonlyMap<string, number>> {
  const { data, error } = await supabase
    .from("suggestions")
    .select("type, actual_minutes, meta")
    .eq("user_id", userId)
    .eq("outcome", "done")
    .not("actual_minutes", "is", null)
    .order("shown_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(
      `Could not load your completed suggestions: ${error.message}`,
    );
  }

  return calibrationFactors(
    ((data ?? []) as CalibrationRow[]).map((row) => ({
      type: row.type,
      actualMinutes:
        typeof row.actual_minutes === "number" ? row.actual_minutes : null,
      estMinutes:
        typeof row.meta?.est_minutes === "number" ? row.meta.est_minutes : null,
    })),
  );
}


function itemSource(
  item: ItemRow,
  progress: WeeklyProgress,
  request: PickRequest,
  calibration: ReadonlyMap<string, number>,
): Source {
  const target = findGoalProgress(progress, item.goal);
  const label = goalLabel(item.goal, target?.label);
  const type = itemType(item);
  const tags = itemTags(item);
  const est = itemMinutes(item);
  const minutes = calibratedMinutes(est, type, calibration);
  const energy = itemEnergy(item);

  return {
    task: {
      key: taskKey("item", item.id, item.goal),
      suggestionId: null,
      source: "item",
      itemId: item.id,
      title: item.title,
      type,
      goal: item.goal,
      goalLabel: label,
      minutes,
      energy,
      url: item.url,
      // Items without a goal have nothing to compare against.
      reason: item.goal ? reasonFor(label, target) : "From your backlog",
      takeaway: item.takeaway ?? null,
    },
    tags,
    estMinutes: est,
    features: {
      type,
      tags,
      energy,
      minutes,
      availableMinutes: request.minutes,
      lastSkippedAt: skippedAt(item),
      goalWeight: target
        ? goalGapWeight(target.perWeek, target.done, request.mode)
        : 1,
    },
  };
}

function genericSource(
  template: GenericTask,
  progress: WeeklyProgress,
  request: PickRequest,
  calibration: ReadonlyMap<string, number>,
): Source {
  const target = findGoalProgress(progress, template.goal);
  const label = goalLabel(template.goal, target?.label);
  const minutes = calibratedMinutes(template.minutes, template.goal, calibration);

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
      minutes,
      energy: template.energy,
      url: null,
      reason: reasonFor(label, target),
    },
    tags: [],
    estMinutes: template.minutes,
    features: {
      // A generic idea is its own activity, so the goal is its learning key.
      type: template.goal,
      tags: [],
      energy: template.energy,
      minutes,
      availableMinutes: request.minutes,
      lastSkippedAt: null,
      goalWeight: target
        ? goalGapWeight(target.perWeek, target.done, request.mode)
        : 1,
    },
  };
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
  source: Source,
  scored: Scored<Source>,
  now: Date,
): Promise<string> {
  const { task } = source;

  const { data, error } = await context.supabase
    .from("suggestions")
    .insert({
      user_id: context.userId,
      item_id: task.itemId,
      title: task.title,
      goal: task.goal,
      type: suggestionType(task),
      tags: source.tags,
      shown_at: now.toISOString(),
      time_available: request.minutes,
      energy: request.energy,
      mode: toSuggestionMode(request.mode),
      outcome: "pending",
      meta: {
        key: task.key,
        source: task.source,
        est_minutes: source.estMinutes,
        calibrated_minutes: task.minutes,
        score: Number(scored.score.toFixed(3)),
        factors: roundFactors(scored.factors),
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

function roundFactors(factors: ScoreFactors): Record<string, number> {
  return {
    goal: Number(factors.goal.toFixed(3)),
    preference: Number(factors.preference.toFixed(3)),
    fit: Number(factors.fit.toFixed(3)),
    skip: Number(factors.skip.toFixed(3)),
  };
}


/**
 * Chooses one task for the user and logs it.
 *
 * "smart" looks at real backlog items first and prefers the goal that is
 * furthest behind this week; "surprise" mixes items and generic ideas. Both
 * fall back to the generic catalog when the backlog has nothing that fits and
 * return null when even the catalog has no task for this time/energy slot.
 *
 * The scoring itself lives in `lib/picker.ts`; this function only gathers the
 * inputs (items, weekly progress, feedback history, calibration) and records
 * what was shown.
 */
export async function pickTask(
  context: PickContext,
  request: PickRequest,
): Promise<PickedTask | null> {
  const now = context.now ?? new Date();
  const exclude = new Set(request.exclude ?? []);

  const [items, progress, feedback, calibration] = await Promise.all([
    loadTodoItems(context.supabase, context.userId),
    loadWeeklyProgress(context.supabase, context.userId, now),
    loadFeedback(context.supabase, context.userId, now),
    loadCalibration(context.supabase, context.userId),
  ]);

  const preferences = buildPreferences(feedback, now);

  const itemSources = items
    .map((item) => ({
      item,
      minutes: calibratedMinutes(itemMinutes(item), itemType(item), calibration),
    }))
    .filter(({ item, minutes }) => isEligible(item, request, now, minutes))
    .map(({ item }) => itemSource(item, progress, request, calibration))
    .filter((source) => !exclude.has(source.task.key));

  const genericSources = GENERIC_TASKS.filter(
    (template) =>
      template.minutes <= request.minutes &&
      energyRank(template.energy) <= energyRank(request.energy),
  )
    .map((template) => genericSource(template, progress, request, calibration))
    .filter((source) => !exclude.has(source.task.key));

  const pool =
    request.mode === "surprise"
      ? [...itemSources, ...genericSources]
      : itemSources.length > 0
        ? itemSources
        : genericSources;

  const chosen = chooseCandidate(
    scoreSources(pool, { now, preferences }),
    request.mode,
  );

  if (!chosen) return null;

  const suggestionId = await logSuggestion(
    context,
    request,
    chosen.candidate,
    chosen,
    now,
  );

  return { ...chosen.candidate.task, suggestionId };
}


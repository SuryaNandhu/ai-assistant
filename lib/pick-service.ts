import type { SupabaseClient } from "@supabase/supabase-js";

import { revisitDueAt } from "@/lib/inbox";
import {
  FEEDBACK_WINDOW_DAYS,
  OTHER_GOAL,
  TIME_GRACE,
  buildPreferences,
  calibrationFactors,
  calibratedMinutes,
  chooseGoal,
  chooseInGoal,
  chooseUniform,
  goalGapWeight,
  scoreSources,
  type CandidateFeatures,
  type FeedbackEvent,
  type GoalChoice,
  type Scored,
  type ScoreFactors,
} from "@/lib/picker";
import {
  findGoalProgress,
  loadWeeklyProgress,
  periodLabel,
  targetSatisfied,
  type GoalProgress,
  type WeeklyProgress,
} from "@/lib/progress";
import { remainingQuantity } from "@/lib/quick-log";
import { effectiveOutcome, toSuggestionMode } from "@/lib/suggestions";
import {
  DEFAULT_MINUTES,
  energyRank,
  genericTaskFor,
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
  /** The goal bucket this candidate belongs to; `OTHER_GOAL` for untargeted. */
  bucket: string;
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
 * allowed, just down-weighted by `fit`. `energy` is the level being tried, so
 * the caller can retry one step up when a slot comes back empty.
 */
function isEligible(
  item: ItemRow,
  request: PickRequest,
  now: Date,
  minutes: number,
  energy: Energy,
): boolean {
  if (!revisitDueAt(item.revisit_at, now)) return false;
  if (minutes > request.minutes * TIME_GRACE) return false;
  return energyRank(itemEnergy(item)) <= energyRank(energy);
}

/**
 * Which goal bucket an item belongs to. An item whose goal has no suggestable
 * target (no goal, walk/run, a paused goal, an older key) joins "other" so it
 * can still be picked without pretending it is part of the plan.
 */
function itemBucket(
  goal: string | null,
  suggestableGoals: ReadonlySet<string>,
): string {
  return goal && suggestableGoals.has(goal) ? goal : OTHER_GOAL;
}

/** One step up (low → normal → high); null at the top. */
function nextEnergy(energy: Energy): Energy | null {
  if (energy === "low") return "normal";
  if (energy === "normal") return "high";
  return null;
}

/** One line explaining the pick, e.g. "LeetCode is 0/3 this week". */
function reasonFor(label: string, progress: GoalProgress | undefined): string {
  if (!progress) return `No target for ${label} yet`;

  const period = periodLabel(progress.period);
  const total = `${progress.done}/${progress.perWeek} ${period}`;

  if (progress.done >= progress.perWeek) {
    return `${label} is already ${total}`;
  }

  // A daily-minimum target counts search days, so say how today is going too.
  const today =
    progress.minQuantity !== null
      ? ` · ${progress.todayQuantity}/${progress.minQuantity} today`
      : "";

  return `${label} is ${total}${today}`;
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
  suggestableGoals: ReadonlySet<string>,
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
      minQuantity: target?.minQuantity ?? null,
      quantityRemaining: target ? remainingQuantity(target) : null,
      takeaway: item.takeaway ?? null,
    },
    tags,
    estMinutes: est,
    bucket: itemBucket(item.goal, suggestableGoals),
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
  target: GoalProgress,
  request: PickRequest,
  calibration: ReadonlyMap<string, number>,
): Source {
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
      goalLabel: target.label,
      minutes,
      timeless: template.timeless === true,
      energy: template.energy,
      url: null,
      // Say where the idea came from; the goal line alone reads like a saved
      // article and hides that the picker can suggest built-in tasks.
      reason: `Built-in idea · ${reasonFor(target.label, target)}`,
      minQuantity: target.minQuantity,
      quantityRemaining: remainingQuantity(target),
    },
    tags: [],
    estMinutes: template.minutes,
    bucket: template.goal,
    features: {
      // A generic idea is its own activity, so the goal is its learning key.
      type: template.goal,
      tags: [],
      energy: template.energy,
      // A timeless idea fits every slot, so time never counts against it.
      minutes: template.timeless ? request.minutes : minutes,
      availableMinutes: request.minutes,
      lastSkippedAt: null,
      goalWeight: goalGapWeight(target.perWeek, target.done, request.mode),
    },
  };
}

/**
 * The built-in idea for one goal, if it fits the slot and the energy being
 * tried. Custom goals get a synthesized "work on it" idea from `genericTaskFor`.
 */
function genericSourceFor(
  target: GoalProgress,
  request: PickRequest,
  energy: Energy,
  calibration: ReadonlyMap<string, number>,
): Source | null {
  const template = genericTaskFor(target.goal, {
    label: target.label,
    minutes: target.estMinutes,
    energy: target.energy,
  });

  if (!template.timeless && template.minutes > request.minutes) return null;
  if (energyRank(template.energy) > energyRank(energy)) return null;

  return genericSource(template, target, request, calibration);
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
  /** True when the slot was empty at the requested energy and one step up won. */
  relaxed: boolean,
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
        bucket: source.bucket,
        relaxed_energy: relaxed,
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
 * "smart" picks a goal first, weighted by how far behind it is this week, with
 * a 15% side door for backlog items no target covers; inside that goal it
 * offers the built-in idea about a third of the time and otherwise the best
 * saved link. "surprise" ignores the plan and draws uniformly from everything
 * eligible. If nothing fits the requested energy, one step up is tried once and
 * the reason says so; null means even that came back empty.
 *
 * The selection and scoring live in `lib/picker.ts`; this function only gathers
 * the inputs (items, targets, feedback history, calibration) and records what
 * was shown.
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
  const scoreContext = { now, preferences };

  // Only goals the user can still be nudged toward get a bucket. walk/run stays
  // out of the picker's plan but its saved items remain pickable via "other".
  // A goal that is already met — 3/3 this week, this month's resume update, or
  // today's 3 applications — is done, so it is not suggested again.
  const goalTargets = progress.goals.filter(
    (target) => target.suggestable && !targetSatisfied(target),
  );
  const suggestableGoals = new Set(goalTargets.map((target) => target.goal));

  const relaxedEnergy = nextEnergy(request.energy);
  const energies: Energy[] = relaxedEnergy
    ? [request.energy, relaxedEnergy]
    : [request.energy];

  for (const [index, energy] of energies.entries()) {
    const relaxed = index > 0;

    const itemSources = items
      .map((item) => ({
        item,
        minutes: calibratedMinutes(
          itemMinutes(item),
          itemType(item),
          calibration,
        ),
      }))
      .filter(({ item, minutes }) =>
        isEligible(item, request, now, minutes, energy),
      )
      .map(({ item }) =>
        itemSource(item, progress, request, calibration, suggestableGoals),
      )
      .filter((source) => !exclude.has(source.task.key));

    // A target's own time and energy win over the catalog default (job search:
    // 45 minutes, LeetCode: normal). The slot still has the final say.
    const genericSources = goalTargets
      .map((target) => genericSourceFor(target, request, energy, calibration))
      .filter((source): source is Source => source !== null)
      .filter((source) => !exclude.has(source.task.key));

    const available = [...itemSources, ...genericSources];
    if (available.length === 0) continue;

    let chosen: Scored<Source> | null = null;

    if (request.mode === "surprise") {
      const picked = chooseUniform(available);
      chosen = picked ? scoreSources([picked], scoreContext)[0] : null;
    } else {
      const buckets = new Map<string, Source[]>();
      for (const source of available) {
        const list = buckets.get(source.bucket) ?? [];
        list.push(source);
        buckets.set(source.bucket, list);
      }

      // Goals with nothing in this slot drop out, so their weight is not spent
      // on an empty bucket.
      const choices: GoalChoice[] = goalTargets
        .filter((target) => (buckets.get(target.goal)?.length ?? 0) > 0)
        .map((target) => ({
          goal: target.goal,
          weight: goalGapWeight(target.perWeek, target.done, "smart"),
        }));

      const bucket = chooseGoal(
        choices,
        (buckets.get(OTHER_GOAL)?.length ?? 0) > 0,
      );
      const sources = bucket ? (buckets.get(bucket) ?? []) : [];

      const generic = sources.find(
        (source) => source.task.source === "generic",
      );
      const goalItems = sources.filter(
        (source) => source.task.source === "item",
      );

      chosen = chooseInGoal(
        scoreSources(goalItems, scoreContext),
        generic ? scoreSources([generic], scoreContext)[0] : null,
      );
    }

    if (!chosen) continue;

    const suggestionId = await logSuggestion(
      context,
      request,
      chosen.candidate,
      chosen,
      now,
      relaxed,
    );

    const reason = relaxed
      ? `${chosen.candidate.task.reason} · a step up in energy`
      : chosen.candidate.task.reason;

    return { ...chosen.candidate.task, reason, suggestionId };
  }

  return null;
}


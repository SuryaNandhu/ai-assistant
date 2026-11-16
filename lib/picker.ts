/**
 * Pure scoring for the "What now?" picker.
 *
 * Nothing here reads the clock or touches Supabase: the service layer gathers
 * the numbers and this file turns them into a weight, which keeps the
 * behaviour predictable and easy to check by hand.
 *
 *   score = goal gap × preference × fit × skip penalty
 *
 * The pick itself is goal-first: smart picks a goal (weighted by how far behind
 * it is, with a 15% side door for untargeted backlog), then chooses within that
 * goal between the built-in idea and the saved links. Surprise skips the goal
 * step and draws uniformly from everything eligible.
 *
 * - goal gap:   a weekly target that is behind pulls harder (as before).
 * - preference: smoothed per-tag and per-type history of done / liked /
 *               skipped-as-not-interested.
 * - fit:        calibrated time against the slot the user picked, plus a soft
 *               penalty for types skipped as "too long" and energy levels
 *               skipped as "too hard".
 * - skip:       a task skipped moments ago is pushed right down for a while.
 *
 * Both pick buttons reserve part of their rolls for a uniform random pick, so
 * the app keeps exploring instead of locking onto one topic.
 */

import type { PickMode } from "./task";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Preferences only look at the recent past; tastes change. */
export const FEEDBACK_WINDOW_DAYS = 60;

/** How many finished suggestions feed the per-type time calibration. */
export const CALIBRATION_SAMPLE = 20;
export const CALIBRATION_MIN = 0.5;
export const CALIBRATION_MAX = 2;

/** Laplace smoothing: a small prior so one event never decides anything. */
export const PREFERENCE_PRIOR = 2;
export const PREFERENCE_MIN = 0.5;
export const PREFERENCE_MAX = 1.5;

/** A type × tag preference is clamped a little wider than a single key. */
export const COMBINED_PREFERENCE_MIN = 0.4;
export const COMBINED_PREFERENCE_MAX = 1.75;

/** Share of picks taken uniformly at random from everything eligible. */
export const EXPLORATION_RATE: Record<PickMode, number> = {
  smart: 0.15,
  surprise: 0.3,
};

/** Items up to 50% over the slot are still shown, but down-weighted. */
export const TIME_GRACE = 1.5;

export const SKIP_FRESH_MS = DAY_MS;
export const SKIP_RECENT_MS = 3 * DAY_MS;
export const SKIP_FRESH_FACTOR = 0.15;
export const SKIP_RECENT_FACTOR = 0.45;

/** "Too long" / "too hard" skips: 12% per event, capped at 3 events. */
export const REASON_PENALTY_STEP = 0.12;
export const REASON_PENALTY_FLOOR = 0.7;
export const REASON_PENALTY_CAP = 3;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Weight for a goal. Goals further behind carry more weight, so the picker
 * tends to surface the neglected one without ever becoming deterministic:
 *  smart     → 1 + 3 × behind   (a fully behind goal is 4× as likely)
 *  surprise  → 1 + 1 × behind   (a light nudge, still mostly random)
 */
export function goalGapWeight(
  perWeek: number,
  done: number,
  mode: PickMode,
): number {
  if (!Number.isFinite(perWeek) || perWeek <= 0) return 1;
  const behind = Math.max(0, perWeek - done) / perWeek;
  return mode === "smart" ? 1 + 3 * behind : 1 + behind;
}

/**
 * The pseudo-goal that holds backlog items no active target covers (links with
 * no goal, paused goals, walk/run). It is a goal-shaped bucket only, never a
 * real target.
 */
export const OTHER_GOAL = "other";

/** Share of smart picks handed to that bucket, so untargeted links still show. */
export const OTHER_SHARE = 0.15;

/**
 * Share of in-goal picks given to the built-in idea rather than a saved link.
 * Without this the picker quietly turns back into "newest article wins".
 */
export const GENERIC_SHARE = 0.35;

export type GoalChoice = {
  goal: string;
  /** Higher means more likely; use `goalGapWeight` for targets. */
  weight: number;
};

/**
 * Chooses the goal for one smart pick. The pseudo-goal "other" takes 15% of
 * picks; the rest is shared out by how far behind each goal is. `null` means
 * neither a goal nor the other bucket has anything to offer.
 */
export function chooseGoal(
  goals: readonly GoalChoice[],
  hasOther: boolean,
  random: () => number = Math.random,
): string | null {
  const weighted = goals.filter(
    (entry) => Number.isFinite(entry.weight) && entry.weight > 0,
  );

  if (weighted.length === 0) return hasOther ? OTHER_GOAL : null;
  if (hasOther && random() < OTHER_SHARE) return OTHER_GOAL;

  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = random() * total;

  for (const entry of weighted) {
    threshold -= entry.weight;
    if (threshold < 0) return entry.goal;
  }

  return weighted[weighted.length - 1].goal;
}

/**
 * Chooses inside one goal. The built-in idea is offered about a third of the
 * time, so a big backlog cannot bury it; otherwise the scored links decide.
 */
export function chooseInGoal<T>(
  scored: readonly Scored<T>[],
  generic: Scored<T> | null,
  random: () => number = Math.random,
): Scored<T> | null {
  if (scored.length === 0) return generic;
  if (generic && random() < GENERIC_SHARE) return generic;
  return chooseCandidate(scored, "smart", random);
}

/** One uniform pick from everything eligible — what "surprise" means. */
export function chooseUniform<T>(
  entries: readonly T[],
  random: () => number = Math.random,
): T | null {
  if (entries.length === 0) return null;
  const index = Math.min(
    entries.length - 1,
    Math.floor(random() * entries.length),
  );
  return entries[index];
}


/** One past suggestion, reduced to what scoring needs. */
export type FeedbackEvent = {
  /** The suggestion's activity: `items.type`, or the goal for a generic idea. */
  type: string | null;
  tags: readonly string[] | null;
  energy: string | null;
  /** Already normalised through `effectiveOutcome` (pending can be ignored). */
  outcome: string;
  liked: boolean | null;
  skipReason: string | null;
  shownAt: Date;
};

export type PreferenceStats = {
  byType: ReadonlyMap<string, number>;
  byTag: ReadonlyMap<string, number>;
  tooLongByType: ReadonlyMap<string, number>;
  tooHardByEnergy: ReadonlyMap<string, number>;
};

type Totals = { sum: number; count: number };

function bump(totals: Map<string, Totals>, key: string, amount: number): void {
  const current = totals.get(key) ?? { sum: 0, count: 0 };
  current.sum += amount;
  current.count += 1;
  totals.set(key, current);
}

function bumpCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * What one suggestion says about the topic: finishing it is good, a thumbs up
 * is a smaller good, a thumbs down or "not interested" is bad.
 */
export function feedbackWeight(event: FeedbackEvent): number {
  let weight = 0;
  if (event.outcome === "done") weight += 1;
  if (event.liked === true) weight += 0.5;
  if (event.liked === false) weight -= 1;
  if (event.outcome === "skipped" && event.skipReason === "not_interested") {
    weight -= 1;
  }
  return weight;
}

function smoothed(totals: Map<string, Totals>): Map<string, number> {
  const result = new Map<string, number>();
  for (const [key, { sum, count }] of totals) {
    const value = 1 + sum / (count + PREFERENCE_PRIOR);
    result.set(key, clamp(value, PREFERENCE_MIN, PREFERENCE_MAX));
  }
  return result;
}

/** Turns the last 60 days of suggestions into multipliers around 1. */
export function buildPreferences(
  events: readonly FeedbackEvent[],
  now: Date,
): PreferenceStats {
  const since = now.getTime() - FEEDBACK_WINDOW_DAYS * DAY_MS;
  const byType = new Map<string, Totals>();
  const byTag = new Map<string, Totals>();
  const tooLongByType = new Map<string, number>();
  const tooHardByEnergy = new Map<string, number>();

  for (const event of events) {
    if (event.shownAt.getTime() < since) continue;

    const weight = feedbackWeight(event);
    if (weight !== 0 && event.type) bump(byType, event.type, weight);
    if (weight !== 0) {
      for (const tag of event.tags ?? []) bump(byTag, tag, weight);
    }

    if (event.outcome !== "skipped") continue;
    if (event.skipReason === "too_long" && event.type) {
      bumpCount(tooLongByType, event.type);
    }
    if (event.skipReason === "too_hard" && event.energy) {
      bumpCount(tooHardByEnergy, event.energy);
    }
  }

  return {
    byType: smoothed(byType),
    byTag: smoothed(byTag),
    tooLongByType,
    tooHardByEnergy,
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type CalibrationInput = {
  type: string | null;
  actualMinutes: number | null;
  estMinutes: number | null;
};

/**
 * Per type, how long things really take versus the estimate. Feed in the last
 * 20 finished suggestions per type, newest first; the median keeps one
 * distracted afternoon from moving the number.
 */
export function calibrationFactors(
  rows: readonly CalibrationInput[],
): ReadonlyMap<string, number> {
  const ratios = new Map<string, number[]>();

  for (const row of rows) {
    if (!row.type) continue;
    const { actualMinutes, estMinutes } = row;
    if (typeof actualMinutes !== "number" || actualMinutes <= 0) continue;
    if (typeof estMinutes !== "number" || estMinutes <= 0) continue;

    const list = ratios.get(row.type) ?? [];
    if (list.length >= CALIBRATION_SAMPLE) continue;
    list.push(actualMinutes / estMinutes);
    ratios.set(row.type, list);
  }

  const factors = new Map<string, number>();
  for (const [type, values] of ratios) {
    factors.set(type, clamp(median(values), CALIBRATION_MIN, CALIBRATION_MAX));
  }
  return factors;
}

/** Applies the learned factor to a raw estimate, so the card shows reality. */
export function calibratedMinutes(
  estMinutes: number,
  type: string,
  calibration: ReadonlyMap<string, number>,
): number {
  const factor = calibration.get(type) ?? 1;
  return Math.max(5, Math.round(estMinutes * factor));
}

/** Everything scoring needs to know about one candidate task. */
export type CandidateFeatures = {
  /** Learning key: `items.type`, or the goal for a generic idea. */
  type: string;
  tags: readonly string[];
  energy: string;
  /** Calibrated estimate in minutes. */
  minutes: number;
  availableMinutes: number;
  lastSkippedAt: Date | null;
  /** Weekly goal gap, already weighted for the mode. */
  goalWeight: number;
};

export type ScoreContext = {
  now: Date;
  preferences: PreferenceStats;
};

export type ScoreFactors = {
  goal: number;
  preference: number;
  fit: number;
  skip: number;
};

export function preferenceFor(
  features: CandidateFeatures,
  preferences: PreferenceStats,
): number {
  const typePreference = preferences.byType.get(features.type) ?? 1;

  if (features.tags.length === 0) {
    return clamp(typePreference, PREFERENCE_MIN, PREFERENCE_MAX);
  }

  let tagTotal = 0;
  for (const tag of features.tags) tagTotal += preferences.byTag.get(tag) ?? 1;
  const tagPreference = tagTotal / features.tags.length;

  return clamp(
    typePreference * tagPreference,
    COMBINED_PREFERENCE_MIN,
    COMBINED_PREFERENCE_MAX,
  );
}

/** 1 when it fits the slot, falling away as the calibrated time overruns it. */
export function timeFit(minutes: number, availableMinutes: number): number {
  if (availableMinutes <= 0) return 0.5;
  if (minutes <= availableMinutes) return 1;
  const overrun = minutes / availableMinutes - 1;
  return Math.max(0.4, 1 - 0.6 * overrun);
}

function reasonPenalty(count: number): number {
  return Math.max(
    REASON_PENALTY_FLOOR,
    1 - REASON_PENALTY_STEP * Math.min(count, REASON_PENALTY_CAP),
  );
}

export function fitFor(
  features: CandidateFeatures,
  preferences: PreferenceStats,
): number {
  const time = timeFit(features.minutes, features.availableMinutes);
  const tooLong = reasonPenalty(
    preferences.tooLongByType.get(features.type) ?? 0,
  );
  const tooHard = reasonPenalty(
    preferences.tooHardByEnergy.get(features.energy) ?? 0,
  );
  return time * tooLong * tooHard;
}

/** A freshly skipped task drops out of sight for a day, then creeps back. */
export function skipPenalty(lastSkippedAt: Date | null, now: Date): number {
  if (!lastSkippedAt) return 1;

  const age = now.getTime() - lastSkippedAt.getTime();
  if (!Number.isFinite(age) || age < 0) return SKIP_FRESH_FACTOR;
  if (age < SKIP_FRESH_MS) return SKIP_FRESH_FACTOR;
  if (age < SKIP_RECENT_MS) return SKIP_RECENT_FACTOR;
  return 1;
}

export function scoreCandidate(
  features: CandidateFeatures,
  context: ScoreContext,
): { score: number; factors: ScoreFactors } {
  const factors: ScoreFactors = {
    goal: features.goalWeight,
    preference: preferenceFor(features, context.preferences),
    fit: fitFor(features, context.preferences),
    skip: skipPenalty(features.lastSkippedAt, context.now),
  };

  return {
    score: Math.max(0, factors.goal * factors.preference * factors.fit * factors.skip),
    factors,
  };
}

export type Scored<T> = {
  candidate: T;
  features: CandidateFeatures;
  score: number;
  factors: ScoreFactors;
};

export function scoreSources<T extends { features: CandidateFeatures }>(
  sources: readonly T[],
  context: ScoreContext,
): Scored<T>[] {
  return sources.map((source) => {
    const { score, factors } = scoreCandidate(source.features, context);
    return { candidate: source, features: source.features, score, factors };
  });
}

/**
 * Rolls the dice: sometimes a uniform random pick, otherwise a weighted one.
 * The random pick is what stops a strong preference from closing off the rest
 * of the backlog.
 */
export function chooseCandidate<T>(
  scored: readonly Scored<T>[],
  mode: PickMode,
  random: () => number = Math.random,
): Scored<T> | null {
  if (scored.length === 0) return null;
  if (scored.length === 1) return scored[0];

  if (random() < EXPLORATION_RATE[mode]) {
    const index = Math.min(
      scored.length - 1,
      Math.floor(random() * scored.length),
    );
    return scored[index];
  }

  const total = scored.reduce((sum, entry) => sum + entry.score, 0);

  if (total <= 0) {
    const index = Math.min(
      scored.length - 1,
      Math.floor(random() * scored.length),
    );
    return scored[index];
  }

  let threshold = random() * total;
  for (const entry of scored) {
    threshold -= entry.score;
    if (threshold < 0) return entry;
  }
  return scored[scored.length - 1];
}


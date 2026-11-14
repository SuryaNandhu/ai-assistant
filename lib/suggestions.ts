/**
 * Suggestion vocabulary shared by the picker, the server actions and the
 * client card. Pure constants and mappers — safe to import anywhere.
 */

import type { Felt, PickMode } from "@/lib/task";

/** Stored in `suggestions.mode` — the pick button the user pressed. */
export type SuggestionMode = "what_now" | "surprise";

export type SuggestionOutcome = "pending" | "done" | "skipped" | "ignored";

export type SkipReason = "not_now" | "too_long" | "not_interested" | "too_hard";

/** Stored in `suggestions.felt`; completions call "right" `ok` instead. */
export type SuggestionFelt = "easy" | "right" | "hard";

export const SKIP_REASONS: readonly { value: SkipReason; label: string }[] = [
  { value: "not_now", label: "Not now" },
  { value: "too_long", label: "Too long" },
  { value: "not_interested", label: "Not interested" },
  { value: "too_hard", label: "Too hard" },
];

export const SKIP_REASON_VALUES = [
  "not_now",
  "too_long",
  "not_interested",
  "too_hard",
] as const satisfies readonly SkipReason[];

/** A pending suggestion older than this is read as 'ignored'. */
export const PENDING_TTL_MS = 12 * 60 * 60 * 1000;

export function toSuggestionMode(mode: PickMode): SuggestionMode {
  return mode === "surprise" ? "surprise" : "what_now";
}

/** `completions.felt` → `suggestions.felt` ("ok" is the same as "right"). */
export function toSuggestionFelt(felt: Felt): SuggestionFelt {
  if (felt === "easy") return "easy";
  if (felt === "hard") return "hard";
  return "right";
}

/**
 * Pending suggestions go stale after 12 hours, so a pick the user walked away
 * from never counts as "still open" when the stats are read. No cron needed.
 */
export function effectiveOutcome(
  row: { outcome: string; shown_at: string | Date },
  now: Date,
): SuggestionOutcome {
  if (row.outcome !== "pending") {
    return row.outcome as SuggestionOutcome;
  }

  const shownAt =
    typeof row.shown_at === "string"
      ? Date.parse(row.shown_at)
      : row.shown_at.getTime();

  if (!Number.isFinite(shownAt)) return "ignored";
  return now.getTime() - shownAt > PENDING_TTL_MS ? "ignored" : "pending";
}

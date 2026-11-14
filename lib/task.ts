/**
 * Task shapes and constants shared by the server-side picker and the client
 * card. Nothing here touches Supabase or `next/headers`, so client components
 * can import it directly.
 */

export type Energy = "low" | "normal" | "high";

export const ENERGY_LEVELS: readonly Energy[] = ["low", "normal", "high"];

export const ENERGY_LABELS: Record<Energy, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

const ENERGY_RANK: Record<Energy, number> = { low: 1, normal: 2, high: 3 };

/** Orders energy so that "less than or equal to what I have" is a comparison. */
export function energyRank(energy: Energy): number {
  return ENERGY_RANK[energy];
}

export function isEnergy(value: unknown): value is Energy {
  return typeof value === "string" && value in ENERGY_RANK;
}

export type TimeOption = 15 | 30 | 60;

export const TIME_OPTIONS: readonly TimeOption[] = [15, 30, 60];

export const DEFAULT_MINUTES: TimeOption = 30;
export const DEFAULT_ENERGY: Energy = "normal";

/** How a task was chosen: the goal-aware pick or a plain surprise. */
export type PickMode = "smart" | "surprise";

export const GOAL_LABELS: Record<string, string> = {
  leetcode: "LeetCode",
  ai_learning: "AI learning",
  bi: "Tableau / Power BI",
  job_search: "Job search",
  walk_run: "5 km walk/run",
};

/**
 * Human label for a goal. Prefers the user's own target label, then the known
 * defaults, then a prettified version of the raw key ("mock_tests" → "Mock
 * tests") so unknown goals still render sensibly.
 */
export function goalLabel(goal: string | null, label?: string | null): string {
  const custom = label?.trim();
  if (custom) return custom;
  if (!goal) return "No goal";

  const known = GOAL_LABELS[goal];
  if (known) return known;

  const pretty = goal.replace(/[_-]+/g, " ").trim();
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

export type GenericTask = {
  goal: string;
  title: string;
  minutes: number;
  energy: Energy;
};

/**
 * Fallback ideas per goal for when the backlog has nothing that fits. Kept in
 * one place so the picker and the completion action agree on what "Study the
 * next topic on your AI roadmap" means.
 */
export const GENERIC_TASKS: readonly GenericTask[] = [
  {
    goal: "leetcode",
    title: "Solve one LeetCode problem (easy or medium)",
    minutes: 30,
    energy: "high",
  },
  {
    goal: "ai_learning",
    title: "Study the next topic on your AI roadmap",
    minutes: 25,
    energy: "normal",
  },
  {
    goal: "bi",
    title: "Tableau/Power BI practice: rebuild a small dashboard",
    minutes: 30,
    energy: "normal",
  },
  {
    goal: "job_search",
    title: "Apply to 2 jobs or message 1 person",
    minutes: 20,
    energy: "normal",
  },
  {
    goal: "walk_run",
    title: "5 km walk or run",
    minutes: 60,
    energy: "normal",
  },
];

export function findGenericTask(goal: string | null): GenericTask | undefined {
  if (!goal) return undefined;
  return GENERIC_TASKS.find((task) => task.goal === goal);
}

export type TaskSource = "item" | "generic";

export type PickedTask = {
  /** Stable identity used to exclude a task from the next pick. */
  key: string;
  /** The `suggestions` row logged when this task was picked. */
  suggestionId: string | null;
  source: TaskSource;
  /** Set only for real backlog items. */
  itemId: string | null;
  title: string;
  /** Raw `items.type` for backlog items; "generic" for catalog suggestions. */
  type: string;
  goal: string | null;
  goalLabel: string;
  minutes: number;
  energy: Energy;
  url: string | null;
  /** One short line explaining why this task surfaced. */
  reason: string;
  /** Existing one-line takeaway, when the item was read before. */
  takeaway?: string | null;
};

export function taskKey(
  source: TaskSource,
  itemId: string | null,
  goal: string | null,
): string {
  return source === "item" && itemId ? `item:${itemId}` : `generic:${goal ?? ""}`;
}

/** How a completion felt, stored in `completions.felt`. */
export type Felt = "easy" | "ok" | "hard";

export const FELT_OPTIONS: readonly { value: Felt; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "ok", label: "Right" },
  { value: "hard", label: "Hard" },
];

/** The only goal that records a distance, and its default when logging. */
export const DISTANCE_GOAL = "walk_run";
export const DEFAULT_DISTANCE_KM = 5;

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MONTH_NAMES,
  firstDayKey,
  type MonthRef,
} from "@/lib/calendar";

/**
 * The monthly project: one row per user per month in `projects`, a short
 * milestone checklist, and an update log. Pure constants and formatters here,
 * plus the one loader the page, Home and the chat tools share.
 */

export const PROJECT_STATUSES = [
  "planned",
  "in_progress",
  "shipped",
  "dropped",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  dropped: "Dropped",
};

export const PROJECT_TITLE_MAX = 120;
export const PROJECT_GOAL_MAX = 200;
export const PROJECT_DESCRIPTION_MAX = 2000;
export const PROJECT_REPO_MAX = 400;
export const MILESTONE_TITLE_MAX = 160;
export const PROJECT_UPDATE_MAX = 280;

/** How many updates the project page and the chat tool read. */
export const PROJECT_UPDATE_LIMIT = 30;

export type Project = {
  id: string;
  /** First day of the month, `YYYY-MM-DD`. */
  month: string;
  title: string;
  goal: string | null;
  description: string | null;
  repoUrl: string | null;
  status: ProjectStatus;
  resumeDraft: string | null;
  resumeDraftedAt: string | null;
  shippedAt: string | null;
};

export type ProjectMilestone = {
  id: string;
  title: string;
  done: boolean;
  position: number;
};

export type ProjectUpdate = {
  id: string;
  note: string;
  createdAt: string;
};

export type ProjectDetail = {
  project: Project;
  milestones: ProjectMilestone[];
  updates: ProjectUpdate[];
};

export const PROJECT_COLUMNS =
  "id, month, title, goal, description, repo_url, status, resume_draft, resume_drafted_at, shipped_at";

/** `2026-11-01` — the unique key projects use. */
export function monthStart(ref: MonthRef): string {
  return firstDayKey(ref);
}

/** `November 2026`. */
export function projectMonthLabel(ref: MonthRef): string {
  return `${MONTH_NAMES[ref.month]} ${ref.year}`;
}

export function milestoneProgress(milestones: readonly ProjectMilestone[]): {
  done: number;
  total: number;
} {
  return {
    done: milestones.filter((milestone) => milestone.done).length,
    total: milestones.length,
  };
}

/** The first unfinished milestone, or null when the list is done or empty. */
export function nextMilestone(
  milestones: readonly ProjectMilestone[],
): ProjectMilestone | null {
  return milestones.find((milestone) => !milestone.done) ?? null;
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    typeof value === "string" &&
    (PROJECT_STATUSES as readonly string[]).includes(value)
  );
}

type ProjectRow = {
  id: string;
  month: string;
  title: string;
  goal: string | null;
  description: string | null;
  repo_url: string | null;
  status: string | null;
  resume_draft: string | null;
  resume_drafted_at: string | null;
  shipped_at: string | null;
};

type MilestoneRow = {
  id: string;
  title: string;
  done: boolean | null;
  position: number | string | null;
};

type UpdateRow = {
  id: string;
  note: string;
  created_at: string;
};

function toPosition(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Loads the project for one month with its milestones and recent updates.
 * Returns null when nothing has been set up yet. Each child query is
 * best-effort: a project without milestones still renders.
 */
export async function loadProject(
  supabase: SupabaseClient,
  userId: string,
  ref: MonthRef,
): Promise<ProjectDetail | null> {
  const month = monthStart(ref);

  const { data: projectRow, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load this month's project: ${error.message}`);
  }

  if (!projectRow) return null;

  const row = projectRow as ProjectRow;

  const [milestoneResult, updateResult] = await Promise.all([
    supabase
      .from("project_milestones")
      .select("id, title, done, position")
      .eq("user_id", userId)
      .eq("project_id", row.id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("project_updates")
      .select("id, note, created_at")
      .eq("user_id", userId)
      .eq("project_id", row.id)
      .order("created_at", { ascending: false })
      .limit(PROJECT_UPDATE_LIMIT),
  ]);

  if (milestoneResult.error) {
    console.error(
      "Could not load the project milestones:",
      milestoneResult.error.message,
    );
  }

  if (updateResult.error) {
    console.error("Could not load the project updates:", updateResult.error.message);
  }

  return {
    project: {
      id: String(row.id),
      month: String(row.month).slice(0, 10),
      title: row.title,
      goal: row.goal ?? null,
      description: row.description ?? null,
      repoUrl: row.repo_url ?? null,
      status: isProjectStatus(row.status) ? row.status : "planned",
      resumeDraft: row.resume_draft ?? null,
      resumeDraftedAt: row.resume_drafted_at ?? null,
      shippedAt: row.shipped_at ?? null,
    },
    milestones: ((milestoneResult.data ?? []) as MilestoneRow[]).map(
      (milestone) => ({
        id: String(milestone.id),
        title: milestone.title,
        done: milestone.done === true,
        position: toPosition(milestone.position),
      }),
    ),
    updates: ((updateResult.data ?? []) as UpdateRow[]).map((update) => ({
      id: String(update.id),
      note: update.note,
      createdAt: update.created_at,
    })),
  };
}

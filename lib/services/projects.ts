import { currentMonth, parseMonthKey } from "@/lib/calendar";
import { describeDbError } from "@/lib/errors";
import {
  MILESTONE_TITLE_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_GOAL_MAX,
  PROJECT_REPO_MAX,
  PROJECT_TITLE_MAX,
  PROJECT_UPDATE_MAX,
  isProjectStatus,
  loadProject,
  monthStart,
  type ProjectStatus,
} from "@/lib/project";
import {
  RESUME_DRAFT_LIMIT,
  RESUME_DRAFT_WINDOW_HOURS,
  formatResumeDraft,
  generateResumeDraft,
  type ResumeDraft,
} from "@/lib/resume";
import type { DbSession } from "@/lib/services/session";

export type AddProjectUpdateResult =
  | { ok: true; note: string; message: string }
  | { ok: false; message: string };

/** `YYYY-MM` → the first day of that month, or null when it is malformed. */
function monthDate(monthKey: string): string | null {
  const ref = parseMonthKey(monthKey);
  return ref ? monthStart(ref) : null;
}

function trimOrNull(value: string | null | undefined, max: number): string | null {
  const clean = value?.trim() ?? "";
  return clean ? clean.slice(0, max) : null;
}

/** Looks up this user's project row for one month. */
async function findProject(
  session: DbSession,
  month: string,
): Promise<{ id: string; shippedAt: string | null } | null> {
  const { data, error } = await session.supabase
    .from("projects")
    .select("id, shipped_at")
    .eq("user_id", session.userId)
    .eq("month", month)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not find this month's project: ${error.message}`);
  }

  if (!data) return null;

  return { id: String(data.id), shippedAt: data.shipped_at ?? null };
}

/**
 * Appends an update to a month's project. Used by the project page form and by
 * the `add_project_update` chat tool, so both apply the same trimming and the
 * same "there is no project yet" message.
 */
export async function addProjectUpdate(
  session: DbSession,
  note: string,
  options: { monthKey?: string; now?: Date } = {},
): Promise<AddProjectUpdateResult> {
  const clean = note.trim().slice(0, PROJECT_UPDATE_MAX);

  if (!clean) {
    return { ok: false, message: "Write something first." };
  }

  const month = options.monthKey
    ? monthDate(options.monthKey)
    : monthStart(currentMonth(options.now ?? new Date()));

  if (!month) {
    return { ok: false, message: "Pick a valid month." };
  }

  let project: { id: string } | null = null;

  try {
    project = await findProject(session, month);
  } catch (error) {
    console.error(error);
    return { ok: false, message: describeDbError(error) };
  }

  if (!project) {
    return {
      ok: false,
      message:
        "No project is set up for this month yet. Add one on the Project screen first.",
    };
  }

  const { error: insertError } = await session.supabase
    .from("project_updates")
    .insert({
      user_id: session.userId,
      project_id: project.id,
      note: clean,
    });

  if (insertError) {
    console.error("Could not add the project update:", insertError.message);
    return { ok: false, message: describeDbError(insertError) };
  }

  return { ok: true, note: clean, message: "Update added to the project." };
}

export type SaveProjectInput = {
  /** `YYYY-MM`; the row is keyed on the first day of that month. */
  monthKey: string;
  title: string;
  goal?: string | null;
  description?: string | null;
  repoUrl?: string | null;
  status: ProjectStatus;
};

export type SaveProjectResult =
  | { ok: true; projectId: string; created: boolean; message: string }
  | { ok: false; message: string };

/**
 * Creates or edits the project for one month. `shipped_at` is stamped the first
 * time the status becomes `shipped` and cleared if the status moves back.
 */
export async function saveProject(
  session: DbSession,
  input: SaveProjectInput,
  now: Date = new Date(),
): Promise<SaveProjectResult> {
  const month = monthDate(input.monthKey);

  if (!month) {
    return { ok: false, message: "Pick a valid month." };
  }

  const title = input.title.trim().slice(0, PROJECT_TITLE_MAX);

  if (!title) {
    return { ok: false, message: "Give the project a title first." };
  }

  const status = isProjectStatus(input.status) ? input.status : "planned";

  const fields = {
    title,
    goal: trimOrNull(input.goal, PROJECT_GOAL_MAX),
    description: trimOrNull(input.description, PROJECT_DESCRIPTION_MAX),
    repo_url: trimOrNull(input.repoUrl, PROJECT_REPO_MAX),
    status,
  };

  let existing: Awaited<ReturnType<typeof findProject>> = null;

  try {
    existing = await findProject(session, month);
  } catch (error) {
    console.error(error);
    return { ok: false, message: describeDbError(error) };
  }

  if (existing) {
    const { error } = await session.supabase
      .from("projects")
      .update({
        ...fields,
        shipped_at:
          status === "shipped"
            ? (existing.shippedAt ?? now.toISOString())
            : null,
      })
      .eq("id", existing.id)
      .eq("user_id", session.userId);

    if (error) {
      console.error("Could not save the project:", error.message);
      return { ok: false, message: describeDbError(error) };
    }

    return {
      ok: true,
      projectId: existing.id,
      created: false,
      message: "Project saved.",
    };
  }

  const { data: created, error } = await session.supabase
    .from("projects")
    .insert({
      user_id: session.userId,
      month,
      ...fields,
      shipped_at: status === "shipped" ? now.toISOString() : null,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    if (error) console.error("Could not create the project:", error.message);
    return {
      ok: false,
      message: error
        ? describeDbError(error)
        : "The project could not be created. Try again.",
    };
  }

  return {
    ok: true,
    projectId: String(created.id),
    created: true,
    message: "Project created.",
  };
}


export type AddMilestoneResult =
  | { ok: true; id: string; title: string; message: string }
  | { ok: false; message: string };

/** Adds one checklist item to the end of a month's project. */
export async function addMilestone(
  session: DbSession,
  monthKey: string,
  title: string,
): Promise<AddMilestoneResult> {
  const month = monthDate(monthKey);

  if (!month) {
    return { ok: false, message: "Pick a valid month." };
  }

  const clean = title.trim().slice(0, MILESTONE_TITLE_MAX);

  if (!clean) {
    return { ok: false, message: "Write the milestone first." };
  }

  let project: Awaited<ReturnType<typeof findProject>> = null;

  try {
    project = await findProject(session, month);
  } catch (error) {
    console.error(error);
    return { ok: false, message: describeDbError(error) };
  }

  if (!project) {
    return {
      ok: false,
      message: "Add the project for this month before its milestones.",
    };
  }

  const { data: last, error: lastError } = await session.supabase
    .from("project_milestones")
    .select("position")
    .eq("user_id", session.userId)
    .eq("project_id", project.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastError) {
    console.error("Could not read the milestone order:", lastError.message);
    return { ok: false, message: describeDbError(lastError) };
  }

  const position = typeof last?.position === "number" ? last.position + 1 : 0;

  const { data: created, error } = await session.supabase
    .from("project_milestones")
    .insert({
      user_id: session.userId,
      project_id: project.id,
      title: clean,
      position,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    if (error) console.error("Could not add the milestone:", error.message);
    return {
      ok: false,
      message: error
        ? describeDbError(error)
        : "The milestone could not be added. Try again.",
    };
  }

  return {
    ok: true,
    id: String(created.id),
    title: clean,
    message: "Milestone added.",
  };
}

export type MilestoneResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** Ticks or unticks one milestone, stamping `done_at` as it goes. */
export async function setMilestoneDone(
  session: DbSession,
  id: string,
  done: boolean,
  now: Date = new Date(),
): Promise<MilestoneResult> {
  const { data, error } = await session.supabase
    .from("project_milestones")
    .update({ done, done_at: done ? now.toISOString() : null })
    .eq("id", id)
    .eq("user_id", session.userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Could not update the milestone:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  if (!data) {
    return { ok: false, message: "That milestone no longer exists." };
  }

  return {
    ok: true,
    message: done ? "Milestone done." : "Milestone reopened.",
  };
}

/** Removes one milestone from the checklist. */
export async function deleteMilestone(
  session: DbSession,
  id: string,
): Promise<MilestoneResult> {
  const { data, error } = await session.supabase
    .from("project_milestones")
    .delete()
    .eq("id", id)
    .eq("user_id", session.userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Could not delete the milestone:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  if (!data) {
    return { ok: false, message: "That milestone no longer exists." };
  }

  return { ok: true, message: "Milestone removed." };
}


export type DraftResumeResult =
  | { ok: true; draft: ResumeDraft; text: string; message: string }
  | { ok: false; message: string };

/** Rolling 24-hour window the draft limit counts against. */
function draftWindowStart(now: Date): string {
  return new Date(
    now.getTime() - RESUME_DRAFT_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();
}

/**
 * Turns one month's project into a resume entry: one model call, validated with
 * zod, saved on the project row and logged in `resume_drafts` for the rolling
 * limit. Failed attempts are logged too, so the limit cannot be sidestepped.
 */
export async function draftProjectResume(
  session: DbSession,
  monthKey: string,
  now: Date = new Date(),
): Promise<DraftResumeResult> {
  const ref = parseMonthKey(monthKey);

  if (!ref) {
    return { ok: false, message: "Pick a valid month." };
  }

  let detail: Awaited<ReturnType<typeof loadProject>> = null;

  try {
    detail = await loadProject(session.supabase, session.userId, ref);
  } catch (error) {
    console.error(error);
    return { ok: false, message: describeDbError(error) };
  }

  if (!detail) {
    return {
      ok: false,
      message: "Add this month's project before drafting a resume entry.",
    };
  }

  const { count, error: countError } = await session.supabase
    .from("resume_drafts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.userId)
    .gte("created_at", draftWindowStart(now));

  if (countError) {
    console.error("Could not count the resume drafts:", countError.message);
    return { ok: false, message: describeDbError(countError) };
  }

  if ((count ?? 0) >= RESUME_DRAFT_LIMIT) {
    return {
      ok: false,
      message: `You have used all ${RESUME_DRAFT_LIMIT} resume drafts in the last ${RESUME_DRAFT_WINDOW_HOURS} hours. Try again later.`,
    };
  }

  let generated: ResumeDraft | null = null;

  try {
    generated = await generateResumeDraft(detail);
  } catch (error) {
    console.error("The resume draft failed:", error);
  }

  if (!generated) {
    // Count the attempt even though nothing usable came back.
    const { error: logError } = await session.supabase
      .from("resume_drafts")
      .insert({
        user_id: session.userId,
        project_id: detail.project.id,
        ok: false,
        draft: "",
      });

    if (logError) {
      console.error("Could not log the failed draft:", logError.message);
    }

    return {
      ok: false,
      message: "The draft did not come back this time. Try again in a minute.",
    };
  }

  const text = formatResumeDraft(generated);

  const { error: logError } = await session.supabase
    .from("resume_drafts")
    .insert({
      user_id: session.userId,
      project_id: detail.project.id,
      ok: true,
      draft: text,
    });

  if (logError) {
    console.error("Could not log the resume draft:", logError.message);
  }

  const { error: saveError } = await session.supabase
    .from("projects")
    .update({ resume_draft: text, resume_drafted_at: now.toISOString() })
    .eq("id", detail.project.id)
    .eq("user_id", session.userId);

  if (saveError) {
    console.error("Could not save the resume draft:", saveError.message);
    return { ok: false, message: describeDbError(saveError) };
  }

  return {
    ok: true,
    draft: generated,
    text,
    message: "Resume entry drafted.",
  };
}


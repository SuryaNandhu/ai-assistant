"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import {
  MILESTONE_TITLE_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_GOAL_MAX,
  PROJECT_REPO_MAX,
  PROJECT_STATUSES,
  PROJECT_TITLE_MAX,
  PROJECT_UPDATE_MAX,
} from "@/lib/project";
import {
  addMilestone,
  addProjectUpdate,
  deleteMilestone,
  draftProjectResume,
  saveProject,
  setMilestoneDone,
} from "@/lib/services/projects";
import { createClient } from "@/lib/supabase/server";

export type ProjectActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const projectSchema = z.object({
  month: monthSchema,
  title: z.string().trim().min(1).max(PROJECT_TITLE_MAX),
  goal: z.string().trim().max(PROJECT_GOAL_MAX).nullish(),
  description: z.string().trim().max(PROJECT_DESCRIPTION_MAX).nullish(),
  repoUrl: z.union([z.literal(""), z.url().max(PROJECT_REPO_MAX)]).nullish(),
  status: z.enum(PROJECT_STATUSES),
});

const milestoneSchema = z.object({
  month: monthSchema,
  title: z.string().trim().min(1).max(MILESTONE_TITLE_MAX),
});

const milestoneIdSchema = z.object({
  id: z.uuid(),
});

const milestoneDoneSchema = z.object({
  id: z.uuid(),
  done: z.boolean(),
});

const updateSchema = z.object({
  month: monthSchema,
  note: z.string().trim().min(1).max(PROJECT_UPDATE_MAX),
});

const draftSchema = z.object({
  month: monthSchema,
});

async function requireSession() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    if (error) console.error("Could not read Supabase session:", error.message);
    return null;
  }

  return { supabase, userId: data.claims.sub };
}

/** Revalidates the screens that show project data. */
function revalidateProject() {
  revalidatePath("/project");
  revalidatePath("/");
}

/**
 * Creates or edits the project for one month. The same service backs the chat
 * tools, so validation and trimming never drift between them.
 */
export async function saveProjectAction(
  input: unknown,
): Promise<ProjectActionResult> {
  const parsed = projectSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Add a title, a valid status and a link that starts with http.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await saveProject(session, {
      monthKey: parsed.data.month,
      title: parsed.data.title,
      goal: parsed.data.goal ?? null,
      description: parsed.data.description ?? null,
      repoUrl: parsed.data.repoUrl ?? null,
      status: parsed.data.status,
    });

    if (!result.ok) return result;

    revalidateProject();
    return { ok: true, message: result.message };
  } catch (error) {
    console.error("Could not save the project:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

export async function addMilestoneAction(
  input: unknown,
): Promise<ProjectActionResult> {
  const parsed = milestoneSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Write a milestone of 160 characters or less.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await addMilestone(
      session,
      parsed.data.month,
      parsed.data.title,
    );

    if (!result.ok) return result;

    revalidateProject();
    return { ok: true, message: result.message };
  } catch (error) {
    console.error("Could not add the milestone:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

export async function setMilestoneDoneAction(
  input: unknown,
): Promise<ProjectActionResult> {
  const parsed = milestoneDoneSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That milestone could not be read." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await setMilestoneDone(
      session,
      parsed.data.id,
      parsed.data.done,
    );

    if (!result.ok) return result;

    revalidateProject();
    return { ok: true, message: result.message };
  } catch (error) {
    console.error("Could not update the milestone:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

export async function deleteMilestoneAction(
  input: unknown,
): Promise<ProjectActionResult> {
  const parsed = milestoneIdSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That milestone could not be read." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await deleteMilestone(session, parsed.data.id);

    if (!result.ok) return result;

    revalidateProject();
    return { ok: true, message: result.message };
  } catch (error) {
    console.error("Could not delete the milestone:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

export async function addProjectUpdateAction(
  input: unknown,
): Promise<ProjectActionResult> {
  const parsed = updateSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Write an update of 280 characters or less." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await addProjectUpdate(session, parsed.data.note, {
      monthKey: parsed.data.month,
    });

    if (!result.ok) return result;

    revalidateProject();
    return { ok: true, message: result.message };
  } catch (error) {
    console.error("Could not add the project update:", error);
    return { ok: false, message: describeDbError(error) };
  }
}

/** One model call, capped at `RESUME_DRAFT_LIMIT` runs per 24 hours. */
export async function draftResumeAction(
  input: unknown,
): Promise<ProjectActionResult> {
  const parsed = draftSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Pick a valid month." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  try {
    const result = await draftProjectResume(session, parsed.data.month);

    if (!result.ok) return result;

    revalidateProject();
    return { ok: true, message: result.message };
  } catch (error) {
    console.error("Could not draft the resume entry:", error);
    return { ok: false, message: describeDbError(error) };
  }
}


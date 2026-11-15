import { z } from "zod";

import { generateJson } from "@/lib/llm-json";
import {
  PROJECT_STATUS_LABELS,
  type ProjectDetail,
} from "@/lib/project";

/**
 * Turning the month's project into resume material.
 *
 * One small JSON completion, validated with zod, plus a plain-text formatter for
 * the page. Failures return null and the caller shows a friendly message; the
 * project data is never invented by the model because everything it may use is
 * in the prompt.
 */

/** At most ten drafts per rolling 24 hours, failed attempts included. */
export const RESUME_DRAFT_LIMIT = 10;
export const RESUME_DRAFT_WINDOW_HOURS = 24;

const RESUME_TIMEOUT_MS = 25_000;

export const resumeDraftSchema = z.object({
  /** One line for the top of the resume entry. */
  headline: z.string().trim().min(1).max(140),
  /** Two or three sentences about the work and its outcome. */
  summary: z.string().trim().min(1).max(600),
  /** Action-led bullets, each starting with a verb. */
  bullets: z.array(z.string().trim().min(1).max(240)).min(3).max(5),
  /** Concrete tools and skills the project actually used. */
  skills: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
});

export type ResumeDraft = z.infer<typeof resumeDraftSchema>;

export const RESUME_SYSTEM_PROMPT = `You write resume entries for a data analyst moving into AI engineering.
You get one project's real notes. Turn them into resume-ready lines.

Rules:
- Use only the facts in the notes. Never invent metrics, users, traffic, awards or tools that are not mentioned.
- If a number is not in the notes, describe the outcome without one.
- Bullets start with a strong verb (Built, Automated, Shipped, Reduced) and say what changed.
- Keep it plain: no buzzwords, no "passionate", no em dashes.
- Answer with one JSON object only, no prose and no code fences.`;

/** Everything the model is allowed to know about the project. */
export function buildResumePrompt(detail: ProjectDetail): string {
  const { project, milestones, updates } = detail;
  const done = milestones.filter((milestone) => milestone.done);
  const open = milestones.filter((milestone) => !milestone.done);

  const lines = [
    `Month: ${project.month.slice(0, 7)}`,
    `Project title: ${project.title}`,
    `Status: ${PROJECT_STATUS_LABELS[project.status]}`,
  ];

  if (project.goal) lines.push(`Goal: ${project.goal}`);
  if (project.repoUrl) lines.push(`Repository: ${project.repoUrl}`);
  if (project.description) {
    lines.push("", "Description:", project.description);
  }

  if (done.length > 0) {
    lines.push("", "Completed milestones:");
    for (const milestone of done) lines.push(`- ${milestone.title}`);
  }

  if (open.length > 0) {
    lines.push("", "Still open (do not present as done):");
    for (const milestone of open) lines.push(`- ${milestone.title}`);
  }

  if (updates.length > 0) {
    lines.push("", "Work log, newest first:");
    for (const update of updates) {
      lines.push(`- ${update.createdAt.slice(0, 10)}: ${update.note}`);
    }
  }

  lines.push(
    "",
    "Write the resume entry as JSON with this exact shape:",
    '{"headline": "...", "summary": "...", "bullets": ["...", "...", "..."], "skills": ["..."]}',
    "3 to 5 bullets, 1 to 12 skills, headline at most 140 characters.",
  );

  return lines.join("\n");
}

/**
 * Calls the model and validates the answer. Returns null on any failure so the
 * action can record the attempt and show one clear message.
 */
export async function generateResumeDraft(
  detail: ProjectDetail,
): Promise<ResumeDraft | null> {
  const raw = await generateJson({
    system: RESUME_SYSTEM_PROMPT,
    prompt: buildResumePrompt(detail),
    timeoutMs: RESUME_TIMEOUT_MS,
    maxOutputTokens: 900,
  });

  const parsed = resumeDraftSchema.safeParse(raw);

  if (!parsed.success) {
    console.error(
      "The resume draft did not match the expected shape:",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
    return null;
  }

  return parsed.data;
}

/** Plain text for the page, the clipboard and the chat tool. */
export function formatResumeDraft(draft: ResumeDraft): string {
  return [
    draft.headline,
    "",
    draft.summary,
    "",
    "Highlights",
    ...draft.bullets.map((bullet) => `• ${bullet}`),
    "",
    `Skills: ${draft.skills.join(", ")}`,
  ].join("\n");
}

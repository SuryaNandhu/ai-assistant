import { tool } from "ai";
import { z } from "zod";

import {
  currentMonth,
  monthKey,
  parseMonthKey,
  type MonthRef,
} from "@/lib/calendar";
import {
  loadProject,
  milestoneProgress,
  nextMilestone,
  MILESTONE_TITLE_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_GOAL_MAX,
  PROJECT_REPO_MAX,
  PROJECT_STATUSES,
  PROJECT_TITLE_MAX,
  PROJECT_UPDATE_MAX,
} from "@/lib/project";
import {
  SCREEN_LIMIT_MAX,
  SCREEN_LIMIT_MIN,
  formatMinutes,
} from "@/lib/screen-time";
import { logActivity } from "@/lib/services/log";
import {
  addMilestone,
  addProjectUpdate,
  draftProjectResume,
  saveProject,
} from "@/lib/services/projects";
import { saveLink } from "@/lib/services/saved";
import { saveScreenLimit, saveScreenTime } from "@/lib/services/screen-time";
import type { DbSession } from "@/lib/services/session";
import { pickTaskForSession } from "@/lib/services/tasks";
import { ENERGY_LEVELS } from "@/lib/task";
import { dayKeyLabel, istDayKey } from "@/lib/week";

/**
 * The assistant's tools. Each one is a thin wrapper over `lib/services/*`, the
 * same code behind the buttons, so the model can never write rows the UI would
 * have refused. Results are small JSON objects with a `message` the model can
 * quote back; failures use the same shape so it can explain what went wrong.
 */

const DAY_KEY = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("IST day key, YYYY-MM-DD. Leave out for today.");

const MONTH_KEY = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe("Month key, YYYY-MM. Leave out for the current month.");

/** Something the model can read and retell; `ok` drives the chip tone. */
export type ToolNote = {
  ok: boolean;
  message: string;
  [key: string]: unknown;
};

function failure(message: string): ToolNote {
  return { ok: false, message };
}

function monthFromInput(month: string | undefined, now: Date): MonthRef | null {
  return month ? parseMonthKey(month) : currentMonth(now);
}

const INVALID_MONTH = "Use a month like 2026-11.";

/** Tool set for one signed-in user; `now` keeps tests and defaults stable. */
export function chatTools(session: DbSession, now: Date = new Date()) {
  return {
    log_activity: tool({
      description:
        "Log work the user already did (a LeetCode session, a walk/run, job applications) as a manual completion.",
      inputSchema: z.object({
        goal: z
          .string()
          .nullable()
          .describe(
            "Goal key such as leetcode, ai_learning, bi, job_search, walk_run, or null for other work.",
          ),
        minutes: z.number().int().min(1).max(600),
        note: z.string().max(200).nullable().optional(),
        day: DAY_KEY.optional(),
        distanceKm: z.number().min(0).max(100).nullable().optional(),
      }),
      execute: async (input) => {
        const result = await logActivity(session, {
          goal: input.goal,
          minutes: input.minutes,
          note: input.note ?? null,
          day: input.day,
          distanceKm: input.distanceKm ?? null,
        });

        if (!result.ok) return failure(result.message);

        return {
          ok: true,
          message: result.message,
          counts: result.counts,
        };
      },
    }),

    save_link: tool({
      description:
        "Save a YouTube video or article link to the inbox so it can be picked as a task later.",
      inputSchema: z.object({
        url: z.string().describe("The full link the user shared."),
      }),
      execute: async ({ url }) => {
        const result = await saveLink(session, url);
        if (!result.ok) return failure(result.message);

        return {
          ok: true,
          message: result.message,
          title: result.title,
          url: result.url,
          created: result.created,
        };
      },
    }),

    pick_task: tool({
      description:
        "Pick one task to do now from the backlog, given the time and energy the user has.",
      inputSchema: z.object({
        minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
        energy: z.enum(ENERGY_LEVELS),
        mode: z
          .enum(["smart", "surprise"])
          .default("smart")
          .describe("smart weights the user's goals; surprise ignores them."),
      }),
      execute: async (input) => {
        const task = await pickTaskForSession(session, {
          mode: input.mode,
          minutes: input.minutes,
          energy: input.energy,
        });

        if (!task) {
          return failure(
            `Nothing in the backlog fits ${input.minutes} minutes at ${input.energy} energy.`,
          );
        }

        return {
          ok: true,
          message: `Try “${task.title}” for about ${task.minutes} minutes. ${task.reason}`,
          task: {
            title: task.title,
            minutes: task.minutes,
            energy: task.energy,
            goal: task.goal,
            goalLabel: task.goalLabel,
            url: task.url,
            reason: task.reason,
          },
        };
      },
    }),

    log_screen_time: tool({
      description:
        "Record how many minutes the user spent on their phone or laptop screen on a day.",
      inputSchema: z.object({
        minutes: z.number().int().min(0).max(1440),
        day: DAY_KEY.optional(),
      }),
      execute: async (input) => {
        const result = await saveScreenTime(session, {
          minutes: input.minutes,
          day: input.day,
        });

        if (!result.ok) return failure(result.message);

        return {
          ok: true,
          message: `Saved ${formatMinutes(result.minutes)} of screen time for ${result.day}.`,
          day: result.day,
          minutes: result.minutes,
        };
      },
    }),

    set_screen_limit: tool({
      description: "Change the user's daily screen-time limit in minutes.",
      inputSchema: z.object({
        minutes: z.number().int().min(SCREEN_LIMIT_MIN).max(SCREEN_LIMIT_MAX),
      }),
      execute: async ({ minutes }) => {
        const result = await saveScreenLimit(session, minutes);

        if (!result.ok) return failure(result.message);

        return {
          ok: true,
          message: `Daily screen-time limit is now ${formatMinutes(result.limitMinutes)}.`,
          minutes: result.limitMinutes,
        };
      },
    }),

    get_project: tool({
      description:
        "Read the month's project: status, goal, milestone progress, recent updates and whether a resume entry exists.",
      inputSchema: z.object({
        month: MONTH_KEY.optional(),
      }),
      execute: async ({ month }) => {
        const ref = monthFromInput(month, now);
        if (!ref) return failure(INVALID_MONTH);

        const detail = await loadProject(session.supabase, session.userId, ref);
        if (!detail) {
          return {
            ok: true,
            message: `No project is set for ${monthKey(ref)} yet.`,
            project: null,
          };
        }

        const progress = milestoneProgress(detail.milestones);
        const next = nextMilestone(detail.milestones);
        const { project } = detail;

        return {
          ok: true,
          message: `${project.title} is ${project.status} with ${progress.done}/${progress.total} milestones done.`,
          project: {
            month: monthKey(ref),
            title: project.title,
            status: project.status,
            goal: project.goal,
            description: project.description,
            repoUrl: project.repoUrl,
          },
          milestones: detail.milestones.map((milestone) => ({
            title: milestone.title,
            done: milestone.done,
          })),
          nextMilestone: next?.title ?? null,
          recentUpdates: detail.updates.slice(0, 5).map((update) => ({
            day: dayKeyLabel(istDayKey(new Date(update.createdAt))),
            note: update.note,
          })),
          resumeDraft: project.resumeDraft
            ? project.resumeDraft.slice(0, 1500)
            : null,
        };
      },
    }),

    save_project: tool({
      description:
        "Create or edit the monthly project. Fields left out on an edit keep their current value.",
      inputSchema: z.object({
        month: MONTH_KEY.optional(),
        title: z.string().max(PROJECT_TITLE_MAX).optional(),
        goal: z.string().max(PROJECT_GOAL_MAX).nullable().optional(),
        description: z
          .string()
          .max(PROJECT_DESCRIPTION_MAX)
          .nullable()
          .optional(),
        repoUrl: z.string().max(PROJECT_REPO_MAX).nullable().optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
      }),
      execute: async (input) => {
        const ref = monthFromInput(input.month, now);
        if (!ref) return failure(INVALID_MONTH);

        const existing = await loadProject(session.supabase, session.userId, ref);
        const title = input.title ?? existing?.project.title;

        if (!title) return failure("Give the project a title first.");

        const result = await saveProject(session, {
          monthKey: monthKey(ref),
          title,
          goal:
            input.goal === undefined
              ? (existing?.project.goal ?? null)
              : input.goal,
          description:
            input.description === undefined
              ? (existing?.project.description ?? null)
              : input.description,
          repoUrl:
            input.repoUrl === undefined
              ? (existing?.project.repoUrl ?? null)
              : input.repoUrl,
          status: input.status ?? existing?.project.status ?? "planned",
        });

        if (!result.ok) return failure(result.message);

        return { ok: true, message: result.message };
      },
    }),

    add_project_update: tool({
      description:
        "Add a dated note to the month's project log, for progress worth remembering.",
      inputSchema: z.object({
        note: z.string().max(PROJECT_UPDATE_MAX),
        month: MONTH_KEY.optional(),
      }),
      execute: async (input) => {
        const ref = monthFromInput(input.month, now);
        if (!ref) return failure(INVALID_MONTH);

        const result = await addProjectUpdate(session, input.note, {
          monthKey: monthKey(ref),
          now,
        });

        if (!result.ok) return failure(result.message);

        return { ok: true, message: result.message };
      },
    }),

    add_milestone: tool({
      description: "Add one checkpoint to the month's project checklist.",
      inputSchema: z.object({
        title: z.string().max(MILESTONE_TITLE_MAX),
        month: MONTH_KEY.optional(),
      }),
      execute: async (input) => {
        const ref = monthFromInput(input.month, now);
        if (!ref) return failure(INVALID_MONTH);

        const result = await addMilestone(
          session,
          monthKey(ref),
          input.title,
        );

        if (!result.ok) return failure(result.message);

        return { ok: true, message: result.message };
      },
    }),

    draft_resume_entry: tool({
      description:
        "Turn the month's project into a two-line resume entry with the model. Costs one of the 10 daily drafts; only run it when the user asks.",
      inputSchema: z.object({
        month: MONTH_KEY.optional(),
      }),
      execute: async (input) => {
        const ref = monthFromInput(input.month, now);
        if (!ref) return failure(INVALID_MONTH);

        const result = await draftProjectResume(
          session,
          monthKey(ref),
          now,
        );

        if (!result.ok) return failure(result.message);

        return { ok: true, message: result.message, draft: result.text };
      },
    }),
  };
}

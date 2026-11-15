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
import { JOURNAL_NOTE_MAX, loadJournalEntry } from "@/lib/journal";
import { ITEM_TITLE_MAX } from "@/lib/inbox";
import {
  SCREEN_LIMIT_MAX,
  SCREEN_LIMIT_MIN,
  formatMinutes,
} from "@/lib/screen-time";
import { saveJournalEntry } from "@/lib/services/journal";
import { loadStatus } from "@/lib/services/status";
import { logActivity } from "@/lib/services/log";
import {
  addMilestone,
  addProjectUpdate,
  draftProjectResume,
  saveProject,
} from "@/lib/services/projects";
import { saveLink } from "@/lib/services/saved";
import { createCustomGoal, createTaskItem } from "@/lib/services/quick-add";
import { saveScreenLimit, saveScreenTime } from "@/lib/services/screen-time";
import type { DbSession } from "@/lib/services/session";
import {
  completePickedTask,
  loadOpenSuggestion,
  pickTaskForSession,
  skipPickedTask,
} from "@/lib/services/tasks";
import { SKIP_REASON_VALUES } from "@/lib/suggestions";
import { GOAL_LABEL_MAX } from "@/lib/targets";
import { ENERGY_LEVELS, type Felt } from "@/lib/task";
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

/** The tool vocabulary says "right"; `completions.felt` stores "ok". */
function completionFelt(felt: "easy" | "right" | "hard" | undefined): Felt {
  if (felt === "easy") return "easy";
  if (felt === "hard") return "hard";
  return "ok";
}

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
            "Goal key such as leetcode, ai_learning, bi, job_search, walk_run, resume_update, or null for other work.",
          ),
        minutes: z.number().int().min(1).max(600),
        note: z.string().max(200).nullable().optional(),
        day: DAY_KEY.optional(),
        distanceKm: z.number().min(0).max(100).nullable().optional(),
        quantity: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .nullable()
          .optional()
          .describe(
            "How many things were done, for goals with a daily minimum (job_search: applications sent). Omit for a single unit.",
          ),
      }),
      execute: async (input) => {
        const result = await logActivity(session, {
          goal: input.goal,
          minutes: input.minutes,
          note: input.note ?? null,
          day: input.day,
          distanceKm: input.distanceKm ?? null,
          quantity: input.quantity ?? null,
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
          suggestionId: task.suggestionId,
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

    complete_suggestion: tool({
      description:
        "Mark the task from the last pick_task as done and record how it felt. Pass the suggestion id that pick_task returned.",
      inputSchema: z.object({
        suggestion_id: z
          .string()
          .min(1)
          .describe("The suggestion id returned by pick_task."),
        felt: z.enum(["easy", "right", "hard"]).optional(),
        liked: z.boolean().optional(),
        takeaway: z.string().trim().max(280).optional(),
      }),
      execute: async (input) => {
        const found = await loadOpenSuggestion(
          session,
          input.suggestion_id,
          now,
        );

        if (!found.ok) return failure(found.message);

        const result = await completePickedTask(session, {
          task: {
            source: found.task.source,
            itemId: found.task.itemId,
            goal: found.task.goal,
            elapsedMinutes: null,
            distanceKm: null,
            takeaway: input.takeaway ?? null,
            suggestionId: found.task.suggestionId,
          },
          felt: completionFelt(input.felt),
          liked: input.liked ?? null,
        });

        if (!result.ok) return failure(result.message);

        return {
          ok: true,
          message: result.message,
          title: found.task.title,
        };
      },
    }),

    skip_suggestion: tool({
      description:
        "Skip the task from the last pick_task. Pass the suggestion id that pick_task returned.",
      inputSchema: z.object({
        suggestion_id: z
          .string()
          .min(1)
          .describe("The suggestion id returned by pick_task."),
        reason: z.enum(SKIP_REASON_VALUES).optional(),
      }),
      execute: async (input) => {
        const found = await loadOpenSuggestion(
          session,
          input.suggestion_id,
          now,
        );

        if (!found.ok) return failure(found.message);

        const result = await skipPickedTask(session, {
          task: {
            source: found.task.source,
            itemId: found.task.itemId,
            suggestionId: found.task.suggestionId,
          },
          reason: input.reason ?? "not_now",
        });

        if (!result.ok) return failure(result.message);

        return {
          ok: true,
          message: `${result.message} · ${found.task.title}`,
          title: found.task.title,
        };
      },
    }),

    get_status: tool({
      description:
        "Read a numbers-only snapshot: current streak, progress per target in its own period (weekly or monthly, with the daily minimum where one exists), today's completion count, which completed days (from the first day screen time was logged) are missing screen time, and which recent days have no journal entry. It never returns journal text.",
      inputSchema: z.object({}),
      execute: async () => {
        const status = await loadStatus(session, now);
        const missing = status.missingScreenDays.length;

        const screenLine =
          missing === 0
            ? "screen time up to date"
            : `screen time missing for ${missing} ${missing === 1 ? "day" : "days"}`;

        const journalMissing = status.journalMissingDays.length;
        const journalLine =
          journalMissing === 0
            ? "journal up to date"
            : `journal missing for ${journalMissing} ${journalMissing === 1 ? "day" : "days"}`;

        return {
          ok: true,
          message: `Streak ${status.streakDays} days · ${status.todayCompletions} logged today · ${screenLine} · ${journalLine}.`,
          ...status,
        };
      },
    }),

    save_journal: tool({
      description:
        "Save a journal entry for a day: a mood from 1 (rough) to 5 (great), one line of up to 200 characters, or both. Only when the user asks; never read the note back to them.",
      inputSchema: z.object({
        mood: z.number().int().min(1).max(5).nullable().optional(),
        note: z.string().max(JOURNAL_NOTE_MAX).nullable().optional(),
        day: DAY_KEY.optional(),
      }),
      execute: async (input) => {
        const day = input.day ?? istDayKey(now);

        // A note-only save keeps the mood already written for that day.
        let mood = input.mood ?? null;
        if (input.mood === undefined && input.note) {
          const existing = await loadJournalEntry(
            session.supabase,
            session.userId,
            day,
          ).catch(() => null);
          mood = existing?.mood ?? null;
        }

        const result = await saveJournalEntry(
          session,
          { mood, note: input.note ?? null, day },
          now,
        );

        if (!result.ok) return failure(result.message);

        return {
          ok: true,
          message: `Journal saved for ${dayKeyLabel(result.entry.day)}.`,
          day: result.entry.day,
        };
      },
    }),

    log_screen_time: tool({
      description:
        "Record how many minutes the user spent on screens during a finished day. Leave out the day for yesterday: screen time covers a whole day, and today is only used when the user says so explicitly.",
      inputSchema: z.object({
        minutes: z.number().int().min(0).max(1440),
        day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe(
            "IST day key, YYYY-MM-DD. Leave out for yesterday; pass it only when the user names another day.",
          ),
      }),
      execute: async (input) => {
        const result = await saveScreenTime(
          session,
          {
            minutes: input.minutes,
            day: input.day,
          },
          now,
        );

        if (!result.ok) return failure(result.message);

        return {
          ok: true,
          message: `Saved ${formatMinutes(result.minutes)} of screen time for ${dayKeyLabel(result.day)}.`,
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

    add_task: tool({
      description:
        "Add a one-off task to the backlog: something to do that is neither a link nor one of my targets.",
      inputSchema: z.object({
        title: z
          .string()
          .max(ITEM_TITLE_MAX)
          .describe("Short task name in my words, e.g. Renew passport."),
        minutes: z
          .union([z.literal(15), z.literal(30), z.literal(60)])
          .optional()
          .describe("Rough time it takes; defaults to 30 minutes."),
      }),
      execute: async (input) => {
        const result = await createTaskItem(session, {
          title: input.title,
          estMinutes: input.minutes ?? null,
        });

        if (!result.ok) return failure(result.message);

        return {
          ok: true,
          message: result.message,
          title: result.item.title,
          minutes: result.item.est_minutes,
        };
      },
    }),

    add_goal: tool({
      description:
        "Create a weekly target of my own, such as gym four times a week. It appears on Home and can be paused or deleted later.",
      inputSchema: z.object({
        label: z
          .string()
          .max(GOAL_LABEL_MAX)
          .describe("Name of the target, e.g. Gym."),
        perWeek: z
          .number()
          .int()
          .min(1)
          .max(7)
          .describe("How many times a week, 1 to 7."),
      }),
      execute: async (input) => {
        const result = await createCustomGoal(session, input);

        if (!result.ok) return failure(result.message);

        return {
          ok: true,
          message: result.message,
          goal: result.goal.goal,
          perWeek: input.perWeek,
        };
      },
    }),
  };
}

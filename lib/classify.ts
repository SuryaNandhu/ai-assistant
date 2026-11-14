import { z } from "zod";

import { ITEM_TYPES } from "@/lib/inbox";
import { generateJson } from "@/lib/llm-json";

/**
 * Optional AI pass over a freshly saved link. It is deliberately small and
 * bounded: if the model is slow, missing or answers nonsense, the caller keeps
 * the rule-based values and the link is still saved.
 */

const CLASSIFY_TIMEOUT_MS = 6000;

const classificationSchema = z.object({
  goal: z.string().trim().max(60).nullable(),
  type: z.enum(ITEM_TYPES),
  est_minutes: z.number().int().min(1).max(240),
  energy: z.enum(["low", "normal", "high"]),
});

export type Classification = z.infer<typeof classificationSchema>;

function clip(value: string | null | undefined, max: number): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function classifyLink(input: {
  title: string;
  description: string | null;
  /** Goal keys from the user's active targets. */
  goals: readonly string[];
  url: string;
}): Promise<Classification | null> {
  const goalList = input.goals.length > 0 ? input.goals.join(", ") : "(none configured)";

  const prompt = [
    "Classify one saved link for a personal study backlog.",
    'Reply with one JSON object and nothing else: {"goal": string|null, "type": ' +
      '"article"|"video"|"leetcode"|"job"|"other", "est_minutes": integer, ' +
      '"energy": "low"|"normal"|"high"}',
    `Goals (use one key exactly, or null when none fits): ${goalList}`,
    "Rules: est_minutes is realistic from 5 to 120; energy is how much focus it needs;",
    "type is article (reading), video (watching), leetcode (coding practice), job (listing/application) or other.",
    "",
    `URL: ${clip(input.url, 500)}`,
    `Title: ${clip(input.title, 300) || "(unknown)"}`,
    `Description: ${clip(input.description, 800) || "(none)"}`,
  ].join("\n");

  const raw = await generateJson({
    prompt,
    timeoutMs: CLASSIFY_TIMEOUT_MS,
    maxOutputTokens: 200,
  });

  const parsed = classificationSchema.safeParse(raw);
  if (!parsed.success) return null;

  const allowedGoals = new Set(input.goals);
  const goal =
    parsed.data.goal && allowedGoals.has(parsed.data.goal) ? parsed.data.goal : null;

  return { ...parsed.data, goal };
}

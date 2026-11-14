import { z } from "zod";

import {
  ITEM_TYPES,
  MAX_TAG_COUNT,
  MAX_TAG_LENGTH,
  normalizeTags,
} from "@/lib/inbox";
import { generateJson } from "@/lib/llm-json";

/**
 * Optional AI pass over a freshly saved link. It is deliberately small and
 * bounded: if the model is slow, missing or answers nonsense, the caller keeps
 * the rule-based values and the link is still saved.
 */

const CLASSIFY_TIMEOUT_MS = 6000;

/** Trim first so the length limit applies to what is actually stored. */
const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TAG_LENGTH)
  .transform((value) => value.toLowerCase());

const classificationSchema = z.object({
  goal: z.string().trim().max(60).nullable(),
  type: z.enum(ITEM_TYPES),
  est_minutes: z.number().int().min(1).max(240),
  energy: z.enum(["low", "normal", "high"]),
  tags: z.array(tagSchema).max(MAX_TAG_COUNT).default([]),
});

export type Classification = {
  goal: string | null;
  type: (typeof ITEM_TYPES)[number];
  est_minutes: number;
  energy: "low" | "normal" | "high";
  tags: string[];
};

function clip(value: string | null | undefined, max: number): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function classifyLink(input: {
  title: string;
  description: string | null;
  /** Goal keys from the user's active targets. */
  goals: readonly string[];
  /** Tags already in use, most used first; the model should reuse them. */
  existingTags?: readonly string[];
  url: string;
}): Promise<Classification | null> {
  const goalList = input.goals.length > 0 ? input.goals.join(", ") : "(none configured)";
  const tagList =
    input.existingTags && input.existingTags.length > 0
      ? input.existingTags.join(", ")
      : "(none yet)";

  const prompt = [
    "Classify one saved link for a personal study backlog.",
    'Reply with one JSON object and nothing else: {"goal": string|null, "type": ' +
      '"article"|"video"|"leetcode"|"job"|"other", "est_minutes": integer, ' +
      '"energy": "low"|"normal"|"high", "tags": string[]}',
    `Goals (use one key exactly, or null when none fits): ${goalList}`,
    `Existing tags (reuse one when it fits): ${tagList}`,
    "Rules: est_minutes is realistic from 5 to 120; energy is how much focus it needs;",
    "type is article (reading), video (watching), leetcode (coding practice), job (listing/application) or other.",
    "tags is 1 or 2 short lowercase topics (one or two words, no #, max 3).",
    "",
    `URL: ${clip(input.url, 500)}`,
    `Title: ${clip(input.title, 300) || "(unknown)"}`,
    `Description: ${clip(input.description, 800) || "(none)"}`,
  ].join("\n");

  const raw = await generateJson({
    prompt,
    timeoutMs: CLASSIFY_TIMEOUT_MS,
    maxOutputTokens: 250,
  });

  const parsed = classificationSchema.safeParse(raw);
  let data = parsed.success ? parsed.data : null;

  // A stray extra tag should not throw away an otherwise good classification.
  if (!data && raw && typeof raw === "object") {
    const retry = classificationSchema.safeParse({
      ...(raw as Record<string, unknown>),
      tags: [],
    });
    if (retry.success) data = retry.data;
  }

  if (!data) return null;

  const allowedGoals = new Set(input.goals);
  const goal = data.goal && allowedGoals.has(data.goal) ? data.goal : null;

  return { ...data, goal, tags: normalizeTags(data.tags) };
}

import { z } from "zod";

import { generateJson } from "@/lib/llm-json";

/**
 * On-demand summaries. Articles are summarised from the first ~8000 characters
 * of readable text; videos are summarised from the title and description only
 * (no transcript scraping, and the result says so).
 */

const SUMMARY_TIMEOUT_MS = 30000;
export const MAX_ARTICLE_CHARS = 8000;

const summarySchema = z.object({
  bullets: z.array(z.string().trim().min(1).max(300)).min(3).max(7),
  worth_reading: z.boolean(),
  reason: z.string().trim().min(1).max(300),
  reading_minutes: z.number().int().min(1).max(240).nullable().optional(),
});

export type SummaryInput =
  | {
      kind: "article";
      title: string;
      description: string | null;
      text: string;
      fallbackMinutes: number | null;
    }
  | {
      kind: "video";
      title: string;
      description: string | null;
      channel: string | null;
    };

function clip(value: string | null | undefined, max: number): string {
  if (!value) return "";
  return value.trim().slice(0, max);
}

function formatSummary(
  title: string,
  result: z.infer<typeof summarySchema>,
  readingMinutes: number | null,
  limited: boolean,
): string {
  const bullets = result.bullets
    .slice(0, 5)
    .map((bullet) => `• ${bullet.replace(/\s+/g, " ").trim()}`);

  const verdict = `Worth reading: ${result.worth_reading ? "yes" : "no"} — ${result.reason
    .replace(/\s+/g, " ")
    .trim()}`;

  const lines = [
    ...(limited
      ? ["Limited summary — from the title and description only (no transcript).", ""]
      : []),
    ...(title ? [`${title}`, ""] : []),
    ...bullets,
    "",
    verdict,
  ];

  if (!limited && readingMinutes) {
    lines.push(`Reading time: ~${readingMinutes} min`);
  }

  return lines.join("\n");
}

/**
 * One DeepSeek call. Returns the formatted summary, or null when the model did
 * not answer with something usable (the caller then saves nothing).
 */
export async function generateSummary(input: SummaryInput): Promise<string | null> {
  const limited = input.kind === "video";

  const prompt =
    input.kind === "article"
      ? [
          "Summarise the article below for a busy data analyst.",
          'Reply with one JSON object and nothing else: {"bullets": ["exactly 5 short bullets, max 18 words each"], "worth_reading": true|false, "reason": "one short reason", "reading_minutes": integer}',
          "Rules: concrete points from the text, no 'this article discusses'; be honest in the verdict; read time in minutes for the full article.",
          "",
          `Title: ${clip(input.title, 300)}`,
          `Description: ${clip(input.description, 500) || "(none)"}`,
          "",
          "Article text:",
          clip(input.text, MAX_ARTICLE_CHARS),
        ].join("\n")
      : [
          "Write a limited summary of a video. You do NOT have the transcript and must not invent it.",
          'Reply with one JSON object and nothing else: {"bullets": ["exactly 5 short bullets, max 18 words each"], "worth_reading": true|false, "reason": "one short reason"}',
          "Rules: only what the title, channel and description support; say what is unclear instead of guessing.",
          "",
          `Title: ${clip(input.title, 300) || "(unknown)"}`,
          `Channel: ${clip(input.channel, 200) || "(unknown)"}`,
          `Description: ${clip(input.description, 800) || "(none)"}`,
        ].join("\n");

  const raw = await generateJson({
    prompt,
    timeoutMs: SUMMARY_TIMEOUT_MS,
    maxOutputTokens: 700,
  });

  const parsed = summarySchema.safeParse(raw);
  if (!parsed.success) return null;

  const readingMinutes =
    input.kind === "article"
      ? (parsed.data.reading_minutes ?? input.fallbackMinutes)
      : null;

  return formatSummary(input.title, parsed.data, readingMinutes, limited);
}

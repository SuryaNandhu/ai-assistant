import { generateText } from "ai";

import { errorMessage } from "@/lib/env";
import { getModel } from "@/lib/llm";

/**
 * One small JSON completion. The model is asked for a bare JSON object; the
 * answer is extracted defensively (models like to wrap it in code fences) and
 * returned as `unknown` so the caller can validate it with zod.
 *
 * Failures (no API key, timeout, network) return null. Callers must always have
 * a non-LLM fallback.
 */
export async function generateJson(options: {
  prompt: string;
  system?: string;
  timeoutMs: number;
  maxOutputTokens?: number;
}): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const { text } = await generateText({
      model: getModel(),
      system: options.system,
      prompt: options.prompt,
      abortSignal: controller.signal,
      maxOutputTokens: options.maxOutputTokens ?? 700,
      temperature: 0.2,
    });

    return extractJsonObject(text);
  } catch (error) {
    console.error("LLM JSON call failed:", errorMessage(error));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls the first JSON object out of a model reply. */
export function extractJsonObject(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

import { deepSeek } from "@ai-sdk/deepseek";

/**
 * The only place the LLM provider is wired up. To switch providers, change the
 * import and the env vars in this file — the rest of the app only asks for a
 * model.
 *
 * Env: DEEPSEEK_API_KEY, LLM_MODEL (for example "deepseek-v4-flash").
 */
export function getModel() {
  const modelId = process.env.LLM_MODEL?.trim();
  if (!modelId) {
    throw new Error(
      "LLM_MODEL is not set. Add it to .env.local (for example: deepseek-v4-flash).",
    );
  }

  // `deepSeek()` reads DEEPSEEK_API_KEY itself; check early for a clear error.
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Add your DeepSeek API key to .env.local.",
    );
  }

  return deepSeek(modelId);
}

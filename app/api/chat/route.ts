import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";

import { errorMessage } from "@/lib/env";
import { getModel } from "@/lib/llm";
import { loadRecentMessages, messageText } from "@/lib/messages";
import { SYSTEM_PROMPT } from "@/lib/prompt";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const DEFAULT_DAILY_MESSAGE_CAP = 100;

/**
 * Errors are returned as plain text so `useChat` shows the exact message in the
 * UI (it uses the response body as the error message for non-2xx responses).
 */
function textError(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function dailyMessageCap(): number {
  const configured = Number(process.env.DAILY_MESSAGE_CAP);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_DAILY_MESSAGE_CAP;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims) {
    return textError("You are not signed in. Refresh the page and sign in again.", 401);
  }
  const userId = claimsData.claims.sub;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return textError("Could not read the request. Please try again.", 400);
  }

  let messages: UIMessage[];
  try {
    messages = await validateUIMessages({
      messages: (payload as { messages?: unknown } | null)?.messages,
    });
  } catch {
    return textError("Invalid chat request. Reload the page and try again.", 400);
  }

  const lastMessage = messages.at(-1);
  const userText = lastMessage?.role === "user" ? messageText(lastMessage) : "";
  if (!userText) {
    return textError("Your message was empty. Type something and try again.", 400);
  }

  // Daily cap: count user messages in the last 24 hours before doing any work.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", since);

  if (countError) {
    console.error("Daily cap check failed:", countError.message);
    return textError(
      "Could not check your daily message limit. Apply supabase/schema.sql if this is a fresh project.",
      500,
    );
  }

  const cap = dailyMessageCap();
  if ((count ?? 0) >= cap) {
    return textError(
      `Daily limit reached: ${cap} messages per 24 hours. Try again later.`,
      429,
    );
  }

  // Persist the user message before generating, so it survives a failed stream.
  const { error: insertError } = await supabase
    .from("messages")
    .insert({ user_id: userId, role: "user", content: userText });

  if (insertError) {
    console.error("Could not save user message:", insertError.message);
    return textError(
      "Could not save your message. Apply supabase/schema.sql if this is a fresh project.",
      500,
    );
  }

  // Context: the last 20 stored messages (the new one included, oldest first).
  let history: UIMessage[];
  try {
    history = await loadRecentMessages(supabase, userId);
  } catch (error) {
    console.error(error);
    return textError("Could not load your recent messages. Please try again.", 500);
  }

  // A conversation must start with a user message (DeepSeek rejects an
  // assistant-first history when the 20-message window slices a pair).
  const context = history[0]?.role === "assistant" ? history.slice(1) : history;

  let model: LanguageModel;
  try {
    model = getModel();
  } catch (error) {
    return textError(errorMessage(error), 500);
  }

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(context),
    onError: ({ error }) => {
      console.error("LLM stream error:", error);
    },
    onEnd: async ({ text }) => {
      const content = text.trim();
      if (!content) return;

      const { error } = await supabase
        .from("messages")
        .insert({ user_id: userId, role: "assistant", content });

      if (error) {
        console.error("Could not save assistant message:", error.message);
      }
    },
  });

  return result.toUIMessageStreamResponse({
    onError: () => "The assistant could not reply. Please try again.",
  });
}

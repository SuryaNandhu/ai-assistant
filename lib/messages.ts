import type { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";

/** How many stored messages are sent to the model as context. */
export const HISTORY_LIMIT = 20;

export type MessageRole = "user" | "assistant";

export type MessageRow = {
  id: string;
  role: MessageRole;
  content: string;
  created_at: string;
};

/**
 * Loads the most recent messages for a user, oldest first, shaped as UI
 * messages so they can hydrate `useChat` or feed `convertToModelMessages`.
 */
export async function loadRecentMessages(
  supabase: SupabaseClient,
  userId: string,
  limit = HISTORY_LIMIT,
): Promise<UIMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Could not load messages: ${error.message}`);
  }

  const rows = (data ?? []) as MessageRow[];
  return rows.reverse().map(toUIMessage);
}

export function toUIMessage(row: MessageRow): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: [{ type: "text", text: row.content }],
  };
}

/** Concatenates the text parts of a UI message. */
export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

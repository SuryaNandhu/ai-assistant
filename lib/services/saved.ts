import { saveInboxItem } from "@/lib/inbox-save";
import type { DbSession } from "@/lib/services/session";

export type SaveLinkResult =
  | { ok: true; created: boolean; title: string; url: string; message: string }
  | { ok: false; message: string };

/**
 * Saves a link the user pasted into the chat. Shares `saveInboxItem` with the
 * inbox form, so dedupe and URL normalisation behave exactly the same; the row
 * is tagged `api` because it did not come from the manual form.
 */
export async function saveLink(
  session: DbSession,
  url: string,
): Promise<SaveLinkResult> {
  const result = await saveInboxItem(session.supabase, session.userId, {
    url,
    addedVia: "api",
  });

  if (!result.ok) return result;

  return {
    ok: true,
    created: result.created,
    title: result.item.title,
    // A note-only inbox row has no URL; the link we just saved always does.
    url: result.item.url ?? url,
    message: result.created
      ? `Saved “${result.item.title}” to your inbox.`
      : `“${result.item.title}” was already in your inbox.`,
  };
}

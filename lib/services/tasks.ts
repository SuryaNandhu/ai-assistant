import {
  pickTask,
  type PickRequest,
} from "@/lib/pick-service";
import type { DbSession } from "@/lib/services/session";
import type { PickedTask } from "@/lib/task";

/** The slot sizes the Home screen offers; the chat tools accept the same. */
export const PICK_MINUTES = [15, 30, 60] as const;

/**
 * Thin wrapper over `pickTask` so the chat tool and the Home buttons go through
 * one function (the suggestion is logged either way, which the picker relies on).
 */
export async function pickTaskForSession(
  session: DbSession,
  request: PickRequest,
  now: Date = new Date(),
): Promise<PickedTask | null> {
  return pickTask(
    { supabase: session.supabase, userId: session.userId, now },
    request,
  );
}

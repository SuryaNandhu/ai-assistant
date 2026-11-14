"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import { INBOX_ITEM_COLUMNS, ITEM_TYPES, type InboxItem } from "@/lib/inbox";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MINUTES } from "@/lib/task";

type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

export type UpdateItemResult =
  | { ok: true; item: InboxItem }
  | { ok: false; message: string };

export type StatusResult = UpdateItemResult;

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

const updateSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, "Give the item a title.").max(300),
  type: z.enum(ITEM_TYPES),
  goal: z.string().trim().max(60).nullable().default(null),
  est_minutes: z.number().int().min(1).max(600),
  energy: z.enum(["low", "normal", "high"]),
  notes: z.string().trim().max(2000).nullable().default(null),
});

const statusSchema = z.object({
  id: z.uuid(),
  status: z.enum(["todo", "done", "dropped"]),
});

async function requireSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    if (error) console.error("Could not read Supabase session:", error.message);
    return null;
  }

  return { supabase, userId: data.claims.sub };
}

function revalidateInbox() {
  revalidatePath("/inbox");
  revalidatePath("/");
}

/** Edits the fields the inbox lets you change on a saved item. */
export async function updateItemAction(input: unknown): Promise<UpdateItemResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the item details and try again.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const { id, notes, goal, ...rest } = parsed.data;

  const { data, error } = await session.supabase
    .from("items")
    .update({
      ...rest,
      goal: goal || null,
      notes: notes || null,
    })
    .eq("id", id)
    .eq("user_id", session.userId)
    .select(INBOX_ITEM_COLUMNS)
    .single();

  if (error) {
    console.error("Could not update the item:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  revalidateInbox();
  return { ok: true, item: data as InboxItem };
}

/**
 * Quick triage from the board. Marking a link done also logs a completion with
 * its estimate (once), so the weekly target stays honest; un-dropping or
 * reopening never deletes history.
 */
export async function setItemStatusAction(input: unknown): Promise<StatusResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "That item could not be found. Reload and try again." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const { id, status } = parsed.data;

  const { data: current, error: readError } = await session.supabase
    .from("items")
    .select("id, status, goal, type, est_minutes")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle<{
      id: string;
      status: string;
      goal: string | null;
      type: string | null;
      est_minutes: number | null;
    }>();

  if (readError) {
    console.error("Could not load the item:", readError.message);
    return { ok: false, message: describeDbError(readError) };
  }

  if (!current) {
    return { ok: false, message: "That item is no longer in your list." };
  }

  const { data, error } = await session.supabase
    .from("items")
    .update({ status })
    .eq("id", id)
    .eq("user_id", session.userId)
    .select(INBOX_ITEM_COLUMNS)
    .single();

  if (error) {
    console.error("Could not change the item status:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  if (status === "done" && current.status !== "done") {
    const minutes =
      typeof current.est_minutes === "number" && current.est_minutes > 0
        ? current.est_minutes
        : DEFAULT_MINUTES;

    const { error: logError } = await session.supabase.from("completions").insert({
      user_id: session.userId,
      item_id: current.id,
      goal: current.goal,
      kind: current.type || "item",
      minutes,
      felt: "ok",
      distance_km: null,
    });

    if (logError) {
      // The status is saved; only the weekly progress misses this one.
      console.error("Could not log the completion:", logError.message);
    }
  }

  revalidateInbox();
  return { ok: true, item: data as InboxItem };
}

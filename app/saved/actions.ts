"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/lib/errors";
import {
  addMonths,
  INBOX_ITEM_COLUMNS,
  ITEM_TYPES,
  MAX_TAG_COUNT,
  MAX_TAG_LENGTH,
  normalizeGoalForType,
  normalizeTags,
  type InboxItem,
} from "@/lib/inbox";
import { clearRestDayForCompletion } from "@/lib/services/rest-day";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MINUTES, JOB_SEARCH_GOAL } from "@/lib/task";
import { istDayKey } from "@/lib/week";

type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";
const GONE = "That link is no longer in your list.";

export type ItemResult =
  | { ok: true; item: InboxItem }
  | { ok: false; message: string };

export type DeleteResult = { ok: true } | { ok: false; message: string };

const idSchema = z.uuid();

const updateSchema = z.object({
  id: idSchema,
  type: z.enum(ITEM_TYPES),
  goal: z.string().trim().max(60).nullable().default(null),
  est_minutes: z.number().int().min(1).max(600),
  energy: z.enum(["low", "normal", "high"]),
  tags: z
    .array(z.string().trim().min(1).max(MAX_TAG_LENGTH))
    .max(MAX_TAG_COUNT)
    .default([]),
});

const revisitSchema = z.object({
  id: idSchema,
  months: z.union([z.literal(1), z.literal(2)]),
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

function revalidateSaved() {
  revalidatePath("/saved");
  revalidatePath("/");
}

/** Edits the fields the saved screen lets you change on an item. */
export async function updateItemAction(input: unknown): Promise<ItemResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Check the details and try again.",
    };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const { id, goal, tags, ...rest } = parsed.data;

  // A job posting is job search, even if the sheet sent another goal.
  const nextGoal = normalizeGoalForType(rest.type, goal);

  const { data, error } = await session.supabase
    .from("items")
    .update({
      ...rest,
      goal: nextGoal,
      tags: normalizeTags(tags),
    })
    .eq("id", id)
    .eq("user_id", session.userId)
    .select(INBOX_ITEM_COLUMNS)
    .single();

  if (error) {
    console.error("Could not update the item:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  revalidateSaved();
  return { ok: true, item: data as InboxItem };
}

/**
 * Marks a link read: status `done`, the revisit date cleared, and one
 * completion logged with its estimate so the streak and the weekly target
 * count it. Re-marking an already-read item logs nothing new.
 */
export async function markItemReadAction(input: unknown): Promise<ItemResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: GONE };

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const id = parsed.data;

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

  if (!current) return { ok: false, message: GONE };

  const { data, error } = await session.supabase
    .from("items")
    .update({ status: "done", revisit_at: null })
    .eq("id", id)
    .eq("user_id", session.userId)
    .select(INBOX_ITEM_COLUMNS)
    .single();

  if (error) {
    console.error("Could not mark the item read:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  if (current.status !== "done") {
    // A job-search item is counted: one application, no minutes, no felt.
    const countOnly = current.goal === JOB_SEARCH_GOAL;
    const minutes = countOnly
      ? null
      : typeof current.est_minutes === "number" && current.est_minutes > 0
        ? current.est_minutes
        : DEFAULT_MINUTES;

    const { error: logError } = await session.supabase
      .from("completions")
      .insert({
        user_id: session.userId,
        item_id: current.id,
        goal: current.goal,
        kind: current.type || "item",
        minutes,
        felt: countOnly ? null : "ok",
        note: null,
        source: "manual",
        quantity: countOnly ? 1 : null,
        distance_km: null,
      });

    if (logError) {
      // The status is saved; only this week's progress misses the item.
      console.error("Could not log the completion:", logError.message);
    } else {
      // The item counts as work, so today is no longer a rest day.
      await clearRestDayForCompletion(session, istDayKey(new Date()));
    }
  }

  revalidateSaved();
  return { ok: true, item: data as InboxItem };
}

/** Reopens a read item without touching the completion already logged. */
export async function markItemUnreadAction(input: unknown): Promise<ItemResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: GONE };

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const { data, error } = await session.supabase
    .from("items")
    .update({ status: "todo" })
    .eq("id", parsed.data)
    .eq("user_id", session.userId)
    .select(INBOX_ITEM_COLUMNS)
    .single();

  if (error) {
    console.error("Could not mark the item unread:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  revalidateSaved();
  return { ok: true, item: data as InboxItem };
}

/**
 * Parks an item until now + 1 or 2 months. Only the date moves: the status
 * returns to `todo` and no completion is written. Works on read items too, so
 * something skimmed now can be revisited properly later.
 */
export async function setRevisitAction(input: unknown): Promise<ItemResult> {
  const parsed = revisitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: GONE };

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const revisitAt = addMonths(new Date(), parsed.data.months).toISOString();

  const { data, error } = await session.supabase
    .from("items")
    .update({ status: "todo", revisit_at: revisitAt })
    .eq("id", parsed.data.id)
    .eq("user_id", session.userId)
    .select(INBOX_ITEM_COLUMNS)
    .single();

  if (error) {
    console.error("Could not defer the item:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  revalidateSaved();
  return { ok: true, item: data as InboxItem };
}

/**
 * Deletes one saved link. `completions.item_id` is `on delete set null`, so the
 * minutes already logged stay in the streak and the weekly progress.
 */
export async function deleteItemAction(input: unknown): Promise<DeleteResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: GONE };

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const { error } = await session.supabase
    .from("items")
    .delete()
    .eq("id", parsed.data)
    .eq("user_id", session.userId);

  if (error) {
    console.error("Could not delete the item:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  revalidateSaved();
  return { ok: true };
}


import type { SupabaseClient } from "@supabase/supabase-js";

import { classifyLink } from "@/lib/classify";
import { errorMessage } from "@/lib/env";
import { describeDbError } from "@/lib/errors";
import { fetchPage, fetchYouTubeOEmbed } from "@/lib/fetch-page";
import {
  INBOX_ITEM_COLUMNS,
  isYoutubeUrl,
  linkDefaults,
  normalizeUrl,
  parseHttpUrl,
  sourceDomainOf,
  titleFromUrl,
  type AddedVia,
  type GoalOption,
  type InboxItem,
} from "@/lib/inbox";

/** Re-exported so server code can import it next to `loadActiveGoals`. */
export type { GoalOption };

/**
 * Saving a link is split in two: `saveInboxItem` validates, dedupes and inserts
 * immediately; `enrichInboxItem` fills in the real title and the AI/rule
 * classification afterwards. Enrichment never runs on the save path, so a slow
 * page or a missing API key cannot stop the item from being saved.
 */

export type SaveInboxInput = {
  url: string;
  note?: string | null;
  /** Goal key picked by the user; null means "let the rules/AI decide". */
  goal?: string | null;
  addedVia?: AddedVia;
};

export type SaveInboxResult =
  | { ok: true; created: boolean; item: InboxItem }
  | { ok: false; message: string };

/** Active weekly targets, used for the goal picker and the AI prompt. */
export async function loadActiveGoals(
  supabase: SupabaseClient,
  userId: string,
): Promise<GoalOption[]> {
  const { data, error } = await supabase
    .from("targets")
    .select("goal, label")
    .eq("user_id", userId)
    .eq("active", true)
    .order("label", { ascending: true });

  if (error) {
    throw new Error(`Could not load your goals: ${error.message}`);
  }

  return ((data ?? []) as GoalOption[]).filter((row) => Boolean(row.goal));
}

export async function saveInboxItem(
  supabase: SupabaseClient,
  userId: string,
  input: SaveInboxInput,
): Promise<SaveInboxResult> {
  const parsedUrl = parseHttpUrl(input.url);
  if (!parsedUrl) {
    return {
      ok: false,
      message:
        "That does not look like a web link. Paste a full http or https URL from a public site.",
    };
  }

  const normalized = normalizeUrl(parsedUrl);

  const { data: existing, error: findError } = await supabase
    .from("items")
    .select(INBOX_ITEM_COLUMNS)
    .eq("user_id", userId)
    .eq("url", normalized)
    .limit(1)
    .maybeSingle();

  if (findError) {
    console.error("Could not check for a duplicate link:", findError.message);
    return { ok: false, message: describeDbError(findError) };
  }

  if (existing) {
    return { ok: true, created: false, item: existing as InboxItem };
  }

  const defaults = linkDefaults(parsedUrl);
  const goal = input.goal?.trim() || defaults.goal;
  const note = input.note?.trim() ? input.note.trim().slice(0, 1000) : null;

  const { data, error } = await supabase
    .from("items")
    .insert({
      user_id: userId,
      type: defaults.type,
      title: titleFromUrl(parsedUrl),
      url: normalized,
      goal,
      est_minutes: defaults.est_minutes,
      energy: defaults.energy,
      status: "todo",
      notes: note,
      source_domain: sourceDomainOf(parsedUrl),
      added_via: input.addedVia ?? "manual",
    })
    .select(INBOX_ITEM_COLUMNS)
    .single();

  if (error) {
    console.error("Could not save the link:", error.message);
    return { ok: false, message: describeDbError(error) };
  }

  return { ok: true, created: true, item: data as InboxItem };
}

/**
 * Post-save enrichment: real page/YouTube title, optional AI classification.
 * Always best-effort — it logs and returns instead of throwing, so it is safe to
 * run after the HTTP response has been sent.
 */
export async function enrichInboxItem(args: {
  supabase: SupabaseClient;
  userId: string;
  itemId: string;
  url: string;
  /** Goal the user picked in the form, if any. */
  chosenGoal?: string | null;
}): Promise<void> {
  try {
    const parsedUrl = parseHttpUrl(args.url);
    if (!parsedUrl) return;

    const rules = linkDefaults(parsedUrl);
    let title: string | null = null;
    let description: string | null = null;
    let channel: string | null = null;

    if (isYoutubeUrl(parsedUrl)) {
      // oEmbed is public and never touches the video page itself.
      const oembed = await fetchYouTubeOEmbed(normalizeUrl(parsedUrl));
      title = oembed?.title ?? null;
      channel = oembed?.authorName ?? null;
    } else {
      try {
        const page = await fetchPage(args.url);
        title = page.title;
        description = page.description;
      } catch (error) {
        console.error(
          `Inbox could not read ${args.url}:`,
          errorMessage(error),
        );
      }
    }

    const goals = await loadActiveGoals(args.supabase, args.userId)
      .then((rows) => rows.map((row) => row.goal))
      .catch(() => [] as string[]);

    const ai = await classifyLink({
      title: title ?? titleFromUrl(parsedUrl),
      description: description ?? (channel ? `YouTube channel: ${channel}` : null),
      goals,
      url: args.url,
    });

    const update: Record<string, unknown> = {};

    if (title && title.trim().length > 1) {
      update.title = title.trim().slice(0, 300);
    }

    if (ai) {
      // Host-driven types (video / leetcode / job) are more reliable than the
      // model's guess; a generic link may be re-typed.
      if (rules.type === "article") update.type = ai.type;
      if (!args.chosenGoal) update.goal = ai.goal ?? rules.goal;
      update.est_minutes = ai.est_minutes;
      update.energy = ai.energy;
    }

    if (Object.keys(update).length === 0) return;

    const { error } = await args.supabase
      .from("items")
      .update(update)
      .eq("id", args.itemId)
      .eq("user_id", args.userId);

    if (error) {
      console.error("Could not enrich the saved link:", error.message);
    }
  } catch (error) {
    console.error("Inbox enrichment failed:", errorMessage(error));
  }
}


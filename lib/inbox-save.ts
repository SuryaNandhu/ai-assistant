import type { SupabaseClient } from "@supabase/supabase-js";

import { classifyLink } from "@/lib/classify";
import { errorMessage } from "@/lib/env";
import { describeDbError } from "@/lib/errors";
import { fetchPage, fetchYouTubeOEmbed } from "@/lib/fetch-page";
import {
  INBOX_ITEM_COLUMNS,
  isYoutubeUrl,
  linkDefaults,
  normalizeGoalForType,
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

/**
 * Tags already in use for this user, most used first (max 50). Fed to the
 * classifier so it reuses an existing topic instead of inventing a near
 * duplicate ("react" vs "reactjs").
 */
export async function loadTopTags(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("items")
    .select("tags")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    // Tags are a nicety; the save and the title still work without them.
    console.error("Could not load existing tags:", error.message);
    return [];
  }

  const counts = new Map<string, number>();

  for (const row of (data ?? []) as { tags: string[] | null }[]) {
    for (const tag of row.tags ?? []) {
      const clean = typeof tag === "string" ? tag.trim().toLowerCase() : "";
      if (!clean) continue;
      counts.set(clean, (counts.get(clean) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 50)
    .map(([tag]) => tag);
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
  const goal = normalizeGoalForType(
    defaults.type,
    input.goal?.trim() || defaults.goal,
  );
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

    const [goals, existingTags] = await Promise.all([
      loadActiveGoals(args.supabase, args.userId)
        .then((rows) => rows.map((row) => row.goal))
        .catch(() => [] as string[]),
      loadTopTags(args.supabase, args.userId),
    ]);

    const ai = await classifyLink({
      title: title ?? titleFromUrl(parsedUrl),
      description: description ?? (channel ? `YouTube channel: ${channel}` : null),
      goals,
      existingTags,
      url: args.url,
    });

    const update: Record<string, unknown> = {};

    if (title && title.trim().length > 1) {
      update.title = title.trim().slice(0, 300);
    }

    const chosenGoal = args.chosenGoal?.trim() || null;

    // Rule-based values first, then the AI may refine them. The goal is combined
    // from the same two passes, so the job rule sees the final type.
    let nextType = rules.type;
    let nextGoal = chosenGoal ?? rules.goal;

    if (ai) {
      if (rules.type === "article") nextType = ai.type;
      if (!chosenGoal) nextGoal = ai.goal ?? rules.goal;
    }

    // A job posting is always job search, whatever the model or the form said.
    nextGoal = normalizeGoalForType(nextType, nextGoal);

    // What `saveInboxItem` wrote a moment ago, so an unchanged goal is not
    // rewritten and a user-chosen goal for a non-job link is left alone.
    const savedGoal = normalizeGoalForType(
      rules.type,
      chosenGoal ?? rules.goal,
    );

    if (ai) {
      // Host-driven types (video / leetcode / job) are more reliable than the
      // model's guess; a generic link may be re-typed.
      if (rules.type === "article") update.type = ai.type;
      update.est_minutes = ai.est_minutes;
      update.energy = ai.energy;
      // No AI answer (or no tags in it) means the column keeps its '{}'.
      if (ai.tags.length > 0) update.tags = ai.tags;
    }

    if (nextGoal !== savedGoal) update.goal = nextGoal;

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


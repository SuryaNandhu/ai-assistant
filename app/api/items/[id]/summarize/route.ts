import { NextResponse } from "next/server";
import { z } from "zod";

import { errorMessage } from "@/lib/env";
import { describeDbError } from "@/lib/errors";
import { PageFetchError, fetchPage, fetchYouTubeOEmbed } from "@/lib/fetch-page";
import { isYoutubeUrl, parseHttpUrl } from "@/lib/inbox";
import { generateSummary } from "@/lib/summarize";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Summaries per user per rolling 24 hours. */
export const SUMMARY_LIMIT = 30;
const WINDOW_MS = 24 * 60 * 60 * 1000;

type ItemRow = {
  id: string;
  url: string | null;
  type: string;
  title: string;
  notes: string | null;
  est_minutes: number | null;
  summarized_at: string | null;
};

function failure(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

function readingMinutesFor(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/**
 * Summarises one saved item on demand and stores the result. Articles are read
 * from the page; videos use only the oEmbed title and channel (no transcript
 * scraping). Nothing is saved when the page or the model fails.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims) {
    return failure("You are signed out. Refresh the page and sign in again.", 401);
  }
  const userId = claimsData.claims.sub;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return failure("That item could not be found.", 404);
  }

  const { data: item, error: itemError } = await supabase
    .from("items")
    .select("id, url, type, title, notes, est_minutes, summarized_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle<ItemRow>();

  if (itemError) {
    console.error("Could not load the item to summarise:", itemError.message);
    return failure(describeDbError(itemError), 500);
  }

  if (!item) {
    return failure("That item is no longer in your list.", 404);
  }

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count, error: countError } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("summarized_at", since);

  if (countError) {
    console.error("Could not check the summary limit:", countError.message);
    return failure(describeDbError(countError), 500);
  }

  if ((count ?? 0) >= SUMMARY_LIMIT) {
    return failure(
      `Summary limit reached: ${SUMMARY_LIMIT} summaries per 24 hours. Try again later.`,
      429,
    );
  }

  if (!item.url) {
    return failure("This item has no link, so there is nothing to summarise.", 400);
  }

  const parsedUrl = parseHttpUrl(item.url);
  if (!parsedUrl) {
    return failure("That link points to a private address, so it was not opened.", 400);
  }

  const isVideo = item.type === "video" || isYoutubeUrl(parsedUrl);

  let summary: string | null = null;

  if (isVideo) {
    const oembed = isYoutubeUrl(parsedUrl)
      ? await fetchYouTubeOEmbed(parsedUrl.toString())
      : null;

    summary = await generateSummary({
      kind: "video",
      title: oembed?.title ?? item.title,
      description: item.notes,
      channel: oembed?.authorName ?? null,
    });
  } else {
    let page;
    try {
      page = await fetchPage(item.url);
    } catch (error) {
      const message =
        error instanceof PageFetchError
          ? error.message
          : "Couldn't read this page. Open it directly.";
      console.error("Could not fetch the page to summarise:", errorMessage(error));
      return failure(message, 422);
    }

    const text = page.text.trim();
    if (text.length < 200 && !page.description) {
      return failure("Couldn't read this page. Open it directly.", 422);
    }

    summary = await generateSummary({
      kind: "article",
      title: page.title ?? item.title,
      description: page.description,
      text,
      fallbackMinutes: text ? readingMinutesFor(text) : null,
    });
  }

  if (!summary) {
    return failure("The summariser did not answer. Try again in a minute.", 502);
  }

  const summarizedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("items")
    .update({ summary, summarized_at: summarizedAt })
    .eq("id", item.id)
    .eq("user_id", userId)
    .select("summary, summarized_at")
    .single();

  if (updateError) {
    console.error("Could not save the summary:", updateError.message);
    return failure(describeDbError(updateError), 500);
  }

  return NextResponse.json({
    ok: true,
    summary: (updated?.summary as string | undefined) ?? summary,
    summarized_at: (updated?.summarized_at as string | undefined) ?? summarizedAt,
  });
}

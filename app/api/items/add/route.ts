import { after, NextResponse } from "next/server";
import { z } from "zod";

import { enrichInboxItem, saveInboxItem } from "@/lib/inbox-save";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const bodySchema = z.object({
  url: z.string().trim().min(1).max(2048),
  note: z.string().trim().max(1000).nullable().optional().default(null),
  goal: z.string().trim().max(60).nullable().optional().default(null),
});

function failure(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

/**
 * Saves a pasted link. The row is written before anything is fetched, and the
 * enrichment (page title, YouTube oEmbed, optional AI classification) runs
 * after the response via `after()`, so adding a link never waits on the network
 * beyond the database round trip.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims) {
    return failure("You are signed out. Refresh the page and sign in again.", 401);
  }
  const userId = claimsData.claims.sub;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return failure("Could not read the request. Please try again.", 400);
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return failure("Paste a link to save. Only http and https links work.", 400);
  }

  const { url, note, goal } = parsed.data;
  const result = await saveInboxItem(supabase, userId, {
    url,
    note,
    goal,
    addedVia: "api",
  });

  if (!result.ok) {
    return failure(result.message, 400);
  }

  if (result.created) {
    const itemId = result.item.id;
    const savedUrl = result.item.url ?? url;

    after(async () => {
      await enrichInboxItem({
        supabase,
        userId,
        itemId,
        url: savedUrl,
        chosenGoal: goal,
      });
    });
  }

  return NextResponse.json({
    ok: true,
    created: result.created,
    duplicate: !result.created,
    item: result.item,
  });
}

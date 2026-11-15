import { NextResponse } from "next/server";

import {
  EXPORT_HOURLY_LIMIT,
  EXPORT_PAGE_SIZE,
  EXPORT_TABLES,
  EXPORT_WINDOW_MS,
  exportCounts,
  exportFileName,
  exportOrderColumn,
  type ExportTable,
} from "@/lib/export";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type Supabase = Awaited<ReturnType<typeof createClient>>;

function failure(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

/**
 * One table, newest page first, `id` ordered so a thousand-row page boundary
 * never repeats or skips a row.
 */
async function fetchAll(
  supabase: Supabase,
  table: ExportTable,
  userId: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const order = exportOrderColumn(table);

  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .order(order, { ascending: true })
      .range(from, from + EXPORT_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }

    const page = (data ?? []) as unknown[];
    rows.push(...page);

    if (page.length < EXPORT_PAGE_SIZE) return rows;
  }
}

/**
 * Downloads everything the signed-in user owns as one JSON file. RLS scopes
 * every query, so the file can never contain another user's rows. The five-per-
 * hour limit is `data_exports` its own table: one row is written before the
 * export runs, so a repeated click cannot queue up work.
 */
export async function GET() {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims) {
    return failure("You are signed out. Refresh the page and sign in again.", 401);
  }

  const userId = claimsData.claims.sub;
  const now = new Date();
  const since = new Date(now.getTime() - EXPORT_WINDOW_MS).toISOString();

  const { count, error: countError } = await supabase
    .from("data_exports")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);

  if (countError) {
    console.error("Could not count the recent exports:", countError.message);
    return failure(
      "Could not start the export. Run migration 007, then try again.",
      500,
    );
  }

  if ((count ?? 0) >= EXPORT_HOURLY_LIMIT) {
    return NextResponse.json(
      {
        ok: false,
        message: `${EXPORT_HOURLY_LIMIT} exports an hour is the limit. Try again in an hour.`,
      },
      { status: 429, headers: { "retry-after": "3600" } },
    );
  }

  const { error: insertError } = await supabase
    .from("data_exports")
    .insert({ user_id: userId });

  if (insertError) {
    console.error("Could not record the export:", insertError.message);
    return failure("Could not start the export. Try again.", 500);
  }

  const tables: Record<string, unknown[]> = {};

  for (const table of EXPORT_TABLES) {
    try {
      tables[table] = await fetchAll(supabase, table, userId);
    } catch (error) {
      console.error("Could not export a table:", error);
      return failure(`Could not export your ${table}. Try again.`, 500);
    }
  }

  const body = {
    exported_at: now.toISOString(),
    counts: exportCounts(tables),
    ...tables,
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(now)}"`,
      "cache-control": "no-store",
    },
  });
}

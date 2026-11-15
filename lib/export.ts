import { istDayKey } from "@/lib/week";

/**
 * Everything the JSON export contains, in the order the keys appear in the
 * file. A new table has to be added here to be exported; `user_settings` has no
 * `id` column, so it is the one table ordered by its primary key instead.
 */
export const EXPORT_TABLES = [
  "items",
  "completions",
  "suggestions",
  "targets",
  "journal_entries",
  "screen_time_entries",
  "user_settings",
  "projects",
  "project_milestones",
  "project_updates",
  "messages",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

/** Rows requested per round trip; PostgREST returns at most 1000. */
export const EXPORT_PAGE_SIZE = 1000;

/** Five downloads an hour is plenty and keeps a stuck loop from hammering. */
export const EXPORT_HOURLY_LIMIT = 5;

export const EXPORT_WINDOW_MS = 60 * 60 * 1000;

/** The column to page through each table on, for a stable order. */
export function exportOrderColumn(table: ExportTable): string {
  return table === "user_settings" ? "user_id" : "id";
}

/** `ai-assistant-2026-11-15.json`, dated by the IST day of the export. */
export function exportFileName(now: Date): string {
  return `ai-assistant-${istDayKey(now)}.json`;
}

/** Counts per table, handy to check the file at a glance. */
export function exportCounts(
  tables: Record<string, readonly unknown[]>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [table, rows.length]),
  );
}

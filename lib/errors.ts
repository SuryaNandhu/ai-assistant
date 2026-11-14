import { errorMessage } from "@/lib/env";

/**
 * Turns low-level Supabase/Postgres errors into something the user can act on.
 * Every new column has a migration, so a missing-column error almost always
 * means the SQL was not applied yet.
 */
export function describeDbError(error: unknown): string {
  const message = errorMessage(error);

  if (
    /does not exist|schema cache|column .* does not exist|could not find the '.*' column/i.test(
      message,
    )
  ) {
    return "Your database is missing part of the schema. Run the SQL in supabase/migrations (or supabase/schema.sql) in the Supabase SQL Editor, then reload.";
  }

  return message;
}

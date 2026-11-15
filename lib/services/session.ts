import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The signed-in user plus a Supabase client. Server actions, page loaders and
 * chat tools all pass this shape into `lib/services/*` so the write logic has
 * exactly one implementation.
 */
export type DbSession = {
  supabase: SupabaseClient;
  userId: string;
};

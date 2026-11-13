/**
 * Environment access. Values are read lazily so that a missing variable shows a
 * clear message at request time instead of crashing the build.
 */

export function getMissingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return missing;
}

export function isSupabaseConfigured(): boolean {
  return getMissingSupabaseEnv().length === 0;
}

/**
 * supabase-js expects the project origin, but the URL is often copied from the
 * dashboard's API settings with a trailing "/rest/v1/". Strip that (and stray
 * trailing slashes) so auth requests do not end up under the REST path.
 */
export function normalizeSupabaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/, "")
    .replace(/\/+$/, "");
}

export function getSupabaseEnv(): { url: string; anonKey: string } {
  const missing = getMissingSupabaseEnv();
  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured. Missing: ${missing.join(", ")}. ` +
        "Copy .env.example to .env.local and fill in your project values.",
    );
  }

  return {
    url: normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!),
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Something went wrong.";
}

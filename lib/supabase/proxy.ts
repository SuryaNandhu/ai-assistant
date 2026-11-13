import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/env";

/**
 * Refreshes the Supabase session for the incoming request and reports the
 * signed-in user id (null when there is no valid session).
 *
 * Must be called from `proxy.ts` so refreshed auth cookies are written back to
 * the browser response.
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  userId: string | null;
}> {
  let response = NextResponse.next({ request });

  // Nothing to refresh until the project is configured. Pages surface a setup
  // notice in that case.
  if (!isSupabaseConfigured()) {
    return { response, userId: null };
  }

  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  try {
    const { data, error } = await supabase.auth.getClaims();

    if (error) {
      console.error("Supabase session refresh failed:", error.message);
      return { response, userId: null };
    }

    const userId = data?.claims?.sub;
    return { response, userId: typeof userId === "string" ? userId : null };
  } catch (error) {
    console.error("Supabase session refresh threw:", error);
    return { response, userId: null };
  }
}

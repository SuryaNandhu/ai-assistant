import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";
import { isSupabaseConfigured } from "@/lib/env";

/** Routes that must stay reachable while signed out. */
const PUBLIC_PREFIXES = ["/login", "/auth"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Keep refreshed auth cookies when redirecting. */
function redirectTo(request: NextRequest, pathname: string, from: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";

  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Until Supabase is configured, let pages show their setup notice instead of
  // bouncing every request to /login.
  if (!isSupabaseConfigured()) {
    return response;
  }

  if (!userId && !isPublicPath(pathname)) {
    return redirectTo(request, "/login", response);
  }

  if (userId && pathname === "/login") {
    return redirectTo(request, "/", response);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets, so `next/image` and CSS keep
     * loading while auth redirects stay in place.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

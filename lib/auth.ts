import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string | null;
};

/** Returns the signed-in user, or null when there is no valid session. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    if (error) console.error("Could not read Supabase session:", error.message);
    return null;
  }

  const email = data.claims.email;
  return {
    id: data.claims.sub,
    email: typeof email === "string" ? email : null,
  };
}

/** Server-side guard for protected pages. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

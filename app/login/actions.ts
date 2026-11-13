"use server";

import { redirect } from "next/navigation";

import { getMissingSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  status: "idle" | "error";
  message: string;
};

/** Turns a Supabase auth failure into something a human can act on. */
function describeAuthError(error: {
  message?: string;
  code?: string;
  status?: number;
}): string {
  switch (error.code) {
    case "invalid_credentials":
      return "Email or password is incorrect.";
    case "email_not_confirmed":
      return "Confirm your email address first — open the confirmation email Supabase sent you.";
    case "user_banned":
      return "This account has been disabled.";
    case "over_request_rate_limit":
    case "too_many_requests":
      return "Too many attempts. Wait a minute, then try again.";
    default:
      break;
  }

  if (error.status === 429) {
    return "Too many attempts. Wait a minute, then try again.";
  }

  return error.message?.trim() || "Could not sign you in. Please try again.";
}

/** Signs in the existing email/password account. Sign-ups are disabled. */
export async function signIn(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !email.includes("@")) {
    return { status: "error", message: "Enter a valid email address." };
  }

  if (!password) {
    return { status: "error", message: "Enter your password." };
  }

  const missing = getMissingSupabaseEnv();
  if (missing.length > 0) {
    return {
      status: "error",
      message: `Supabase is not configured on this deployment (missing ${missing.join(", ")}).`,
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { status: "error", message: describeAuthError(error) };
    }
  } catch (error) {
    console.error("Sign in failed:", error);
    const message = error instanceof Error ? error.message : String(error);

    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
      return {
        status: "error",
        message:
          "Could not reach the authentication server. Check your connection and try again.",
      };
    }

    return {
      status: "error",
      message: "Could not sign you in. Please try again.",
    };
  }

  // Outside the try/catch: redirect() works by throwing, so it must not be
  // caught above. The auth cookies were already written by createClient().
  redirect("/");
}

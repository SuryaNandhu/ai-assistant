"use server";

import { headers } from "next/headers";

import { errorMessage } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  status: "idle" | "sent" | "error";
  message?: string;
};

async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");

  if (!host) return "http://localhost:3000";

  const proto =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");

  return `${proto}://${host}`;
}

export async function sendMagicLink(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return { status: "error", message: "Enter a valid email address." };
  }

  try {
    const supabase = await createClient();
    const origin = await requestOrigin();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Supabase appends ?code=... to this URL after the email is clicked.
        emailRedirectTo: `${origin}/auth/callback?next=/`,
      },
    });

    if (error) {
      return { status: "error", message: error.message };
    }

    return { status: "sent", message: `Check ${email} for the sign-in link.` };
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

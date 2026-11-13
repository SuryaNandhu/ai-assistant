import type { Metadata } from "next";

import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">AI Assistant</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with your email and password.
          </p>
        </div>

        {isSupabaseConfigured() ? (
          <div className="rounded-xl border border-border p-5">
            <LoginForm />
          </div>
        ) : (
          <SetupNotice />
        )}
      </div>
    </main>
  );
}

import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";

import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">AI Assistant</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with a magic link sent to your email.
          </p>
        </div>

        {isSupabaseConfigured() ? (
          <div className="space-y-4 rounded-xl border border-border p-5">
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <LoginForm />
          </div>
        ) : (
          <SetupNotice />
        )}
      </div>
    </main>
  );
}

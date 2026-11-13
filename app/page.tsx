import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

// Auth-gated page: always evaluate the session at request time.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-xl font-semibold tracking-tight">AI Assistant</h1>
        <SetupNotice />
      </main>
    );
  }

  const user = await requireUser();

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold">AI Assistant</h1>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {user.email}
          </span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          Signed in as{" "}
          <span className="text-foreground">{user.email ?? "your account"}</span>
          . Streaming chat arrives in step 3.
        </p>
      </div>
    </main>
  );
}

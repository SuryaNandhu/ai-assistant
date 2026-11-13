import Link from "next/link";

type AppHeaderProps = {
  email: string | null;
};

/** Slim top bar shared by the signed-in pages. */
export function AppHeader({ email }: AppHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        AI Assistant
      </Link>

      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          {email}
        </span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

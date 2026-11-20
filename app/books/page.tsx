import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { BooksBoard } from "@/components/books-board";
import { BottomNav } from "@/components/bottom-nav";
import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import { loadBooks, type BookShelf } from "@/lib/books";
import { errorMessage, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// Auth-gated page: always evaluate the session at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Books",
};

const EMPTY_SHELF: BookShelf = {
  reading: null,
  upNext: [],
  finished: [],
  dropped: [],
};

export default async function BooksPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Books</h1>
        <SetupNotice />
      </main>
    );
  }

  const user = await requireUser();
  const supabase = await createClient();

  let shelf: BookShelf = EMPTY_SHELF;
  let loadError: string | null = null;

  try {
    shelf = await loadBooks(supabase, user.id);
  } catch (error) {
    console.error(error);
    loadError = errorMessage(error);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <AppHeader email={user.email} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-md px-4 pb-8 pt-2">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Books</h1>
            <Link
              href="/progress"
              className="text-xs text-muted-foreground underline"
            >
              Progress
            </Link>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            One book at a time, with the pace it takes to finish it.
          </p>

          {loadError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {loadError}
            </p>
          ) : (
            <BooksBoard shelf={shelf} />
          )}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import { errorMessage, isSupabaseConfigured } from "@/lib/env";
import {
  loadJournalEntries,
  moodEmoji,
  type JournalEntry,
} from "@/lib/journal";
import { createClient } from "@/lib/supabase/server";
import { dayKeyLabel } from "@/lib/week";

// Auth-gated page: always evaluate the session at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Journal",
};

export default async function JournalPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Journal</h1>
        <SetupNotice />
      </main>
    );
  }

  const user = await requireUser();
  const supabase = await createClient();

  let entries: JournalEntry[] = [];
  let loadError: string | null = null;

  try {
    entries = await loadJournalEntries(supabase, user.id);
  } catch (error) {
    console.error(error);
    loadError = errorMessage(error);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AppHeader email={user.email} />

        <div className="mx-auto w-full max-w-md px-4 pt-4 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                One mood and one line a day. Private to you.
              </p>
            </div>
            <Link
              href="/"
              className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Home
            </Link>
          </div>

          {loadError && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {loadError}
            </p>
          )}

          {entries.length === 0 ? (
            !loadError && (
              <div className="mt-4 rounded-2xl border border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium">No entries yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Home asks how your day was after 8 pm.
                </p>
              </div>
            )
          ) : (
            <ul className="mt-4 space-y-2">
              {entries.map((entry) => (
                <li
                  key={entry.day}
                  className="flex items-start gap-3 rounded-2xl border border-border p-3"
                >
                  <span
                    aria-hidden="true"
                    className="text-2xl leading-none"
                  >
                    {moodEmoji(entry.mood)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {dayKeyLabel(entry.day)}
                    </p>
                    <p className="mt-1 text-sm">
                      {entry.note ?? "No note, just a mood."}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}

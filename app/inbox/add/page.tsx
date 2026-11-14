import type { Metadata } from "next";

import { AddLinkForm } from "@/components/add-link-form";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { readShareParams, type GoalOption } from "@/lib/inbox";
import { loadActiveGoals } from "@/lib/inbox-save";
import { createClient } from "@/lib/supabase/server";

// Auth-gated page: always evaluate the session at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add link",
};

type AddLinkPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** First value of a query param, whatever Next hands us. */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Manual add, and the Android share target (`/inbox/add?url=…&text=…`).
 */
export default async function AddLinkPage({ searchParams }: AddLinkPageProps) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Add link</h1>
        <SetupNotice />
      </main>
    );
  }

  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const shared = readShareParams({
    url: first(params.url),
    title: first(params.title),
    text: first(params.text),
  });

  let goals: GoalOption[] = [];
  try {
    goals = await loadActiveGoals(supabase, user.id);
  } catch (error) {
    console.error(error);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <AppHeader email={user.email} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4 pt-4 pb-6">
          <h1 className="text-xl font-semibold tracking-tight">Add a link</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Save an article, video, problem or job posting for later.
          </p>
          <AddLinkForm
            initialUrl={shared.url}
            initialNote={shared.note}
            goals={goals}
          />
        </div>
      </div>
      <BottomNav />
    </main>
  );
}

import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { InboxBoard } from "@/components/inbox-board";
import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import { errorMessage, isSupabaseConfigured } from "@/lib/env";
import { INBOX_ITEM_COLUMNS, type GoalOption, type InboxItem } from "@/lib/inbox";
import { loadActiveGoals } from "@/lib/inbox-save";
import { createClient } from "@/lib/supabase/server";

// Auth-gated page: always evaluate the session at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Inbox",
};

export default async function InboxPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <SetupNotice />
      </main>
    );
  }

  const user = await requireUser();
  const supabase = await createClient();

  let items: InboxItem[] = [];
  let goals: GoalOption[] = [];
  let loadError: string | null = null;

  try {
    const [itemsResult, goalRows] = await Promise.all([
      supabase
        .from("items")
        .select(INBOX_ITEM_COLUMNS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200),
      loadActiveGoals(supabase, user.id),
    ]);

    if (itemsResult.error) {
      throw new Error(itemsResult.error.message);
    }

    items = (itemsResult.data ?? []) as InboxItem[];
    goals = goalRows;
  } catch (error) {
    console.error(error);
    loadError = errorMessage(error);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <AppHeader email={user.email} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <InboxBoard items={items} goals={goals} loadError={loadError} />
      </div>
      <BottomNav />
    </main>
  );
}

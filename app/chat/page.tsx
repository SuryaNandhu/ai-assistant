import type { Metadata } from "next";
import type { UIMessage } from "ai";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { Chat } from "@/components/chat";
import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import { errorMessage, isSupabaseConfigured } from "@/lib/env";
import { loadRecentMessages } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

// Auth-gated page: always evaluate the session at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chat",
};

export default async function ChatPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-xl font-semibold tracking-tight">AI Assistant</h1>
        <SetupNotice />
      </main>
    );
  }

  const user = await requireUser();
  const supabase = await createClient();

  let initialMessages: UIMessage[] = [];
  let historyError: string | null = null;

  try {
    initialMessages = await loadRecentMessages(supabase, user.id);
  } catch (error) {
    console.error(error);
    historyError = errorMessage(error);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <AppHeader email={user.email} />
      <Chat initialMessages={initialMessages} historyError={historyError} />
      <BottomNav />
    </main>
  );
}


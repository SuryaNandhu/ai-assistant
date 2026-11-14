import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { HomeBoard } from "@/components/home-board";
import { HomeHeader } from "@/components/home-header";
import { QuickSaveButton } from "@/components/quick-save";
import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import { errorMessage, isSupabaseConfigured } from "@/lib/env";
import { loadWeeklyProgress, type WeeklyProgress } from "@/lib/progress";
import {
  QUICK_LOG_MAX_DAYS_BACK,
  quickLogTargets,
} from "@/lib/quick-log";
import { loadStreak, type Streak } from "@/lib/streak";
import { createClient } from "@/lib/supabase/server";
import { istDayKey, shiftDayKey } from "@/lib/week";

// Auth-gated page: always evaluate the session at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Home",
};

export default async function HomePage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-xl font-semibold tracking-tight">AI Assistant</h1>
        <SetupNotice />
      </main>
    );
  }

  const user = await requireUser();
  const supabase = await createClient();

  // The IST day keys are fixed on the server so the client never disagrees.
  const todayKey = istDayKey(new Date());
  const minDayKey = shiftDayKey(todayKey, -QUICK_LOG_MAX_DAYS_BACK);

  let progress: WeeklyProgress | null = null;
  let streak: Streak | null = null;
  let statsError: string | null = null;

  try {
    [progress, streak] = await Promise.all([
      loadWeeklyProgress(supabase, user.id),
      loadStreak(supabase, user.id),
    ]);
  } catch (error) {
    console.error(error);
    statsError = errorMessage(error);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AppHeader email={user.email} />
        <HomeHeader progress={progress} streak={streak} error={statsError} />
        <HomeBoard
          targets={quickLogTargets(progress?.goals ?? [])}
          todayKey={todayKey}
          minDayKey={minDayKey}
        />
      </div>
      <QuickSaveButton />
      <BottomNav />
    </main>
  );
}

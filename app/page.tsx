import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { HomeBoard } from "@/components/home-board";
import { HomeHeader } from "@/components/home-header";
import { JournalCard } from "@/components/journal-card";
import { ProjectCard } from "@/components/project-card";
import { QuickSaveButton } from "@/components/quick-save";
import { ScreenTimePrompt } from "@/components/screen-time-prompt";
import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import { currentMonth } from "@/lib/calendar";
import { errorMessage, isSupabaseConfigured } from "@/lib/env";
import {
  isJournalPromptTime,
  loadJournalEntry,
  type JournalEntry,
} from "@/lib/journal";
import { loadWeeklyProgress, type WeeklyProgress } from "@/lib/progress";
import {
  loadProject,
  projectMonthLabel,
  type ProjectDetail,
} from "@/lib/project";
import {
  QUICK_LOG_MAX_DAYS_BACK,
  quickLogTargets,
} from "@/lib/quick-log";
import { loadMissingScreenDays } from "@/lib/screen-time";
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
  const now = new Date();
  const todayKey = istDayKey(now);
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

  // A missing journal table should only hide the card, never break Home.
  let journalEntry: JournalEntry | null = null;
  try {
    journalEntry = await loadJournalEntry(supabase, user.id, todayKey);
  } catch (error) {
    console.error("Could not load today's journal entry:", error);
  }

  // Screen time is asked for one completed day at a time; a missing table just
  // hides the card instead of breaking Home.
  let missingScreenDays: string[] = [];
  try {
    missingScreenDays = await loadMissingScreenDays(supabase, user.id, now);
  } catch (error) {
    console.error("Could not load missing screen-time days:", error);
  }

  // The monthly project card: a missing table hides the card, never the page.
  let projectDetail: ProjectDetail | null = null;
  const thisMonth = currentMonth(now);
  try {
    projectDetail = await loadProject(supabase, user.id, thisMonth);
  } catch (error) {
    console.error("Could not load this month's project:", error);
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
        <ProjectCard
          monthLabel={projectMonthLabel(thisMonth)}
          project={projectDetail?.project ?? null}
          milestones={projectDetail?.milestones ?? []}
        />
        <ScreenTimePrompt days={missingScreenDays} todayKey={todayKey} />
        <JournalCard
          entry={journalEntry}
          showPrompt={isJournalPromptTime(now)}
        />
      </div>
      <QuickSaveButton />
      <BottomNav />
    </main>
  );
}

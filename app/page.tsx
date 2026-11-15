import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { HomeBoard } from "@/components/home-board";
import { HomeHeader } from "@/components/home-header";
import { JournalBacklogCard } from "@/components/journal-backlog-card";
import { JournalCard } from "@/components/journal-card";
import { LastWeekCard } from "@/components/last-week-card";
import { ProjectCard } from "@/components/project-card";
import { QuickSaveButton } from "@/components/quick-save";
import { ScreenTimePrompt } from "@/components/screen-time-prompt";
import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import { currentMonth } from "@/lib/calendar";
import { errorMessage, isSupabaseConfigured } from "@/lib/env";
import {
  isJournalPromptTime,
  loadJournalBacklog,
  loadJournalEntry,
  type JournalBacklog,
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
import { loadGoalCards } from "@/lib/services/quick-add";
import {
  loadRestDayState,
  type RestDayState,
} from "@/lib/services/rest-day";
import { loadWeeklySummary, type WeekSummary } from "@/lib/services/weekly";
import { loadStreak, type Streak } from "@/lib/streak";
import { createClient } from "@/lib/supabase/server";
import type { GoalCard } from "@/lib/targets";
import { istDayKey, istParts, shiftDayKey } from "@/lib/week";

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

  // A missing journal table should only hide the cards, never break Home.
  let journalEntry: JournalEntry | null = null;
  let journalBacklog: JournalBacklog = { start: null, missing: [] };
  try {
    [journalEntry, journalBacklog] = await Promise.all([
      loadJournalEntry(supabase, user.id, todayKey),
      loadJournalBacklog(supabase, user.id, now),
    ]);
  } catch (error) {
    console.error("Could not load the journal:", error);
  }

  // The weekly rest day: a missing 008 column only hides the button's actions.
  let restDay: RestDayState | null = null;
  try {
    restDay = await loadRestDayState({ supabase, userId: user.id }, now);
  } catch (error) {
    console.error("Could not load the rest day:", error);
  }

  // Monday and Tuesday: the week that just ended is still fresh news, so Home
  // shows one line about it. A failure here only hides the card.
  let lastWeek: WeekSummary | null = null;
  const { weekday } = istParts(now);
  if (weekday === 1 || weekday === 2) {
    try {
      const weeks = await loadWeeklySummary(
        { supabase, userId: user.id },
        now,
        2,
      );
      lastWeek = weeks.find((week) => !week.isCurrent) ?? null;
    } catch (error) {
      console.error("Could not load last week's summary:", error);
    }
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

  // The add sheet's goal tab: a missing 007 migration empties the list, which
  // only hides the goal rows and never breaks Home.
  let goalCards: GoalCard[] = [];
  try {
    goalCards = await loadGoalCards(supabase, user.id);
  } catch (error) {
    console.error("Could not load targets for the add sheet:", error);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AppHeader email={user.email} />
        <HomeHeader
          progress={progress}
          streak={streak}
          restDay={restDay}
          error={statsError}
        />
        {lastWeek && <LastWeekCard week={lastWeek} />}
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
        <JournalBacklogCard
          days={journalBacklog.missing}
          todayKey={todayKey}
        />
      </div>
      <QuickSaveButton goals={goalCards} />
      <BottomNav />
    </main>
  );
}

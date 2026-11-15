import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { ProjectBoard } from "@/components/project-board";
import { SetupNotice } from "@/components/setup-notice";
import { requireUser } from "@/lib/auth";
import {
  currentMonth,
  monthKey,
  parseMonthKey,
  shiftMonth,
} from "@/lib/calendar";
import { errorMessage, isSupabaseConfigured } from "@/lib/env";
import {
  loadProject,
  projectMonthLabel,
  type ProjectDetail,
} from "@/lib/project";
import { createClient } from "@/lib/supabase/server";

// Auth-gated page: always evaluate the session at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project",
};

type ProjectPageProps = {
  /** `?month=YYYY-MM`, validated below; anything else falls back to today. */
  searchParams: Promise<{ month?: string | string[] }>;
};

const ARROW_BUTTON =
  "flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

/**
 * One project per month: the project notes, its milestone checklist, the update
 * log and the resume entry drafted from all of it.
 */
export default async function ProjectPage({ searchParams }: ProjectPageProps) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Project</h1>
        <SetupNotice />
      </main>
    );
  }

  const user = await requireUser();
  const supabase = await createClient();

  const now = new Date();
  const thisMonth = currentMonth(now);

  const params = await searchParams;
  const rawMonth = Array.isArray(params.month) ? params.month[0] : params.month;
  const visible = parseMonthKey(rawMonth) ?? thisMonth;
  const visibleKey = monthKey(visible);
  const isCurrentMonth = visibleKey === monthKey(thisMonth);

  let detail: ProjectDetail | null = null;
  let loadError: string | null = null;

  try {
    detail = await loadProject(supabase, user.id, visible);
  } catch (error) {
    console.error(error);
    loadError = errorMessage(error);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AppHeader email={user.email} />
        <div className="mx-auto w-full max-w-md px-4 pt-4 pb-6">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Project</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                One project a month, from plan to resume line.
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-border p-2">
            <Link
              href={`/project?month=${monthKey(shiftMonth(visible, -1))}`}
              aria-label="Previous month"
              className={ARROW_BUTTON}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="m14 6-6 6 6 6" />
              </svg>
            </Link>

            <div className="min-w-0 text-center">
              <p className="text-sm font-semibold">
                {projectMonthLabel(visible)}
              </p>
              {isCurrentMonth ? (
                <p className="text-[11px] text-muted-foreground">
                  This month
                </p>
              ) : (
                <Link
                  href="/project"
                  className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Back to this month
                </Link>
              )}
            </div>

            <Link
              href={`/project?month=${monthKey(shiftMonth(visible, 1))}`}
              aria-label="Next month"
              className={ARROW_BUTTON}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="m10 6 6 6-6 6" />
              </svg>
            </Link>
          </div>

          <ProjectBoard
            key={visibleKey}
            detail={detail}
            month={visibleKey}
            monthLabel={projectMonthLabel(visible)}
            loadError={loadError}
          />
        </div>
      </div>
      <BottomNav />
    </main>
  );
}

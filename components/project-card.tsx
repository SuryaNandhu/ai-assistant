import Link from "next/link";

import {
  PROJECT_STATUS_LABELS,
  milestoneProgress,
  nextMilestone,
  type Project,
  type ProjectMilestone,
} from "@/lib/project";

type ProjectCardProps = {
  /** `November 2026` for the month on screen. */
  monthLabel: string;
  project: Project | null;
  milestones: readonly ProjectMilestone[];
};

/**
 * Home's monthly project card: the one thing this month is about. It stays a
 * link rather than a form so Home keeps its single focus.
 */
export function ProjectCard({
  monthLabel,
  project,
  milestones,
}: ProjectCardProps) {
  const progress = milestoneProgress(milestones);
  const next = nextMilestone(milestones);
  const percent =
    progress.total === 0
      ? 0
      : Math.round((progress.done / progress.total) * 100);

  return (
    <section className="mx-auto w-full max-w-md px-4 pb-6">
      <Link
        href="/project"
        className="block rounded-2xl border border-border bg-background p-4 transition-colors hover:bg-muted"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">This month&apos;s project</h2>
          <span className="text-xs font-medium text-muted-foreground underline-offset-2">
            {monthLabel}
          </span>
        </div>

        {project ? (
          <>
            <p className="mt-2 truncate text-sm font-medium">{project.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {PROJECT_STATUS_LABELS[project.status]} · {progress.done}/
              {progress.total} milestones
            </p>

            <div
              role="progressbar"
              aria-label="Milestones done"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
            >
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${percent}%` }}
              />
            </div>

            <p className="mt-2 truncate text-sm text-muted-foreground">
              {next
                ? `Next: ${next.title}`
                : progress.total > 0
                  ? "All milestones done."
                  : "Add a milestone to get moving."}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No project for {monthLabel} yet. Tap to pick the one thing you ship
            this month.
          </p>
        )}
      </Link>
    </section>
  );
}

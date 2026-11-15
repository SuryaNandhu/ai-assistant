"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  addMilestoneAction,
  addProjectUpdateAction,
  deleteMilestoneAction,
  draftResumeAction,
  saveProjectAction,
  setMilestoneDoneAction,
  type ProjectActionResult,
} from "@/app/project-actions";
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_GOAL_MAX,
  PROJECT_REPO_MAX,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  PROJECT_TITLE_MAX,
  PROJECT_UPDATE_MAX,
  milestoneProgress,
  nextMilestone,
  type Project,
  type ProjectDetail,
  type ProjectMilestone,
  type ProjectStatus,
  type ProjectUpdate,
} from "@/lib/project";
import { dayKeyLabel, istDayKey } from "@/lib/week";

const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

const TEXTAREA_CLASS =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

const CARD = "rounded-2xl border border-border p-3";

const PRIMARY_BUTTON =
  "h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50";

const QUIET_BUTTON =
  "h-9 shrink-0 rounded-xl border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50";

const STATUS_BADGE: Record<ProjectStatus, string> = {
  planned: "bg-muted text-muted-foreground",
  in_progress: "bg-foreground/10 text-foreground",
  shipped: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  dropped: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function Alert({ message, tone }: { message: string; tone: "error" | "ok" }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={[
        "mt-2 rounded-xl border p-2.5 text-xs",
        tone === "error"
          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
      ].join(" ")}
    >
      {message}
    </p>
  );
}

type ProjectBoardProps = {
  detail: ProjectDetail | null;
  /** `YYYY-MM` of the month on screen. */
  month: string;
  monthLabel: string;
  loadError: string | null;
};

/**
 * The project screen after the month header: project notes, milestones, the
 * update feed and the resume draft. Every write goes through a server action,
 * which re-renders this page.
 */
export function ProjectBoard({
  detail,
  month,
  monthLabel,
  loadError,
}: ProjectBoardProps) {
  const [editing, setEditing] = useState(detail === null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(loadError);

  function afterChange(result: ProjectActionResult, close?: boolean) {
    if (!result.ok) {
      setError(result.message);
      return;
    }

    setError(null);
    setNotice(result.message);
    if (close) setEditing(false);
  }

  return (
    <div className="mt-3 space-y-3">
      {error && <Alert message={error} tone="error" />}
      {notice && !error && <Alert message={notice} tone="ok" />}

      {editing ? (
        <ProjectForm
          month={month}
          project={detail?.project ?? null}
          monthLabel={monthLabel}
          onResult={(result) => afterChange(result, true)}
          onCancel={detail ? () => setEditing(false) : undefined}
        />
      ) : detail ? (
        <ProjectSummary
          project={detail.project}
          milestones={detail.milestones}
          onEdit={() => {
            setError(null);
            setNotice(null);
            setEditing(true);
          }}
        />
      ) : null}

      {detail && (
        <>
          <MilestonesSection
            month={month}
            milestones={detail.milestones}
            onResult={afterChange}
          />
          <ResumeSection
            month={month}
            project={detail.project}
            onResult={afterChange}
          />
          <UpdatesSection
            month={month}
            updates={detail.updates}
            onResult={afterChange}
          />
        </>
      )}
    </div>
  );
}

type ProjectFormProps = {
  month: string;
  project: Project | null;
  monthLabel: string;
  onResult: (result: ProjectActionResult) => void;
  onCancel?: () => void;
};

/** Create or edit the month's project. `null` project means a fresh form. */
function ProjectForm({
  month,
  project,
  monthLabel,
  onResult,
  onCancel,
}: ProjectFormProps) {
  const router = useRouter();

  const [title, setTitle] = useState(project?.title ?? "");
  const [goal, setGoal] = useState(project?.goal ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl ?? "");
  const [status, setStatus] = useState<ProjectStatus>(
    project?.status ?? "planned",
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    if (!title.trim()) {
      setLocalError("Give the project a title first.");
      return;
    }

    if (repoUrl.trim() && !/^https?:\/\//i.test(repoUrl.trim())) {
      setLocalError("The repo link should start with http:// or https://.");
      return;
    }

    setLocalError(null);

    startSaving(async () => {
      const result = await saveProjectAction({
        month,
        title,
        goal,
        description,
        repoUrl,
        status,
      });

      onResult(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {project ? "Edit project" : "Start this month's project"}
        </h2>
        <span className="text-[11px] text-muted-foreground">{monthLabel}</span>
      </div>

      <label htmlFor="project-title" className="mt-3 block text-sm font-medium">
        Title
      </label>
      <input
        id="project-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={PROJECT_TITLE_MAX}
        placeholder="Portfolio site rebuild"
        className={INPUT_CLASS}
      />

      <label htmlFor="project-goal" className="mt-3 block text-sm font-medium">
        Goal <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <input
        id="project-goal"
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        maxLength={PROJECT_GOAL_MAX}
        placeholder="Ship a public site with three case studies"
        className={INPUT_CLASS}
      />

      <label
        htmlFor="project-description"
        className="mt-3 block text-sm font-medium"
      >
        Notes{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <textarea
        id="project-description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={PROJECT_DESCRIPTION_MAX}
        rows={4}
        placeholder="What you are building, for whom, and what done looks like."
        className={`mt-1 ${TEXTAREA_CLASS}`}
      />

      <label htmlFor="project-repo" className="mt-3 block text-sm font-medium">
        Repo or link{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <input
        id="project-repo"
        type="url"
        value={repoUrl}
        onChange={(event) => setRepoUrl(event.target.value)}
        maxLength={PROJECT_REPO_MAX}
        placeholder="https://github.com/you/project"
        className={INPUT_CLASS}
      />

      <p className="mt-3 text-sm font-medium">Status</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PROJECT_STATUSES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setStatus(option)}
            aria-pressed={status === option}
            className={[
              "h-10 rounded-xl border px-3 text-sm font-medium transition-colors",
              status === option
                ? "border-transparent bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            ].join(" ")}
          >
            {PROJECT_STATUS_LABELS[option]}
          </button>
        ))}
      </div>

      {localError && <Alert message={localError} tone="error" />}

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? "Saving…" : project ? "Save changes" : "Create project"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className={QUIET_BUTTON}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}


type ProjectSummaryProps = {
  project: Project;
  milestones: readonly ProjectMilestone[];
  onEdit: () => void;
};

/** Read view of the project: title, status, notes, link and progress. */
function ProjectSummary({ project, milestones, onEdit }: ProjectSummaryProps) {
  const progress = milestoneProgress(milestones);
  const next = nextMilestone(milestones);

  return (
    <section className={CARD}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{project.title}</h2>
          <span
            className={[
              "mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
              STATUS_BADGE[project.status],
            ].join(" ")}
          >
            {PROJECT_STATUS_LABELS[project.status]}
          </span>
        </div>
        <button type="button" onClick={onEdit} className={QUIET_BUTTON}>
          Edit
        </button>
      </div>

      {project.goal && (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Goal: </span>
          {project.goal}
        </p>
      )}

      {project.description && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {project.description}
        </p>
      )}

      {project.repoUrl && (
        <a
          href={project.repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block break-all text-sm font-medium underline underline-offset-2"
        >
          {project.repoUrl}
        </a>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {progress.total === 0
          ? "No milestones yet."
          : `${progress.done} of ${progress.total} milestones done${
              next ? ` · next: ${next.title}` : " · all done"
            }`}
      </p>
    </section>
  );
}


type MilestonesSectionProps = {
  month: string;
  milestones: readonly ProjectMilestone[];
  onResult: (result: ProjectActionResult) => void;
};

/** The checklist: tick, untick, remove, and add one at a time. */
function MilestonesSection({
  month,
  milestones,
  onResult,
}: MilestonesSectionProps) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const [adding, startAdding] = useTransition();
  const [updating, startUpdating] = useTransition();

  const progress = milestoneProgress(milestones);

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding || !title.trim()) return;

    startAdding(async () => {
      const result = await addMilestoneAction({ month, title });

      onResult(result);
      if (result.ok) {
        setTitle("");
        router.refresh();
      }
    });
  }

  function toggle(milestone: ProjectMilestone) {
    if (updating) return;

    setPendingId(milestone.id);

    startUpdating(async () => {
      const result = await setMilestoneDoneAction({
        id: milestone.id,
        done: !milestone.done,
      });

      setPendingId(null);
      onResult(result);
      if (result.ok) router.refresh();
    });
  }

  function remove(milestone: ProjectMilestone) {
    if (updating) return;

    setPendingId(milestone.id);

    startUpdating(async () => {
      const result = await deleteMilestoneAction({ id: milestone.id });

      setPendingId(null);
      onResult(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Milestones</h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {progress.done}/{progress.total} done
        </span>
      </div>

      {milestones.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Break the project into three to five checkpoints.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {milestones.map((milestone) => {
            const busy = updating && pendingId === milestone.id;

            return (
              <li
                key={milestone.id}
                className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={milestone.done}
                  aria-label={milestone.title}
                  onClick={() => toggle(milestone)}
                  disabled={busy}
                  className={[
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs transition-colors disabled:opacity-50",
                    milestone.done
                      ? "border-transparent bg-foreground text-background"
                      : "border-border text-transparent hover:border-foreground/40",
                  ].join(" ")}
                >
                  ✓
                </button>

                <span
                  className={[
                    "min-w-0 flex-1 text-sm",
                    milestone.done
                      ? "text-muted-foreground line-through"
                      : "text-foreground",
                  ].join(" ")}
                >
                  {milestone.title}
                </span>

                <button
                  type="button"

                  onClick={() => remove(milestone)}
                  disabled={busy}
                  aria-label={`Remove ${milestone.title}`}
                  className="h-7 w-7 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={handleAdd} className="mt-3 flex gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={160}
          placeholder="Add a milestone"
          aria-label="New milestone"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={adding || !title.trim()}
          className={PRIMARY_BUTTON}
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>
    </section>
  );
}


type ResumeSectionProps = {
  month: string;
  project: Project;
  onResult: (result: ProjectActionResult) => void;
};

/** Draft with the model, then copy the entry into a resume. */
function ResumeSection({ month, project, onResult }: ResumeSectionProps) {
  const router = useRouter();

  const [drafting, startDrafting] = useTransition();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const text = project.resumeDraft;

  function draft() {
    if (drafting) return;

    setCopied(false);

    startDrafting(async () => {
      const result = await draftResumeAction({ month });

      onResult(result);
      if (result.ok) router.refresh();
    });
  }

  async function copy() {
    if (!text) return;

    setCopyError(null);

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopyError("Copy failed. Select the text and copy it by hand.");
    }
  }

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Resume entry</h2>
        {project.resumeDraftedAt && (
          <span className="text-[11px] text-muted-foreground">
            Drafted{" "}
            {new Date(project.resumeDraftedAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              timeZone: "Asia/Kolkata",
            })}
          </span>
        )}
      </div>

      {text ? (
        <>
          <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/60 p-2.5 font-sans text-sm leading-relaxed">
            {text}
          </pre>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={copy} className={QUIET_BUTTON}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={draft}
              disabled={drafting}
              className={QUIET_BUTTON}
            >
              {drafting ? "Drafting…" : "Draft again"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Turns this project, its milestones and its updates into two resume
            lines.
          </p>
          <button
            type="button"
            onClick={draft}
            disabled={drafting}
            className={`mt-2 ${PRIMARY_BUTTON}`}
          >
            {drafting ? "Drafting…" : "Draft resume entry"}
          </button>
        </>
      )}

      {copyError && <Alert message={copyError} tone="error" />}
    </section>
  );
}

type UpdatesSectionProps = {
  month: string;
  updates: readonly ProjectUpdate[];
  onResult: (result: ProjectActionResult) => void;
};

/** A dated log of what moved on the project. */
function UpdatesSection({ month, updates, onResult }: UpdatesSectionProps) {
  const router = useRouter();

  const [note, setNote] = useState("");
  const [adding, startAdding] = useTransition();

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding || !note.trim()) return;

    startAdding(async () => {
      const result = await addProjectUpdateAction({ month, note });

      onResult(result);
      if (result.ok) {
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <section className={CARD}>
      <h2 className="text-sm font-semibold">Updates</h2>

      <form onSubmit={handleAdd} className="mt-2 flex gap-2">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={PROJECT_UPDATE_MAX}
          placeholder="Shipped the auth flow"
          aria-label="New project update"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={adding || !note.trim()}
          className={PRIMARY_BUTTON}
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      {updates.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing logged yet this month.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {updates.map((update) => (
            <li key={update.id} className="rounded-xl bg-muted/60 p-2.5">
              <p className="text-sm break-words">{update.note}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {dayKeyLabel(istDayKey(new Date(update.createdAt)))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

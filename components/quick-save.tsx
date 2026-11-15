"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  addGoalAction,
  addTaskAction,
  deleteGoalAction,
  setGoalActiveAction,
} from "@/app/quick-add-actions";
import { ITEM_TITLE_MAX } from "@/lib/inbox";
import {
  CUSTOM_GOAL_MAX_ACTIVE,
  GOAL_LABEL_MAX,
  type GoalCard,
} from "@/lib/targets";

/**
 * Floating "+" that opens one sheet with three ways in: paste a link, add a
 * one-off task, or make a weekly goal. Links still post to `/api/items/add` so
 * validation, the SSRF checks, duplicate detection and enrichment stay in one
 * place; the other two call `app/quick-add-actions.ts`, which the chat tools
 * share, so both always write the same rows.
 */

type Tab = "link" | "task" | "goal";

const TABS: { value: Tab; label: string }[] = [
  { value: "link", label: "Link" },
  { value: "task", label: "Task" },
  { value: "goal", label: "Goal" },
];

/** Minutes offered for a task; 30 is the same default targets use. */
const TASK_MINUTES = [15, 30, 60] as const;
const PER_WEEK = [1, 2, 3, 4, 5, 6, 7] as const;

const NETWORK =
  "Could not reach the server. Check your connection and try again.";

const CHIP_IDLE =
  "h-9 rounded-xl border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted";
const CHIP_ON =
  "h-9 rounded-xl border border-foreground bg-foreground px-3 text-sm font-semibold text-background";

function headingFor(tab: Tab): { title: string; hint: string; submit: string } {
  if (tab === "task") {
    return {
      title: "Add a task",
      hint: "A one-off thing to do. No link, no goal — it waits in Saved.",
      submit: "Add task",
    };
  }

  if (tab === "goal") {
    return {
      title: "Add a goal",
      hint: "A weekly target of your own. It appears on Home straight away.",
      submit: "Add goal",
    };
  }

  return {
    title: "Save a link",
    hint: "Paste anything worth coming back to. The title and tags fill in after saving.",
    submit: "Save link",
  };
}

/** Keeps the list in the same order the server sends it: active, then label. */
function sortedGoals(list: GoalCard[]): GoalCard[] {
  return [...list].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export function QuickSaveButton({
  goals = [],
}: {
  /** Every target, active first; empty hides the goal list but not the tab. */
  goals?: readonly GoalCard[];
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState<number>(30);
  const [goalLabel, setGoalLabel] = useState("");
  const [perWeek, setPerWeek] = useState<number>(3);
  /** Null until the user changes something, so a refresh still shows through. */
  const [editedGoals, setEditedGoals] = useState<GoalCard[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyGoal, setBusyGoal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const goalList: readonly GoalCard[] = editedGoals ?? goals;
  const activeGoals = goalList.filter((row) => row.active).length;
  const atGoalLimit = activeGoals >= CUSTOM_GOAL_MAX_ACTIVE;
  const copy = headingFor(tab);

  // The confirmation is a glance, not a notification.
  useEffect(() => {
    if (!confirmation) return;

    const timer = window.setTimeout(() => setConfirmation(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function openSheet() {
    setError(null);
    setNotice(null);
    setDuplicate(false);
    setConfirming(null);
    setOpen(true);
  }

  function switchTab(next: Tab) {
    setTab(next);
    setError(null);
    setNotice(null);
    setDuplicate(false);
    setConfirming(null);
  }

  async function handleLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setError(null);
    setNotice(null);
    setDuplicate(false);

    if (!url.trim()) {
      setError("Paste a link to save.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/items/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; duplicate?: boolean; message?: string }
        | null;

      if (!response.ok || !body?.ok) {
        setError(body?.message ?? "Could not save that link. Try again.");
        return;
      }

      if (body.duplicate) {
        setDuplicate(true);
        return;
      }

      setOpen(false);
      setUrl("");
      setConfirmation("Saved. Find it in Saved.");
      router.refresh();
    } catch {
      setError(NETWORK);
    } finally {
      setSaving(false);
    }
  }

  async function handleTaskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setError(null);
    setNotice(null);

    if (title.trim().length < 2) {
      setError("Give the task a name.");
      return;
    }

    setSaving(true);

    try {
      const result = await addTaskAction({ title, estMinutes: minutes });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      // Stay on the tab: adding three things in a row is the common case.
      setTitle("");
      setNotice(result.message);
      router.refresh();
    } catch {
      setError(NETWORK);
    } finally {
      setSaving(false);
    }
  }

  async function handleGoalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setError(null);
    setNotice(null);

    if (goalLabel.trim().length < 2) {
      setError("Give the goal a name.");
      return;
    }

    setSaving(true);

    try {
      const result = await addGoalAction({ label: goalLabel, perWeek });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const card = result.goal;

      if (card) {
        setEditedGoals((current) =>
          sortedGoals([
            ...(current ?? goalList).filter((row) => row.goal !== card.goal),
            card,
          ]),
        );
      }

      setGoalLabel("");
      setNotice(result.message);
      router.refresh();
    } catch {
      setError(NETWORK);
    } finally {
      setSaving(false);
    }
  }

  async function toggleGoal(goal: GoalCard) {
    if (busyGoal || saving) return;

    setBusyGoal(goal.goal);
    setError(null);
    setNotice(null);
    setConfirming(null);

    try {
      const result = await setGoalActiveAction({
        goal: goal.goal,
        active: !goal.active,
      });

      if (!result.ok || !result.goal) {
        setError(result.message);
        return;
      }

      const card = result.goal;
      setEditedGoals((current) =>
        sortedGoals(
          (current ?? goalList).map((row) =>
            row.goal === card.goal ? card : row,
          ),
        ),
      );
      setNotice(result.message);
      router.refresh();
    } catch {
      setError(NETWORK);
    } finally {
      setBusyGoal(null);
    }
  }

  async function deleteGoal(goal: GoalCard) {
    if (busyGoal || saving) return;

    // Two taps instead of a confirm dialog: fast on a phone, no modal on modal.
    if (confirming !== goal.goal) {
      setConfirming(goal.goal);
      setError(null);
      setNotice(null);
      return;
    }

    setBusyGoal(goal.goal);
    setConfirming(null);

    try {
      const result = await deleteGoalAction({ goal: goal.goal });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setEditedGoals((current) =>
        (current ?? goalList).filter((row) => row.goal !== goal.goal),
      );
      setNotice(result.message);
      router.refresh();
    } catch {
      setError(NETWORK);
    } finally {
      setBusyGoal(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label="Add something"
        title="Add something"
        className="fixed right-4 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg transition-transform active:scale-95"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="h-6 w-6"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {confirmation && !open && (
        <p
          role="status"
          className="fixed right-4 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+5rem)] z-40 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {confirmation}
        </p>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-save-title"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/40"
          />

          <form
            onSubmit={
              tab === "link"
                ? handleLinkSubmit
                : tab === "task"
                  ? handleTaskSubmit
                  : handleGoalSubmit
            }
            className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-border bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />

            <h2
              id="quick-save-title"
              className="text-lg font-semibold tracking-tight"
            >
              {copy.title}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{copy.hint}</p>

            <div
              role="tablist"
              aria-label="What to add"
              className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
            >
              {TABS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.value}
                  onClick={() => switchTab(item.value)}
                  className={
                    tab === item.value
                      ? "h-9 rounded-lg bg-background text-sm font-semibold shadow-sm"
                      : "h-9 rounded-lg text-sm font-medium text-muted-foreground"
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === "link" && (
              <input
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/article"
                aria-label="Link to save"
                className="mt-4 h-12 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
              />
            )}

            {tab === "task" && (
              <>
                <input
                  type="text"
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Renew passport"
                  aria-label="Task name"
                  maxLength={ITEM_TITLE_MAX}
                  className="mt-4 h-12 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
                />

                <p className="mt-3 text-xs font-medium text-muted-foreground">
                  About how long?
                </p>
                <div className="mt-1.5 flex gap-2">
                  {TASK_MINUTES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={minutes === value}
                      onClick={() => setMinutes(value)}
                      className={minutes === value ? CHIP_ON : CHIP_IDLE}
                    >
                      {value} min
                    </button>
                  ))}
                </div>
              </>
            )}

            {tab === "goal" && (
              <>
                <input
                  type="text"
                  autoFocus
                  value={goalLabel}
                  onChange={(event) => setGoalLabel(event.target.value)}
                  placeholder="Read non-fiction"
                  aria-label="Goal name"
                  maxLength={GOAL_LABEL_MAX}
                  className="mt-4 h-12 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
                />

                <p className="mt-3 text-xs font-medium text-muted-foreground">
                  How many times a week?
                </p>
                <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                  {PER_WEEK.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={perWeek === value}
                      onClick={() => setPerWeek(value)}
                      className={`${perWeek === value ? CHIP_ON : CHIP_IDLE} px-0`}
                    >
                      {value}×
                    </button>
                  ))}
                </div>

                {atGoalLimit && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    {CUSTOM_GOAL_MAX_ACTIVE} targets is the limit. Pause one
                    below to make room.
                  </p>
                )}
              </>
            )}

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              >
                {error}
              </p>
            )}

            {notice && (
              <p
                role="status"
                className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
              >
                {notice}
              </p>
            )}

            {duplicate && (
              <p
                role="status"
                className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
              >
                That link is already saved.
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="h-12 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || (tab === "goal" && atGoalLimit)}
                className="h-12 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
              >
                {saving ? "Saving…" : copy.submit}
              </button>
            </div>

            {tab === "goal" && goalList.length > 0 && (
              <div className="mt-5 border-t border-border pt-4">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Your targets
                </p>
                <ul className="mt-1 divide-y divide-border">
                  {goalList.map((goal) => (
                    <li
                      key={goal.goal}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <span
                        className={
                          goal.active
                            ? "truncate text-sm font-medium"
                            : "truncate text-sm font-medium text-muted-foreground"
                        }
                      >
                        {goal.label}
                        {!goal.active && (
                          <span className="ml-1.5 text-xs font-normal">
                            paused
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleGoal(goal)}
                          disabled={Boolean(busyGoal)}
                          className="h-8 rounded-lg border border-border px-2 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                        >
                          {busyGoal === goal.goal
                            ? "…"
                            : goal.active
                              ? "Pause"
                              : "Resume"}
                        </button>
                        {goal.isCustom && (
                          <button
                            type="button"
                            onClick={() => deleteGoal(goal)}
                            disabled={Boolean(busyGoal)}
                            className={
                              confirming === goal.goal
                                ? "h-8 rounded-lg border border-red-300 bg-red-50 px-2 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                                : "h-8 rounded-lg border border-border px-2 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                            }
                          >
                            {confirming === goal.goal ? "Sure?" : "Delete"}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Paused targets keep their history and stay out of Home. Only
                  goals you made can be deleted.
                </p>
              </div>
            )}
          </form>
        </div>
      )}
    </>
  );
}

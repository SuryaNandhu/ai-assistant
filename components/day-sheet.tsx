"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { saveJournalDayAction } from "@/app/journal/actions";
import {
  deleteCompletionAction,
  updateCompletionAction,
} from "@/app/progress/actions";
import { saveScreenTimeAction } from "@/app/screen-time-actions";
import { QuickLogSheet } from "@/components/quick-log-sheet";
import { JOURNAL_MOODS, JOURNAL_NOTE_MAX, moodEmoji } from "@/lib/journal";
import { EDIT_WINDOW_DAYS, isLocked } from "@/lib/lock";
import { QUICK_LOG_MAX_DAYS_BACK, type QuickLogTarget } from "@/lib/quick-log";
import { formatKm, type CompletionEntry, type DayJournal } from "@/lib/report";
import {
  SCREEN_TIME_MAX_DAYS_BACK,
  SCREEN_TIME_MAX_MINUTES,
  formatMinutes,
  isOverLimit,
} from "@/lib/screen-time";
import { DISTANCE_GOAL, FELT_OPTIONS, type Felt } from "@/lib/task";
import { dayKeyLabel, shiftDayKey } from "@/lib/week";

type EditDraft = {
  minutes: string;
  distance: string;
  felt: Felt;
  note: string;
};

const INPUT_CLASS =
  "mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

const SMALL_BUTTON =
  "h-11 rounded-xl border border-border text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50";

function feltLabel(felt: CompletionEntry["felt"]): string | null {
  return FELT_OPTIONS.find((option) => option.value === felt)?.label ?? null;
}

/**
 * One completion with its own edit/delete state. Editing is inline so the panel
 * never navigates away from the day.
 */
function CompletionItem({
  entry,
  locked,
}: {
  entry: CompletionEntry;
  locked: boolean;
}) {
  const router = useRouter();

  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();

  const meta = [
    entry.minutes !== null ? `${entry.minutes} min` : null,
    entry.distanceKm !== null ? formatKm(entry.distanceKm) : null,
    feltLabel(entry.felt),
  ]
    .filter(Boolean)
    .join(" · ");

  function beginEdit() {
    setError(null);
    setConfirming(false);
    setDraft({
      minutes: entry.minutes === null ? "" : String(entry.minutes),
      distance: entry.distanceKm === null ? "" : String(entry.distanceKm),
      felt: entry.felt ?? "ok",
      note: entry.note ?? "",
    });
  }

  function save() {
    if (!draft || saving) return;

    const minutes = Number(draft.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
      setError("Minutes should be between 1 and 600.");
      return;
    }

    let distanceKm: number | null = entry.distanceKm;
    if (entry.goal === DISTANCE_GOAL) {
      const parsed = Number(draft.distance.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        setError("Distance should be between 0 and 100 km.");
        return;
      }
      distanceKm = parsed;
    }

    setError(null);

    startSaving(async () => {
      const result = await updateCompletionAction({
        id: entry.id,
        minutes: Math.round(minutes),
        felt: draft.felt,
        note: draft.note.trim() ? draft.note.trim() : null,
        distanceKm: entry.goal === DISTANCE_GOAL ? distanceKm : undefined,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setDraft(null);
      router.refresh();
    });
  }

  function remove() {
    if (deleting) return;

    setError(null);

    startDeleting(async () => {
      const result = await deleteCompletionAction({ id: entry.id });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <li className="rounded-2xl border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {entry.title ?? entry.goalLabel}
          </p>
          {meta && (
            <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
          )}
        </div>
        <span
          className={[
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            entry.source === "manual"
              ? "border-border text-muted-foreground"
              : "border-foreground/25 bg-muted text-foreground",
          ].join(" ")}
        >
          {entry.source === "manual" ? "Manual" : "Suggested"}
        </span>
      </div>

      {entry.note && (
        <p className="mt-2 text-sm text-muted-foreground">{entry.note}</p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="mt-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                Minutes
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                value={draft.minutes}
                onChange={(event) =>
                  setDraft({ ...draft, minutes: event.target.value })
                }
                className={INPUT_CLASS}
              />
            </label>

            {entry.goal === DISTANCE_GOAL && (
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  Distance (km)
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.1"
                  value={draft.distance}
                  onChange={(event) =>
                    setDraft({ ...draft, distance: event.target.value })
                  }
                  className={INPUT_CLASS}
                />
              </label>
            )}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            {FELT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={draft.felt === option.value}
                onClick={() => setDraft({ ...draft, felt: option.value })}
                className={[
                  "h-11 rounded-xl border text-xs font-medium transition-colors",
                  draft.felt === option.value
                    ? "border-transparent bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            maxLength={280}
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            placeholder="Note"
            className={INPUT_CLASS}
          />

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={saving}
              className="h-11 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-11 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

        </form>
      ) : confirming ? (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-2.5 dark:border-red-900 dark:bg-red-950">
          <p className="text-xs text-red-700 dark:text-red-300">
            Delete this log? Your streak and weekly counts will change.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="h-11 rounded-lg border border-red-300 text-xs font-medium text-red-700 dark:border-red-900 dark:text-red-300"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="h-11 rounded-lg bg-red-600 text-xs font-semibold text-white disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      ) : locked ? null : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={beginEdit} className={SMALL_BUTTON}>
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            className={SMALL_BUTTON}
          >
            Delete
          </button>
        </div>
      )}

    </li>
  );
}

type DaySheetProps = {
  /** IST day key of the day being opened. */
  dayKey: string;
  completions: readonly CompletionEntry[];
  journal: DayJournal | null;
  /** Screen time for this day, null when it was not logged. */
  screenMinutes: number | null;
  /** The user's daily limit, from `user_settings`; null when not set. */
  screenLimit: number | null;
  todayKey: string;
  /** Earliest day a quick log may use. */
  minDayKey: string;
  targets: readonly QuickLogTarget[];
  onClose: () => void;
};

/**
 * Everything about one day, in a bottom sheet on a phone and a side panel on a
 * wide screen: each completion (with edit and delete), the journal line, screen
 * time and a shortcut into the quick-log form for that date.
 */
export function DaySheet({
  dayKey,
  completions,
  journal,
  screenMinutes,
  screenLimit,
  todayKey,
  minDayKey,
  targets,
  onClose,
}: DaySheetProps) {
  const router = useRouter();
  // Past the edit window the panel is read-only; the server refuses the same
  // writes, so hiding the buttons is only the visible half of the rule.
  const locked = isLocked(dayKey, todayKey);

  const [journalEditing, setJournalEditing] = useState(false);
  const [mood, setMood] = useState<number | null>(journal?.mood ?? null);
  const [journalNote, setJournalNote] = useState(journal?.note ?? "");

  const [screenEditing, setScreenEditing] = useState(false);
  const [screenValue, setScreenValue] = useState(
    screenMinutes === null ? "" : String(screenMinutes),
  );

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quickLogOpen, setQuickLogOpen] = useState(false);

  const [savingJournal, startSavingJournal] = useTransition();
  const [savingScreen, startSavingScreen] = useTransition();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !quickLogOpen) onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, quickLogOpen]);

  const canQuickLog = !locked && dayKey >= minDayKey && dayKey <= todayKey;
  // Screen time is a completed-day number, so the future is out and the window
  // matches what the server accepts.
  const canEditScreen =
    !locked &&
    dayKey <= todayKey &&
    dayKey >= shiftDayKey(todayKey, -SCREEN_TIME_MAX_DAYS_BACK);
  const screenOver = isOverLimit(screenMinutes, screenLimit);
  const distanceKm = completions.reduce(
    (total, entry) =>
      entry.goal === DISTANCE_GOAL && entry.distanceKm !== null
        ? total + entry.distanceKm
        : total,
    0,
  );

  function beginJournalEdit() {
    setError(null);
    setNotice(null);
    setMood(journal?.mood ?? null);
    setJournalNote(journal?.note ?? "");
    setJournalEditing(true);
  }

  function saveJournal() {
    if (savingJournal) return;

    setError(null);
    setNotice(null);

    startSavingJournal(async () => {
      const result = await saveJournalDayAction({
        day: dayKey,
        mood,
        note: journalNote.trim() ? journalNote.trim() : null,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setJournalEditing(false);
      setNotice("Journal saved.");
      router.refresh();
    });
  }

  function beginScreenEdit() {
    setError(null);
    setNotice(null);
    setScreenValue(screenMinutes === null ? "" : String(screenMinutes));
    setScreenEditing(true);
  }

  function saveScreen() {
    if (savingScreen) return;

    const parsed = Number(screenValue);

    if (
      screenValue.trim() === "" ||
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      parsed > SCREEN_TIME_MAX_MINUTES
    ) {
      setError(`Enter minutes between 0 and ${SCREEN_TIME_MAX_MINUTES}.`);
      return;
    }

    setError(null);
    setNotice(null);

    startSavingScreen(async () => {
      const result = await saveScreenTimeAction({
        day: dayKey,
        minutes: Math.round(parsed),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setScreenEditing(false);
      setNotice(result.message);
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-sheet-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />

      <div className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background shadow-xl sm:h-full sm:max-h-none sm:rounded-none sm:border-t-0 sm:border-l">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="day-sheet-title" className="text-base font-semibold">
              {dayKeyLabel(dayKey)}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {completions.length === 0
                ? "Nothing logged"
                : `${completions.length} logged`}
              {distanceKm > 0 ? ` · ${formatKm(distanceKm)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-5 w-5"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error && (
            <p
              role="alert"
              className="mb-3 rounded-xl border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}

          {notice && (
            <p
              role="status"
              className="mb-3 rounded-xl border border-emerald-300 bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
            >
              {notice}
            </p>
          )}

          {locked && (
            <p className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-muted/60 p-2.5 text-xs text-muted-foreground">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5 shrink-0"
              >
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              Locked after {EDIT_WINDOW_DAYS} days
            </p>
          )}

          {completions.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Nothing logged on this day.
            </p>
          ) : (
            <ul className="space-y-2">
              {completions.map((entry) => (
                <CompletionItem key={entry.id} entry={entry} locked={locked} />
              ))}
            </ul>
          )}


          <section className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Journal
              </h3>
              {!journalEditing && !locked && journal && (
                <button
                  type="button"
                  onClick={beginJournalEdit}
                  className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Edit
                </button>
              )}
            </div>

            {journalEditing ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveJournal();
                }}
                className="mt-2 rounded-2xl border border-border p-3"
              >
                <div className="grid grid-cols-5 gap-1.5">
                  {JOURNAL_MOODS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={mood === option.value}
                      aria-label={option.label}
                      onClick={() => setMood(option.value)}
                      className={[
                        "flex h-12 items-center justify-center rounded-xl border text-2xl transition-colors",
                        mood === option.value
                          ? "border-transparent bg-accent"
                          : "border-border hover:bg-muted",
                      ].join(" ")}
                    >
                      <span aria-hidden="true">{option.emoji}</span>
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  maxLength={JOURNAL_NOTE_MAX}
                  value={journalNote}
                  onChange={(event) => setJournalNote(event.target.value)}
                  placeholder="One line about the day"
                  className={INPUT_CLASS}
                />

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setJournalEditing(false)}
                    disabled={savingJournal}
                    className="h-11 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingJournal}
                    className="h-11 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
                  >
                    {savingJournal ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            ) : journal ? (
              <div className="mt-2 flex items-start gap-3 rounded-2xl border border-border p-3">
                <span aria-hidden="true" className="text-2xl leading-none">
                  {moodEmoji(journal.mood)}
                </span>
                <p className="min-w-0 flex-1 text-sm">
                  {journal.note ?? "No note, just a mood."}
                </p>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border p-3">
                <p className="text-sm text-muted-foreground">
                  No entry for this day.
                </p>
                {!locked && (
                  <button
                    type="button"
                    onClick={beginJournalEdit}
                    className="h-10 shrink-0 rounded-xl border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Add
                  </button>
                )}
              </div>
            )}
          </section>


          <section className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Screen time
              </h3>
              {!screenEditing && !locked && screenMinutes !== null && (
                <button
                  type="button"
                  onClick={beginScreenEdit}
                  className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Edit
                </button>
              )}
            </div>

            {screenEditing ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveScreen();
                }}
                className="mt-2 rounded-2xl border border-border p-3"
              >
                <label htmlFor="day-screen-minutes" className="block text-sm font-medium">
                  Minutes
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="day-screen-minutes"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={SCREEN_TIME_MAX_MINUTES}
                    step={5}
                    value={screenValue}
                    onChange={(event) => setScreenValue(event.target.value)}
                    placeholder="90"
                    className={INPUT_CLASS}
                  />
                  <button
                    type="submit"
                    disabled={savingScreen}
                    className="h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                  >
                    {savingScreen ? "Saving…" : "Save"}
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setScreenEditing(false);
                      setError(null);
                    }}
                    disabled={savingScreen}
                    className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  {screenLimit !== null && (
                    <p className="text-xs text-muted-foreground">
                      Limit {formatMinutes(screenLimit)}
                    </p>
                  )}
                </div>
              </form>
            ) : screenMinutes === null ? (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border p-3">
                <p className="text-sm text-muted-foreground">Not logged.</p>
                {canEditScreen && (
                  <button
                    type="button"
                    onClick={beginScreenEdit}
                    className="h-10 shrink-0 rounded-xl border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Add
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-2 rounded-2xl border border-border p-3">
                <p className="text-lg font-semibold tabular-nums">
                  {formatMinutes(screenMinutes)}
                </p>
                {screenLimit !== null && (
                  <p
                    className={[
                      "mt-0.5 text-xs font-medium",
                      screenOver
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-700 dark:text-emerald-400",
                    ].join(" ")}
                  >
                    {screenOver ? "Over" : "Under"} the{" "}
                    {formatMinutes(screenLimit)} limit
                  </p>
                )}
              </div>
            )}
          </section>

          <div className="mt-5 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setNotice(null);
                setQuickLogOpen(true);
              }}
              disabled={!canQuickLog}
              className="h-12 w-full rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              Log activity for this day
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {locked
                ? `Edits stop after ${EDIT_WINDOW_DAYS} days, so this day is read-only.`
                : canQuickLog
                  ? `Opens quick log with ${dayKeyLabel(dayKey)} already filled in.`
                  : `Quick log works for the last ${QUICK_LOG_MAX_DAYS_BACK} days.`}
            </p>
          </div>

        </div>

        {quickLogOpen && (
          <QuickLogSheet
            targets={targets}
            initialGoal={targets[0]?.goal ?? null}
            initialDay={dayKey}
            todayKey={todayKey}
            minDayKey={minDayKey}
            showTargetPicker
            onClose={() => setQuickLogOpen(false)}
            onSaved={(result) => {
              setNotice(result.message);
              router.refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { saveJournalAction } from "@/app/journal/actions";
import { saveScreenTimeAction } from "@/app/screen-time-actions";
import {
  JOURNAL_MOODS,
  JOURNAL_NOTE_MAX,
  moodEmoji,
  type JournalEntry,
} from "@/lib/journal";
import {
  SCREEN_TIME_MAX_MINUTES,
  formatMinutes,
  isOverLimit,
} from "@/lib/screen-time";

type JournalCardProps = {
  entry: JournalEntry | null;
  /** True from 7 pm IST when today has no entry yet. */
  showPrompt: boolean;
  /** Today's screen time in minutes, null when it has not been logged. */
  screenMinutes: number | null;
  /** The user's daily limit, from `user_settings`. */
  screenLimit: number;
};

/**
 * "How was your day?" — five emoji and one line, editable on the same day.
 * The text is only ever read here and on /journal; nothing is sent to the LLM.
 */
export function JournalCard({
  entry,
  showPrompt,
  screenMinutes,
  screenLimit,
}: JournalCardProps) {
  const router = useRouter();

  const [current, setCurrent] = useState<JournalEntry | null>(entry);
  // Only open straight into the form when the day has not been written yet.
  const [editing, setEditing] = useState(showPrompt && entry === null);
  const [mood, setMood] = useState<number | null>(entry?.mood ?? null);
  const [note, setNote] = useState(entry?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setError(null);

    startSaving(async () => {
      const result = await saveJournalAction({
        mood,
        note: note.trim() ? note.trim() : null,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setCurrent(result.entry);
      setEditing(false);
      router.refresh();
    });
  }

  function startEditing() {
    setMood(current?.mood ?? null);
    setNote(current?.note ?? "");
    setError(null);
    setEditing(true);
  }

  return (
    <>
      <section className="mx-auto w-full max-w-md px-4 pb-6">
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {current
              ? "Today's journal"
              : showPrompt
                ? "How was your day?"
                : "Journal"}
          </h2>
          <Link
            href="/journal"
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Journal
          </Link>
        </div>

        {current && !editing && (
          <div className="mt-3 flex items-start gap-3">
            <span aria-hidden="true" className="text-3xl leading-none">
              {moodEmoji(current.mood)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                {current.note ?? "No note, just a mood."}
              </p>
              <button
                type="button"
                onClick={startEditing}
                className="mt-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Edit today
              </button>
            </div>
          </div>
        )}

        {!current && !editing && (
          <p className="mt-2 text-sm text-muted-foreground">
            One mood and one line a day. The card shows up after 7 pm.
          </p>
        )}

        {editing && (
          <form onSubmit={handleSubmit} className="mt-3">
            <div
              role="group"
              aria-label="Mood"
              className="grid grid-cols-5 gap-2"
            >
              {JOURNAL_MOODS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mood === option.value}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => setMood(option.value)}
                  className={[
                    "flex h-14 items-center justify-center rounded-xl border text-2xl transition-colors",
                    mood === option.value
                      ? "border-transparent bg-accent"
                      : "border-border hover:bg-muted",
                  ].join(" ")}
                >
                  <span aria-hidden="true">{option.emoji}</span>
                </button>
              ))}
            </div>

            <label
              htmlFor="journal-note"
              className="mt-3 block text-sm font-medium"
            >
              One line (optional)
            </label>
            <input
              id="journal-note"
              type="text"
              maxLength={JOURNAL_NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What mattered today?"
              className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
            />
            <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
              {note.length}/{JOURNAL_NOTE_MAX}
            </p>

            {error && (
              <p
                role="alert"
                className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              >
                {error}
              </p>
            )}

            {current ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="h-11 w-full rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
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
            ) : (
              <div className="mt-3 grid gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="h-11 w-full rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save the day"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="h-11 w-full rounded-xl text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  Not now
                </button>
              </div>
            )}
          </form>
        )}
      </div>
      </section>

      <section className="mx-auto w-full max-w-md px-4 pb-6">
        <ScreenTimeCard minutes={screenMinutes} limit={screenLimit} />
      </section>
    </>
  );
}

type ScreenTimeCardProps = {
  minutes: number | null;
  limit: number;
};

/**
 * Today's screen time, typed straight into a small card. Saving is a single
 * upsert per IST day, so editing twice in the evening simply overwrites the
 * number instead of adding a second row.
 */
function ScreenTimeCard({ minutes, limit }: ScreenTimeCardProps) {
  const router = useRouter();

  const [current, setCurrent] = useState<number | null>(minutes);
  const [value, setValue] = useState(minutes === null ? "" : String(minutes));
  const [editing, setEditing] = useState(minutes === null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();

  const over = isOverLimit(current, limit);

  function beginEditing() {
    setValue(current === null ? "" : String(current));
    setError(null);
    setNotice(null);
    setEditing(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const parsed = Number(value);

    if (
      value.trim() === "" ||
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      parsed > SCREEN_TIME_MAX_MINUTES
    ) {
      setError(`Enter minutes between 0 and ${SCREEN_TIME_MAX_MINUTES}.`);
      return;
    }

    setError(null);

    startSaving(async () => {
      const result = await saveScreenTimeAction({ minutes: Math.round(parsed) });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setCurrent(Math.round(parsed));
      setEditing(false);
      setNotice(result.message);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Screen time today</h2>
        {!editing && current !== null && (
          <button
            type="button"
            onClick={beginEditing}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSubmit} className="mt-3">
          <label htmlFor="screen-minutes" className="block text-sm font-medium">
            Minutes
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="screen-minutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={SCREEN_TIME_MAX_MINUTES}
              step={5}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="90"
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
            />
            <button
              type="submit"
              disabled={saving}
              className="h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {current !== null && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={saving}
              className="mt-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Cancel
            </button>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            Your limit is {formatMinutes(limit)} a day.
          </p>
        </form>
      ) : current === null ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-dashed border-border p-3">
          <p className="text-sm text-muted-foreground">Not logged yet.</p>
          <button
            type="button"
            onClick={beginEditing}
            className="h-10 shrink-0 rounded-xl border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Add
          </button>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-2xl font-semibold tabular-nums">
            {formatMinutes(current)}
          </p>
          <p
            className={[
              "mt-1 text-xs font-medium",
              over
                ? "text-red-600 dark:text-red-400"
                : "text-emerald-700 dark:text-emerald-400",
            ].join(" ")}
          >
            {over ? "Over" : "Under"} your {formatMinutes(limit)} limit
            {over ? ` by ${formatMinutes(current - limit)}` : ""}
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {notice && !error && (
        <p
          role="status"
          className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {notice}
        </p>
      )}
    </div>
  );
}


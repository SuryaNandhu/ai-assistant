"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { saveJournalAction } from "@/app/journal/actions";
import {
  JOURNAL_MOODS,
  JOURNAL_NOTE_MAX,
  moodEmoji,
  type JournalEntry,
} from "@/lib/journal";

type JournalCardProps = {
  entry: JournalEntry | null;
  /** True from 7 pm IST when today has no entry yet. */
  showPrompt: boolean;
};

/**
 * "How was your day?" — five emoji and one line, editable on the same day.
 * The text is only ever read here and on /journal; nothing is sent to the LLM.
 */
export function JournalCard({ entry, showPrompt }: JournalCardProps) {
  const router = useRouter();

  const [current, setCurrent] = useState<JournalEntry | null>(entry);
  const [editing, setEditing] = useState(showPrompt);
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
  );
}


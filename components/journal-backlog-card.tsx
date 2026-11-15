"use client";

import { useRouter } from "next/navigation";
import {
  useSyncExternalStore,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { saveJournalDayAction } from "@/app/journal/actions";
import { JOURNAL_MOODS, JOURNAL_NOTE_MAX, moodEmoji } from "@/lib/journal";
import { dayKeyLabel } from "@/lib/week";

/** Local flag: the IST day the card was last put off on. */
const DISMISS_KEY = "journal-backlog-dismissed";
/** Same-tab notification, because `storage` only fires in other tabs. */
const DISMISS_EVENT = "journal-backlog-dismissed";

function subscribeToDismissal(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(DISMISS_EVENT, onChange);

  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DISMISS_EVENT, onChange);
  };
}

/** Wrapped in try/catch: private mode and blocked stores just keep asking. */
function readDismissedDay(): string | null {
  try {
    return window.localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/** The server cannot know about localStorage, so it renders the card. */
function readServerDismissedDay(): string | null {
  return null;
}

type JournalBacklogCardProps = {
  /** Missed days since the first mood, newest first (never today). */
  days: readonly string[];
  /** Today's IST key, so a dismissal only lasts until tomorrow. */
  todayKey: string;
};

/**
 * A small catch-up card for the days that slipped past. Only days after the
 * first journal entry are ever asked about, three at most, and "Not now" hides
 * the card until tomorrow — the same rule the screen-time card follows.
 */
export function JournalBacklogCard({ days, todayKey }: JournalBacklogCardProps) {
  const router = useRouter();

  const dismissedDay = useSyncExternalStore(
    subscribeToDismissal,
    readDismissedDay,
    readServerDismissedDay,
  );
  // Also covers a blocked localStorage, where the store never changes.
  const [dismissedHere, setDismissedHere] = useState(false);
  const [pending, setPending] = useState<readonly string[]>(days);
  const [selected, setSelected] = useState<string | null>(days[0] ?? null);
  const [mood, setMood] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();

  const dismissed = dismissedHere || dismissedDay === todayKey;
  const dayKey = selected ?? pending[0] ?? null;

  if (dismissed || pending.length === 0 || dayKey === null) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, todayKey);
      window.dispatchEvent(new Event(DISMISS_EVENT));
    } catch {
      // Nothing to clean up; the local flag hides it for this visit.
    }
    setDismissedHere(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || dayKey === null) return;

    if (mood === null) {
      setError("Pick a mood first.");
      return;
    }

    setError(null);
    setNotice(null);

    startSaving(async () => {
      const result = await saveJournalDayAction({
        day: dayKey,
        mood,
        note: note.trim() ? note.trim() : null,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const rest = pending.filter((day) => day !== dayKey);
      setPending(rest);
      setSelected(rest[0] ?? null);
      setMood(null);
      setNote("");
      setNotice(`Saved ${dayKeyLabel(dayKey)}.`);
      router.refresh();
    });
  }

  return (
    <section className="mx-auto w-full max-w-md px-4 pb-6">
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Missed a day?</h2>
          <span className="text-[11px] text-muted-foreground">
            {pending.length} {pending.length === 1 ? "day" : "days"} open
          </span>
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          Fill one in while you still remember it.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {pending.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => {
                setSelected(day);
                setMood(null);
                setNote("");
                setError(null);
                setNotice(null);
              }}
              aria-pressed={day === dayKey}
              className={[
                "rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors",
                day === dayKey
                  ? "border-transparent bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              {dayKeyLabel(day)}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-3">
          <div role="group" aria-label="Mood" className="grid grid-cols-5 gap-1.5">
            {JOURNAL_MOODS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={mood === option.value}
                aria-label={option.label}
                title={option.label}
                onClick={() => setMood(option.value)}
                className={[
                  "flex h-11 items-center justify-center rounded-xl border text-xl transition-colors",
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
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-label="One line (optional)"
            placeholder="One line (optional)"
            className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={dismiss}
              disabled={saving}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Not now
            </button>
            <button
              type="submit"
              disabled={saving || mood === null}
              className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : `Save ${moodEmoji(mood)}`}
            </button>
          </div>
        </form>

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
    </section>
  );
}

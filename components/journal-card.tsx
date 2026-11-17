"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import { saveJournalAction } from "@/app/journal/actions";
import { JOURNAL_MOODS, JOURNAL_NOTE_MAX } from "@/lib/journal";

/** The card only appears from 8 pm IST. */
const JOURNAL_CARD_HOUR = 20;

/**
 * The IST hour in the browser. `Intl` keeps the zone right without a library,
 * and `hourCycle: "h23"` avoids the "24" some engines use at midnight.
 */
function istHourNow(): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .find((part) => part.type === "hour")?.value;

  return Number(hour ?? "");
}

type JournalCardProps = {
  /** True when today's mood is already saved; the card then stays hidden. */
  hasMood: boolean;
};

/**
 * "How was your day?" — five emoji and one line, on Home only from 8 pm IST
 * while the day still has no mood. The text is only ever read here and on
 * /journal; nothing is sent to the LLM.
 *
 * `evening` starts false, so the server and the first client render both output
 * nothing; the effect then reads the real clock and keeps it fresh every minute
 * and on focus. No placeholder is ever shown before 8 pm.
 */
export function JournalCard({ hasMood }: JournalCardProps) {
  const router = useRouter();

  const [evening, setEvening] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mood, setMood] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();

  useEffect(() => {
    const update = () => setEvening(istHourNow() >= JOURNAL_CARD_HOUR);

    update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  // Still before 8 pm, already answered, or put off for this visit.
  if (!evening || hasMood || saved || hidden) return null;

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

      // The day is answered, so the card has done its job until tomorrow.
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="mx-auto w-full max-w-md px-4 pb-6">
      <div className="rounded-2xl border border-border bg-background p-4">
        <h2 className="text-sm font-semibold">How was your day?</h2>

        <form onSubmit={handleSubmit} className="mt-3">
          <div role="group" aria-label="Mood" className="grid grid-cols-5 gap-2">
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
              onClick={() => setHidden(true)}
              disabled={saving}
              className="h-11 w-full rounded-xl text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Not now
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

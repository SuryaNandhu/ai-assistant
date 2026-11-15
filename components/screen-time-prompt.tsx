"use client";

import { useRouter } from "next/navigation";
import {
  useSyncExternalStore,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { saveScreenTimeAction } from "@/app/screen-time-actions";
import { SCREEN_TIME_MAX_MINUTES } from "@/lib/screen-time";
import { dayKeyLabel } from "@/lib/week";

/** Local flag: the IST day the card was last dismissed on. */
const DISMISS_KEY = "screen-time-dismissed";
/** Same-tab notification, because `storage` only fires in other tabs. */
const DISMISS_EVENT = "screen-time-dismissed";

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

type ScreenTimePromptProps = {
  /** Missing completed days, oldest first (yesterday at the latest). */
  days: readonly string[];
  /** Today's IST key, so a dismissal only lasts until tomorrow. */
  todayKey: string;
};

/**
 * Screen time belongs to a finished day, so Home asks about the oldest missing
 * day out of the last three, one at a time. "Not now" hides the card until
 * tomorrow; once every day is logged the card disappears on its own.
 */
export function ScreenTimePrompt({ days, todayKey }: ScreenTimePromptProps) {
  const router = useRouter();

  const dismissedDay = useSyncExternalStore(
    subscribeToDismissal,
    readDismissedDay,
    readServerDismissedDay,
  );
  // Also covers a blocked localStorage, where the store never changes.
  const [dismissedHere, setDismissedHere] = useState(false);
  const [index, setIndex] = useState(0);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();

  const dayKey = days[index];
  const dismissed = dismissedHere || dismissedDay === todayKey;

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
    if (saving || !dayKey) return;

    const h = hours.trim() === "" ? 0 : Number(hours);
    const m = minutes.trim() === "" ? 0 : Number(minutes);

    if (
      !Number.isFinite(h) ||
      !Number.isFinite(m) ||
      h < 0 ||
      h > 24 ||
      m < 0 ||
      m > 59 ||
      h * 60 + m > SCREEN_TIME_MAX_MINUTES
    ) {
      setError("Enter hours 0–24 and minutes 0–59.");
      return;
    }

    const total = Math.round(h * 60 + m);
    setError(null);
    setNotice(null);

    startSaving(async () => {
      const result = await saveScreenTimeAction({ day: dayKey, minutes: total });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setNotice(result.message);
      setHours("");
      setMinutes("");
      setIndex((current) => current + 1);
      router.refresh();
    });
  }

  // Nothing to ask → no card at all.
  if (dismissed || !dayKey) return null;

  return (
    <section className="mx-auto w-full max-w-md px-4 pb-6">
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Screen time for {dayKeyLabel(dayKey)}
          </h2>
          {days.length > 1 && (
            <span className="text-[11px] text-muted-foreground">
              {index + 1} of {days.length}
            </span>
          )}
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          How much time did you spend on screens that day?
        </p>

        <form onSubmit={handleSubmit} className="mt-3">
          <div className="flex items-end gap-2">
            <label htmlFor="screen-hours" className="flex-1 text-xs font-medium">
              Hours
              <input
                id="screen-hours"
                type="number"
                inputMode="numeric"
                min={0}
                max={24}
                step={1}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                placeholder="3"
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
              />
            </label>

            <label htmlFor="screen-minutes" className="flex-1 text-xs font-medium">
              Minutes
              <input
                id="screen-minutes"
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                step={5}
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                placeholder="30"
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
              />
            </label>

            <button
              type="submit"
              disabled={saving || (hours.trim() === "" && minutes.trim() === "")}
              className="h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={dismiss}
              disabled={saving}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Not now
            </button>
            <p className="text-[11px] text-muted-foreground">
              Older days are on the calendar.
            </p>
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

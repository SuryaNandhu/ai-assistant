"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { takeRestDayAction } from "@/app/rest-day-actions";
import type { RestDayOption, RestDayState } from "@/lib/services/rest-day";
import { dayKeyLabel } from "@/lib/week";

type RestDayButtonProps = {
  /** Server-computed state: today and yesterday, plus the week's allowance. */
  state: RestDayState;
};

/**
 * The secondary control next to the streak. One rest day per Monday–Sunday
 * week, usable for today or yesterday; when neither qualifies the button stays
 * visible but disabled and says why.
 */
export function RestDayButton({ state }: RestDayButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const { today, yesterday } = state;
  const nothingAvailable = !today.allowed && !yesterday.allowed;
  const blockedReason = today.reason ?? yesterday.reason;

  function take(option: RestDayOption) {
    if (!option.allowed) return;

    setError(null);
    setNotice(null);

    startSaving(async () => {
      const result = await takeRestDayAction({ day: option.day });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setNotice(result.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpen((value) => !value);
          }}
          aria-expanded={open}
          disabled={nothingAvailable}
          title={nothingAvailable ? (blockedReason ?? undefined) : undefined}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          😴 Use rest day
        </button>
      </div>

      {nothingAvailable && !open && (
        <p className="mt-1 text-right text-[11px] text-muted-foreground">
          {blockedReason ?? "No rest day left this week."}
        </p>
      )}

      {(open || notice || error) && (
        <div className="mt-2 rounded-xl border border-border p-2.5">
          <p className="text-[11px] text-muted-foreground">
            {state.thisWeekRestDay
              ? `This week's rest day: ${dayKeyLabel(state.thisWeekRestDay)}.`
              : "One rest day a week, Monday to Sunday. This week's is unused."}
          </p>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <DayButton
              label="Today"
              option={today}
              disabled={saving}
              onPick={take}
            />
            <DayButton
              label="Yesterday"
              option={yesterday}
              disabled={saving}
              onPick={take}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}

          {notice && !error && (
            <p className="mt-2 text-[11px] text-muted-foreground">{notice}</p>
          )}
        </div>
      )}
    </div>
  );
}

function DayButton({
  label,
  option,
  disabled,
  onPick,
}: {
  label: string;
  option: RestDayOption;
  disabled: boolean;
  onPick: (option: RestDayOption) => void;
}) {
  const sub = option.used
    ? "rest day"
    : option.allowed
      ? dayKeyLabel(option.day)
      : (option.reason ?? "not available");

  return (
    <button
      type="button"
      onClick={() => onPick(option)}
      disabled={disabled || !option.allowed}
      title={option.allowed ? undefined : (option.reason ?? undefined)}
      className="flex h-12 flex-col items-center justify-center rounded-xl border border-border px-2 text-xs font-medium disabled:opacity-50"
    >
      <span>{label}</span>
      <span className="mt-0.5 max-w-full truncate text-[10px] font-normal text-muted-foreground">
        {sub}
      </span>
    </button>
  );
}

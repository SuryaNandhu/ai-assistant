"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  ITEM_STATUSES,
  ITEM_STATUS_LABELS,
  ITEM_TYPES,
  itemTypeLabel,
  type GoalOption,
  type InboxItem,
  type ItemStatus,
} from "@/lib/inbox";
import { ENERGY_LABELS, ENERGY_LEVELS, type Energy } from "@/lib/task";

export type ItemEditInput = {
  title: string;
  type: string;
  goal: string | null;
  est_minutes: number;
  energy: Energy;
  notes: string | null;
  status: ItemStatus;
};

type ItemEditSheetProps = {
  item: InboxItem;
  goals: readonly GoalOption[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (input: ItemEditInput) => void;
};

function chipClass(active: boolean): string {
  return [
    "h-11 rounded-xl border text-sm font-medium transition-colors",
    active
      ? "border-transparent bg-accent text-accent-foreground"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
  ].join(" ");
}

const INPUT_CLASS =
  "mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

/** Bottom sheet for fixing up a saved link: type, goal, time, energy, status. */
export function ItemEditSheet({
  item,
  goals,
  pending,
  error,
  onCancel,
  onSave,
}: ItemEditSheetProps) {
  const [title, setTitle] = useState(item.title);
  const [type, setType] = useState(item.type);
  const [goal, setGoal] = useState(item.goal ?? "");
  const [minutes, setMinutes] = useState(String(item.est_minutes ?? 10));
  const [energy, setEnergy] = useState<Energy>(item.energy);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [status, setStatus] = useState<ItemStatus>(item.status);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  // A goal that was removed from the targets still has to stay selectable.
  const goalOptions = goals.some((option) => option.goal === goal)
    ? goals
    : goal
      ? [...goals, { goal, label: goal }]
      : goals;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = Number(minutes.replace(",", "."));
    const est = Number.isFinite(parsed)
      ? Math.min(600, Math.max(1, Math.round(parsed)))
      : (item.est_minutes ?? 10);

    onSave({
      title: title.trim() || item.title,
      type,
      goal: goal || null,
      est_minutes: est,
      energy,
      notes: notes.trim() ? notes.trim() : null,
      status,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-sheet-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/40"
      />

      <form
        onSubmit={handleSubmit}
        className="relative max-h-[88dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-1 w-10 rounded-full bg-border"
        />

        <h2 id="edit-sheet-title" className="text-base font-semibold">
          Edit item
        </h2>
        {item.source_domain && (
          <p className="mt-1 text-xs text-muted-foreground">{item.source_domain}</p>
        )}

        <div className="mt-4">
          <label htmlFor="item-title" className="text-sm font-medium">
            Title
          </label>
          <input
            id="item-title"
            type="text"
            value={title}
            maxLength={300}
            onChange={(event) => setTitle(event.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="item-type" className="text-sm font-medium">
              Type
            </label>
            <select
              id="item-type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className={INPUT_CLASS}
            >
              {ITEM_TYPES.map((option) => (
                <option key={option} value={option}>
                  {itemTypeLabel(option)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="item-goal" className="text-sm font-medium">
              Goal
            </label>
            <select
              id="item-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">No goal</option>
              {goalOptions.map((option) => (
                <option key={option.goal} value={option.goal}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="item-minutes" className="text-sm font-medium">
            Estimate (minutes)
          </label>
          <input
            id="item-minutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Energy</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {ENERGY_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={energy === level}
                onClick={() => setEnergy(level)}
                className={chipClass(energy === level)}
              >
                {ENERGY_LABELS[level]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Status</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {ITEM_STATUSES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={status === option}
                onClick={() => setStatus(option)}
                className={chipClass(status === option)}
              >
                {ITEM_STATUS_LABELS[option]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-4">
          <label htmlFor="item-notes" className="text-sm font-medium">
            Notes
          </label>
          <textarea
            id="item-notes"
            value={notes}
            rows={3}
            maxLength={2000}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-12 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="h-12 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}


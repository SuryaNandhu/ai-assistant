"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { undoQuickLogAction } from "@/app/quick-log-actions";
import { QuickLogSheet } from "@/components/quick-log-sheet";
import type { QuickLogTarget } from "@/lib/quick-log";

type QuickLogProps = {
  targets: readonly QuickLogTarget[];
  /** Today's IST day key, computed on the server so the client cannot drift. */
  todayKey: string;
  /** The earliest day a quick log may use. */
  minDayKey: string;
};

/** The undo toast stays for eight seconds. */
const TOAST_MS = 8000;

/**
 * "Quick log" chips under the pick buttons. A chip opens the prefilled sheet
 * for that goal; saving refreshes Home so the streak and weekly pills update.
 */
export function QuickLog({ targets, todayKey, minDayKey }: QuickLogProps) {
  const router = useRouter();

  const [active, setActive] = useState<QuickLogTarget | null>(null);
  const [toast, setToast] = useState<{ id: string | null; message: string } | null>(
    null,
  );

  const [undoing, startUndoing] = useTransition();

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function handleUndo(id: string) {
    if (undoing) return;

    startUndoing(async () => {
      const result = await undoQuickLogAction({ id });

      setToast({ id: null, message: result.message });
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Quick log
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Done away from the app
        </span>
      </div>

      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {targets.map((target) => (
          <button
            key={target.goal ?? "other"}
            type="button"
            onClick={() => setActive(target)}
            className="shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            + {target.label}
          </button>
        ))}
      </div>

      {toast && (
        <div
          role="status"
          className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          <span className="min-w-0">{toast.message}</span>
          {toast.id && (
            <button
              type="button"
              onClick={() => {
                if (toast.id) handleUndo(toast.id);
              }}
              disabled={undoing}
              className="shrink-0 rounded-lg border border-emerald-400/60 px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
            >
              {undoing ? "Undoing…" : "Undo"}
            </button>
          )}
        </div>
      )}

      {active && (
        <QuickLogSheet
          targets={targets}
          initialGoal={active.goal}
          initialDay={todayKey}
          todayKey={todayKey}
          minDayKey={minDayKey}
          onClose={() => setActive(null)}
          onSaved={(result) => {
            setToast({ id: result.id, message: result.message });
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Floating "+" that opens a paste-a-link sheet. It posts to the same endpoint
 * as the share target, so validation, the SSRF checks, duplicate detection and
 * enrichment all stay in one place.
 */
export function QuickSaveButton() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

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
    setDuplicate(false);
    setOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setError(null);
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
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label="Save a link"
        title="Save a link"
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
            onSubmit={handleSubmit}
            className="relative w-full max-w-md rounded-t-2xl border-t border-border bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />

            <h2
              id="quick-save-title"
              className="text-lg font-semibold tracking-tight"
            >
              Save a link
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Paste anything worth coming back to. The title and tags fill in
              after saving.
            </p>

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

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              >
                {error}
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
                disabled={saving}
                className="h-12 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save link"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}


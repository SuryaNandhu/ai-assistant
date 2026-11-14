"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { GoalOption } from "@/lib/inbox";

type AddLinkFormProps = {
  initialUrl: string;
  initialNote: string;
  goals: GoalOption[];
};

const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

/** Paste-a-link form; the same endpoint the share sheet hits. */
export function AddLinkForm({ initialUrl, initialNote, goals }: AddLinkFormProps) {
  const router = useRouter();

  const [url, setUrl] = useState(initialUrl);
  const [note, setNote] = useState(initialNote);
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);

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
        body: JSON.stringify({
          url,
          note: note.trim() || null,
          goal: goal || null,
        }),
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

      router.replace("/saved");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4">
      <label htmlFor="link-url" className="text-sm font-medium">
        Link
      </label>
      <input
        id="link-url"
        type="text"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        autoFocus={!initialUrl}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://example.com/article"
        className={`${INPUT_CLASS} h-12`}
      />

      <label htmlFor="link-note" className="mt-4 block text-sm font-medium">
        Note (optional)
      </label>
      <textarea
        id="link-note"
        value={note}
        rows={3}
        maxLength={1000}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Why is this worth keeping?"
        className={`${INPUT_CLASS} py-2`}
      />

      <label htmlFor="link-goal" className="mt-4 block text-sm font-medium">
        Goal (optional)
      </label>
      <select
        id="link-goal"
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        className={`${INPUT_CLASS} h-12`}
      >
        <option value="">Let the rules decide</option>
        {goals.map((option) => (
          <option key={option.goal} value={option.goal}>
            {option.label}
          </option>
        ))}
      </select>

      <p className="mt-3 text-xs text-muted-foreground">
        The title, tags and estimate fill in by themselves a few seconds after
        saving. You can fix anything in Saved.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {duplicate && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          That link is already saved.{" "}
          <Link href="/saved" className="font-medium underline">
            Open Saved
          </Link>
          .
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Link
          href="/saved"
          className="h-12 rounded-xl border border-border text-center text-sm font-medium leading-[2.75rem] text-muted-foreground hover:bg-muted"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={saving}
          className="h-12 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save link"}
        </button>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { setItemStatusAction, updateItemAction } from "@/app/inbox/actions";
import { ItemEditSheet, type ItemEditInput } from "@/components/item-edit-sheet";
import {
  ITEM_STATUS_LABELS,
  itemTypeLabel,
  safeHref,
  type GoalOption,
  type InboxItem,
  type ItemStatus,
} from "@/lib/inbox";
import { ENERGY_LABELS, goalLabel } from "@/lib/task";

type StatusFilter = ItemStatus | "all";

const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "all", label: "All" },
  { value: "done", label: "Done" },
  { value: "dropped", label: "Dropped" },
];

const ACTION_CLASS =
  "h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50";
const PRIMARY_ACTION_CLASS =
  "h-9 rounded-lg border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50";

function savedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function filterClass(active: boolean): string {
  return [
    "h-9 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
    active
      ? "border-transparent bg-accent text-accent-foreground"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
  ].join(" ");
}

type InboxBoardProps = {
  items: InboxItem[];
  goals: GoalOption[];
  loadError: string | null;
};

/** The saved-links board: filter, search, summarise, edit, triage. */
export function InboxBoard({ items: initialItems, goals, loadError }: InboxBoardProps) {
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [filter, setFilter] = useState<StatusFilter>("todo");
  const [query, setQuery] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(loadError);
  const [notice, setNotice] = useState<string | null>(null);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [changingId, setChangingId] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();
  const [changing, startChanging] = useTransition();

  const goalLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of goals) map.set(option.goal, option.label);
    return map;
  }, [goals]);

  const counts = useMemo(
    () => ({
      todo: items.filter((item) => item.status === "todo").length,
      all: items.length,
      done: items.filter((item) => item.status === "done").length,
      dropped: items.filter((item) => item.status === "dropped").length,
    }),
    [items],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return items.filter((item) => {
      if (filter !== "all" && item.status !== filter) return false;
      if (!needle) return true;

      return [
        item.title,
        item.source_domain,
        item.goal,
        item.type,
        item.summary,
        item.notes,
        item.takeaway,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [items, filter, query]);

  const editing = editId ? (items.find((item) => item.id === editId) ?? null) : null;

  function patchItem(next: InboxItem) {
    setItems((list) => list.map((item) => (item.id === next.id ? next : item)));
  }

  async function handleSummarize(item: InboxItem) {
    if (summarizingId) return;

    setSummarizingId(item.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/items/${item.id}/summarize`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; summary?: string; summarized_at?: string }
        | null;

      if (!response.ok || !body?.ok || !body.summary) {
        setError(body?.message ?? "Could not summarise this link. Try again.");
        return;
      }

      patchItem({
        ...item,
        summary: body.summary,
        summarized_at: body.summarized_at ?? new Date().toISOString(),
      });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSummarizingId(null);
    }
  }

  function handleStatus(item: InboxItem, status: ItemStatus) {
    if (changingId) return;

    setChangingId(item.id);
    setError(null);
    setNotice(null);

    startChanging(async () => {
      const result = await setItemStatusAction({ id: item.id, status });

      if (!result.ok) {
        setError(result.message);
        setChangingId(null);
        return;
      }

      patchItem(result.item);
      setNotice(
        status === "done"
          ? "Marked read and logged against this week."
          : status === "dropped"
            ? "Dropped."
            : "Back in the inbox.",
      );
      setChangingId(null);
    });
  }

  function handleSave(input: ItemEditInput) {
    if (!editing) return;

    const item = editing;
    setSheetError(null);

    startSaving(async () => {
      const result = await updateItemAction({
        id: item.id,
        title: input.title,
        type: input.type,
        goal: input.goal,
        est_minutes: input.est_minutes,
        energy: input.energy,
        notes: input.notes,
      });

      if (!result.ok) {
        setSheetError(result.message);
        return;
      }

      let updated = result.item;

      if (input.status !== item.status) {
        const statusResult = await setItemStatusAction({
          id: item.id,
          status: input.status,
        });

        if (!statusResult.ok) {
          patchItem(updated);
          setSheetError(statusResult.message);
          return;
        }

        updated = statusResult.item;
      }

      patchItem(updated);
      setEditId(null);
      setNotice("Item updated.");
    });
  }


  return (
    <div className="px-4 pt-4 pb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {counts.todo === 0
              ? "Nothing waiting — save something to read later."
              : `${counts.todo} ${counts.todo === 1 ? "link" : "links"} to get to.`}
          </p>
        </div>
        <Link
          href="/inbox/add"
          className="h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold leading-[2.75rem] text-accent-foreground"
        >
          Add link
        </Link>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search titles, notes, goals…"
        aria-label="Search saved links"
        className="mt-4 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
      />

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={filterClass(filter === option.value)}
          >
            {option.label} ({counts[option.value]})
          </button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {notice}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {visible.map((item) => {
          const href = safeHref(item.url);
          const summarizing = summarizingId === item.id;
          const busy = summarizing || (changing && changingId === item.id);
          const saved = savedLabel(item.created_at);

          return (
            <li key={item.id}>
              <article className="rounded-2xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                    {itemTypeLabel(item.type)}
                  </span>
                  {item.source_domain && (
                    <span className="truncate text-muted-foreground">
                      {item.source_domain}
                    </span>
                  )}
                  {item.goal && (
                    <span className="truncate text-muted-foreground">
                      · {goalLabel(item.goal, goalLabels.get(item.goal))}
                    </span>
                  )}
                  {item.status !== "todo" && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                      {ITEM_STATUS_LABELS[item.status]}
                    </span>
                  )}
                </div>

                <h2 className="mt-2 text-base font-semibold leading-snug">
                  {item.title}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.est_minutes ?? 10} min · {ENERGY_LABELS[item.energy]} energy
                  {saved ? ` · saved ${saved}` : ""}
                </p>

                {item.notes && (
                  <p className="mt-2 text-sm text-muted-foreground">{item.notes}</p>
                )}

                {item.summary && (
                  <div className="mt-3 rounded-xl bg-muted p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Summary
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{item.summary}</p>
                  </div>
                )}

                {item.takeaway && (
                  <p className="mt-2 text-sm">
                    <span className="font-medium">Takeaway:</span> {item.takeaway}
                  </p>
                )}


                <div className="mt-3 flex flex-wrap gap-2">
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={ACTION_CLASS}
                    >
                      Open
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSummarize(item)}
                    disabled={busy}
                    className={ACTION_CLASS}
                  >
                    {summarizing
                      ? "Summarising…"
                      : item.summary
                        ? "Re-summarise"
                        : "Summarize"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSheetError(null);
                      setEditId(item.id);
                    }}
                    disabled={busy}
                    className={ACTION_CLASS}
                  >
                    Edit
                  </button>
                  {item.status === "todo" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleStatus(item, "done")}
                        disabled={busy}
                        className={PRIMARY_ACTION_CLASS}
                      >
                        Mark read
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStatus(item, "dropped")}
                        disabled={busy}
                        className={ACTION_CLASS}
                      >
                        Drop
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleStatus(item, "todo")}
                      disabled={busy}
                      className={ACTION_CLASS}
                    >
                      Move to inbox
                    </button>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      {visible.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">
            {query.trim()
              ? "Nothing matches that search"
              : filter === "todo"
                ? "Inbox zero"
                : `No ${ITEM_STATUS_LABELS[filter as ItemStatus].toLowerCase()} links`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {query.trim()
              ? "Try a shorter word, or switch the filter."
              : "Share a link from Android, or tap Add link to save one."}
          </p>
        </div>
      )}

      {editing && (
        <ItemEditSheet
          item={editing}
          goals={goals}
          pending={saving}
          error={sheetError}
          onCancel={() => {
            setEditId(null);
            setSheetError(null);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}


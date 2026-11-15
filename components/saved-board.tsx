"use client";

import { useMemo, useState, useTransition } from "react";

import {
  deleteItemAction,
  markItemReadAction,
  markItemUnreadAction,
  setRevisitAction,
  updateItemAction,
} from "@/app/saved/actions";
import { ItemEditSheet, type ItemEditInput } from "@/components/item-edit-sheet";
import {
  REVISIT_MONTHS,
  SAVED_TABS,
  SAVED_TAB_LABELS,
  itemTypeLabel,
  safeHref,
  savedBucketOf,
  type GoalOption,
  type InboxItem,
  type SavedBucket,
  type SavedTab,
} from "@/lib/inbox";
import { goalLabel } from "@/lib/task";

const ACTION_CLASS =
  "h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50";
const PRIMARY_ACTION_CLASS =
  "h-9 rounded-lg border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50";

/** "12 Nov", or "12 Nov 2027" when the date is not this year. */
function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getUTCFullYear() === now.getUTCFullYear()
      ? {}
      : { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
}

function tagsOf(item: InboxItem): string[] {
  return Array.isArray(item.tags) ? item.tags : [];
}

function filterClass(active: boolean): string {
  return [
    "h-9 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
    active
      ? "border-transparent bg-accent text-accent-foreground"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
  ].join(" ");
}

function isVideo(item: InboxItem): boolean {
  return item.type === "video";
}

type SavedBoardProps = {
  items: InboxItem[];
  goals: GoalOption[];
  loadError: string | null;
};

/** The Saved screen: Unread / Revisit / Read, search, goal and tag filters. */
export function SavedBoard({
  items: initialItems,
  goals,
  loadError,
}: SavedBoardProps) {
  /** Local edits layered over the server list; null marks a deleted row. */
  const [overrides, setOverrides] = useState<Record<string, InboxItem | null>>(
    {},
  );
  const [tab, setTab] = useState<SavedTab>("unread");
  const [query, setQuery] = useState("");
  const [goalFilter, setGoalFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [menuId, setMenuId] = useState<string | null>(null);
  const [revisitId, setRevisitId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(loadError);
  const [notice, setNotice] = useState<string | null>(null);

  const [saving, startSaving] = useTransition();

  // One "now" per mount keeps every tab and badge in agreement.
  const now = useMemo(() => new Date(), []);

  // The server list is the source of truth, so a quick save (router.refresh)
  // lands here without an effect: only the rows this screen changed differ.
  const items = useMemo(
    () =>
      initialItems
        .map((item) => (item.id in overrides ? overrides[item.id] : item))
        .filter((item): item is InboxItem => item !== null),
    [initialItems, overrides],
  );

  const goalLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of goals) map.set(option.goal, option.label);
    return map;
  }, [goals]);

  const counts = useMemo(() => {
    const next: Record<SavedBucket, number> = {
      unread: 0,
      revisit: 0,
      read: 0,
      dropped: 0,
    };

    for (const item of items) next[savedBucketOf(item, now)] += 1;
    return next;
  }, [items, now]);

  /** Tags in use, most used first (the chip row under the filters). */
  const tagCounts = useMemo(() => {
    const countsByTag = new Map<string, number>();

    for (const item of items) {
      if (savedBucketOf(item, now) === "dropped") continue;
      for (const tag of tagsOf(item)) {
        countsByTag.set(tag, (countsByTag.get(tag) ?? 0) + 1);
      }
    }

    return [...countsByTag.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20);
  }, [items, now]);

  /** Goals actually present in the list, plus the user's target labels. */
  const goalChoices = useMemo(() => {
    const seen = new Set<string>();

    for (const item of items) {
      if (item.goal && savedBucketOf(item, now) !== "dropped") seen.add(item.goal);
    }

    return [...seen]
      .sort((a, b) => a.localeCompare(b))
      .map((goal) => ({ goal, label: goalLabel(goal, goalLabels.get(goal)) }));
  }, [items, now, goalLabels]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return items
      .filter((item) => savedBucketOf(item, now) === tab)
      .filter((item) => !goalFilter || item.goal === goalFilter)
      .filter((item) => !tagFilter || tagsOf(item).includes(tagFilter))
      .filter((item) => {
        if (!needle) return true;

        return [item.title, item.source_domain, item.goal, item.type, ...tagsOf(item)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) =>
        tab === "revisit"
          ? (a.revisit_at ?? "").localeCompare(b.revisit_at ?? "")
          : b.created_at.localeCompare(a.created_at),
      );
  }, [items, tab, query, goalFilter, tagFilter, now]);

  const editing = editId ? (items.find((item) => item.id === editId) ?? null) : null;

  function patchItem(next: InboxItem) {
    setOverrides((map) => ({ ...map, [next.id]: next }));
  }

  function clearPanels() {
    setMenuId(null);
    setRevisitId(null);
    setDeleteId(null);
  }

  function beginAction(item: InboxItem): boolean {
    if (busyId) return false;
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    clearPanels();
    return true;
  }

  async function handleRead(item: InboxItem) {
    if (!beginAction(item)) return;

    const result = await markItemReadAction(item.id);

    if (!result.ok) {
      setError(result.message);
    } else {
      patchItem(result.item);
      setNotice(
        isVideo(item)
          ? "Marked watched and logged against this week."
          : "Marked read and logged against this week.",
      );
    }

    setBusyId(null);
  }

  async function handleUnread(item: InboxItem) {
    if (!beginAction(item)) return;

    const result = await markItemUnreadAction(item.id);

    if (!result.ok) {
      setError(result.message);
    } else {
      patchItem(result.item);
      setNotice("Moved back to Unread.");
    }

    setBusyId(null);
  }

  async function handleRevisit(item: InboxItem, months: 1 | 2) {
    if (!beginAction(item)) return;

    const result = await setRevisitAction({ id: item.id, months });

    if (!result.ok) {
      setError(result.message);
    } else {
      patchItem(result.item);
      setNotice(
        result.item.revisit_at
          ? `Parked until ${dayLabel(result.item.revisit_at, now)}.`
          : "Parked for later.",
      );
    }

    setBusyId(null);
  }

  async function handleDelete(item: InboxItem) {
    if (!beginAction(item)) return;

    const result = await deleteItemAction(item.id);

    if (!result.ok) {
      setError(result.message);
    } else {
      setOverrides((map) => ({ ...map, [item.id]: null }));
      setNotice("Deleted.");
    }

    setBusyId(null);
  }

  function handleSave(input: ItemEditInput) {
    if (!editing) return;

    const item = editing;
    setSheetError(null);

    startSaving(async () => {
      const result = await updateItemAction({ id: item.id, ...input });

      if (!result.ok) {
        setSheetError(result.message);
        return;
      }

      patchItem(result.item);
      setEditId(null);
      setNotice("Link updated.");
    });
  }


  return (
    <div className="px-4 pt-4 pb-24">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Saved</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {counts.unread === 0
            ? "Nothing unread — save something to come back to."
            : `${counts.unread} unread ${counts.unread === 1 ? "link" : "links"} waiting.`}
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search titles, tags, goals…"
          aria-label="Search saved links"
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
        />
        <select
          value={goalFilter}
          onChange={(event) => setGoalFilter(event.target.value)}
          aria-label="Filter by goal"
          className="h-11 w-36 shrink-0 rounded-xl border border-border bg-background px-2 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
        >
          <option value="">All goals</option>
          {goalChoices.map((option) => (
            <option key={option.goal} value={option.goal}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {SAVED_TABS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={filterClass(tab === value)}
          >
            {SAVED_TAB_LABELS[value]} ({counts[value]})
          </button>
        ))}
      </div>

      {tagCounts.length > 0 && (
        <div
          aria-label="Filter by tag"
          className="mt-2 flex gap-2 overflow-x-auto pb-1"
        >
          <button
            type="button"
            aria-pressed={tagFilter === null}
            onClick={() => setTagFilter(null)}
            className={filterClass(tagFilter === null)}
          >
            All tags
          </button>
          {tagCounts.map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              aria-pressed={tagFilter === tag}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              className={filterClass(tagFilter === tag)}
            >
              #{tag} ({count})
            </button>
          ))}
        </div>
      )}

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
          const busy = busyId === item.id;
          const tags = tagsOf(item);
          const dueBack = item.status === "todo" && item.revisit_at !== null;

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
                  <span className="text-muted-foreground">
                    · {item.est_minutes ?? 10} min
                  </span>
                  {dueBack && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                      Revisit
                    </span>
                  )}
                </div>

                <h2 className="mt-2 text-base font-semibold leading-snug">
                  {item.title}
                </h2>

                {tab === "revisit" && item.revisit_at && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Comes back {dayLabel(item.revisit_at, now)}
                  </p>
                )}

                {tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={tagFilter === tag}
                        onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                        className={[
                          "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                          tagFilter === tag
                            ? "bg-accent text-accent-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
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

                  {item.status === "todo" ? (
                    <button
                      type="button"
                      onClick={() => handleRead(item)}
                      disabled={busy}
                      className={PRIMARY_ACTION_CLASS}
                    >
                      {item.type === "task"
                        ? "Done"
                        : isVideo(item)
                          ? "Watched"
                          : "Mark read"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleUnread(item)}
                      disabled={busy}
                      className={ACTION_CLASS}
                    >
                      Mark unread
                    </button>
                  )}

                  <button
                    type="button"
                    aria-expanded={revisitId === item.id}
                    onClick={() => {
                      setMenuId(null);
                      setDeleteId(null);
                      setRevisitId(revisitId === item.id ? null : item.id);
                    }}
                    disabled={busy}
                    className={ACTION_CLASS}
                  >
                    Revisit later
                  </button>

                  <button
                    type="button"
                    aria-expanded={menuId === item.id}
                    aria-label={`More actions for ${item.title}`}
                    onClick={() => {
                      setRevisitId(null);
                      setDeleteId(null);
                      setMenuId(menuId === item.id ? null : item.id);
                    }}
                    disabled={busy}
                    className={`${ACTION_CLASS} w-9 px-0 text-base leading-none`}
                  >
                    ⋯
                  </button>
                </div>



                {revisitId === item.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-2">
                    <span className="text-xs text-muted-foreground">
                      Come back in
                    </span>
                    {REVISIT_MONTHS.map((months) => (
                      <button
                        key={months}
                        type="button"
                        onClick={() => handleRevisit(item, months)}
                        disabled={busy}
                        className={ACTION_CLASS}
                      >
                        {months} {months === 1 ? "month" : "months"}
                      </button>
                    ))}
                  </div>
                )}

                {menuId === item.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuId(null);
                        setSheetError(null);
                        setEditId(item.id);
                      }}
                      disabled={busy}
                      className={ACTION_CLASS}
                    >
                      Edit
                    </button>

                    {deleteId === item.id ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          Delete for good?
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDelete(item)}
                          disabled={busy}
                          className="h-9 rounded-lg border border-red-300 px-3 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                        >
                          {busy ? "Deleting…" : "Delete"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteId(null)}
                          disabled={busy}
                          className={ACTION_CLASS}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteId(item.id)}
                        disabled={busy}
                        className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>

      {visible.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">
            {query.trim() || goalFilter || tagFilter
              ? "Nothing matches those filters"
              : tab === "unread"
                ? "Nothing unread"
                : tab === "revisit"
                  ? "Nothing parked"
                  : "Nothing read yet"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {query.trim() || goalFilter || tagFilter
              ? "Try a shorter search or clear the goal and tag filters."
              : tab === "unread"
                ? "Tap the + button to save a link, or share one from your phone."
                : tab === "revisit"
                  ? "Use Revisit later on a link to push it out a month or two."
                  : "Links you mark read land here."}
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

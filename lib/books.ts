import type { SupabaseClient } from "@supabase/supabase-js";

import { istDayKey } from "@/lib/week";

/**
 * The reading tracker: one book at a time, a page count, and a pace worked out
 * from `started_on`. Pure except the loader, so client components may use the
 * formatters and the pace maths too.
 */

export const BOOK_STATUSES = [
  "reading",
  "up_next",
  "finished",
  "dropped",
] as const;

export type BookStatus = (typeof BOOK_STATUSES)[number];

export const BOOK_STATUS_LABELS: Record<BookStatus, string> = {
  reading: "Reading",
  up_next: "Up next",
  finished: "Finished",
  dropped: "Dropped",
};

export const BOOK_TITLE_MAX = 200;
export const BOOK_AUTHOR_MAX = 120;
export const BOOK_NOTE_MAX = 500;
export const BOOK_PAGES_MAX = 20000;

export type Book = {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  totalPages: number | null;
  currentPage: number;
  /** IST day key the reading started, `YYYY-MM-DD`. */
  startedOn: string | null;
  finishedOn: string | null;
  rating: number | null;
  note: string | null;
  createdAt: string;
};

/** The shelf, already grouped so the page does no filtering. */
export type BookShelf = {
  reading: Book | null;
  upNext: Book[];
  finished: Book[];
  dropped: Book[];
};

const BOOK_COLUMNS =
  "id, title, author, status, total_pages, current_page, started_on, finished_on, rating, note, created_at";

type BookRow = {
  id: string;
  title: string;
  author: string | null;
  status: string;
  total_pages: number | string | null;
  current_page: number | string | null;
  started_on: string | null;
  finished_on: string | null;
  rating: number | string | null;
  note: string | null;
  created_at: string;
};

function toNumber(value: number | string | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStatus(value: string): BookStatus {
  return BOOK_STATUSES.includes(value as BookStatus)
    ? (value as BookStatus)
    : "up_next";
}

function toBook(row: BookRow): Book {
  return {
    id: String(row.id),
    title: row.title,
    author: row.author,
    status: toStatus(row.status),
    totalPages: toNumber(row.total_pages),
    currentPage: toNumber(row.current_page) ?? 0,
    startedOn: row.started_on ? String(row.started_on).slice(0, 10) : null,
    finishedOn: row.finished_on ? String(row.finished_on).slice(0, 10) : null,
    rating: toNumber(row.rating),
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Pages read so far, never negative. */
export function pagesRead(book: Book): number {
  return Math.max(0, book.currentPage);
}

/**
 * How many days the book has been in progress, counting today. A book started
 * today is on day 1, so pace never divides by zero.
 */
export function daysReading(book: Book, now: Date = new Date()): number | null {
  if (!book.startedOn) return null;

  const start = Date.parse(`${book.startedOn}T00:00:00+05:30`);
  if (!Number.isFinite(start)) return null;

  const elapsed = Math.floor((now.getTime() - start) / 86_400_000) + 1;
  return Math.max(1, elapsed);
}

/** Whole percent read, or null when the book has no page total. */
export function bookPercent(book: Book): number | null {
  if (!book.totalPages || book.totalPages <= 0) return null;
  const percent = (pagesRead(book) / book.totalPages) * 100;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** Pages per day since the book was started, one decimal place. */
export function pagesPerDay(book: Book, now: Date = new Date()): number | null {
  const days = daysReading(book, now);
  if (days === null) return null;

  const pages = pagesRead(book);
  if (pages <= 0) return null;

  return Math.round((pages / days) * 10) / 10;
}

/** Days left at the current pace, rounded up; null when it cannot be known. */
export function daysLeft(book: Book, now: Date = new Date()): number | null {
  if (!book.totalPages) return null;

  const remaining = book.totalPages - pagesRead(book);
  if (remaining <= 0) return 0;

  const pace = pagesPerDay(book, now);
  if (pace === null || pace <= 0) return null;

  return Math.ceil(remaining / pace);
}

/** One line under the progress bar: pace, pages left and finish estimate. */
export function bookPaceLabel(book: Book, now: Date = new Date()): string {
  const read = pagesRead(book);

  if (!book.totalPages) {
    return read > 0 ? `${read} pages read` : "Add the page total to track pace";
  }

  if (read >= book.totalPages) return "Finished";

  const remaining = book.totalPages - read;
  const pace = pagesPerDay(book, now);
  const left = daysLeft(book, now);

  if (pace === null || left === null) {
    return `${remaining} ${remaining === 1 ? "page" : "pages"} left`;
  }

  return `${pace} pages/day · ${remaining} left · ~${left} ${
    left === 1 ? "day" : "days"
  } to go`;
}

/**
 * Reads the whole shelf in one query. Newest first, so "up next" reads like a
 * queue the user built rather than an alphabetical list.
 */
export async function loadBooks(
  supabase: SupabaseClient,
  userId: string,
): Promise<BookShelf> {
  const { data, error } = await supabase
    .from("books")
    .select(BOOK_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`Could not load books: ${error.message}`);
  }

  const shelf: BookShelf = {
    reading: null,
    upNext: [],
    finished: [],
    dropped: [],
  };

  for (const row of (data ?? []) as BookRow[]) {
    const book = toBook(row);

    if (book.status === "reading") {
      // The partial unique index allows one, so the first one wins regardless.
      shelf.reading ??= book;
    } else if (book.status === "finished") {
      shelf.finished.push(book);
    } else if (book.status === "dropped") {
      shelf.dropped.push(book);
    } else {
      shelf.upNext.push(book);
    }
  }

  return shelf;
}

/** Today's IST day key, so the actions and the page agree on "today". */
export function todayKey(now: Date = new Date()): string {
  return istDayKey(now);
}

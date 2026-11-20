import { z } from "zod";

import {
  BOOK_AUTHOR_MAX,
  BOOK_NOTE_MAX,
  BOOK_PAGES_MAX,
  BOOK_STATUSES,
  BOOK_TITLE_MAX,
  type Book,
  type BookStatus,
} from "@/lib/books";
import { describeDbError } from "@/lib/errors";
import type { DbSession } from "@/lib/services/session";
import { istDayKey } from "@/lib/week";

/**
 * Writes for the reading tracker. Every query is scoped by `user_id` as well as
 * left to the `books owner` RLS policy, and the one-book-at-a-time rule is
 * checked here for a readable message before the partial unique index has to
 * reject the row.
 */

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

export type BookWriteResult =
  | { ok: true; book: Book }
  | { ok: false; message: string };

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

const optionalPages = z
  .number()
  .int()
  .min(1)
  .max(BOOK_PAGES_MAX)
  .nullable()
  .optional();

export const addBookSchema = z.object({
  title: z.string().trim().min(1).max(BOOK_TITLE_MAX),
  author: optionalText(BOOK_AUTHOR_MAX),
  totalPages: optionalPages,
  /** Adding straight to the shelf is allowed, but only one book can be reading. */
  startReading: z.boolean().optional(),
});

export const bookIdSchema = z.object({
  id: z.string().uuid(),
});

export const updateBookPageSchema = z.object({
  id: z.string().uuid(),
  currentPage: z.number().int().min(0).max(BOOK_PAGES_MAX),
});

export const finishBookSchema = z.object({
  id: z.string().uuid(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  note: optionalText(BOOK_NOTE_MAX),
});

function toBook(row: BookRow): Book {
  return {
    id: String(row.id),
    title: row.title,
    author: row.author,
    status: BOOK_STATUSES.includes(row.status as BookStatus)
      ? (row.status as BookStatus)
      : "up_next",
    totalPages:
      row.total_pages === null || row.total_pages === ""
        ? null
        : Number(row.total_pages),
    currentPage:
      row.current_page === null || row.current_page === ""
        ? 0
        : Number(row.current_page),
    startedOn: row.started_on ? String(row.started_on).slice(0, 10) : null,
    finishedOn: row.finished_on ? String(row.finished_on).slice(0, 10) : null,
    rating: row.rating === null ? null : Number(row.rating),
    note: row.note,
    createdAt: row.created_at,
  };
}

/** The one row that can be `reading`, if any. */
async function loadReadingBook(
  session: DbSession,
): Promise<{ id: string; title: string } | null> {
  const { data, error } = await session.supabase
    .from("books")
    .select("id, title")
    .eq("user_id", session.userId)
    .eq("status", "reading")
    .maybeSingle();

  if (error) {
    console.error("Could not check the current book:", error.message);
    return null;
  }

  return data ? { id: String(data.id), title: data.title } : null;
}

function busyMessage(title: string): string {
  return `Finish or drop "${title}" first — one book at a time.`;
}

function failed(action: string, message: string): BookWriteResult {
  console.error(`Could not ${action}:`, message);
  return { ok: false, message };
}

/** Adds a book to "up next", or starts it right away. */
export async function addBook(
  session: DbSession,
  input: z.input<typeof addBookSchema>,
  now: Date = new Date(),
): Promise<BookWriteResult> {
  const parsed = addBookSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: `Give the book a title (up to ${BOOK_TITLE_MAX} characters).`,
    };
  }

  const { title, author, totalPages, startReading } = parsed.data;
  const reading = startReading ? await loadReadingBook(session) : null;
  const status: BookStatus = startReading ? "reading" : "up_next";

  if (startReading && reading) {
    return { ok: false, message: busyMessage(reading.title) };
  }

  const { data, error } = await session.supabase
    .from("books")
    .insert({
      user_id: session.userId,
      title,
      author: author ?? null,
      total_pages: totalPages ?? null,
      current_page: 0,
      status,
      started_on: startReading ? istDayKey(now) : null,
      updated_at: new Date().toISOString(),
    })
    .select(BOOK_COLUMNS)
    .maybeSingle();

  if (error) return failed("add the book", describeDbError(error));
  if (!data) return { ok: false, message: "The book was not saved." };

  return { ok: true, book: toBook(data as BookRow) };
}

/** Moves a book to `reading` and stamps the day the reading started. */
export async function startReading(
  session: DbSession,
  id: string,
  now: Date = new Date(),
): Promise<BookWriteResult> {
  const parsed = bookIdSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, message: "That book is unknown." };

  const reading = await loadReadingBook(session);
  if (reading && reading.id !== parsed.data.id) {
    return { ok: false, message: busyMessage(reading.title) };
  }

  const { data: current } = await session.supabase
    .from("books")
    .select("started_on")
    .eq("user_id", session.userId)
    .eq("id", parsed.data.id)
    .maybeSingle();

  const { data, error } = await session.supabase
    .from("books")
    .update({
      status: "reading",
      // Resuming a paused book keeps its original start, so pace stays honest.
      started_on: current?.started_on ?? istDayKey(now),
      finished_on: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", session.userId)
    .eq("id", parsed.data.id)
    .select(BOOK_COLUMNS)
    .maybeSingle();

  if (error) {
    // 23505 is the one-reading index: another tab started a book first.
    if (error.code === "23505") {
      const other = await loadReadingBook(session);
      if (other) return { ok: false, message: busyMessage(other.title) };
    }
    return failed("start the book", describeDbError(error));
  }

  if (!data) return { ok: false, message: "That book is no longer on the shelf." };

  return { ok: true, book: toBook(data as BookRow) };
}

/**
 * Saves the page the reader is on. Reaching the last page finishes the book, so
 * a page update is the only thing needed to close it out.
 */
export async function updateBookPage(
  session: DbSession,
  input: z.input<typeof updateBookPageSchema>,
  now: Date = new Date(),
): Promise<BookWriteResult> {
  const parsed = updateBookPageSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That page number does not look right." };
  }

  const { id, currentPage } = parsed.data;

  const { data: current, error: loadError } = await session.supabase
    .from("books")
    .select("status, total_pages")
    .eq("user_id", session.userId)
    .eq("id", id)
    .maybeSingle();

  if (loadError) return failed("load the book", describeDbError(loadError));
  if (!current) return { ok: false, message: "That book is no longer on the shelf." };

  if (current.status !== "reading") {
    return { ok: false, message: "Start the book before updating pages." };
  }

  const totalPages =
    current.total_pages === null ? null : Number(current.total_pages);
  const page = totalPages ? Math.min(currentPage, totalPages) : currentPage;
  const finished = totalPages !== null && page >= totalPages;

  const update: Record<string, unknown> = {
    current_page: page,
    updated_at: new Date().toISOString(),
  };

  if (finished) {
    update.status = "finished";
    update.finished_on = istDayKey(now);
  }

  const { data, error } = await session.supabase
    .from("books")
    .update(update)
    .eq("user_id", session.userId)
    .eq("id", id)
    .select(BOOK_COLUMNS)
    .maybeSingle();

  if (error) return failed("save the page", describeDbError(error));
  if (!data) return { ok: false, message: "That book is no longer on the shelf." };

  return { ok: true, book: toBook(data as BookRow) };
}

/** Closes a book out, optionally with a rating and a note. */
export async function finishBook(
  session: DbSession,
  input: z.input<typeof finishBookSchema>,
  now: Date = new Date(),
): Promise<BookWriteResult> {
  const parsed = finishBookSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "A rating is 1 to 5 stars." };
  }

  const { id, rating, note } = parsed.data;
  const today = istDayKey(now);

  const { data: current, error: loadError } = await session.supabase
    .from("books")
    .select("total_pages, current_page")
    .eq("user_id", session.userId)
    .eq("id", id)
    .maybeSingle();

  if (loadError) return failed("load the book", describeDbError(loadError));
  if (!current) return { ok: false, message: "That book is no longer on the shelf." };

  const totalPages =
    current.total_pages === null ? null : Number(current.total_pages);

  const update: Record<string, unknown> = {
    status: "finished",
    finished_on: today,
    // A book with a page total is finished at its last page, not where the
    // reader last tapped save.
    current_page: totalPages ?? Number(current.current_page ?? 0),
    rating: rating ?? null,
    updated_at: new Date().toISOString(),
  };

  if (note !== undefined) update.note = note;

  const { data, error } = await session.supabase
    .from("books")
    .update(update)
    .eq("user_id", session.userId)
    .eq("id", id)
    .select(BOOK_COLUMNS)
    .maybeSingle();

  if (error) return failed("finish the book", describeDbError(error));
  if (!data) return { ok: false, message: "That book is no longer on the shelf." };

  return { ok: true, book: toBook(data as BookRow) };
}

export type BookActionResult = { ok: true } | { ok: false; message: string };

/** Takes a book off the reading pile without finishing it. */
export async function dropBook(
  session: DbSession,
  id: string,
): Promise<BookActionResult> {
  const parsed = bookIdSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, message: "That book is unknown." };

  const { error } = await session.supabase
    .from("books")
    .update({
      status: "dropped",
      finished_on: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", session.userId)
    .eq("id", parsed.data.id);

  if (error) {
    return {
      ok: false,
      message: describeDbError(error),
    };
  }

  return { ok: true };
}

/**
 * Puts a book back in the queue. `started_on` and the page stay put, so
 * resuming later keeps the pace and the progress.
 */
export async function moveToUpNext(
  session: DbSession,
  id: string,
): Promise<BookActionResult> {
  const parsed = bookIdSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, message: "That book is unknown." };

  const { error } = await session.supabase
    .from("books")
    .update({
      status: "up_next",
      finished_on: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", session.userId)
    .eq("id", parsed.data.id);

  if (error) {
    return {
      ok: false,
      message: describeDbError(error),
    };
  }

  return { ok: true };
}

/** Removes the row entirely — for a book added by mistake. */
export async function deleteBook(
  session: DbSession,
  id: string,
): Promise<BookActionResult> {
  const parsed = bookIdSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, message: "That book is unknown." };

  const { error } = await session.supabase
    .from("books")
    .delete()
    .eq("user_id", session.userId)
    .eq("id", parsed.data.id);

  if (error) {
    return {
      ok: false,
      message: describeDbError(error),
    };
  }

  return { ok: true };
}

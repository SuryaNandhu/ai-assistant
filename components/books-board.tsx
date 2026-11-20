"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import type { BookActionResult } from "@/app/books/actions";
import {
  addBookAction,
  deleteBookAction,
  dropBookAction,
  finishBookAction,
  moveToUpNextAction,
  startReadingAction,
  updateBookPageAction,
} from "@/app/books/actions";
import {
  BOOK_AUTHOR_MAX,
  BOOK_PAGES_MAX,
  BOOK_TITLE_MAX,
  bookPaceLabel,
  bookPercent,
  pagesRead,
  type Book,
  type BookShelf,
} from "@/lib/books";

const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

const BUTTON_CLASS =
  "h-10 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50";

type Note = { tone: "ok" | "error"; text: string };

type BooksBoardProps = {
  shelf: BookShelf;
};

function formatDay(day: string | null): string {
  if (!day) return "";
  const parsed = new Date(`${day}T00:00:00+05:30`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5`} className="text-xs text-amber-600">
      {"★".repeat(rating)}
      <span className="text-muted-foreground/40">
        {"★".repeat(Math.max(0, 5 - rating))}
      </span>
    </span>
  );
}

export function BooksBoard({ shelf }: BooksBoardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<Note | null>(null);

  function run(action: () => Promise<BookActionResult>) {
    setNote(null);

    startTransition(async () => {
      const result = await action();
      setNote({ tone: result.ok ? "ok" : "error", text: result.message });
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mt-4">
      {note && (
        <p
          role={note.tone === "error" ? "alert" : "status"}
          className={`rounded-xl border p-2.5 text-sm ${
            note.tone === "error"
              ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          }`}
        >
          {note.text}
        </p>
      )}

      <section className="mt-4" aria-label="Currently reading">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Currently reading
        </h2>

        {shelf.reading ? (
          <ReadingCard
            book={shelf.reading}
            pending={pending}
            onSavePage={(page) =>
              run(() =>
                updateBookPageAction({
                  id: shelf.reading!.id,
                  currentPage: page,
                }),
              )
            }
            onFinish={(rating) =>
              run(() => finishBookAction({ id: shelf.reading!.id, rating }))
            }
            onDrop={() => run(() => dropBookAction({ id: shelf.reading!.id }))}
            onPause={() =>
              run(() => moveToUpNextAction({ id: shelf.reading!.id }))
            }
          />
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Nothing on the go. Add a book below or start one from up next.
          </p>
        )}
      </section>

      <AddBookForm
        pending={pending}
        emptyShelf={!shelf.reading}
        onAdd={(input) => run(() => addBookAction(input))}
      />

      <section className="mt-6" aria-label="Up next">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Up next ({shelf.upNext.length})
        </h2>

        {shelf.upNext.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            The queue is empty.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {shelf.upNext.map((book) => (
              <li key={book.id} className="rounded-2xl border border-border p-3">
                <p className="text-sm font-medium">{book.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {book.author ?? "Unknown author"}
                  {book.totalPages ? ` · ${book.totalPages} pages` : ""}
                  {book.currentPage > 0
                    ? ` · page ${book.currentPage} saved`
                    : ""}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => startReadingAction({ id: book.id }))}
                    className="h-9 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                  >
                    Start reading
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteBookAction({ id: book.id }))}
                    className={BUTTON_CLASS}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {shelf.finished.length > 0 && (
        <section className="mt-6" aria-label="Finished">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Finished ({shelf.finished.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {shelf.finished.map((book) => (
              <li
                key={book.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{book.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {book.author ?? "Unknown author"}
                    {book.finishedOn ? ` · ${formatDay(book.finishedOn)}` : ""}
                    {book.totalPages ? ` · ${book.totalPages} pages` : ""}
                  </p>
                  {book.rating !== null && (
                    <p className="mt-1">
                      <Stars rating={book.rating} />
                    </p>
                  )}
                  {book.note && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {book.note}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => deleteBookAction({ id: book.id }))}
                  className="shrink-0 text-xs text-muted-foreground underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shelf.dropped.length > 0 && (
        <section className="mt-6" aria-label="Dropped">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Dropped ({shelf.dropped.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {shelf.dropped.map((book) => (
              <li
                key={book.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{book.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {pagesRead(book)} pages read
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => moveToUpNextAction({ id: book.id }))}
                  className="shrink-0 text-xs text-muted-foreground underline"
                >
                  Back to up next
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type ReadingCardProps = {
  book: Book;
  pending: boolean;
  onSavePage: (page: number) => void;
  onFinish: (rating: number | null) => void;
  onDrop: () => void;
  onPause: () => void;
};

function ReadingCard({
  book,
  pending,
  onSavePage,
  onFinish,
  onDrop,
  onPause,
}: ReadingCardProps) {
  const [page, setPage] = useState(String(book.currentPage));
  const [rating, setRating] = useState("");
  const [error, setError] = useState<string | null>(null);

  const percent = bookPercent(book);

  function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = Number(page);

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > BOOK_PAGES_MAX) {
      setError(`The page should be a whole number up to ${BOOK_PAGES_MAX}.`);
      return;
    }

    if (book.totalPages && parsed > book.totalPages) {
      setError(`That book only has ${book.totalPages} pages.`);
      return;
    }

    onSavePage(Math.round(parsed));
  }

  return (
    <div className="mt-3 rounded-2xl border border-border p-4">
      <p className="text-base font-semibold">{book.title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {book.author ?? "Unknown author"}
        {book.totalPages ? ` · ${book.totalPages} pages` : ""}
        {book.startedOn ? ` · since ${formatDay(book.startedOn)}` : ""}
      </p>

      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? 0}
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        {pagesRead(book)}
        {book.totalPages ? ` / ${book.totalPages}` : ""} pages
        {percent !== null ? ` · ${percent}%` : ""}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {bookPaceLabel(book)}
      </p>

      <form onSubmit={savePage} className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="book-page" className="text-xs font-medium">
            I am on page
          </label>
          <input
            id="book-page"
            type="number"
            inputMode="numeric"
            min={0}
            max={book.totalPages ?? BOOK_PAGES_MAX}
            step={1}
            value={page}
            onChange={(event) => setPage(event.target.value)}
            className={`${INPUT_CLASS} h-10`}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          Save page
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="book-rating" className="text-xs font-medium">
            Rating
          </label>
          <select
            id="book-rating"
            value={rating}
            onChange={(event) => setRating(event.target.value)}
            className="mt-1 h-10 rounded-xl border border-border bg-background px-2 text-sm"
          >
            <option value="">No rating</option>
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value} {value === 1 ? "star" : "stars"}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => onFinish(rating ? Number(rating) : null)}
          className="h-10 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50"
        >
          Finish
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onPause}
          className={BUTTON_CLASS}
        >
          Pause
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onDrop}
          className="h-10 rounded-xl px-3 text-sm text-muted-foreground underline disabled:opacity-50"
        >
          Drop
        </button>
      </div>
    </div>
  );
}



type AddBookFormProps = {
  pending: boolean;
  emptyShelf: boolean;
  onAdd: (input: {
    title: string;
    author: string | null;
    totalPages: number | null;
    startReading: boolean;
  }) => void;
};

function AddBookForm({ pending, emptyShelf, onAdd }: AddBookFormProps) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [pages, setPages] = useState("");
  const [startReading, setStartReading] = useState(emptyShelf);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const cleanTitle = title.trim();

    if (!cleanTitle) {
      setError("Give the book a title.");
      return;
    }

    let totalPages: number | null = null;

    if (pages.trim()) {
      const parsed = Number(pages);

      if (!Number.isInteger(parsed) || parsed < 1 || parsed > BOOK_PAGES_MAX) {
        setError(`Pages should be between 1 and ${BOOK_PAGES_MAX}.`);
        return;
      }

      totalPages = parsed;
    }

    onAdd({
      title: cleanTitle,
      author: author.trim() || null,
      totalPages,
      startReading,
    });

    setTitle("");
    setAuthor("");
    setPages("");
    setStartReading(false);
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-2xl border border-border p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Add a book
      </h2>

      <label htmlFor="book-title" className="mt-3 block text-sm font-medium">
        Title
      </label>
      <input
        id="book-title"
        type="text"
        value={title}
        maxLength={BOOK_TITLE_MAX}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="The book you want to read"
        className={`${INPUT_CLASS} h-11`}
      />

      <label htmlFor="book-author" className="mt-3 block text-sm font-medium">
        Author (optional)
      </label>
      <input
        id="book-author"
        type="text"
        value={author}
        maxLength={BOOK_AUTHOR_MAX}
        onChange={(event) => setAuthor(event.target.value)}
        className={`${INPUT_CLASS} h-11`}
      />

      <label htmlFor="book-pages" className="mt-3 block text-sm font-medium">
        Pages (optional)
      </label>
      <input
        id="book-pages"
        type="number"
        inputMode="numeric"
        min={1}
        max={BOOK_PAGES_MAX}
        step={1}
        value={pages}
        onChange={(event) => setPages(event.target.value)}
        placeholder="Needed for pace"
        className={`${INPUT_CLASS} h-11`}
      />

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={startReading}
          onChange={(event) => setStartReading(event.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        Start reading now
      </label>

      <p className="mt-1 text-xs text-muted-foreground">
        One book at a time. Another can start once this one is finished, paused
        or dropped.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-3 h-11 w-full rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        Add book
      </button>
    </form>
  );
}

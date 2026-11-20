"use server";

import { revalidatePath } from "next/cache";

import {
  addBook,
  addBookSchema,
  bookIdSchema,
  deleteBook,
  dropBook,
  finishBook,
  finishBookSchema,
  moveToUpNext,
  startReading,
  updateBookPage,
  updateBookPageSchema,
} from "@/lib/services/books";
import { createClient } from "@/lib/supabase/server";

type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

export type BookActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

async function requireSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    if (error) console.error("Could not read Supabase session:", error.message);
    return null;
  }

  return { supabase, userId: data.claims.sub };
}

const SIGNED_OUT = "You are signed out. Refresh the page and sign in again.";

function revalidateBooks() {
  revalidatePath("/books");
  revalidatePath("/progress");
}

function addedMessage(title: string): string {
  return `Added "${title}" to up next.`;
}

/** Adds a book to the queue, or starts it when the shelf is empty. */
export async function addBookAction(input: unknown): Promise<BookActionResult> {
  const parsed = addBookSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Give the book a title first." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const result = await addBook(session, parsed.data, new Date());

  if (!result.ok) return result;

  revalidateBooks();

  return {
    ok: true,
    message:
      result.book.status === "reading"
        ? `Started "${result.book.title}".`
        : addedMessage(result.book.title),
  };
}

/** Moves a book into "reading"; a second one is refused by the service. */
export async function startReadingAction(input: unknown): Promise<BookActionResult> {
  const parsed = bookIdSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That book is unknown." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const result = await startReading(session, parsed.data.id, new Date());

  if (!result.ok) return result;

  revalidateBooks();

  return { ok: true, message: `Started "${result.book.title}".` };
}

/** Saves the current page; landing on the last page finishes the book. */
export async function updateBookPageAction(
  input: unknown,
): Promise<BookActionResult> {
  const parsed = updateBookPageSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That page number does not look right." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const result = await updateBookPage(session, parsed.data, new Date());

  if (!result.ok) return result;

  revalidateBooks();

  return {
    ok: true,
    message:
      result.book.status === "finished"
        ? `Finished "${result.book.title}".`
        : `Saved page ${result.book.currentPage}.`,
  };
}

/** Closes a book out with an optional rating and note. */
export async function finishBookAction(
  input: unknown,
): Promise<BookActionResult> {
  const parsed = finishBookSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "A rating is 1 to 5 stars." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const result = await finishBook(session, parsed.data, new Date());

  if (!result.ok) return result;

  revalidateBooks();

  return { ok: true, message: `Finished "${result.book.title}".` };
}

/** Removes a book from the reading pile without finishing it. */
export async function dropBookAction(input: unknown): Promise<BookActionResult> {
  const parsed = bookIdSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That book is unknown." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const result = await dropBook(session, parsed.data.id);

  if (!result.ok) return result;

  revalidateBooks();

  return { ok: true, message: "Dropped. It stays in your list." };
}

/** Puts the reading book back in the queue, keeping its page. */
export async function moveToUpNextAction(
  input: unknown,
): Promise<BookActionResult> {
  const parsed = bookIdSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That book is unknown." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const result = await moveToUpNext(session, parsed.data.id);

  if (!result.ok) return result;

  revalidateBooks();

  return { ok: true, message: "Moved back to up next." };
}

/** Deletes the row, for a book added by mistake. */
export async function deleteBookAction(
  input: unknown,
): Promise<BookActionResult> {
  const parsed = bookIdSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That book is unknown." };
  }

  const session = await requireSession();
  if (!session) return { ok: false, message: SIGNED_OUT };

  const result = await deleteBook(session, parsed.data.id);

  if (!result.ok) return result;

  revalidateBooks();

  return { ok: true, message: "Removed from your shelf." };
}

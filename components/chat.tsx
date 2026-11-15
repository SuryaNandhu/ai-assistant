"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { messageText } from "@/lib/messages";

type ToolChipData = {
  label: string;
  tone: "ok" | "error" | "pending";
};

/**
 * Turns the tool parts of an assistant message into small chips. The model says
 * what happened in its own words; the chip is the receipt from the tool itself.
 */
function readToolChips(parts: UIMessage["parts"]): ToolChipData[] {
  const chips: ToolChipData[] = [];

  for (const part of parts) {
    if (!part.type.startsWith("tool-")) continue;

    const call = part as unknown as { state?: string; output?: unknown };

    if (call.state === "output-available") {
      const output = call.output as { ok?: boolean; message?: unknown } | null;
      chips.push({
        label:
          typeof output?.message === "string" ? output.message : "Done.",
        tone: output?.ok === false ? "error" : "ok",
      });
      continue;
    }

    if (call.state === "output-error") {
      chips.push({ label: "That action failed.", tone: "error" });
      continue;
    }

    chips.push({ label: "Working…", tone: "pending" });
  }

  return chips;
}

function ToolChip({ label, tone }: ToolChipData) {
  return (
    <span
      className={[
        "inline-flex max-w-full items-start gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs leading-relaxed",
        tone === "error"
          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          : tone === "pending"
            ? "border-dashed border-border bg-background text-muted-foreground"
            : "border-border bg-background text-muted-foreground",
      ].join(" ")}
    >
      <span aria-hidden="true">{tone === "error" ? "!" : "✓"}</span>
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}

type ChatProps = {
  initialMessages: UIMessage[];
  historyError?: string | null;
};

export function Chat({ initialMessages, historyError }: ChatProps) {
  const [transport] = useState(
    () => new DefaultChatTransport({ api: "/api/chat" }),
  );
  const [input, setInput] = useState("");

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const { messages, sendMessage, status, error, clearError } = useChat({
    messages: initialMessages,
    transport,
  });

  const isBusy = status === "submitted" || status === "streaming";

  // Keep the newest message in view, unless the user scrolled up to read.
  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages, status, error]);

  function handleScroll() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    stickToBottom.current = distanceFromBottom < 80;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;

    setInput("");
    stickToBottom.current = true;
    void sendMessage({ text });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-3 py-5 sm:px-4 sm:py-6">
          {historyError && (
            <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {historyError}{" "}
              If this is a fresh project, run{" "}
              <code className="font-mono">supabase/schema.sql</code> in the
              Supabase SQL editor.
            </p>
          )}

          {messages.length === 0 && !historyError && <EmptyState />}

          {messages.map((message) => {
            const text = messageText(message);
            const chips =
              message.role === "assistant" ? readToolChips(message.parts) : [];

            if (!text && chips.length === 0) return null;

            const isUser = message.role === "user";
            return (
              <div
                key={message.id}
                className={isUser ? "flex justify-end" : "flex justify-start"}
              >
                <div className="flex max-w-[85%] flex-col items-start gap-1.5 sm:max-w-[75%]">
                  {text && (
                    <div
                      className={[
                        "max-w-full whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                        isUser
                          ? "rounded-br-md bg-accent text-accent-foreground"
                          : "rounded-bl-md border border-border bg-muted",
                      ].join(" ")}
                    >
                      {text}
                    </div>
                  )}

                  {chips.map((chip, index) => (
                    <ToolChip
                      key={`${message.id}-tool-${index}`}
                      label={chip.label}
                      tone={chip.tone}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {status === "submitted" && (
            <div className="flex justify-start" aria-live="polite">
              <div className="rounded-2xl rounded-bl-md border border-border bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                Thinking…
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              <p className="whitespace-pre-wrap break-words">
                {error.message || "The request failed. Please try again."}
              </p>
              <button
                type="button"
                onClick={() => clearError()}
                className="shrink-0 underline underline-offset-2"
              >
                Dismiss
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-border bg-background px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
      >
        <div className="mx-auto flex w-full max-w-2xl items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Message your assistant…"
            aria-label="Message"
            className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/40"
          />
          <button
            type="submit"
            disabled={isBusy || input.trim().length === 0}
            className="h-10 shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-2xl text-center text-[11px] text-muted-foreground">
          Enter to send · Shift+Enter for a new line
        </p>
      </form>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-border bg-muted p-4 text-sm">
      <p className="font-medium">What should we do today?</p>
      <p className="mt-1 text-muted-foreground">
        Ask about your backlog, LeetCode practice, or the project you are
        shipping this month.
      </p>
    </div>
  );
}

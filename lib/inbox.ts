/**
 * Inbox shapes and link rules shared by the server and the client.
 *
 * Nothing here touches Supabase, `next/headers` or `node:*`, so client
 * components can import it directly (same idea as `lib/task.ts`).
 */

import type { Energy } from "@/lib/task";

export type ItemStatus = "todo" | "done" | "dropped";

export const ITEM_STATUSES: readonly ItemStatus[] = ["todo", "done", "dropped"];

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  todo: "To do",
  done: "Done",
  dropped: "Dropped",
};

export function isItemStatus(value: unknown): value is ItemStatus {
  return (
    typeof value === "string" && (ITEM_STATUSES as readonly string[]).includes(value)
  );
}

/** Types the inbox knows how to label. `items.type` stays free-form text. */
export const ITEM_TYPES = ["article", "video", "leetcode", "job", "other"] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_TYPE_LABELS: Record<string, string> = {
  article: "Article",
  video: "Video",
  leetcode: "LeetCode",
  job: "Job",
  other: "Other",
};

/** Human label for an item type, falling back to a prettified raw value. */
export function itemTypeLabel(type: string | null | undefined): string {
  const raw = type?.trim();
  if (!raw) return "Item";

  const known = ITEM_TYPE_LABELS[raw];
  if (known) return known;

  const pretty = raw.replace(/[_-]+/g, " ").trim();
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

/** One row of `items`, as the inbox reads it. */
export type InboxItem = {
  id: string;
  title: string;
  url: string | null;
  type: string;
  goal: string | null;
  status: ItemStatus;
  est_minutes: number | null;
  energy: Energy;
  notes: string | null;
  source_domain: string | null;
  summary: string | null;
  takeaway: string | null;
  summarized_at: string | null;
  added_via: string | null;
  created_at: string;
};

/** Columns selected for every inbox item (kept in one place). */
export const INBOX_ITEM_COLUMNS =
  "id, title, url, type, goal, status, est_minutes, energy, notes, source_domain, summary, takeaway, summarized_at, added_via, created_at";

export const ADDED_VIA_VALUES = ["manual", "share", "api"] as const;

export type AddedVia = (typeof ADDED_VIA_VALUES)[number];

/** An active weekly target, as offered in the goal picker. */
export type GoalOption = {
  goal: string;
  label: string;
};

// ---------------------------------------------------------------------------
// URLs: validation (including SSRF host blocking), normalisation, titles
// ---------------------------------------------------------------------------

const MAX_URL_LENGTH = 2048;

/**
 * Parses a user-supplied link into an http(s) URL. A bare domain gets an
 * `https://` prefix so pasting "example.com" works; anything that is not
 * http(s) after that is rejected.
 */
export function parseHttpUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  if (isPrivateHostname(url.hostname)) return null;

  return url;
}

/** `true` for IPv4 literals such as 10.1.2.3 (private, loopback or reserved). */
export function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN,
  );
  if (octets.some((octet) => !Number.isFinite(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/** `true` for IPv6 loopback, unique-local and link-local addresses. */
export function isPrivateIpv6(address: string): boolean {
  const host = address.toLowerCase();
  if (!host.includes(":")) return false;

  if (host === "::1" || host === "::") return true;

  // IPv4-mapped addresses: WHATWG URLs normalise "::ffff:127.0.0.1" to
  // "::ffff:7f00:1", DNS returns either form.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (dotted) return isPrivateIpv4(dotted[1]);

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (hex) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return isPrivateIpv4(
      `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
    );
  }

  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true; // fe80::/10
  return false;
}

/**
 * Blocks hostnames that can only resolve inside a private network. This is the
 * first SSRF gate; the fetcher additionally resolves DNS and re-checks the
 * addresses it is about to connect to.
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "");

  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".lan")
  ) {
    return true;
  }

  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return true;

  // A single-label name ("intranet") can never be a public site.
  if (!host.includes(".") && !host.includes(":")) return true;

  return false;
}

/** `true` when the host is an IP literal rather than a DNS name. */
export function isIpLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}


// ---------------------------------------------------------------------------
// Canonical form, display domain, titles
// ---------------------------------------------------------------------------

/** Query parameters that only identify a campaign, never the page itself. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "si",
  "feature",
]);

function isTrackingParam(key: string): boolean {
  return /^utm_/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase());
}

/**
 * Canonical form used for duplicate checks: no fragment, lowercase host, no
 * "www.", no tracking parameters, sorted query string, no trailing slash.
 */
export function normalizeUrl(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = "";
  copy.hostname = copy.hostname.toLowerCase().replace(/^www\./, "");

  const kept: [string, string][] = [];
  copy.searchParams.forEach((value, key) => {
    if (!isTrackingParam(key)) kept.push([key, value]);
  });
  kept.sort(([aKey, aValue], [bKey, bValue]) =>
    aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
  );

  copy.search = "";
  for (const [key, value] of kept) copy.searchParams.append(key, value);

  if (copy.pathname.length > 1) copy.pathname = copy.pathname.replace(/\/+$/, "");

  return copy.toString();
}

/** Host shown in the inbox, e.g. "youtube.com". */
export function sourceDomainOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com"]);

export function isYoutubeUrl(url: URL): boolean {
  const host = sourceDomainOf(url);
  return host === "youtu.be" || YOUTUBE_HOSTS.has(host);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A readable title derived from the URL alone, before any page is fetched. */
export function titleFromUrl(url: URL): string {
  if (isYoutubeUrl(url)) return "YouTube video";

  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  const cleaned = safeDecode(last)
    .replace(/\.(html?|php|aspx?|jsp|md)$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const looksLikeId = /^[a-f0-9]{16,}$/i.test(cleaned) || /^\d{5,}$/.test(cleaned);
  if (cleaned.length > 2 && !looksLikeId) {
    const title = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return title.slice(0, 140);
  }

  return sourceDomainOf(url);
}

/** Looks like a bare domain ("example.com/path"), so a prefixed https URL works. */
function looksLikeBareUrl(value: string): boolean {
  return /^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(value);
}

/**
 * Normalises the params a share sheet sends (Android usually passes `url`, but
 * some apps put everything in `text`). Returns the link to prefill plus a note
 * with the leftover text.
 */
export function readShareParams(params: {
  url?: string | null;
  title?: string | null;
  text?: string | null;
}): { url: string; note: string } {
  const url = params.url?.trim() ?? "";
  const text = params.text?.trim() ?? "";
  const title = params.title?.trim() ?? "";

  if (url) {
    const note = text && !text.includes(url) ? text : "";
    return { url, note: note.slice(0, 1000) };
  }

  const inText = text.match(/https?:\/\/[^\s<>"']+/i);
  if (inText) {
    const note = text.replace(inText[0], "").trim();
    return { url: inText[0], note: note.slice(0, 1000) };
  }

  if (looksLikeBareUrl(text)) return { url: text, note: "" };
  if (looksLikeBareUrl(title)) return { url: title, note: "" };

  return { url: "", note: text.slice(0, 1000) };
}


// ---------------------------------------------------------------------------
// Rule-based defaults for a freshly saved link
// ---------------------------------------------------------------------------

export type LinkDefaults = {
  type: string;
  goal: string | null;
  est_minutes: number;
  energy: Energy;
};

const JOB_HOSTS = [
  "linkedin.com",
  "indeed.com",
  "indeed.co.in",
  "naukri.com",
  "wellfound.com",
  "glassdoor.com",
  "instahyre.com",
];

function isJobHost(host: string): boolean {
  return JOB_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/**
 * Rule-based starting point for a saved link. AI classification may refine it
 * later, but the item is usable even when no model call happens.
 */
export function linkDefaults(url: URL): LinkDefaults {
  const host = sourceDomainOf(url);
  const path = `${url.pathname}${url.search}`.toLowerCase();

  if (isYoutubeUrl(url)) {
    return { type: "video", goal: null, est_minutes: 20, energy: "low" };
  }

  if (host === "leetcode.com") {
    return { type: "leetcode", goal: "leetcode", est_minutes: 30, energy: "high" };
  }

  if (isJobHost(host) || /careers?\b/.test(path) || host.includes("careers")) {
    return { type: "job", goal: "job_search", est_minutes: 15, energy: "normal" };
  }

  return { type: "article", goal: null, est_minutes: 8, energy: "low" };
}

/** A safe href for rendering: only http(s) links are clickable. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const parsed = parseHttpUrl(url);
  return parsed ? parsed.toString() : null;
}


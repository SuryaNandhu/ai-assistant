import { lookup } from "node:dns/promises";

import { isIpLiteral, isPrivateHostname, isPrivateIpv4, isPrivateIpv6 } from "@/lib/inbox";

/**
 * Server-side page fetching for the inbox.
 *
 * Everything here is defensive: only http(s), no private addresses (checked on
 * the host name, on the DNS answers and on every redirect hop), a 5 second
 * timeout, and at most 1 MB of HTML. No dependencies — the handful of patterns
 * we need (title, meta tags, readable text) are simple enough by hand.
 */

export const PAGE_TIMEOUT_MS = 5000;
export const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

const USER_AGENT =
  "Mozilla/5.0 (compatible; AIAssistantInbox/1.0; +https://github.com/SuryaNandhu/ai-assistant)";

/** A fetch failure with a message that is safe to show the user. */
export class PageFetchError extends Error {
  constructor(message = "Couldn't read this page. Open it directly.") {
    super(message);
    this.name = "PageFetchError";
  }
}

export type PageMeta = {
  /** `<title>`, else og:title. */
  title: string | null;
  /** meta description or og:description. */
  description: string | null;
  /** og:site_name, when the page provides one. */
  siteName: string | null;
  /** Readable text with scripts, styles and page chrome removed. */
  text: string;
  /** The URL that actually served the page (after redirects). */
  finalUrl: string;
};

/**
 * Rejects URLs that could reach this machine or a private network. DNS names
 * are resolved first so a public-looking host that points at 127.0.0.1 or
 * 169.254.169.254 (cloud metadata) is refused too.
 */
async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PageFetchError("Only http and https links can be opened.");
  }

  const host = url.hostname;
  if (isPrivateHostname(host)) {
    throw new PageFetchError("That link points to a private address, so it was not opened.");
  }

  if (isIpLiteral(host)) return;

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new PageFetchError("Couldn't find that site. Check the link and try again.");
  }

  if (addresses.length === 0) {
    throw new PageFetchError("Couldn't find that site. Check the link and try again.");
  }

  const blocked = addresses.some(
    (entry) => isPrivateIpv4(entry.address) || isPrivateIpv6(entry.address),
  );
  if (blocked) {
    throw new PageFetchError("That link points to a private address, so it was not opened.");
  }
}

/**
 * Reads at most MAX_PAGE_BYTES and decodes them with the charset the server
 * declared (UTF-8 when it declares nothing usable).
 */
async function readBodyCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;

    const remaining = MAX_PAGE_BYTES - total;
    const slice =
      value.byteLength > remaining ? value.subarray(0, remaining) : value;

    chunks.push(slice);
    total += slice.byteLength;

    if (slice.byteLength < value.byteLength) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim();
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset || "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }

  return decoder.decode(merged);
}

/**
 * Fetches a page, following a few redirects by hand so each hop is validated
 * against the same private-address rules.
 */
async function requestPage(startUrl: URL): Promise<{ html: string; finalUrl: string }> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current);

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
          "accept-language": "en",
        },
      });
    } catch {
      throw new PageFetchError();
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new PageFetchError();

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new PageFetchError();
      }

      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new PageFetchError();
      }

      current = next;
      continue;
    }

    if (!response.ok) {
      throw new PageFetchError(
        `This page answered with HTTP ${response.status}. Open it directly.`,
      );
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml") &&
      !contentType.includes("text/plain")
    ) {
      throw new PageFetchError(
        "This link is not a web page (it may be a PDF or a file). Open it directly.",
      );
    }

    const html = await readBodyCapped(response);
    if (!html.trim()) throw new PageFetchError();

    return { html, finalUrl: current.toString() };
  }

  throw new PageFetchError("That link redirects too many times. Open it directly.");
}


const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();

    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }

    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }

    return NAMED_ENTITIES[key] ?? match;
  });
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>`]+))/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    attributes.set(
      match[1].toLowerCase(),
      decodeEntities(match[3] ?? match[4] ?? match[5] ?? ""),
    );
  }

  return attributes;
}

/** property/name -> content for every `<meta>` tag on the page. */
function readMetaTags(html: string): Map<string, string> {
  const metas = new Map<string, string>();

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase();
    const content = attributes.get("content");

    if (!key || !content) continue;
    if (!metas.has(key)) metas.set(key, normalizeWhitespace(content));
  }

  return metas;
}

function readTitleTag(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const title = normalizeWhitespace(decodeEntities(match[1]));
  return title || null;
}

/** Body content when present, otherwise the whole document. */
function bodyOf(html: string): string {
  const match = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return match ? match[1] : html;
}

const STRIPPED_ELEMENTS =
  /<(script|style|noscript|template|svg|canvas|iframe|form|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const BLOCK_BREAKS =
  /<\/?(p|div|section|article|main|li|ul|ol|h[1-6]|tr|td|th|blockquote|pre|figure|figcaption|table)\b[^>]*>/gi;

/**
 * Turns HTML into plain readable text: removes scripts, styles and page
 * chrome, keeps paragraph breaks, decodes entities and drops blank lines.
 */
export function htmlToText(html: string): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(STRIPPED_ELEMENTS, " ");
  // Unclosed <script>/<style> blocks would otherwise swallow the rest.
  text = text.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*$/gi, " ");
  text = text.replace(/<br\b[^>]*>/gi, "\n");
  text = text.replace(BLOCK_BREAKS, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);

  const lines: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/[ \t\u00a0]+/g, " ").trim();
    if (!line) continue;
    // Repeated menu items and cookie banners are noise in a summary.
    if (line.length < 400 && seen.has(line)) continue;
    if (line.length < 400) seen.add(line);
    lines.push(line);
  }

  return lines.join("\n").trim();
}


/**
 * Fetches a page and extracts its title, description, site name and readable
 * text. Throws `PageFetchError` (with a user-facing message) when the page
 * cannot be read.
 */
export async function fetchPage(rawUrl: string): Promise<PageMeta> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PageFetchError();
  }

  const { html, finalUrl } = await requestPage(url);
  const metas = readMetaTags(html);

  const title =
    readTitleTag(html) ??
    metas.get("og:title") ??
    metas.get("twitter:title") ??
    null;

  const description =
    metas.get("og:description") ??
    metas.get("description") ??
    metas.get("twitter:description") ??
    null;

  const siteName = metas.get("og:site_name") ?? null;

  return {
    title: title ? normalizeWhitespace(title).slice(0, 300) : null,
    description: description ? normalizeWhitespace(description).slice(0, 1000) : null,
    siteName: siteName ? normalizeWhitespace(siteName).slice(0, 120) : null,
    text: htmlToText(bodyOf(html)),
    finalUrl,
  };
}

export type YouTubeOEmbed = {
  title: string | null;
  authorName: string | null;
};

/**
 * Public oEmbed lookup for a YouTube link. No API key involved; the video page
 * itself is never scraped. Returns null when the endpoint cannot help.
 */
export async function fetchYouTubeOEmbed(videoUrl: string): Promise<YouTubeOEmbed | null> {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    videoUrl,
  )}&format=json`;

  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      redirect: "manual",
    });

    if (!response.ok) return null;

    const raw = await readBodyCapped(response);
    const parsed = JSON.parse(raw) as { title?: unknown; author_name?: unknown };

    return {
      title:
        typeof parsed.title === "string" && parsed.title.trim()
          ? normalizeWhitespace(parsed.title).slice(0, 300)
          : null,
      authorName:
        typeof parsed.author_name === "string" && parsed.author_name.trim()
          ? normalizeWhitespace(parsed.author_name).slice(0, 120)
          : null,
    };
  } catch (error) {
    console.error("YouTube oEmbed lookup failed:", error);
    return null;
  }
}


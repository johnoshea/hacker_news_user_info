// Pure-logic helpers. No DOM, no GM_* APIs - safe to import under Node.

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_MONTH = 2592000; // 30-day month, matches legacy behavior
const SECONDS_PER_YEAR = 31536000; // 365-day year, matches legacy behavior

export function timeSince(createdUnixSeconds, nowUnixSeconds) {
	const seconds = Math.floor(nowUnixSeconds - createdUnixSeconds);
	const years = Math.floor(seconds / SECONDS_PER_YEAR);
	if (years >= 1) return `${years} year${years === 1 ? "" : "s"}`;
	const months = Math.floor(seconds / SECONDS_PER_MONTH);
	if (months >= 1) return `${months} month${months === 1 ? "" : "s"}`;
	const days = Math.floor(seconds / SECONDS_PER_DAY);
	return `${days} day${days === 1 ? "" : "s"}`;
}

// Strip a leading "> " (with any surrounding whitespace) from a quoted-comment
// text node, then trim the result. Used by the quote-rendering pass to set
// the body of a `<p class="quote">` directly. Defensive against non-strings
// because the caller pulls from DOM where `.data` could be missing.
export function stripLeadingQuoteMarker(text) {
	if (typeof text !== "string") return "";
	return text.replace(/^\s*>\s*/, "").trim();
}

// For an item page's comment list (top-down DOM order), return for each
// comment the index of its current root (a top-level comment with indent
// level 0), or -1 if the comment is itself a root.
//
// Used by collapse-root-comment to inject a "[collapse root]" link on
// every non-root comment that points at the right root toggle.
export function findCommentRootIndices(indentLevels) {
	const out = new Array(indentLevels.length);
	let currentRoot = -1;
	for (let i = 0; i < indentLevels.length; i++) {
		if (indentLevels[i] === 0) {
			currentRoot = i;
			out[i] = -1; // a root has no parent root to collapse to
		} else {
			out[i] = currentRoot;
		}
	}
	return out;
}

// Split a string into alternating { kind: "text" } and { kind: "code" }
// segments based on backtick pairs. Used by the backticks-to-monospace
// pass to walk text nodes and replace them with DOM nodes that render
// `inline code` segments inside <code> elements.
//
// Rules:
//   - A `code` segment is the shortest run between two backticks. Empty
//     pairs (two backticks with nothing between them) are not treated
//     as code; they survive as text.
//   - An unmatched backtick (no closing pair) stays in place inside the
//     surrounding text segment.
//   - The result preserves the original characters exactly when joined
//     back together (text + "`" + code + "`" + text + ...).
export function splitBackticks(text) {
	if (typeof text !== "string" || text === "") return [];
	const segments = [];
	const pattern = /`([^`]+)`/g;
	let lastIndex = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index;
		if (start > lastIndex) {
			segments.push({ kind: "text", value: text.slice(lastIndex, start) });
		}
		segments.push({ kind: "code", value: match[1] });
		lastIndex = start + match[0].length;
	}
	if (lastIndex < text.length) {
		segments.push({ kind: "text", value: text.slice(lastIndex) });
	}
	return segments;
}

// Given the comment IDs visible on the current page and the IDs we
// stored on a previous visit to the same item, return the IDs that are
// new (i.e. present now but not before). Used by highlight-unread to
// decide which td.ind cells to mark.
export function findNewCommentIds(currentIds, storedIds) {
	const seen = new Set(storedIds || []);
	const out = [];
	for (const id of currentIds || []) {
		if (!seen.has(id)) out.push(id);
	}
	return out;
}

// True iff the entry was last updated within ttlMs of now. A missing
// entry, missing fetchedAt, or stale entry returns false. Used both for
// freshness checks at read time and for cleanup-on-load.
export function isReadCommentEntryFresh(entry, nowMs, ttlMs) {
	if (!entry || typeof entry.fetchedAt !== "number") return false;
	return nowMs - entry.fetchedAt <= ttlMs;
}

// Return a new map containing only the entries that are still fresh.
// Used when persisting to drop expired item IDs from storage so the
// readComments slice doesn't grow unboundedly.
export function pruneExpiredReadComments(map, nowMs, ttlMs) {
	const out = {};
	for (const [itemId, entry] of Object.entries(map || {})) {
		if (isReadCommentEntryFresh(entry, nowMs, ttlMs)) {
			out[itemId] = entry;
		}
	}
	return out;
}

// Truncate a string to at most maxLen characters, appending an ellipsis
// (…) when the original was longer. Used by the hover popups to keep
// long item-text or user-about previews from overflowing the popup.
//
// Keeps it simple: counts code units, not graphemes. HN content is
// overwhelmingly ASCII/BMP so this is fine in practice.
export function truncateText(text, maxLen) {
	if (typeof text !== "string") return "";
	if (typeof maxLen !== "number" || maxLen < 0) return text;
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen)}…`;
}

// Pull the hostname out of an absolute URL, or null if the input isn't
// parseable. Used by the item-info hover to render a "(github.com)"
// badge next to a story's title — same convention HN uses on listing
// pages.
export function extractDomain(url) {
	if (typeof url !== "string" || url === "") return null;
	try {
		const host = new URL(url).hostname;
		return host.startsWith("www.") ? host.slice(4) : host;
	} catch {
		return null;
	}
}

// Split a string into alternating { kind: "text" | "url" | "email" }
// segments. Used by linkify-user-about to walk the about-text cell on
// /user pages and replace plain-text URLs / email addresses with
// clickable <a> elements.
//
// In-house instead of pulling in linkifyjs (saves ~12KB of dep we'd
// barely use). The trade-off is that we don't handle weird URL shapes
// (FTP, gopher, scheme-less domains like "example.com") — only http(s)
// and email. That covers the overwhelming majority of HN about-texts.
//
// Trailing sentence punctuation (.,;:!?)]}>) is split back out into a
// following text segment so "see https://example.com." renders as a
// link followed by a literal period.
export function linkifySegments(text) {
	if (typeof text !== "string" || text === "") return [];
	const out = [];
	const pattern = /(https?:\/\/[^\s<>"]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;
	const trailing = /[.,;:!?)\]}>]+$/;
	let lastIndex = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index;
		if (start > lastIndex) {
			out.push({ kind: "text", value: text.slice(lastIndex, start) });
		}
		const matched = match[0];
		const trail = matched.match(trailing)?.[0] || "";
		const linkBody = trail ? matched.slice(0, -trail.length) : matched;
		const kind = match[1] ? "url" : "email";
		// Defensive: if all that's left after trimming is empty, skip the
		// link entirely and emit the original characters as text.
		if (!linkBody) {
			out.push({ kind: "text", value: matched });
		} else {
			out.push({ kind, value: linkBody });
			if (trail) out.push({ kind: "text", value: trail });
		}
		lastIndex = start + matched.length;
	}
	if (lastIndex < text.length) {
		out.push({ kind: "text", value: text.slice(lastIndex) });
	}
	return out;
}

// Sort a story list by the chosen mode. Stories must carry
// { id, score, commentsCount, defaultRank } at minimum (other fields
// are passed through unchanged). Mode "default" restores HN's
// server-side ranking; "time" newest-first by id; "score" highest
// first; "ratio" highest comments-to-score ratio first (a rough
// "discussion intensity" proxy that surfaces controversial items).
export function sortStoriesBy(stories, mode) {
	const sorted = (stories || []).slice();
	switch (mode) {
		case "time":
			sorted.sort((a, b) => Number(b.id) - Number(a.id));
			break;
		case "score":
			sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
			break;
		case "ratio":
			sorted.sort((a, b) => {
				const ra = (a.commentsCount || 0) / Math.max(a.score || 1, 1);
				const rb = (b.commentsCount || 0) / Math.max(b.score || 1, 1);
				return rb - ra;
			});
			break;
		default: // "default"
			sorted.sort((a, b) => (a.defaultRank || 0) - (b.defaultRank || 0));
			break;
	}
	return sorted;
}

// Parse a raw comma-separated tag string into a canonical list: each name
// trimmed, empty entries dropped, duplicates (first-wins) removed. Used by
// the inline tag input so duplicates never reach setUserTags.
export function parseTagInput(text) {
	const seen = new Set();
	const out = [];
	for (const part of (text || "").split(",")) {
		const name = part.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}

// True iff `latestKids` contains an id not present in `seenKids`. Used
// by the watch-for-replies feature to decide whether a watched comment
// has new replies that the user has not yet acknowledged. Both inputs
// may be null/undefined (treated as empty).
export function watchHasNewReplies(seenKids, latestKids) {
	const seen = new Set(seenKids || []);
	for (const id of latestKids || []) {
		if (!seen.has(id)) return true;
	}
	return false;
}

// True iff lastCheckedAt is older than nowMs - throttleMs (i.e. due
// for a fresh API recheck). A missing entry, missing lastCheckedAt,
// or non-numeric lastCheckedAt is treated as stale so the very first
// recheck always fires.
export function isWatchCheckStale(entry, nowMs, throttleMs) {
	if (!entry || typeof entry.lastCheckedAt !== "number") return true;
	return nowMs - entry.lastCheckedAt > throttleMs;
}

// Return a new map containing only the watches that are still within
// the TTL (addedAt within ttlMs of now). A missing or non-numeric
// addedAt is treated as expired — defensive against malformed entries
// from a botched import or a forward-incompatible schema change.
export function pruneExpiredWatches(map, nowMs, ttlMs) {
	const out = {};
	for (const [commentId, entry] of Object.entries(map || {})) {
		if (!entry || typeof entry.addedAt !== "number") continue;
		if (nowMs - entry.addedAt <= ttlMs) {
			out[commentId] = entry;
		}
	}
	return out;
}

// Group a watchedComments map by itemId, attaching the derived
// `hasNew` flag to each entry. Used by the listing-page highlight
// pass to look up "are there any watched comments with new replies
// in this story's thread?" in one keyed lookup per row.
//
// Returns: { [itemId]: [{ commentId, hasNew }, ...] }
//
// Entries missing an itemId are skipped (a malformed entry shouldn't
// crash the listing-page pass).
export function watchesByItemId(map) {
	const out = {};
	for (const [commentId, entry] of Object.entries(map || {})) {
		if (!entry || typeof entry.itemId !== "string") continue;
		const hasNew = watchHasNewReplies(entry.seenKids, entry.latestKids);
		if (!out[entry.itemId]) out[entry.itemId] = [];
		out[entry.itemId].push({ commentId, hasNew });
	}
	return out;
}

// True iff this author's rating crosses the auto-collapse threshold.
// Threshold is expected to be negative; a rating of 0 (the default
// for an unrated user) must never collapse. Boundary is inclusive —
// a rating equal to the threshold counts as "low score".
export function shouldAutoCollapseAuthor(rating, threshold) {
	return rating <= threshold;
}

// Pull the comment id from a "parent" link's href. HN serves these
// as `item?id=12345` (relative); a base URL is supplied so the
// pure-Node URL parser can resolve relative inputs. Returns null on
// any parse failure or missing `id` param so the caller can decide
// (typically: skip the popup).
export function parseParentIdFromHref(href) {
	if (typeof href !== "string" || href === "") return null;
	try {
		const url = new URL(href, "https://news.ycombinator.com/");
		return url.searchParams.get("id") || null;
	} catch {
		return null;
	}
}

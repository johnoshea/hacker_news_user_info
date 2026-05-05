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

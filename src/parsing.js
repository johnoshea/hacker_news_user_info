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

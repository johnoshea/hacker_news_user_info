// ==UserScript==
// @name         Hacker News - Inline Account Info, Legible Custom Tags and Rating
// @namespace    Violent Monkey
// @version      0.11+cdb94ec
// @description  Inline account info, custom tags and ratings on comment pages, plus site-wide legibility tweaks (quote rendering, downvote contrast, font/layout cleanup, optional comment-box toggle)
// @author       You
// @match        https://news.ycombinator.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ycombinator.com
// ==/UserScript==

(function () {
"use strict";

// ===== src/config.js =====

// Single backend key holding all user-visible state. Consolidating everything
// here means exports are one JSON.stringify and imports are one assignment,
// and it eliminates the legacy prefix-scan over GM_listValues.
const STATE_KEY = "hn_state";
const STATE_SCHEMA_VERSION = 1;

// Pre-0.4 storage layout. Migration reads these on first run; after that the
// keys are left in place for one version as a rollback safety net.
const LEGACY_RATING_PREFIX = "hn_author_rating_";
const LEGACY_TAGS_PREFIX = "hn_custom_tags_";
const LEGACY_COLOR_PREFIX = "hn_custom_tag_color_";

// How long a cached {created, karma} pair is considered fresh. Karma drifts
// slowly; 6h means a repeat-visitor sees a fully-rendered page with zero
// network requests for users they've already seen today.
const USER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Per-request ceiling. Without it, GM_xmlhttpRequest can hang forever and
// the page never finishes rendering. Firebase's HN endpoint is fast in the
// common case; 8s is generous.
const USER_FETCH_TIMEOUT_MS = 8000;

// How long the highlight-unread feature remembers the comment IDs it
// saw on a previous visit to a given item. Three days matches refined-
// hacker-news's default and means a thread you opened on Friday still
// shows new replies on Monday morning.
const READ_COMMENTS_TTL_MS = 3 * 24 * 60 * 60 * 1000;

// The per-comment "[toggle replies]" link from refined-hacker-news's
// toggle-all-comments-and-replies feature. Default off because adding
// a link to every comment scales linearly with thread size and slows
// page render on items with hundreds of comments. The fatitem-level
// "[toggle all]" link is always on.
const TOGGLE_ALL_REPLIES_ENABLED = false;

// Hover-panel TTL/timeout/dwell. Item content (title, score, comment
// count, etc.) drifts about as slowly as user karma, so a 6h cache is
// enough for the hover preview to feel current without re-fetching the
// same item every time the cursor passes over a link.
const ITEM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Per-request ceiling for the hover fetcher. Same shape as the user
// fetch — without it a hung request would leave the popup stuck on
// "loading…" until the tab is closed.
const ITEM_FETCH_TIMEOUT_MS = 8000;
// How long the cursor must rest on a link before we trigger a fetch.
// Keeps the hover from firing during cursor-fly-over events on long
// pages; short enough to feel responsive when the user actually wants
// the preview.
const HOVER_DWELL_MS = 250;

// How long a watched comment persists before being silently pruned.
// HN threads rarely receive replies after two weeks, and the TTL stops
// the watch list growing forever on threads that have gone cold.
const WATCH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Minimum interval between API rechecks of a single watched comment.
// 60 seconds is short enough that the listing-page highlight reflects
// new replies on the very next page load after they arrive (anything
// longer leaves the user staring at an unflagged comments link while
// the throttle still applies from the most recent item-page sync), and
// long enough to dedup tight reload spam. Each request is a tiny JSON
// behind fetchItem's inflight-dedup map, so the load impact is small
// even with several active watches.
const WATCH_RECHECK_THROTTLE_MS = 60 * 1000;

// Authors whose stored rating sits at or below this value have their
// comments auto-collapsed on render. Rating defaults to 0, so the
// threshold must be negative (otherwise every unrated user would
// collapse). The value is intentionally a constant rather than a
// toolbar-configurable setting — it's a single edit if it ever needs
// to change, and the simplicity is worth more than the flexibility.
const LOW_SCORE_COLLAPSE_THRESHOLD = -10;


// ===== src/parsing.js =====

// Pure-logic helpers. No DOM, no GM_* APIs - safe to import under Node.

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_MONTH = 2592000; // 30-day month, matches legacy behavior
const SECONDS_PER_YEAR = 31536000; // 365-day year, matches legacy behavior
function timeSince(createdUnixSeconds, nowUnixSeconds) {
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
function stripLeadingQuoteMarker(text) {
	if (typeof text !== "string") return "";
	return text.replace(/^\s*>\s*/, "").trim();
}

// For an item page's comment list (top-down DOM order), return for each
// comment the index of its current root (a top-level comment with indent
// level 0), or -1 if the comment is itself a root.
//
// Used by collapse-root-comment to inject a "[collapse root]" link on
// every non-root comment that points at the right root toggle.
function findCommentRootIndices(indentLevels) {
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
function splitBackticks(text) {
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
function findNewCommentIds(currentIds, storedIds) {
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
function isReadCommentEntryFresh(entry, nowMs, ttlMs) {
	if (!entry || typeof entry.fetchedAt !== "number") return false;
	return nowMs - entry.fetchedAt <= ttlMs;
}

// Return a new map containing only the entries that are still fresh.
// Used when persisting to drop expired item IDs from storage so the
// readComments slice doesn't grow unboundedly.
function pruneExpiredReadComments(map, nowMs, ttlMs) {
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
function truncateText(text, maxLen) {
	if (typeof text !== "string") return "";
	if (typeof maxLen !== "number" || maxLen < 0) return text;
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen)}…`;
}

// Pull the hostname out of an absolute URL, or null if the input isn't
// parseable. Used by the item-info hover to render a "(github.com)"
// badge next to a story's title — same convention HN uses on listing
// pages.
function extractDomain(url) {
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
function linkifySegments(text) {
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
function sortStoriesBy(stories, mode) {
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
function parseTagInput(text) {
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
function watchHasNewReplies(seenKids, latestKids) {
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
function isWatchCheckStale(entry, nowMs, throttleMs) {
	if (!entry || typeof entry.lastCheckedAt !== "number") return true;
	return nowMs - entry.lastCheckedAt > throttleMs;
}

// Return a new map containing only the watches that are still within
// the TTL (addedAt within ttlMs of now). A missing or non-numeric
// addedAt is treated as expired — defensive against malformed entries
// from a botched import or a forward-incompatible schema change.
function pruneExpiredWatches(map, nowMs, ttlMs) {
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
function watchesByItemId(map) {
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
function shouldAutoCollapseAuthor(rating, threshold) {
	return rating <= threshold;
}

// Pull the comment id from a "parent" link's href. HN serves these
// as `item?id=12345` (relative); a base URL is supplied so the
// pure-Node URL parser can resolve relative inputs. Returns null on
// any parse failure or missing `id` param so the caller can decide
// (typically: skip the popup).
function parseParentIdFromHref(href) {
	if (typeof href !== "string" || href === "") return null;
	try {
		const url = new URL(href, "https://news.ycombinator.com/");
		return url.searchParams.get("id") || null;
	} catch {
		return null;
	}
}

// Split a comment-body HTML string into paragraph-equivalent chunks.
// HN uses <p> as a separator (not a wrapper), so we split on any
// <p ...> tag and return the trimmed non-empty pieces. Inline markup
// (<a>, <i>, <code>, <pre>) inside each chunk is preserved as-is —
// the caller decides whether to render via DOMParser or treat as
// plain text.
function splitHtmlIntoParagraphs(html) {
	if (typeof html !== "string" || html === "") return [];
	return html
		.split(/<p\b[^>]*>/i)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}


// ===== src/state.js =====

// Storage and pure state mutators. No DOM, no GM_* APIs - safe to import
// under Node. The browser bootstrap (main.js) wraps the GM_* APIs into the
// {get, set, list} backend that createStore expects.
function emptyState() {
	return {
		schemaVersion: STATE_SCHEMA_VERSION,
		ratings: {},
		tags: {}, // username -> [tagName, ...]
		colors: {}, // tagName  -> { bgColor, textColor }
		cache: {}, // username -> { created, karma, fetchedAt }
		readComments: {}, // itemId -> { ids: [...], fetchedAt }
		itemCache: {}, // itemId -> { title, url, by, score, descendants, time, text, type, kids, fetchedAt }
		watchedComments: {}, // commentId -> { itemId, seenKids, latestKids, lastCheckedAt, addedAt }
	};
}

// Factory over a { get(key), set(key, value) } backend. Loads the consolidated
// state on first access; mutations are read-modify-write (re-read disk, apply
// the mutation, write back) so writes from other tabs that landed since the
// last read are absorbed instead of clobbered. The pre-RMW design was racy:
// at page load every tab the user had cmd-clicked open from the front page
// would call setReadComments synchronously with a stale in-memory snapshot,
// and the last writer's snapshot wiped everyone else's entry. The cross-tab
// listener can't fix that after the fact — it only invalidates the in-memory
// cache, it doesn't merge in-flight writes.
function createStore(backend) {
	let state = null;

	const readDisk = () => {
		const raw = backend.get(STATE_KEY);
		if (raw === undefined || raw === null || raw === "") {
			return emptyState();
		}
		try {
			const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
			return { ...emptyState(), ...parsed };
		} catch (_err) {
			return emptyState();
		}
	};

	const load = () => {
		if (state !== null) return state;
		state = readDisk();
		return state;
	};

	// Apply a mutation against the latest disk state. The mutator runs on
	// a fresh read of the blob, then we write the whole thing back; this
	// absorbs concurrent writes from other tabs as long as our get-then-set
	// pair isn't preempted (GM_getValue and GM_setValue are synchronous in
	// Tampermonkey/Violentmonkey, so the race window is essentially zero
	// per call site). The mutator may return `false` to signal "no change,
	// don't write" — used by pruneReadComments when nothing's stale.
	const mutate = (mutator) => {
		const fresh = readDisk();
		const result = mutator(fresh);
		if (result !== false) {
			backend.set(STATE_KEY, JSON.stringify(fresh));
		}
		state = fresh;
	};

	const hydrateTag = (tagName) => {
		const color = load().colors[tagName] || {
			bgColor: undefined,
			textColor: undefined,
		};
		return {
			value: tagName,
			bgColor: color.bgColor,
			textColor: color.textColor,
		};
	};

	return {
		getRating(username) {
			return load().ratings[username] || 0;
		},
		setRating(username, rating) {
			mutate((s) => {
				s.ratings[username] = rating;
			});
		},
		getUserTags(username) {
			const names = load().tags[username] || [];
			return names.map(hydrateTag);
		},
		setUserTags(username, tags) {
			mutate((s) => {
				s.tags[username] = tags.map((t) => t.value);
				// Record any color info that came along with the tag. If a tag
				// already has a color, a caller-supplied color overrides it
				// (setTagColor is the explicit "update the shared color"
				// operation; passing a color here is how new tags get their
				// initial color).
				for (const t of tags) {
					if (t.bgColor && t.textColor) {
						s.colors[t.value] = {
							bgColor: t.bgColor,
							textColor: t.textColor,
						};
					}
				}
			});
		},
		getTagColor(tagName) {
			return load().colors[tagName] || null;
		},
		setTagColor(tagName, { bgColor, textColor }) {
			mutate((s) => {
				s.colors[tagName] = { bgColor, textColor };
			});
		},
		// User-data cache. The `now` and `ttlMs` arguments are injected so tests
		// can control time without mocking the clock. The browser call site
		// passes Date.now() and a hardcoded TTL (USER_CACHE_TTL_MS in config).
		// `data` is treated as opaque so future call sites (e.g. the hover
		// panel adding `about`) don't need to extend this method's signature.
		getCachedUser(username, nowMs, ttlMs) {
			const entry = load().cache[username];
			if (!entry) return null;
			if (nowMs - entry.fetchedAt > ttlMs) return null;
			const { fetchedAt: _f, ...rest } = entry;
			return rest;
		},
		setCachedUser(username, data, nowMs) {
			mutate((s) => {
				s.cache[username] = { ...data, fetchedAt: nowMs };
			});
		},
		// Item-info cache for the hover-panel feature. Stores a digest
		// (title/url/by/score/descendants/time/text/type) of items the
		// user has hovered, so subsequent hovers resolve from local
		// state without re-hitting the Firebase API.
		getCachedItem(itemId, nowMs, ttlMs) {
			const entry = load().itemCache?.[itemId];
			if (!entry) return null;
			if (nowMs - entry.fetchedAt > ttlMs) return null;
			const { fetchedAt: _f, ...digest } = entry;
			return digest;
		},
		setCachedItem(itemId, digest, nowMs) {
			mutate((s) => {
				s.itemCache[itemId] = { ...digest, fetchedAt: nowMs };
			});
		},

		// Read-comments cache for highlight-unread. Returns the stored
		// entry { ids, fetchedAt } if it exists, else null. The browser
		// caller decides what to do with a missing entry (highlight
		// nothing, since this is a first visit) vs a stale one (treat as
		// missing — pruneReadComments below drops stale entries on every
		// item-page load so this is mostly a belt-and-braces check).
		getReadComments(itemId) {
			const entry = load().readComments?.[itemId];
			if (!entry) return null;
			return { ids: entry.ids || [], fetchedAt: entry.fetchedAt || 0 };
		},
		// Replace the stored ID list for an item. Always overwrites — the
		// caller decides whether to merge with previous ids or replace them.
		// (We replace, since a comment that's no longer on the page must
		// have been deleted/flagged, and there's no value in tracking it.)
		setReadComments(itemId, ids, nowMs) {
			mutate((s) => {
				s.readComments[itemId] = { ids: ids.slice(), fetchedAt: nowMs };
			});
		},
		// Drop expired entries from the readComments map. Run on every
		// item-page load so a user who reads-then-never-revisits doesn't
		// accumulate dead entries forever.
		pruneReadComments(nowMs, ttlMs) {
			mutate((s) => {
				const before = s.readComments;
				const after = pruneExpiredReadComments(before, nowMs, ttlMs);
				if (Object.keys(after).length === Object.keys(before).length) {
					return false;
				}
				s.readComments = after;
			});
		},
		// Watched-comments map for the watch-for-replies feature. Keyed
		// by HN comment id; each entry stores the parent itemId (so the
		// listing-page pass can look up "any watched comments in this
		// story?"), the `seenKids` snapshot of replies the user has
		// acknowledged, the `latestKids` from the most recent API check,
		// and timestamps driving the recheck throttle and TTL prune.
		getWatchedComments() {
			return load().watchedComments || {};
		},
		getWatchedComment(commentId) {
			const map = load().watchedComments || {};
			return map[commentId] || null;
		},
		setWatchedComment(commentId, entry) {
			mutate((s) => {
				s.watchedComments[commentId] = {
					itemId: entry.itemId,
					seenKids: (entry.seenKids || []).slice(),
					latestKids: (entry.latestKids || []).slice(),
					lastCheckedAt: entry.lastCheckedAt,
					addedAt: entry.addedAt,
				};
			});
		},
		removeWatchedComment(commentId) {
			mutate((s) => {
				if (!s.watchedComments?.[commentId]) return false;
				delete s.watchedComments[commentId];
			});
		},
		// Sync seenKids to latestKids — i.e. acknowledge every reply the
		// most recent API check returned. Called when the user lands on
		// the item page where a watched comment is rendered.
		markWatchSeen(commentId, _nowMs) {
			mutate((s) => {
				const e = s.watchedComments?.[commentId];
				if (!e) return false;
				e.seenKids = (e.latestKids || []).slice();
			});
		},
		// Replace latestKids with a fresh API result and stamp the check
		// timestamp. Doesn't touch seenKids — the watch retains its
		// "what's new since I last looked" notion until the user visits
		// the item page.
		updateWatchKids(commentId, kids, nowMs) {
			mutate((s) => {
				const e = s.watchedComments?.[commentId];
				if (!e) return false;
				e.latestKids = (kids || []).slice();
				e.lastCheckedAt = nowMs;
			});
		},
		// Drop expired entries from the watchedComments map. Run periodically
		// so a watch that hasn't been checked in >14 days is cleaned up.
		pruneWatchedComments(nowMs, ttlMs) {
			mutate((s) => {
				const before = s.watchedComments || {};
				const after = pruneExpiredWatches(before, nowMs, ttlMs);
				if (Object.keys(after).length === Object.keys(before).length) {
					return false;
				}
				s.watchedComments = after;
			});
		},
		replaceTagsAndColors(tagsByUser, colorsByTag) {
			mutate((s) => {
				s.tags = tagsByUser;
				s.colors = colorsByTag;
			});
		},
		// Expose raw state for export and for callers that need to iterate.
		_snapshot() {
			return load();
		},
		// Drop the in-memory cache so the next read reloads from the backend.
		// Used when another tab writes to the same key. Mutations don't need
		// this because they always re-read disk before writing.
		_invalidate() {
			state = null;
		},
	};
}

// One-shot migration from the pre-rework key layout:
//   hn_author_rating_<user>   -> int
//   hn_custom_tags_<user>     -> JSON array of {value, bgColor, textColor}
//   hn_custom_tag_color_<tag> -> JSON {bgColor, textColor}
// to the single consolidated `hn_state` key. Legacy keys are left in place for
// one version so a rollback of the script doesn't lose data. The migration is
// idempotent and a no-op when hn_state already exists.
//
// Backend must additionally support list(): string[].
function migrateLegacyKeys(backend) {
	if (backend.get(STATE_KEY) !== undefined) return;
	if (typeof backend.list !== "function") return;

	const keys = backend.list();
	const hasLegacy = keys.some(
		(k) =>
			k.startsWith(LEGACY_RATING_PREFIX) ||
			k.startsWith(LEGACY_TAGS_PREFIX) ||
			k.startsWith(LEGACY_COLOR_PREFIX),
	);
	if (!hasLegacy) return;

	const state = emptyState();

	const parseJSON = (raw, fallback) => {
		try {
			return typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch (_err) {
			return fallback;
		}
	};

	for (const key of keys) {
		if (key.startsWith(LEGACY_RATING_PREFIX)) {
			const username = key.slice(LEGACY_RATING_PREFIX.length);
			const value = backend.get(key);
			const rating = typeof value === "number" ? value : Number(value);
			if (!Number.isNaN(rating)) state.ratings[username] = rating;
		} else if (key.startsWith(LEGACY_COLOR_PREFIX)) {
			const tagName = key.slice(LEGACY_COLOR_PREFIX.length);
			const color = parseJSON(backend.get(key), null);
			if (color?.bgColor) {
				state.colors[tagName] = {
					bgColor: color.bgColor,
					textColor: color.textColor || "black",
				};
			}
		}
	}

	// Tags are processed after colors so legacy tag entries can contribute
	// their embedded color info without overwriting the explicit color key.
	for (const key of keys) {
		if (!key.startsWith(LEGACY_TAGS_PREFIX)) continue;
		const username = key.slice(LEGACY_TAGS_PREFIX.length);
		const legacyTags = parseJSON(backend.get(key), []);
		if (!Array.isArray(legacyTags)) continue;
		const tagNames = [];
		for (const t of legacyTags) {
			if (!t || typeof t.value !== "string") continue;
			tagNames.push(t.value);
			if (!state.colors[t.value] && t.bgColor) {
				state.colors[t.value] = {
					bgColor: t.bgColor,
					textColor: t.textColor || "black",
				};
			}
		}
		state.tags[username] = tagNames;
	}

	backend.set(STATE_KEY, JSON.stringify(state));
}

// Accepts either the normalized export shape ({customTags, users}) or the
// legacy flat-key dump ({hn_author_rating_<u>: N, hn_custom_tags_<u>: "...", ...})
// and produces a consolidated state object. The cache slot is left empty -
// import is a user-data operation, not a cache restore.
function parseImport(data) {
	const state = emptyState();
	if (!data || typeof data !== "object") return state;

	// Normalized format.
	if (data.customTags || data.users || data.watches) {
		if (data.customTags && typeof data.customTags === "object") {
			for (const [tagName, info] of Object.entries(data.customTags)) {
				if (info?.bgColor) {
					state.colors[tagName] = {
						bgColor: info.bgColor,
						textColor: info.textColor || "black",
					};
				}
			}
		}
		if (data.users && typeof data.users === "object") {
			for (const [username, userData] of Object.entries(data.users)) {
				if (!userData) continue;
				if (typeof userData.rating === "number" && userData.rating !== 0) {
					state.ratings[username] = userData.rating;
				}
				if (Array.isArray(userData.tags)) {
					state.tags[username] = userData.tags.slice();
				}
			}
		}
		if (data.watches && typeof data.watches === "object") {
			for (const [commentId, entry] of Object.entries(data.watches)) {
				if (!entry || typeof entry.itemId !== "string") continue;
				state.watchedComments[commentId] = {
					itemId: entry.itemId,
					seenKids: Array.isArray(entry.seenKids) ? entry.seenKids.slice() : [],
					latestKids: Array.isArray(entry.latestKids)
						? entry.latestKids.slice()
						: [],
					lastCheckedAt:
						typeof entry.lastCheckedAt === "number" ? entry.lastCheckedAt : 0,
					addedAt: typeof entry.addedAt === "number" ? entry.addedAt : 0,
				};
			}
		}
		return state;
	}

	// Legacy flat-key format - mirrors migrateLegacyKeys but reads from a plain
	// object instead of a backend.
	const parseJSON = (raw, fallback) => {
		try {
			return typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch (_err) {
			return fallback;
		}
	};
	for (const [key, value] of Object.entries(data)) {
		if (key.startsWith(LEGACY_RATING_PREFIX)) {
			const username = key.slice(LEGACY_RATING_PREFIX.length);
			const rating = typeof value === "number" ? value : Number(value);
			if (!Number.isNaN(rating)) state.ratings[username] = rating;
		} else if (key.startsWith(LEGACY_COLOR_PREFIX)) {
			const tagName = key.slice(LEGACY_COLOR_PREFIX.length);
			const color = parseJSON(value, null);
			if (color?.bgColor) {
				state.colors[tagName] = {
					bgColor: color.bgColor,
					textColor: color.textColor || "black",
				};
			}
		}
	}
	for (const [key, value] of Object.entries(data)) {
		if (!key.startsWith(LEGACY_TAGS_PREFIX)) continue;
		const username = key.slice(LEGACY_TAGS_PREFIX.length);
		const legacyTags = parseJSON(value, []);
		if (!Array.isArray(legacyTags)) continue;
		const names = [];
		for (const t of legacyTags) {
			if (!t || typeof t.value !== "string") continue;
			names.push(t.value);
			if (!state.colors[t.value] && t.bgColor) {
				state.colors[t.value] = {
					bgColor: t.bgColor,
					textColor: t.textColor || "black",
				};
			}
		}
		state.tags[username] = names;
	}
	return state;
}

// Normalized export shape. Stable across versions so old backups stay
// interoperable. Cache is intentionally dropped — it's perf scaffolding,
// not user data, and shouldn't bloat export files. `watches` is user
// data (a deliberate user choice), so it ships in exports.
function stateToExport(state) {
	const customTags = {};
	for (const [tagName, info] of Object.entries(state.colors || {})) {
		customTags[tagName] = {
			bgColor: info.bgColor,
			textColor: info.textColor,
		};
	}
	const users = {};
	const allUsernames = new Set([
		...Object.keys(state.ratings || {}),
		...Object.keys(state.tags || {}),
	]);
	for (const username of allUsernames) {
		const rating = state.ratings[username] || 0;
		const tags = state.tags[username] || [];
		if (rating === 0 && tags.length === 0) continue;
		users[username] = { rating, tags: tags.slice() };
	}
	const watches = {};
	for (const [commentId, entry] of Object.entries(
		state.watchedComments || {},
	)) {
		if (!entry || typeof entry.itemId !== "string") continue;
		watches[commentId] = {
			itemId: entry.itemId,
			seenKids: (entry.seenKids || []).slice(),
			latestKids: (entry.latestKids || []).slice(),
			lastCheckedAt: entry.lastCheckedAt,
			addedAt: entry.addedAt,
		};
	}
	return { customTags, users, watches };
}

// Returns a new state with every user's `oldName` tag replaced by `newName`
// and the color entry moved accordingly. If `newName` already exists as a
// tag (in colors or any user's tag list), this becomes a merge: the
// destination's color is kept, the source color is dropped, and any user
// carrying both ends up with one entry (first-occurrence wins, so the
// relative order of other tags is preserved). Empty / whitespace-only
// `newName`, a no-op rename, or a rename of a tag that isn't present
// anywhere returns the same reference.
function renameTagInState(state, oldName, newName) {
	const trimmed = typeof newName === "string" ? newName.trim() : "";
	if (!trimmed || trimmed === oldName) return state;

	const tags = state.tags || {};
	const colors = state.colors || {};
	const inColors = Object.hasOwn(colors, oldName);
	const inTags = Object.values(tags).some((list) => list.includes(oldName));
	if (!inColors && !inTags) return state;

	const destExists = Object.hasOwn(colors, trimmed);

	const newTags = {};
	for (const [user, list] of Object.entries(tags)) {
		if (!list.includes(oldName)) {
			newTags[user] = list.slice();
			continue;
		}
		const renamed = list.map((t) => (t === oldName ? trimmed : t));
		const seen = new Set();
		newTags[user] = renamed.filter((t) => {
			if (seen.has(t)) return false;
			seen.add(t);
			return true;
		});
	}

	const newColors = { ...colors };
	delete newColors[oldName];
	if (!destExists && inColors) {
		newColors[trimmed] = colors[oldName];
	}

	return { ...state, tags: newTags, colors: newColors };
}

// Returns a new state with `tagName` removed from every user's tag list
// and from the colors map. No-op (same reference) if the tag isn't
// present anywhere.
function removeTagInState(state, tagName) {
	const tags = state.tags || {};
	const colors = state.colors || {};
	const inColors = Object.hasOwn(colors, tagName);
	const inTags = Object.values(tags).some((list) => list.includes(tagName));
	if (!inColors && !inTags) return state;

	const newTags = {};
	for (const [user, list] of Object.entries(tags)) {
		newTags[user] = list.includes(tagName)
			? list.filter((t) => t !== tagName)
			: list.slice();
	}

	const newColors = { ...colors };
	delete newColors[tagName];

	return { ...state, tags: newTags, colors: newColors };
}

// Distinct-users-per-tag count. Includes tags that appear only in the
// colors map (orphans) with a count of 0.
function countsFromState(state) {
	const tags = state.tags || {};
	const colors = state.colors || {};
	const counts = {};
	for (const tagName of Object.keys(colors)) counts[tagName] = 0;
	for (const list of Object.values(tags)) {
		const seen = new Set();
		for (const t of list) {
			if (seen.has(t)) continue;
			seen.add(t);
			counts[t] = (counts[t] || 0) + 1;
		}
	}
	return counts;
}


// ===== src/dom.js =====

// Tiny element factory. Accepts text content and event handlers but
// intentionally does NOT accept innerHTML - all text goes through
// textContent so it can't become an XSS foothold even if we later pass a
// username or tag name through it.
function h(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === "class") node.className = v;
		else if (k === "text") node.textContent = v;
		else if (k.startsWith("on") && typeof v === "function") {
			node.addEventListener(k.slice(2).toLowerCase(), v);
		} else {
			node[k] = v;
		}
	}
	for (const child of children) {
		if (child) node.appendChild(child);
	}
	return node;
}
function findCommentParent(usernameEl) {
	return usernameEl.closest(".comhead") || usernameEl.parentElement;
}
function isItemPage() {
	return window.location.pathname === "/item";
}

// Read the item id from the current page's `?id=` URL parameter, or
// null if absent. Pairs with `isItemPage()` — both inspect
// `window.location` so they live together. Centralising here also
// dodges the build script's duplicate-function-name check, which
// otherwise forces each feature module to spell its own copy with a
// distinct name (see `scripts/build.js`).
function getItemPageId() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || null;
}

// Find the listing-page story table. HN's older markup tagged it with
// `class="itemlist"`; the current markup leaves the table unclassed
// inside `<tr id="bigbox">`, so we anchor off the per-story
// `tr.athing.submission` marker instead. Returns null on item pages
// (the only `tr.athing.submission` there is the fatitem header, which
// we exclude) and on pages with no submission rows at all.
function getStoryListTable() {
	const row = document.querySelector("tr.athing.submission");
	if (!row) return null;
	const table = row.closest("table");
	if (!table || table.classList.contains("fatitem")) return null;
	return table;
}


// ===== src/styles.js =====

// CSS for the userscript: site-wide legibility tweaks plus our injected UI.
// Tokens (`--colour-hn-orange`, `--gutter`, `--border-radius`) are declared
// on `:root` so feature-specific rules added later can reuse them.
//
// The site-wide block is adapted from
// https://github.com/mgladdish/website-customisations.
const STYLES = `
    :root {
      --colour-hn-orange: #ff6600;
      --colour-hn-orange-pale: rgba(255, 102, 0, 0.05);
      --gutter: 0.5rem;
      --border-radius: 3px;
    }

    /* Site-wide legibility tweaks, adapted from
       https://github.com/mgladdish/website-customisations. */
    html, body, td, .title, .comment, .default {
      font-family: "Verdana", "Arial", sans-serif;
    }
    html, body { margin-top: 0; }
    body { padding: 0; margin: 0; }
    body, td, .title, .pagetop, .comment { font-size: 1rem; }

    html[op="news"] .title,
    .votelinks,
    .fatitem .title + .votelinks { vertical-align: inherit; }

    .comment-tree .votelinks,
    html[op="threads"] .votelinks,
    html[op="item"] .votelinks,
    xhtml[op="newcomments"] .votelinks { vertical-align: top; }

    span.titleline {
      font-size: 1rem;
      margin-top: var(--gutter);
      margin-bottom: var(--gutter);
      display: block;
    }
    html[op="item"] span.titleline { font-size: 1.2rem; }

    .rank { display: none; }

    html[op="news"]        #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="newest"]      #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="ask"]         #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="newcomments"] #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="shownew"]     #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="submitted"]   #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="favorites"]   #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2),
    html[op="front"]       #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2),
    html[op="show"]        #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2) {
      margin-left: var(--gutter);
    }

    .sitebit.comhead { margin-left: var(--gutter); }
    .subtext, .subline { font-size: 0.75rem; }

    #hnmain {
      width: 100%;
      background-color: white;
    }
    #hnmain > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) {
      padding: var(--gutter);
    }
    #hnmain > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) {
      padding-right: var(--gutter) !important;
    }

    .comment, .toptext { max-width: 40em; }
    .toptext, a { color: black; }
    a:visited { color: #4c2c92; }
    a:hover { text-decoration: underline; }

    input { padding: var(--gutter); }
    input, textarea {
      background-color: white;
      border: 2px solid var(--colour-hn-orange);
      border-radius: var(--border-radius);
    }
    input[type="button"], input[type="submit"] { cursor: pointer; }

    .downvoted {
      background-color: rgb(245, 245, 245);
      border-radius: var(--border-radius);
      padding: 6px;
    }
    .downvoted .commtext {
      color: black;
      font-size: smaller;
    }

    .quote {
      border-left: 3px solid var(--colour-hn-orange);
      padding: 6px 6px 6px 9px;
      font-style: italic;
      background-color: var(--colour-hn-orange-pale);
      border-radius: var(--border-radius);
    }

    .hidden { display: none; }

    .showComment a,
    .hideComment,
    .hideComment:link,
    .hideComment:visited {
      color: var(--colour-hn-orange);
      text-decoration: underline;
    }
    .hideComment { margin-left: var(--gutter); }

    /* Our own injected UI (account info, custom tags, ratings, toolbar,
       tag-management overlay). The site-wide input padding rule would
       otherwise inflate our compact fields, so the inputs below carry
       tighter padding overrides - but the orange border + radius from
       the site-wide rule are kept on purpose. */

    .hn-post-layout {
      display: grid;
      grid-template-columns: 1fr auto;
      margin: 5px 0;
      width: 100%;
    }
    .comment { padding-top: 10px; }
    /* Hide the stray <br>s HN puts above comment bodies.
       :has() is supported in all current evergreen browsers. */
    br:has(+ div.comment) { display: none; }
    .hn-username {
      font-weight: 700;
      font-size: 1.15em;
      margin-right: 5px;
    }
    .hn-main-row {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      padding-bottom: 2px;
      grid-column: 1;
    }
    .hn-info {
      font-size: 0.8em;
      margin-left: 4px;
      white-space: nowrap;
    }
    .hn-info-pending { opacity: 0.4; }
    .hn-tag-container {
      display: flex;
      flex-direction: column;
      grid-column: 2;
      padding-left: 10px;
      margin-left: 10px;
    }
    .hn-tag-group {
      display: flex;
      flex-direction: column;
    }
    .hn-tag {
      padding: 3px 6px;
      margin-bottom: 3px;
      margin-right: 5px;
      border-radius: 5px;
      font-size: 0.9em;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: fit-content;
    }
    .hn-tag-text { margin-right: 5px; }
    .hn-tag-icons {
      display: flex;
      align-items: center;
    }
    .hn-tag-icon {
      cursor: pointer;
      margin-left: 3px;
      font-size: 0.8em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.3);
    }
    .hn-tag-icon:hover { background-color: rgba(255, 255, 255, 0.6); }
    .hn-tag-input {
      font-size: 0.8em;
      margin-left: 4px;
      width: 250px;
      height: 30px;
      line-height: 30px;
      display: inline-block;
      vertical-align: middle;
      /* Tighter padding than the site-wide rule so the field stays
         compact; the orange border + radius from the site-wide rule
         are kept by design. */
      padding: 0 4px;
    }
    .hn-rating-container {
      margin-left: 4px;
      white-space: nowrap;
      display: flex;
      align-items: center;
    }
    .hn-rating-btn {
      font-size: 0.6em;
      padding: 1px 2px;
      margin-right: 2px;
    }
    .hn-rating-display {
      font-size: 1.3em;
      padding: 0 4px 0 2px;
      color: #575F94;
      font-weight: 700;
    }
    .hn-toolbar {
      position: fixed;
      top: 10px;
      right: 10px;
      background-color: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: 4px;
      padding: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      z-index: 9999;
      display: flex;
      align-items: center;
    }
    .hn-drag-handle {
      width: 12.5px;
      height: 100%;
      background-color: rgba(255, 102, 0, 0.5);
      cursor: move;
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      border-top-left-radius: 3px;
      border-bottom-left-radius: 3px;
    }
    .hn-toolbar-buttons {
      display: flex;
      padding-left: 8px;
    }
    .hn-toolbar-btn {
      background-color: var(--colour-hn-orange);
      color: white;
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      margin: 0 5px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-toolbar-btn:hover { background-color: #ff8533; }
    .hn-tagmgr-catcher {
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: transparent;
    }
    .hn-tagmgr-overlay {
      position: fixed;
      top: 5vh;
      right: 0;
      width: 33vw;
      min-width: 320px;
      height: 90vh;
      background-color: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: 4px 0 0 4px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      font-size: 0.9em;
    }
    .hn-tagmgr-header {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: bold;
    }
    .hn-tagmgr-header-count { color: #888; font-weight: normal; }
    .hn-tagmgr-controls {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .hn-tagmgr-filter {
      width: 100%;
      padding: 4px 6px;
      box-sizing: border-box;
    }
    .hn-tagmgr-sort { display: flex; gap: 6px; }
    .hn-tagmgr-sort-btn {
      font-size: 0.85em;
      padding: 2px 8px;
      background: #f4f4f4;
      border: 1px solid #ccc;
      border-radius: 3px;
      cursor: pointer;
    }
    .hn-tagmgr-sort-btn.active {
      background: var(--colour-hn-orange);
      color: white;
      border-color: var(--colour-hn-orange);
    }
    .hn-tagmgr-list {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 4px 0;
    }
    .hn-tagmgr-row {
      display: flex;
      align-items: center;
      padding: 4px 12px;
      gap: 8px;
      border-left: 2px solid transparent;
    }
    .hn-tagmgr-row.dirty { border-left-color: var(--colour-hn-orange); }
    .hn-tagmgr-row.removed .hn-tagmgr-name { text-decoration: line-through; }
    .hn-tagmgr-row.removed { opacity: 0.6; }
    .hn-tagmgr-swatch {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      flex: 0 0 12px;
      border: 1px solid rgba(0,0,0,0.1);
    }
    .hn-tagmgr-name {
      flex: 1 1 auto;
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: bold;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hn-tagmgr-name-input {
      flex: 1 1 auto;
      font-size: 1em;
      padding: 1px 5px;
    }
    .hn-tagmgr-count {
      flex: 0 0 auto;
      font-size: 0.85em;
      color: #666;
      min-width: 2em;
      text-align: right;
    }
    .hn-tagmgr-count.zero { color: #bbb; }
    .hn-tagmgr-icons { display: flex; gap: 4px; flex: 0 0 auto; }
    .hn-tagmgr-icon {
      cursor: pointer;
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-size: 0.9em;
    }
    .hn-tagmgr-icon:hover { background: #eee; }
    .hn-tagmgr-footer {
      padding: 8px 12px;
      border-top: 1px solid #eee;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .hn-tagmgr-btn {
      background: white;
      border: 1px solid #ccc;
      border-radius: 3px;
      padding: 5px 14px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-tagmgr-btn.primary {
      background: var(--colour-hn-orange);
      color: white;
      border-color: var(--colour-hn-orange);
    }
    .hn-tagmgr-btn:hover { filter: brightness(0.95); }

    /* Refined-HN-derived comment-tree tweaks (PR-2). HN's site-wide CSS
       sets .commtext.cdd to grey-on-grey for dead comments; we recolour
       it to a faint red so showdead users can spot them at a glance.
       The indent border puts a 1px shadow on the indent gutter so reply
       depth is visible without counting indents. <pre> and inline
       <code> get a subtle grey background to look like code, matching
       how most readers expect monospace text to render. */
    .commtext.cdd,
    .commtext.cdd * {
      color: #d89899 !important;
    }
    tr.comtr td.ind {
      box-shadow: inset -1px 0 #ccc;
    }
    .hn-clickable-indent {
      cursor: pointer;
    }
    .hn-clickable-indent:hover {
      box-shadow: inset -1px 0 #888;
    }
    div.comment span.commtext pre,
    div.comment span.commtext *:not(pre) > code {
      background: #e4e4e4;
      border-radius: var(--border-radius);
    }
    div.comment span.commtext *:not(pre) > code {
      padding: 0 4px;
      display: inline-block;
    }

    /* OP highlight: the [op] suffix is appended as a text node by
       user-render so the marker is grep-able in the DOM, and the
       .hn-op class colours the whole username (including the suffix)
       in HN orange. */
    .hn-op {
      color: var(--colour-hn-orange) !important;
    }

    /* The collapse-root link sits inline next to "parent | next" in the
       comhead. Match HN's existing comhead link size so it doesn't
       overpower the row. */
    a.hn-collapse-root,
    a.hn-collapse-root:link,
    a.hn-collapse-root:visited {
      color: var(--colour-hn-orange);
      margin-left: 4px;
    }
    a.hn-collapse-root:hover {
      text-decoration: underline;
    }

    /* Highlight-unread tints every cell of a new comment's row so the
       marker stays visible regardless of indent depth. (Painting only
       td.ind leaves root comments unmarked because their indent cell
       collapses to ~0 width.) */
    .hn-new-comment > td {
      background-color: rgba(255, 102, 0, 0.12);
    }

    /* "[toggle all]" sits next to the existing fatitem subtext links;
       "[toggle replies]" (when enabled) lives in each comment's comhead
       like "[collapse root]". Same orange/underline treatment as the
       collapse-root link for visual consistency. */
    a.hn-toggle-all,
    a.hn-toggle-all:link,
    a.hn-toggle-all:visited,
    a.hn-toggle-replies,
    a.hn-toggle-replies:link,
    a.hn-toggle-replies:visited {
      color: var(--colour-hn-orange);
      margin-left: 4px;
    }
    a.hn-toggle-all:hover,
    a.hn-toggle-replies:hover {
      text-decoration: underline;
    }

    /* PR-4: shared hover-popup primitive used by user-info-hover and
       item-info-hover. Fixed-position-via-absolute (anchored relative
       to scrollY/scrollX in the JS) so it floats above page content
       without joining the document flow. The .hidden rule is shared
       with the comment-box-toggle. */
    .hn-hover-popup {
      position: absolute;
      max-width: 360px;
      background: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: var(--border-radius);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      padding: 8px 10px;
      font-size: 0.85em;
      z-index: 10000;
      pointer-events: none;
    }
    .hn-hover-popup-title {
      font-size: 1em;
      margin-bottom: 4px;
    }
    .hn-hover-popup-domain {
      color: #888;
      font-weight: normal;
    }
    .hn-hover-popup-meta {
      color: #555;
      margin-bottom: 4px;
    }
    .hn-hover-popup-body {
      color: #333;
      margin-top: 4px;
      max-height: 8em;
      overflow: hidden;
    }

    /* PR-5: sort-stories dropdown sits above the listing table on
       listing pages. Match HN's subtext font size so it doesn't
       dominate the layout. */
    .hn-sort-bar {
      padding: 6px 10px;
      font-size: 0.8em;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .hn-sort-select {
      padding: 1px 4px;
      font-size: inherit;
    }
    a.hn-sort-reverse,
    a.hn-sort-reverse:link,
    a.hn-sort-reverse:visited {
      color: var(--colour-hn-orange);
      margin-left: 4px;
    }
    a.hn-sort-reverse:hover {
      text-decoration: underline;
    }

    /* reply-inline injects HN's own reply/edit/delete <form> into
       div.reply with this class so we can give it some top margin
       (otherwise it bumps right up against the parent comment). */
    .hn-injected-form {
      margin-top: 10px;
    }
    .hn-reply-loader {
      color: #888;
      font-size: 0.85em;
    }

    /* Watch-for-replies: per-comment toggle icon, sitting in
       .hn-main-row between the rating control and the tag input. */
    .hn-watch-icon {
      cursor: pointer;
      user-select: none;
      margin: 0 4px;
      opacity: 0.6;
    }
    .hn-watch-icon:hover { opacity: 1; }
    .hn-watch-icon.hn-watching { opacity: 1; }

    /* Watched-comment row: thick orange left border (in the indent
       gutter) plus a faint yellow background tint on every cell.
       Yellow is deliberately distinct from the orange tint that
       hn-new-comment uses, so a row that is somehow both still reads
       as both. */
    .hn-watched > td.ind {
      border-left: 5px solid var(--colour-hn-orange);
    }
    .hn-watched > td {
      background-color: rgba(255, 255, 0, 0.10);
    }

    /* Toolbar prev/next-watch buttons. Inherits .hn-toolbar-btn
       padding/border from the existing toolbar rule. */
    .hn-watch-nav[disabled] {
      opacity: 0.35;
      cursor: not-allowed;
    }

    /* Listing-page "n comments" link with new replies on a watched
       comment. The leading star is injected via ::before so the
       underlying anchor's textContent (used by HN's "n comments"
       counting) is undisturbed. */
    .hn-watched-link {
      font-weight: bold;
      color: var(--colour-hn-orange) !important;
    }
    .hn-watched-link::before {
      content: "★ ";
    }

    /* Auto-collapse: when an author's stored rating is <= the
       LOW_SCORE_COLLAPSE_THRESHOLD, the row is tagged .hn-low-score and
       the body + reply link are hidden. The comhead and the
       user-render main row stay visible (so the rating buttons remain
       reachable), and replies — which are separate tr.comtr rows —
       are unaffected. Clicking the indent gutter toggles
       .hn-low-score-expanded, which uses display: revert to undo the
       hide on this single row. */
    tr.comtr.hn-low-score .commtext,
    tr.comtr.hn-low-score .reply {
      display: none;
    }

    tr.comtr.hn-low-score.hn-low-score-expanded .commtext,
    tr.comtr.hn-low-score.hn-low-score-expanded .reply {
      display: revert;
    }

    /* "[low score]" marker appended to the comhead next to the existing
       "[collapse root]" link. Faint grey so it reads as metadata rather
       than as another action link. */
    .hn-low-score-tag {
      color: #999;
      margin-left: 4px;
      font-size: 0.9em;
    }
  `;


// ===== src/api.js =====

// HN Firebase API access. Browser-side only - imports the GM_xmlhttpRequest
// global at call time so this module never references it at import time
// (so the build artifact, which inlines this, doesn't crash if loaded
// outside a userscript runtime).

// Factory over a store. Returns { fetchUser, fetchItem } where each
// resolves to a digest object or null. Both are protected by:
//   - A persistent cache (store.getCachedUser/getCachedItem) with a TTL
//     declared in config.
//   - An in-memory inflight Map that dedupes concurrent fetches for
//     the same key.
//   - A per-request timeout so a hung request can't leave a popup
//     stuck on "loading…" forever.
function createApi({ store }) {
	const userInflight = new Map();
	const itemInflight = new Map();

	function fetchUser(username) {
		const cached = store.getCachedUser(username, Date.now(), USER_CACHE_TTL_MS);
		if (cached) return Promise.resolve(cached);
		if (userInflight.has(username)) return userInflight.get(username);

		const promise = new Promise((resolve) => {
			GM_xmlhttpRequest({
				method: "GET",
				url: `https://hacker-news.firebaseio.com/v0/user/${username}.json`,
				timeout: USER_FETCH_TIMEOUT_MS,
				onload: (response) => {
					if (response.status !== 200 || !response.responseText) {
						resolve(null);
						return;
					}
					try {
						const data = JSON.parse(response.responseText);
						if (data && typeof data.created === "number") {
							store.setCachedUser(
								username,
								{
									created: data.created,
									karma: data.karma,
									about: data.about || "",
								},
								Date.now(),
							);
							resolve({
								created: data.created,
								karma: data.karma,
								about: data.about || "",
							});
						} else {
							resolve(null);
						}
					} catch (_err) {
						resolve(null);
					}
				},
				onerror: () => resolve(null),
				ontimeout: () => resolve(null),
			});
		}).finally(() => {
			userInflight.delete(username);
		});
		userInflight.set(username, promise);
		return promise;
	}

	// `fresh: true` skips the persistent cache read but still participates
	// in inflight-dedup and still writes the cache on resolve. Used by
	// the watch-for-replies feature, where the 6h cache would otherwise
	// shadow the 30-min recheck throttle. Hover-popup callers leave the
	// default in place — title/score/karma drift slowly enough that the
	// 6h cache is fine for them.
	function fetchItem(itemId, { fresh = false } = {}) {
		if (!fresh) {
			const cached = store.getCachedItem(itemId, Date.now(), ITEM_CACHE_TTL_MS);
			if (cached) return Promise.resolve(cached);
		}
		if (itemInflight.has(itemId)) return itemInflight.get(itemId);

		const promise = new Promise((resolve) => {
			GM_xmlhttpRequest({
				method: "GET",
				url: `https://hacker-news.firebaseio.com/v0/item/${itemId}.json`,
				timeout: ITEM_FETCH_TIMEOUT_MS,
				onload: (response) => {
					if (response.status !== 200 || !response.responseText) {
						resolve(null);
						return;
					}
					try {
						const data = JSON.parse(response.responseText);
						if (!data || typeof data.id !== "number") {
							resolve(null);
							return;
						}
						const digest = {
							title: data.title || "",
							url: data.url || "",
							by: data.by || "",
							score: typeof data.score === "number" ? data.score : 0,
							descendants:
								typeof data.descendants === "number" ? data.descendants : 0,
							time: typeof data.time === "number" ? data.time : 0,
							text: data.text || "",
							type: data.type || "story",
							// Direct replies. Used by the watch-for-replies feature
							// to detect new replies on a watched comment without
							// loading the full comment page. Hover popup ignores it.
							kids: Array.isArray(data.kids) ? data.kids.slice() : [],
						};
						store.setCachedItem(itemId, digest, Date.now());
						resolve(digest);
					} catch (_err) {
						resolve(null);
					}
				},
				onerror: () => resolve(null),
				ontimeout: () => resolve(null),
			});
		}).finally(() => {
			itemInflight.delete(itemId);
		});
		itemInflight.set(itemId, promise);
		return promise;
	}

	return { fetchUser, fetchItem };
}


// ===== src/features/legibility.js =====

// Site-wide legibility passes. Run on every HN page: restyle downvoted
// comments and rewrite ">"-prefixed text into styled quote blocks.



// HN comment styling: any .commtext that lacks the .c00 class has been
// downvoted (HN drops the class to express grey-on-grey). We tag the
// surrounding .comment so our CSS can restore black text on a faint-grey
// background.
function applyDownvotedClass() {
	for (const el of document.querySelectorAll(".commtext")) {
		if (!el.classList.contains("c00")) {
			el.parentElement?.classList.add("downvoted");
		}
	}
}

// Find <i>/<p>/<span> whose first text-node child starts with ">" and
// re-render it as a styled <p class="quote"> block. Two shapes seen in
// HN markup:
//   1. The first text node contains both the marker and the quoted body
//      (e.g. <i>&gt; quoted text</i>) -> strip the marker, set the body
//      as text on the new <p>.
//   2. The first text node is just the marker, with the quoted content
//      sitting in the next sibling (e.g. <i>&gt; <a>link</a></i>) -> move
//      the sibling into the <p> so any nested elements survive.
function transformQuotes() {
	const candidates = document.querySelectorAll("i, p, span");
	for (const el of candidates) {
		if (el.classList.contains("quote")) continue;
		const textNode = Array.from(el.childNodes).find(
			(n) => n.nodeType === Node.TEXT_NODE,
		);
		if (!textNode?.data.trimStart().startsWith(">")) continue;

		const p = h("p", { class: "quote" });
		if (textNode.data.trim() === ">") {
			const next = textNode.nextSibling;
			if (next) p.appendChild(next);
		} else {
			p.textContent = stripLeadingQuoteMarker(textNode.data);
		}
		textNode.replaceWith(p);
	}
}


// ===== src/features/comment-box-toggle.js =====

// Item pages: hide the comment-submit form behind a "show comment box"
// link. Returning early on missing nodes covers locked threads and
// logged-out views, where the form (and possibly the row) isn't there.
function setupCommentBoxToggle() {
	const addComment = document.querySelector(".fatitem tr:last-of-type");
	const commentForm = document.querySelector("form[action='comment']");
	if (!addComment || !commentForm) return;

	addComment.classList.add("hidden");

	const showLink = h("a", {
		href: "#",
		text: "show comment box",
	});
	const showRow = h("tr", { class: "showComment" }, [
		h("td", { colSpan: 2 }),
		h("td", {}, [showLink]),
	]);
	const toggle = (e) => {
		e.preventDefault();
		showRow.classList.toggle("hidden");
		addComment.classList.toggle("hidden");
	};
	showLink.addEventListener("click", toggle);

	const hideLink = h("a", {
		href: "#",
		class: "hideComment",
		text: "hide comment box",
		onclick: toggle,
	});

	addComment.parentNode.insertBefore(showRow, addComment);
	commentForm.append(hideLink);
}


// ===== src/features/click-indent-toggle.js =====

// Make the empty indent column on each comment a click target.
// Default behaviour: fire HN's native toggle (collapse/expand the
// whole subtree). Overridden behaviour: on rows tagged
// .hn-low-score (auto-collapsed because the author's rating is at
// or below the configured threshold), toggle .hn-low-score-expanded
// instead — score-collapse hides only this comment's body, not its
// replies, so HN's native subtree toggle would do the wrong thing.
function setupClickIndentToggle() {
	for (const row of document.querySelectorAll("tr.comtr")) {
		const indentCell = row.querySelector("td.ind");
		const toggleBtn = row.querySelector("a.togg");
		if (!indentCell || !toggleBtn) continue;
		indentCell.classList.add("hn-clickable-indent");
		indentCell.addEventListener("click", () => {
			if (row.classList.contains("hn-low-score")) {
				row.classList.toggle("hn-low-score-expanded");
				return;
			}
			toggleBtn.click();
		});
	}
}


// ===== src/features/collapse-root-comment.js =====

// On each non-root comment, append a "[collapse root]" link to the
// comhead. Clicking it fires the root comment's native toggle and
// scrolls the page back to the (now-collapsed) root, so a reader who
// has descended deep into a thread can dismiss the whole subtree
// without losing their place in the page.
function setupCollapseRootComment() {
	const comments = Array.from(document.querySelectorAll("tr.comtr"));
	if (comments.length === 0) return;

	// HN renders indentation as an <img> in td.ind whose width is
	// `40 * level` pixels. We read that width once per comment to build
	// the level array, then hand it to the pure helper.
	const indentLevels = comments.map((row) => {
		const img = row.querySelector("td.ind img");
		if (!img) return 0;
		const width = Number(img.getAttribute("width")) || img.width || 0;
		return Math.round(width / 40);
	});

	const rootIndices = findCommentRootIndices(indentLevels);

	for (let i = 0; i < comments.length; i++) {
		const rootIdx = rootIndices[i];
		if (rootIdx === -1) continue;
		const root = comments[rootIdx];
		const head = comments[i].querySelector("span.comhead");
		if (!head) continue;

		const link = h("a", {
			class: "hn-collapse-root",
			href: "javascript:void(0)",
			text: "[collapse root]",
			onclick: (e) => {
				e.preventDefault();
				const rootToggle = root.querySelector("a.togg");
				if (!rootToggle) return;
				rootToggle.click();
				// Scroll the (now collapsed) root into view so the reader
				// doesn't lose their place after the subtree disappears.
				const rect = root.getBoundingClientRect();
				const top = rect.top + window.scrollY;
				window.scrollTo({ top, left: 0 });
			},
		});

		head.append(link);
	}
}


// ===== src/features/backticks-to-monospace.js =====

// Walk the text nodes inside every .commtext and replace `inline code`
// segments (delimited by backticks) with proper <code> elements. The
// pure helper splitBackticks(text) does the actual splitting; this
// module is the DOM glue.
//
// Skips text inside existing <code>, <pre>, and <a> elements so we
// don't mangle pre-formatted code blocks or rewrite link text.


const SKIP_TAGS = new Set(["code", "pre", "a"]);
function transformBackticksToMonospace() {
	for (const commtext of document.querySelectorAll(".commtext")) {
		// Two-pass: collect candidate text nodes first, then mutate. A
		// single pass that mutates while walking would have the walker
		// skip nodes that get inserted during replacement.
		const candidates = [];
		const walker = document.createTreeWalker(commtext, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const parent = node.parentNode;
				if (!parent) return NodeFilter.FILTER_REJECT;
				const tag = parent.tagName?.toLowerCase();
				if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
				// Quick prefilter: a text node with no backticks won't
				// match anything in splitBackticks, so don't bother.
				if (!node.data.includes("`")) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let n = walker.nextNode();
		while (n !== null) {
			candidates.push(n);
			n = walker.nextNode();
		}

		for (const node of candidates) {
			const segments = splitBackticks(node.data);
			if (!segments.some((s) => s.kind === "code")) continue;
			const fragment = document.createDocumentFragment();
			for (const seg of segments) {
				if (seg.kind === "text") {
					fragment.appendChild(document.createTextNode(seg.value));
				} else {
					const code = document.createElement("code");
					code.textContent = seg.value;
					fragment.appendChild(code);
				}
			}
			node.replaceWith(fragment);
		}
	}
}


// ===== src/features/toggle-all-comments.js =====

// "[toggle all]" link in the fatitem subtext that fires every
// top-level comment's a.togg in one click — useful on long threads
// where you've already drilled into one subtree and want to dismiss
// the rest, or want to expand a fully-collapsed page in one go.
//
// Optionally also adds a per-comment "[toggle replies]" link that
// fires every direct child's a.togg. Gated by TOGGLE_ALL_REPLIES_ENABLED
// in src/config.js because adding a link to every commentscales
// linearly with thread size; refined-hacker-news warns that it slows
// page render on items with hundreds of comments. Default off.



function indentLevel(row) {
	const img = row.querySelector("td.ind img");
	if (!img) return 0;
	const width = Number(img.getAttribute("width")) || img.width || 0;
	return Math.round(width / 40);
}

function fireToggle(row) {
	row.querySelector("a.togg")?.click();
}
function setupToggleAllComments() {
	const subtext = document.querySelector(".fatitem .subtext");
	const allRows = Array.from(document.querySelectorAll("tr.comtr"));
	if (!subtext || allRows.length === 0) return;

	const levels = allRows.map(indentLevel);

	// Fatitem-level toggle: collect all root rows up front so the click
	// handler doesn't re-query the DOM on every press.
	const rootRows = allRows.filter((_, i) => levels[i] === 0);
	if (rootRows.length > 0) {
		const link = h("a", {
			class: "hn-toggle-all",
			href: "javascript:void(0)",
			text: "toggle all",
			onclick: (e) => {
				e.preventDefault();
				for (const row of rootRows) fireToggle(row);
			},
		});
		// Match HN's subtext separator pattern: " | <link>".
		subtext.append(document.createTextNode(" | "));
		subtext.append(link);
	}

	if (!TOGGLE_ALL_REPLIES_ENABLED) return;

	// Per-comment "[toggle replies]" links. For each row, find its
	// immediate children (the contiguous run of following rows whose
	// indent is exactly +1 deeper, stopping when we hit one at <= the
	// parent's level). Skip rows that have no replies.
	for (let i = 0; i < allRows.length; i++) {
		const parent = allRows[i];
		const parentLevel = levels[i];
		const replies = [];
		for (let j = i + 1; j < allRows.length; j++) {
			if (levels[j] <= parentLevel) break;
			if (levels[j] === parentLevel + 1) replies.push(allRows[j]);
		}
		if (replies.length === 0) continue;

		const head = parent.querySelector("span.comhead");
		if (!head) continue;

		head.append(
			h("a", {
				class: "hn-toggle-replies",
				href: "javascript:void(0)",
				text: "[toggle replies]",
				onclick: (e) => {
					e.preventDefault();
					for (const row of replies) fireToggle(row);
				},
			}),
		);
	}
}


// ===== src/features/highlight-unread-comments.js =====

// Mark comment rows that weren't on the page the last time you visited
// this thread. Keeps a per-item ID list in the consolidated store under
// state.readComments[itemId] = { ids, fetchedAt }, with a 3-day TTL
// (READ_COMMENTS_TTL_MS in config). Stale entries are pruned on every
// item-page load so the slice can't grow unboundedly.
//
// First visit (no stored entry): nothing is highlighted, but every
// visible comment ID is recorded so the *next* visit knows which
// comments are new.
//
// Subsequent visits: ids in the current page that weren't in the
// stored entry get a .hn-new-comment class on their tr.comtr row.
// (The class lives on the row, not on td.ind, because the indent cell
// has ~0 width on root-level comments — anything painted on it would
// be invisible there.)




function getCurrentCommentIds() {
	return Array.from(document.querySelectorAll("tr.comtr"))
		.map((row) => row.id)
		.filter(Boolean);
}
function setupHighlightUnreadComments({ store }) {
	const itemId = getItemPageId();
	if (!itemId) return;

	const now = Date.now();

	// Drop expired entries first so a user who hasn't visited a thread
	// in months doesn't carry around its dead ID list forever.
	store.pruneReadComments(now, READ_COMMENTS_TTL_MS);

	const currentIds = getCurrentCommentIds();
	if (currentIds.length === 0) return;

	const stored = store.getReadComments(itemId);
	const isFreshSecondVisit =
		stored !== null && now - stored.fetchedAt <= READ_COMMENTS_TTL_MS;

	if (isFreshSecondVisit) {
		const newIds = findNewCommentIds(currentIds, stored.ids);
		for (const id of newIds) {
			const row = document.getElementById(id);
			if (row) row.classList.add("hn-new-comment");
		}
	}

	// Always update the stored snapshot to match what's currently on
	// the page — next visit's "new" set is derived from this.
	store.setReadComments(itemId, currentIds, now);
}


// ===== src/features/auto-collapse-low-score.js =====

// Auto-collapse comments whose author's stored rating is at or
// below LOW_SCORE_COLLAPSE_THRESHOLD. This pass walks every
// tr.comtr on the page once, tags each row with
// data-hn-author=<username> (so rerenderUserRatings can find rows
// by author later), and applies the .hn-low-score class to rows
// whose author crosses the threshold. CSS in styles.js does the
// actual hiding.
//
// The [low score] marker is appended to the comhead — same
// position as the existing [collapse root] link — so the reader
// has a visible reason for the empty body.
function setupAutoCollapseLowScore({ store }) {
	for (const row of document.querySelectorAll("tr.comtr")) {
		const userEl = row.querySelector(".hnuser");
		const username = userEl?.textContent || "";
		if (!username) continue;
		row.dataset.hnAuthor = username;

		const rating = store.getRating(username);
		if (!shouldAutoCollapseAuthor(rating, LOW_SCORE_COLLAPSE_THRESHOLD)) {
			continue;
		}
		row.classList.add("hn-low-score");

		const head = row.querySelector("span.comhead");
		if (head) {
			head.append(
				h("span", { class: "hn-low-score-tag", text: "[low score]" }),
			);
		}
	}
}


// ===== src/features/hover-popup.js =====

// Shared hover-popup primitive used by user-info-hover and item-info-hover.
// Builds a single fixed-position div appended to <body>, plus an
// attachDwell helper that wires the standard "cursor rests for N ms ->
// fetch -> render -> show" pattern. One popup per page; whichever
// hover wins last replaces the content.
function createHoverPopup() {
	const popup = h("div", { class: "hn-hover-popup hidden" });
	document.body.appendChild(popup);

	let currentToken = 0; // monotonic; bumped on every show/hide
	let visibleNear = null;

	function setContent(nodes) {
		popup.replaceChildren(...nodes);
	}

	function position(near) {
		const rect = near.getBoundingClientRect();
		// Anchor below the link, scrolled-position-aware. Clamp to the
		// viewport so the popup doesn't escape off the right or bottom
		// edge on long usernames near the screen edge.
		const top = rect.bottom + window.scrollY + 6;
		const proposedLeft = rect.left + window.scrollX;
		const maxLeft = window.scrollX + document.documentElement.clientWidth - 360;
		const left = Math.max(window.scrollX + 4, Math.min(proposedLeft, maxLeft));
		popup.style.top = `${top}px`;
		popup.style.left = `${left}px`;
	}

	function show(near, contentNodes) {
		setContent(contentNodes);
		position(near);
		popup.classList.remove("hidden");
		visibleNear = near;
	}

	function hide() {
		currentToken += 1;
		popup.classList.add("hidden");
		visibleNear = null;
		popup.replaceChildren();
	}

	// Escape dismisses whichever hover popup is currently visible.
	// Single document-level listener means user/item/parent hovers all
	// inherit keyboard dismissal automatically.
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Escape") return;
		if (popup.classList.contains("hidden")) return;
		hide();
	});

	// Wire mouseenter/mouseleave on `target` so that, after HOVER_DWELL_MS
	// of continuous hover, `loader()` is invoked. If it resolves and the
	// cursor is still on the target, `render(data)` is called and its
	// returned nodes are shown in the popup. Mouse leaving the target at
	// any time aborts the in-flight chain via a token bump.
	function attachDwell(target, loader, render) {
		let dwellTimer = null;
		let myToken = -1;

		target.addEventListener("mouseenter", () => {
			if (dwellTimer) clearTimeout(dwellTimer);
			currentToken += 1;
			myToken = currentToken;
			dwellTimer = setTimeout(() => {
				if (myToken !== currentToken) return;
				Promise.resolve(loader()).then((data) => {
					if (myToken !== currentToken) return;
					if (!data) {
						hide();
						return;
					}
					show(target, render(data));
				});
			}, HOVER_DWELL_MS);
		});

		target.addEventListener("mouseleave", () => {
			if (dwellTimer) {
				clearTimeout(dwellTimer);
				dwellTimer = null;
			}
			// Only hide if this target's hover is still the visible one;
			// avoids hiding the popup the user just moved into a second
			// candidate over.
			if (visibleNear === target) hide();
			currentToken += 1;
			myToken = -1;
		});
	}

	return { show, hide, attachDwell };
}


// ===== src/features/user-info-hover.js =====

// Hover any .hnuser link to see a popup with the user's account age,
// karma, and (if any) about-text snippet. Shares the popup primitive
// with item-info-hover, and the user-data cache with renderAllUsernames
// — repeat hovers cost zero requests.
//
// Skipped on the /user page itself (you're already looking at the
// profile).
//
// On item pages, renderAllUsernames hides each original .hnuser and
// inserts a visible clone inside .hn-main-row — so this pass must run
// after renderAllUsernames, and we attach to every .hnuser we find.
// Handlers on the hidden originals never fire (display:none = no mouse
// events); the visible clones do, and the popup adds the about-text
// snippet that the inline (age, karma) blurb doesn't show.



const ABOUT_PREVIEW_MAX = 280;

function isOnUserPage() {
	return window.location.pathname === "/user";
}

// HN serves `about` as HTML (links, paragraphs, italic). For the
// preview popup, we want a plain-text rendering — strips tags via the
// browser's HTML parser and trims to a fixed length so a long bio
// doesn't make the popup the size of a small monitor.
function aboutToText(html) {
	if (!html) return "";
	const doc = new DOMParser().parseFromString(html, "text/html");
	const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
	return truncateText(text, ABOUT_PREVIEW_MAX);
}

function renderUserPopup(username, data) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const lines = [
		h("div", { class: "hn-hover-popup-title" }, [
			h("strong", { text: username }),
		]),
		h("div", {
			class: "hn-hover-popup-meta",
			text: `${timeSince(data.created, nowSeconds)} old · ${data.karma} karma`,
		}),
	];
	const about = aboutToText(data.about);
	if (about) {
		lines.push(h("div", { class: "hn-hover-popup-body", text: about }));
	}
	return lines;
}
function setupUserInfoHover({ fetchUser, popup }) {
	if (isOnUserPage()) return;
	for (const link of document.querySelectorAll("a.hnuser")) {
		const username = link.textContent;
		if (!username) continue;
		popup.attachDwell(
			link,
			() => fetchUser(username),
			(data) => renderUserPopup(username, data),
		);
	}
}


// ===== src/features/item-info-hover.js =====

// Hover any link to /item?id=N inside a comment to see a preview of
// that item: title, domain, author, score, comment count, time, and
// (for Ask/Show items) a snippet of the body text. Useful when a
// commenter cites another submission and you want context without
// leaving the page.
//
// Scoped to `.commtext a[href*='/item?id=']` so we only enrich
// commenter-cited links, not navigation chrome (like the "parent" /
// "next" links that point to other items).



const TEXT_PREVIEW_MAX = 280;

// Distinct from highlight-unread's URL-based helper. The build flattens
// every module into one IIFE, so two same-name function declarations
// would silently override each other.
function getItemIdFromLinkHref(link) {
	try {
		const url = new URL(link.href);
		return url.searchParams.get("id") || null;
	} catch {
		return null;
	}
}

function textToPreview(html) {
	if (!html) return "";
	const doc = new DOMParser().parseFromString(html, "text/html");
	const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
	return truncateText(text, TEXT_PREVIEW_MAX);
}

function renderItemPopup(digest) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const titleNodes = [h("strong", { text: digest.title || "(untitled)" })];
	const domain = extractDomain(digest.url);
	if (domain) {
		titleNodes.push(
			h("span", { class: "hn-hover-popup-domain", text: ` (${domain})` }),
		);
	}

	const lines = [h("div", { class: "hn-hover-popup-title" }, titleNodes)];

	const metaParts = [];
	if (digest.score) metaParts.push(`${digest.score} points`);
	if (digest.by) metaParts.push(`by ${digest.by}`);
	if (digest.time) metaParts.push(`${timeSince(digest.time, nowSeconds)} ago`);
	if (typeof digest.descendants === "number") {
		metaParts.push(
			`${digest.descendants} comment${digest.descendants === 1 ? "" : "s"}`,
		);
	}
	if (metaParts.length > 0) {
		lines.push(
			h("div", { class: "hn-hover-popup-meta", text: metaParts.join(" · ") }),
		);
	}

	const body = textToPreview(digest.text);
	if (body) {
		lines.push(h("div", { class: "hn-hover-popup-body", text: body }));
	}
	return lines;
}
function setupItemInfoHover({ fetchItem, popup }) {
	const links = document.querySelectorAll(".commtext a[href*='/item?id=']");
	for (const link of links) {
		const id = getItemIdFromLinkHref(link);
		if (!id) continue;
		popup.attachDwell(
			link,
			() => fetchItem(id),
			(digest) => renderItemPopup(digest),
		);
	}
}


// ===== src/features/parent-hover.js =====

// Hover the "parent" link in any comment's comhead for HOVER_DWELL_MS
// to see the parent comment's body inline — saves a navigation
// round-trip in deep or wide threads. Resolves the parent first via
// the on-page DOM (the common case: parent is somewhere above the
// hovered comment in the same item page) and falls back to the
// existing fetchItem cache when the parent isn't on the page (e.g.
// you're viewing a deep subtree at /item?id=DEEP_COMMENT, or the
// parent is the story itself for a top-level comment).
//
// The popup shows up to two paragraphs of body, plus an ellipsis if
// more were dropped. For a story parent (top-level comments), the
// title is rendered as a bold first line above the body. Author,
// timestamp and score are deliberately omitted — the goal is to
// remind the reader of what the comment-being-replied-to said, not
// to re-show metadata.



const MAX_PARAGRAPHS = 2;

// Parse a paragraph HTML string into a fragment of DOM nodes,
// preserving inline markup (anchors, italics, code) without trusting
// the string as live HTML. DOMParser delivers a sandboxed Document;
// we only adopt the parsed children.
function paragraphToNodes(htmlChunk) {
	const doc = new DOMParser().parseFromString(
		`<div>${htmlChunk}</div>`,
		"text/html",
	);
	const wrapper = doc.body.firstChild;
	if (!wrapper) return [];
	return Array.from(wrapper.childNodes).map((n) =>
		document.importNode(n, true),
	);
}

function renderParagraphs(paragraphs, hasMore) {
	const nodes = [];
	for (const para of paragraphs) {
		nodes.push(
			h("p", { class: "hn-hover-popup-body" }, paragraphToNodes(para)),
		);
	}
	if (hasMore) {
		nodes.push(h("p", { class: "hn-hover-popup-body", text: "…" }));
	}
	return nodes;
}

// Try the on-page DOM first. Returns null if the parent isn't on the
// page or has no body content (deleted comments fall through to the
// API path, which can return a [deleted] placeholder or null).
function loadFromDom(parentId) {
	const row = document.getElementById(parentId);
	if (!row || row.tagName !== "TR") return null;
	const commtext = row.querySelector(".commtext");
	if (!commtext) return null;
	const paragraphs = splitHtmlIntoParagraphs(commtext.innerHTML);
	if (paragraphs.length === 0) return null;
	return {
		title: null,
		paragraphs: paragraphs.slice(0, MAX_PARAGRAPHS),
		hasMore: paragraphs.length > MAX_PARAGRAPHS,
	};
}

async function loadFromApi(parentId, fetchItem) {
	const digest = await fetchItem(parentId);
	if (!digest) return null;
	const paragraphs = splitHtmlIntoParagraphs(digest.text || "");
	if (paragraphs.length === 0 && !digest.title) return null;
	return {
		title: digest.title || null,
		paragraphs: paragraphs.slice(0, MAX_PARAGRAPHS),
		hasMore: paragraphs.length > MAX_PARAGRAPHS,
	};
}

function renderPopup(data) {
	const lines = [];
	if (data.title) {
		lines.push(
			h("div", { class: "hn-hover-popup-title" }, [
				h("strong", { text: data.title }),
			]),
		);
	}
	for (const node of renderParagraphs(data.paragraphs, data.hasMore)) {
		lines.push(node);
	}
	return lines;
}
function setupParentHover({ fetchItem, popup }) {
	const links = document.querySelectorAll("span.comhead a[href^='item?id=']");
	for (const link of links) {
		// The comhead has multiple "item?id=" anchors (parent, prev, next,
		// root, context); only the "parent" link is the use case here.
		if (link.textContent.trim() !== "parent") continue;
		const id = parseParentIdFromHref(link.getAttribute("href") || link.href);
		if (!id) continue;
		popup.attachDwell(
			link,
			() => loadFromDom(id) ?? loadFromApi(id, fetchItem),
			(data) => renderPopup(data),
		);
	}
}


// ===== src/features/linkify-user-about.js =====

// On /user pages, walk the about-cell text nodes and replace plain-
// text URLs / email addresses with clickable <a> elements. The pure
// helper linkifySegments (in src/parsing.js) does the splitting; this
// module is the DOM glue.
//
// Skips text already inside an <a> so HN's own pre-existing links
// don't get wrapped a second time. Refined-hacker-news pulls in
// linkifyjs for this; we use a small in-house regex linker instead
// to avoid the npm dep.


function findAboutCell() {
	// HN's user page has a nested table inside #hnmain; the inner table
	// has rows for "user:", "created:", "karma:", "about:". The "about:"
	// label is in the first cell; the body is in the next sibling cell.
	const rows = document.querySelectorAll("#hnmain table table tr");
	for (const row of rows) {
		const labelCell = row.querySelector("td");
		if (!labelCell) continue;
		if (labelCell.textContent.trim() === "about:") {
			return labelCell.nextElementSibling;
		}
	}
	return null;
}

function isInsideAnchor(node) {
	let cursor = node.parentNode;
	while (cursor && cursor.nodeType === Node.ELEMENT_NODE) {
		if (cursor.tagName === "A") return true;
		cursor = cursor.parentNode;
	}
	return false;
}

function buildLinkifiedFragment(text) {
	const fragment = document.createDocumentFragment();
	for (const seg of linkifySegments(text)) {
		if (seg.kind === "text") {
			fragment.appendChild(document.createTextNode(seg.value));
		} else if (seg.kind === "url") {
			const a = document.createElement("a");
			a.href = seg.value;
			a.rel = "noopener noreferrer";
			a.textContent = seg.value;
			fragment.appendChild(a);
		} else if (seg.kind === "email") {
			const a = document.createElement("a");
			a.href = `mailto:${seg.value}`;
			a.rel = "noopener noreferrer";
			a.textContent = seg.value;
			fragment.appendChild(a);
		}
	}
	return fragment;
}
function setupLinkifyUserAbout() {
	if (window.location.pathname !== "/user") return;
	const cell = findAboutCell();
	if (!cell) return;

	// Two-pass walk to avoid the walker skipping over text nodes we
	// just inserted while replacing.
	const candidates = [];
	const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (isInsideAnchor(node)) return NodeFilter.FILTER_REJECT;
			const segs = linkifySegments(node.data);
			const hasLink = segs.some((s) => s.kind === "url" || s.kind === "email");
			return hasLink ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
		},
	});
	let n = walker.nextNode();
	while (n !== null) {
		candidates.push(n);
		n = walker.nextNode();
	}

	for (const node of candidates) {
		const fragment = buildLinkifiedFragment(node.data);
		node.replaceWith(fragment);
	}
}


// ===== src/features/sort-stories.js =====

// On listing pages (/news, /newest, /ask, /show, /best, /front, etc.)
// add a "sort: …" dropdown above the story table. Selecting an option
// reorders the story rows in place; a "reverse" link flips the
// current order. Sort options:
//   - default: HN's server-supplied rank
//   - time:    newer items first (by id, which is monotonically
//              increasing)
//   - score:   highest first
//   - ratio:   comments/score descending — proxy for "most-discussed
//              given its score", surfaces controversial threads
//
// All three of these are non-persistent (per page load). The pure
// helper sortStoriesBy in src/parsing.js does the actual ordering.



const MODES = [
	{ value: "default", label: "default" },
	{ value: "time", label: "time" },
	{ value: "score", label: "score" },
	{ value: "ratio", label: "comments/score ratio" },
];

// Read each story's metadata + the 3 row group it occupies in the
// listing table's tbody. HN renders each story as exactly:
//   <tr class="athing">    -- title row, id=NNNN
//   <tr>...</tr>           -- subtext row (score, by, time, comments)
//   <tr style="height:5px">-- spacer row
function parseStoryRows(table) {
	const rows = Array.from(table.querySelectorAll("tbody > tr"));
	const stories = [];
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (!row.classList.contains("athing")) continue;
		const subtext = rows[i + 1];
		if (!subtext) continue;
		const spacer = rows[i + 2];

		const id = row.id;
		const rankText = row.querySelector(".rank")?.textContent || "";
		const defaultRank =
			Number(rankText.replace(/\.$/, "")) || stories.length + 1;
		const scoreText = subtext.querySelector(".score")?.textContent || "";
		const score = Number(scoreText.split(" ")[0]) || 0;
		// Comment count: the last "X comments" / "discuss" link in the
		// subtext. "discuss" means 0 comments; missing means it's a job
		// posting (no discussion).
		let commentsCount = 0;
		const commentLinks = subtext.querySelectorAll('a[href^="item?id="]');
		const lastLink = commentLinks[commentLinks.length - 1];
		if (lastLink) {
			const txt = lastLink.textContent.trim();
			const m = txt.match(/^(\d+)/);
			if (m) commentsCount = Number(m[1]);
		}

		const elements = [row, subtext];
		if (spacer && !spacer.classList.contains("athing")) {
			elements.push(spacer);
		}
		stories.push({ id, score, commentsCount, defaultRank, elements });
	}
	return stories;
}

function rerenderStories(tbody, stories) {
	// HN appends a "More" link as the last row of the listing table
	// (and a matching morespace row above it). Preserve those at the
	// end so pagination still works after reorder.
	const allRows = Array.from(tbody.children);
	const moreRow = allRows[allRows.length - 1];
	const moreSpace = allRows[allRows.length - 2];

	// Detach every story group's rows, then re-append in the requested
	// order. The DOM mutations are cheap because we're just moving
	// existing elements, not creating new ones.
	for (const story of stories) {
		for (const el of story.elements) {
			el.remove();
		}
	}

	// Find a stable insertion point: just before moreSpace (if present)
	// or at the end otherwise.
	const anchor =
		moreSpace && tbody.contains(moreSpace) ? moreSpace : moreRow || null;
	for (const story of stories) {
		for (const el of story.elements) {
			if (anchor && tbody.contains(anchor)) {
				tbody.insertBefore(el, anchor);
			} else {
				tbody.appendChild(el);
			}
		}
	}
}
function setupSortStories() {
	const table = getStoryListTable();
	if (!table) return;
	const tbody = table.querySelector("tbody");
	if (!tbody) return;

	// Capture the original story list (with default-rank metadata) once.
	// Subsequent sorts work from this snapshot so "default" really
	// restores the server-supplied ordering, not the most recent sort.
	const original = parseStoryRows(table);
	if (original.length === 0) return;

	const select = h("select", { class: "hn-sort-select" });
	for (const { value, label } of MODES) {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = label;
		select.appendChild(option);
	}
	const reverse = h("a", {
		class: "hn-sort-reverse",
		href: "javascript:void(0)",
		text: "reverse",
	});

	let currentMode = "default";
	let isReversed = false;

	function applyOrder() {
		let stories = sortStoriesBy(original, currentMode);
		if (isReversed) stories = stories.slice().reverse();
		rerenderStories(tbody, stories);
	}

	select.addEventListener("change", () => {
		currentMode = select.value;
		isReversed = false;
		applyOrder();
	});
	reverse.addEventListener("click", (e) => {
		e.preventDefault();
		isReversed = !isReversed;
		applyOrder();
	});

	const bar = h("div", { class: "hn-sort-bar" }, [
		h("label", { text: "sort: ", htmlFor: "hn-sort-select" }),
		select,
		reverse,
	]);
	table.parentNode.insertBefore(bar, table);
}


// ===== src/features/reply-inline.js =====

// Inline reply / edit / delete: instead of navigating away to
// /reply?id=N or /edit?id=N when the user clicks one of those links,
// fetch the page in the background and inject its <form> into the
// comment's div.reply. Click again to hide. If text is selected
// before the click, prepend it as a "> " quoted block to the
// textarea so users can quote-reply with the keyboard.
//
// Adapted from refined-hacker-news's reply-without-leaving-page,
// minus the italics-on-quote option (always plain "> "). Network
// fetches go through GM_xmlhttpRequest with a timeout — without it
// a hung request would silently strand the spinner forever.


const FETCH_TIMEOUT_MS = 8000;

function fetchPageDom(url) {
	return new Promise((resolve) => {
		GM_xmlhttpRequest({
			method: "GET",
			url,
			timeout: FETCH_TIMEOUT_MS,
			onload: (response) => {
				if (response.status !== 200 || !response.responseText) {
					resolve(null);
					return;
				}
				try {
					const doc = new DOMParser().parseFromString(
						response.responseText,
						"text/html",
					);
					resolve(doc);
				} catch (_err) {
					resolve(null);
				}
			},
			onerror: () => resolve(null),
			ontimeout: () => resolve(null),
		});
	});
}

// Wrap the user's current text selection (if any) into a "> "-prefixed
// block, suitable for prepending to a reply textarea.
function quoteSelection() {
	const text = window.getSelection().toString().trim();
	if (!text) return "";
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => `> ${line}`)
		.join("\n\n");
}

function isClickModified(event) {
	return (
		event.button !== 0 ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.altKey
	);
}

function attachActionLink(link, replyDiv, state) {
	const originalText = link.textContent;

	link.addEventListener("click", async (event) => {
		// Modified clicks (cmd/ctrl/middle/shift) keep their default
		// behaviour — opening in a new tab is still useful.
		if (isClickModified(event)) return;
		event.preventDefault();

		const quoted = quoteSelection();

		// If a form is currently open from any action on this comment,
		// remove it. If the same button was clicked, that's the toggle-
		// off path; if a different button, fall through after removal
		// to fetch the new form.
		if (state.activeForm) {
			state.activeForm.remove();
			state.activeForm = null;
			if (state.activeButton) {
				state.activeButton.textContent = state.activeButton.dataset.hnOriginal;
				state.activeButton.dataset.hnOriginal = "";
			}
			const wasSameButton = state.activeButton === link;
			state.activeButton = null;
			if (wasSameButton) return;
		}

		// Visual cue while the fetch is in flight.
		const loader = h("span", {
			class: "hn-reply-loader",
			text: " (loading…)",
		});
		link.after(loader);

		const dom = await fetchPageDom(link.href);
		loader.remove();
		if (!dom) {
			alert(
				"Couldn't load the form for that action. Try clicking the link directly to navigate to the page.",
			);
			return;
		}
		const form = dom.querySelector("form");
		if (!form) {
			alert(
				"The fetched page didn't contain a form. Try clicking the link directly.",
			);
			return;
		}
		form.classList.add("hn-injected-form");

		state.activeForm = form;
		state.activeButton = link;
		link.dataset.hnOriginal = originalText;
		link.textContent = `hide ${originalText}`;
		replyDiv.append(form);

		const textarea = form.querySelector("textarea");
		if (textarea) {
			if (quoted.length > 0) {
				textarea.value = `${textarea.value ? `${textarea.value}\n\n` : ""}${quoted}\n\n`;
			}
			textarea.focus();
		}
	});
}
function setupReplyInline() {
	for (const comment of document.querySelectorAll("tr.comtr")) {
		const replyDiv = comment.querySelector("div.reply");
		if (!replyDiv) continue;

		// Per-comment shared state across the action buttons so opening
		// one form auto-closes another on the same comment.
		const state = { activeForm: null, activeButton: null };

		for (const action of ["reply", "edit", "delete-confirm"]) {
			const link = comment.querySelector(`a[href^="${action}"]`);
			if (link) attachActionLink(link, replyDiv, state);
		}
	}
}


// ===== src/features/user-render.js =====

// Per-user inline UI on item pages: account info blurb, rating controls,
// editable tag list, plus the rerender-by-user fan-out used after any
// store write so all comments by the same author stay in sync.




// Pastel HSL. The lightness floor (75%) guarantees black text is always the
// high-contrast choice, so we don't need a luminance calculator.
function randomPastelColor() {
	const r = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1) + lo);
	return `hsl(${r(0, 359)}, ${r(30, 100)}%, ${r(75, 95)}%)`;
}

// Factory. Wiring done in main.js:
//   - `store` is the consolidated store from src/state.js
//   - `fetchUser` is from src/api.js
//   - `openTagManager` is the overlay opener from src/features/tag-manager.js
//     (passed as a getter so it can refer to a forward-declared variable).
function createUserRender({ store, fetchUser, openTagManager }) {
	function ensureTagColor(tagName) {
		const existing = store.getTagColor(tagName);
		if (existing?.bgColor) return existing;
		const color = { bgColor: randomPastelColor(), textColor: "black" };
		store.setTagColor(tagName, color);
		return color;
	}

	function renderRatingControls(username) {
		const display = h("span", {
			class: "hn-rating-display",
			text: String(store.getRating(username)),
		});
		display.dataset.hnUser = username;
		const mkBtn = (glyph, delta) =>
			h("button", {
				class: "hn-rating-btn",
				text: glyph,
				tabIndex: -1,
				onclick: (e) => {
					e.preventDefault();
					e.currentTarget.blur();
					const next = store.getRating(username) + delta;
					store.setRating(username, next);
					rerenderUserRatings(username);
				},
			});
		return h("span", { class: "hn-rating-container" }, [
			mkBtn("▲", 1),
			mkBtn("▼", -1),
			display,
		]);
	}

	// Renders the tag list for a user into `container` (clearing first). Called
	// on initial render and after any tag edit/remove so we don't need a full
	// page reload.
	function renderTagGroup(username, container) {
		container.replaceChildren();
		for (const tag of store.getUserTags(username)) {
			container.appendChild(renderTagSpan(username, tag));
		}
	}

	// Re-renders tag groups and updates tag inputs for every instance of a
	// user on the page. Called after any tag mutation so all comments by the
	// same author stay in sync.
	function rerenderUserTags(username) {
		const esc = CSS.escape(username);
		for (const group of document.querySelectorAll(
			`.hn-tag-group[data-hn-user="${esc}"]`,
		)) {
			renderTagGroup(username, group);
		}
		const names = store.getUserTags(username).map((t) => t.value);
		for (const input of document.querySelectorAll(
			`.hn-tag-input[data-hn-user="${esc}"]`,
		)) {
			input.value = names.join(", ");
		}
	}

	function rerenderUserRatings(username) {
		const esc = CSS.escape(username);
		const rating = store.getRating(username);
		const text = String(rating);
		for (const rd of document.querySelectorAll(
			`.hn-rating-display[data-hn-user="${esc}"]`,
		)) {
			rd.textContent = text;
		}
		const collapse = shouldAutoCollapseAuthor(
			rating,
			LOW_SCORE_COLLAPSE_THRESHOLD,
		);
		for (const row of document.querySelectorAll(
			`tr.comtr[data-hn-author="${esc}"]`,
		)) {
			row.classList.toggle("hn-low-score", collapse);
			// Any rating change resets the manual-expand state so the row
			// snaps back to the canonical collapsed/expanded shape derived
			// from the new rating.
			row.classList.remove("hn-low-score-expanded");
			// Keep the [low score] marker in sync with the collapse class —
			// a comhead with a "[low score]" tag but a fully-visible body
			// would be misleading, and a freshly-collapsed row that never
			// had the marker (because it was added to the rating below the
			// threshold mid-session) needs one now.
			const head = row.querySelector("span.comhead");
			if (!head) continue;
			const existing = head.querySelector(".hn-low-score-tag");
			if (collapse && !existing) {
				head.append(
					h("span", { class: "hn-low-score-tag", text: "[low score]" }),
				);
			} else if (!collapse && existing) {
				existing.remove();
			}
		}
	}

	function renderTagSpan(username, tag) {
		const editIcon = h("span", {
			class: "hn-tag-icon",
			title: "Edit tag",
			text: "✏️", // pencil
			onclick: (e) => {
				e.stopPropagation();
				const raw = prompt("Edit tag name:", tag.value);
				const newName = raw ? raw.trim() : "";
				if (!newName || newName === tag.value) return;
				const current = store.getUserTags(username);
				const color = ensureTagColor(newName);
				const updated = current.map((t) =>
					t.value === tag.value
						? {
								value: newName,
								bgColor: color.bgColor,
								textColor: color.textColor,
							}
						: t,
				);
				store.setUserTags(username, updated);
				rerenderUserTags(username);
			},
		});
		const removeIcon = h("span", {
			class: "hn-tag-icon",
			title: "Remove tag",
			text: "✖", // x
			onclick: (e) => {
				e.stopPropagation();
				if (!confirm(`Remove tag "${tag.value}"?`)) return;
				const current = store.getUserTags(username);
				store.setUserTags(
					username,
					current.filter((t) => t.value !== tag.value),
				);
				rerenderUserTags(username);
			},
		});

		const manageIcon = h("span", {
			class: "hn-tag-icon",
			title: "Manage all tags",
			text: "☰", // hamburger
			onclick: (e) => {
				e.stopPropagation();
				openTagManager();
			},
		});

		const span = h("div", { class: "hn-tag" }, [
			h("span", { class: "hn-tag-text", text: tag.value }),
			h("div", { class: "hn-tag-icons" }, [editIcon, manageIcon, removeIcon]),
		]);
		span.style.backgroundColor = tag.bgColor || "";
		span.style.color = tag.textColor || "black";
		return span;
	}

	function renderTagInput(username) {
		const currentNames = store.getUserTags(username).map((t) => t.value);
		const input = h("input", {
			type: "text",
			class: "hn-tag-input",
			value: currentNames.join(", "),
			placeholder: "Add tags (comma separated)",
		});
		input.dataset.hnUser = username;

		// Keystrokes update a live preview only; the store is written on blur
		// or Enter. Writing per-keystroke was persisting every partial string
		// the user typed (e.g. "Are" -> "Areg" -> "Argen" -> "Argentinian"
		// all ended up as distinct saved tags), which polluted both the
		// user's tag list and the shared colors map.
		const previewColors = new Map();
		const previewColorFor = (name) => {
			const real = store.getTagColor(name);
			if (real?.bgColor) return real;
			if (previewColors.has(name)) return previewColors.get(name);
			const color = { bgColor: randomPastelColor(), textColor: "black" };
			previewColors.set(name, color);
			return color;
		};

		const parseNames = () => parseTagInput(input.value);

		const renderPreview = () => {
			const esc = CSS.escape(username);
			const names = parseNames();
			for (const group of document.querySelectorAll(
				`.hn-tag-group[data-hn-user="${esc}"]`,
			)) {
				group.replaceChildren();
				for (const name of names) {
					const color = previewColorFor(name);
					group.appendChild(
						renderTagSpan(username, {
							value: name,
							bgColor: color.bgColor,
							textColor: color.textColor,
						}),
					);
				}
			}
		};

		const commit = () => {
			const names = parseNames();
			const updated = names.map((name) => {
				const color = ensureTagColor(name);
				return {
					value: name,
					bgColor: color.bgColor,
					textColor: color.textColor,
				};
			});
			store.setUserTags(username, updated);
			rerenderUserTags(username);
			previewColors.clear();
		};

		input.addEventListener("input", renderPreview);
		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			input.blur(); // triggers commit via the blur listener
		});
		return input;
	}

	function renderAccountInfo(created, karma) {
		const now = Math.floor(Date.now() / 1000);
		return h("span", {
			class: "hn-info",
			text: `(${timeSince(created, now)} old, ${karma} karma)`,
		});
	}

	// Skeleton-first: every row is built and inserted synchronously from the
	// store. The age/karma blurb gets filled in as each fetch resolves, so a
	// slow or hung request can't block the rest of the page.
	function renderAllUsernames() {
		const usernameElements = Array.from(document.querySelectorAll(".hnuser"));
		// The OP's username appears in .fatitem above the comments and again
		// on every comment they author within the thread. Reading it once
		// here lets us tag every comment-row authorship below as [op] without
		// also marking the fatitem's own hnuser (which is redundantly the OP
		// — we already know they posted the item).
		const itemAuthor =
			document.querySelector(".fatitem .hnuser")?.textContent || null;

		for (const usernameEl of usernameElements) {
			const username = usernameEl.textContent;
			const parent = findCommentParent(usernameEl);
			if (!parent) continue;

			const tagGroup = h("div", { class: "hn-tag-group" });
			tagGroup.dataset.hnUser = username;
			renderTagGroup(username, tagGroup);

			const usernameClone = usernameEl.cloneNode(true);
			usernameClone.className = `${usernameClone.className} hn-username`.trim();

			const isCommentAuthor = !!usernameEl.closest("tr.comtr");
			if (isCommentAuthor && itemAuthor && username === itemAuthor) {
				usernameClone.classList.add("hn-op");
				usernameClone.appendChild(document.createTextNode(" [op]"));
			}

			const infoSlot = h("span", {
				class: "hn-info hn-info-pending",
				text: "(loading…)",
			});

			const mainRow = h("div", { class: "hn-main-row" }, [
				usernameClone,
				infoSlot,
				renderRatingControls(username),
				renderTagInput(username),
			]);
			const tagContainer = h("div", { class: "hn-tag-container" }, [tagGroup]);
			const layout = h("div", { class: "hn-post-layout" }, [
				mainRow,
				tagContainer,
			]);

			parent.parentNode.insertBefore(layout, parent.nextSibling);
			usernameEl.style.display = "none";

			// Populate the info slot asynchronously. Cached users resolve on the
			// microtask queue (effectively synchronous). Failed or timed-out
			// fetches remove the slot rather than leaving a "loading…" ghost.
			fetchUser(username).then((data) => {
				if (data) {
					infoSlot.replaceWith(renderAccountInfo(data.created, data.karma));
				} else {
					infoSlot.remove();
				}
			});
		}
	}

	return {
		renderAllUsernames,
		rerenderUserTags,
		rerenderUserRatings,
	};
}


// ===== src/features/watch-toggles.js =====

// Per-comment "watch for replies" toggle. Runs after
// userRender.renderAllUsernames() (which produces the .hn-main-row
// layout this pass inserts into).
//
// Click semantics:
//   off -> on : apply .hn-watched class + .hn-watching to the icon
//               immediately (visual response is synchronous), fire a
//               fresh fetchItem to capture the comment's current kids,
//               and persist the watch entry.
//   on  -> off: remove .hn-watched / .hn-watching, delete the store
//               entry. Any in-flight initial fetch is dropped on
//               resolve (we re-check before writing).
//
// Page-load semantics: for every watched comment whose id is present
// on this page, mark the row, fire a throttle-aware fresh fetchItem
// and on resolve sync both latestKids and seenKids to the response.
// This is the "visit clears new" step.




const ICON_OFF = "👁";
const ICON_ON = "👁‍🗨";

function setIconState(iconEl, isOn) {
	iconEl.textContent = isOn ? ICON_ON : ICON_OFF;
	iconEl.title = isOn ? "Stop watching" : "Watch for replies";
	iconEl.classList.toggle("hn-watching", isOn);
}
function setupWatchToggles({ store, fetchItem }) {
	if (!isItemPage()) return;
	const itemId = getItemPageId();
	if (!itemId) return;

	// Prune watches past the TTL on every item-page load — same
	// pattern that highlight-unread-comments uses for read-comment
	// entries, so the watch list can't grow without bound.
	store.pruneWatchedComments(Date.now(), WATCH_TTL_MS);

	const rows = Array.from(document.querySelectorAll("tr.comtr"));

	for (const row of rows) {
		const commentId = row.id;
		if (!commentId) continue;

		const mainRow = row.querySelector(".hn-main-row");
		if (!mainRow) continue;

		const tagInput = mainRow.querySelector(".hn-tag-input");
		// Skip any .hn-main-row that user-render didn't fully populate.
		if (!tagInput || !mainRow.querySelector(".hn-rating-container")) continue;

		const initiallyWatched = store.getWatchedComment(commentId) !== null;

		const icon = h("span", { class: "hn-watch-icon" });
		icon.dataset.hnComment = commentId;
		setIconState(icon, initiallyWatched);

		icon.addEventListener("click", () => {
			// The icon's CSS class is the source of truth for "is this
			// currently watched", because the store-write on toggle-on
			// is async (it waits for fetchItem). Reading the store
			// directly here would let a fast double-click while the
			// initial fetch is in flight register two toggle-ON clicks.
			const wasWatched = icon.classList.contains("hn-watching");
			if (wasWatched) {
				store.removeWatchedComment(commentId);
				row.classList.remove("hn-watched");
				setIconState(icon, false);
				return;
			}
			// Toggle ON: visual response immediately, persist after fetch.
			row.classList.add("hn-watched");
			setIconState(icon, true);
			fetchItem(commentId, { fresh: true }).then((digest) => {
				// User may have toggled off before the fetch resolved.
				// The icon's class state is the user's latest intent;
				// only persist if they still want to be watching.
				if (!icon.classList.contains("hn-watching")) return;
				const kids = digest?.kids || [];
				const now = Date.now();
				store.setWatchedComment(commentId, {
					itemId,
					seenKids: kids.slice(),
					latestKids: kids.slice(),
					lastCheckedAt: now,
					addedAt: now,
				});
			});
		});

		// Insert between the rating container and the tag input.
		mainRow.insertBefore(icon, tagInput);

		// If watched, mark the row immediately on page load.
		if (initiallyWatched) {
			row.classList.add("hn-watched");
		}
	}

	// Page-load sync: for every watched comment present on this page,
	// fire a throttle-aware fresh fetchItem; on resolve, update
	// latestKids and seenKids in lockstep.
	const watches = store.getWatchedComments();
	const now = Date.now();
	for (const [commentId, entry] of Object.entries(watches)) {
		if (entry.itemId !== itemId) continue;
		if (!document.getElementById(commentId)) continue;
		if (!isWatchCheckStale(entry, now, WATCH_RECHECK_THROTTLE_MS)) {
			// Fresh enough — still acknowledge the current latestKids
			// (the user has visited the page).
			store.markWatchSeen(commentId, now);
			continue;
		}
		fetchItem(commentId, { fresh: true }).then((digest) => {
			if (store.getWatchedComment(commentId) === null) return; // toggled off mid-flight
			const kids = digest?.kids || [];
			const resolveNow = Date.now();
			store.updateWatchKids(commentId, kids, resolveNow);
			store.markWatchSeen(commentId, resolveNow);
		});
	}
}


// ===== src/features/watched-comment-nav.js =====

// Toolbar prev/next-watched-comment navigation. Runs after
// toolbar.mount() on item pages. Adds two buttons to the toolbar's
// button container when at least one watched comment WITH new replies
// is present on this page; otherwise mounts nothing — the nav exists
// to surface activity, so a watched comment with no new replies is
// not a useful target.
//
// "Current position" is tracked as a closure-local index into the
// list of watched-comment rows, in document order. Initial value -1
// means "before any" — the first click on `watch ↓` jumps to the
// first watched comment. Disabled state is recomputed after every
// click so a single-watch thread can never click `↑ watch`.
function setupWatchedCommentNav({ store, toolbar }) {
	if (!isItemPage()) return;
	const itemId = getItemPageId();
	if (!itemId) return;

	// Resolve every on-page row for a watch in this thread that has
	// new replies, in DOM order. Watches whose comment id isn't on this
	// page (e.g. on a later "more" page) are dropped, and watches with
	// no new replies are dropped — the nav targets only "show me
	// what's new" comments.
	const watches = store.getWatchedComments();
	const rows = [];
	for (const [commentId, entry] of Object.entries(watches)) {
		if (entry.itemId !== itemId) continue;
		if (!watchHasNewReplies(entry.seenKids, entry.latestKids)) continue;
		const row = document.getElementById(commentId);
		if (row) rows.push(row);
	}
	if (rows.length === 0) return;
	// Sort by document order. compareDocumentPosition returns a
	// bitmask; FOLLOWING (4) means `b` comes after `a`.
	rows.sort((a, b) =>
		a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
	);

	const buttons = toolbar.getButtonsContainer();
	if (!buttons) return;

	let currentIndex = -1;

	const prevBtn = h("button", {
		class: "hn-toolbar-btn hn-watch-nav hn-watch-nav-prev",
		text: "↑ watch",
	});
	const nextBtn = h("button", {
		class: "hn-toolbar-btn hn-watch-nav hn-watch-nav-next",
		text: "watch ↓",
	});

	function updateDisabled() {
		// prev disabled when at or before the first
		prevBtn.disabled = currentIndex <= 0;
		// next disabled when at the last
		nextBtn.disabled = currentIndex >= rows.length - 1;
	}

	prevBtn.addEventListener("click", () => {
		if (currentIndex <= 0) return;
		currentIndex -= 1;
		rows[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
		updateDisabled();
	});
	nextBtn.addEventListener("click", () => {
		if (currentIndex >= rows.length - 1) return;
		currentIndex += 1;
		rows[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
		updateDisabled();
	});

	buttons.appendChild(prevBtn);
	buttons.appendChild(nextBtn);
	updateDisabled();
}


// ===== src/features/watched-listing-highlights.js =====

// Listing-page pass: for any story row in the listing table whose
// item has at least one watched comment, kick off a stale-aware fresh
// fetchItem recheck on each watch and, when any has new replies,
// restyle the story's "n comments" link with .hn-watched-link. The
// star ★ prefix is injected via the CSS ::before rule, not inline.
//
// Runs unconditionally; gates internally on getStoryListTable()
// (matches setupSortStories' approach so the call site in main.js
// stays simple).




// Find the "n comments" link for a story row. HN renders each story
// as <tr class="athing"> followed by a subtext <tr> on the next
// sibling; the comments link is the last <a href="item?id=..."> in
// the subtext (ahead of it sits "by user", "n hours ago", "hide", "past").
function findCommentsLink(athingRow) {
	const subtext = athingRow.nextElementSibling;
	if (!subtext) return null;
	const links = subtext.querySelectorAll('a[href^="item?id="]');
	return links[links.length - 1] || null;
}
function setupWatchedListingHighlights({ store, fetchItem }) {
	const table = getStoryListTable();
	if (!table) return;

	const grouped = watchesByItemId(store.getWatchedComments());
	if (Object.keys(grouped).length === 0) return;

	const now = Date.now();
	const watches = store.getWatchedComments();

	for (const athing of table.querySelectorAll("tr.athing")) {
		const itemId = athing.id;
		const group = grouped[itemId];
		if (!group) continue;
		const link = findCommentsLink(athing);
		if (!link) continue;

		// Synchronous: if any watch in this group already has hasNew
		// from a previous session's API check, mark immediately.
		if (group.some((g) => g.hasNew)) {
			link.classList.add("hn-watched-link");
		}

		// Stale-aware async recheck. Each fetch resolves independently;
		// after each, recompute hasNew across the group and either
		// add or remove the class.
		for (const { commentId } of group) {
			const entry = watches[commentId];
			if (!entry) continue;
			if (!isWatchCheckStale(entry, now, WATCH_RECHECK_THROTTLE_MS)) continue;
			fetchItem(commentId, { fresh: true }).then((digest) => {
				if (digest) {
					store.updateWatchKids(commentId, digest.kids || [], Date.now());
				}
				// Re-evaluate the group after each resolve so the
				// highlight reflects the latest server view.
				const updated =
					watchesByItemId(store.getWatchedComments())[itemId] || [];
				if (updated.some((g) => g.hasNew)) {
					link.classList.add("hn-watched-link");
				} else {
					link.classList.remove("hn-watched-link");
				}
			});
		}
	}
}


// ===== src/features/tag-manager.js =====

// Single-instance tag-management overlay. The overlay holds a draft
// snapshot of {tags, colors}; edits mutate the draft via pure helpers,
// and Save writes the draft back atomically.



function isDraftDirty(liveSnapshot, draft) {
	return (
		JSON.stringify(liveSnapshot.tags || {}) !== JSON.stringify(draft.tags) ||
		JSON.stringify(liveSnapshot.colors || {}) !== JSON.stringify(draft.colors)
	);
}

// Factory. `rerenderUserTags(username)` is invoked after a successful Save
// for every user visible on the page so their inline tag pills refresh.
//
// Returns:
//   open()       - opens the overlay (no-op if already open)
//   getActive()  - returns the active overlay handle (with markStale())
//                  while open, null otherwise. Used by the cross-tab
//                  listener in main.js to flag a remote write while the
//                  overlay is mid-edit.
function createTagManager({ store, rerenderUserTags }) {
	let tagManagerOpen = false;
	let activeTagManager = null;

	function open() {
		if (tagManagerOpen) return;
		tagManagerOpen = true;

		const live = store._snapshot();
		const draft = {
			tags: JSON.parse(JSON.stringify(live.tags || {})),
			colors: JSON.parse(JSON.stringify(live.colors || {})),
		};

		// Per-row state keyed by the tag name as it existed when the overlay
		// opened. Undo on a row reverts that row's changes only.
		const rows = new Map(); // originalName -> { currentName, pendingRemoval }
		const allNames = new Set([
			...Object.keys(live.colors || {}),
			...Object.values(live.tags || {}).flat(),
		]);
		for (const name of allNames) {
			rows.set(name, { currentName: name, pendingRemoval: false });
		}

		let filter = "";
		let sortMode = "name"; // "name" | "count"
		let isStale = false;

		const catcher = h("div", { class: "hn-tagmgr-catcher" });
		const overlay = h("div", { class: "hn-tagmgr-overlay" });
		document.body.appendChild(catcher);
		document.body.appendChild(overlay);

		activeTagManager = {
			markStale() {
				if (isStale) return;
				isStale = true;
				renderOverlay();
			},
		};

		function closeTagManager({ commit }) {
			if (commit) {
				if (isDraftDirty(live, draft)) {
					if (isStale) {
						alert(
							"Tags changed in another tab while this overlay was open. Close and reopen before saving so you do not overwrite newer data.",
						);
						return;
					}
					store.replaceTagsAndColors(draft.tags, draft.colors);
					store._invalidate();
					const visibleUsers = new Set();
					for (const el of document.querySelectorAll("[data-hn-user]")) {
						visibleUsers.add(el.dataset.hnUser);
					}
					for (const username of visibleUsers) rerenderUserTags(username);
				}
			}
			document.removeEventListener("keydown", onKeyDown);
			catcher.remove();
			overlay.remove();
			tagManagerOpen = false;
			activeTagManager = null;
		}

		function confirmDiscardIfDirty() {
			if (!isDraftDirty(live, draft)) return true;
			return confirm("Discard unsaved tag changes?");
		}

		function onKeyDown(e) {
			if (e.key !== "Escape") return;
			// If focus is inside a rename input, let the row handle its own
			// Escape (cancels the field, doesn't close the overlay).
			const active = document.activeElement;
			if (active?.classList.contains("hn-tagmgr-name-input")) return;
			e.preventDefault();
			if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
		}
		document.addEventListener("keydown", onKeyDown);

		catcher.addEventListener("click", () => {
			if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
		});

		// Footer (Save / Cancel) wired immediately; list + controls wired by
		// later tasks via renderOverlay().
		const saveBtn = h("button", {
			class: "hn-tagmgr-btn primary",
			text: "Save",
			onclick: () => closeTagManager({ commit: true }),
		});
		const cancelBtn = h("button", {
			class: "hn-tagmgr-btn",
			text: "Cancel",
			onclick: () => {
				if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
			},
		});
		const footer = h("div", { class: "hn-tagmgr-footer" }, [
			cancelBtn,
			saveBtn,
		]);

		const list = h("div", { class: "hn-tagmgr-list" });

		const filterInput = h("input", {
			type: "text",
			class: "hn-tagmgr-filter",
			placeholder: "Filter tags…",
		});
		filterInput.addEventListener("input", () => {
			filter = filterInput.value;
			renderOverlay();
		});

		const sortNameBtn = h("button", {
			class: "hn-tagmgr-sort-btn active",
			text: "Name (A→Z)",
			onclick: () => {
				sortMode = "name";
				renderOverlay();
			},
		});
		const sortCountBtn = h("button", {
			class: "hn-tagmgr-sort-btn",
			text: "Uses (0 first)",
			onclick: () => {
				sortMode = "count";
				renderOverlay();
			},
		});

		const controls = h("div", { class: "hn-tagmgr-controls" }, [
			filterInput,
			h("div", { class: "hn-tagmgr-sort" }, [sortNameBtn, sortCountBtn]),
		]);

		const headerCount = h("span", { class: "hn-tagmgr-header-count" });
		overlay.appendChild(
			h("div", { class: "hn-tagmgr-header" }, [
				h("span", { text: "Manage tags" }),
				headerCount,
			]),
		);
		overlay.appendChild(controls);
		overlay.appendChild(list);
		overlay.appendChild(footer);

		// Derive the draft from the rows map each time. Each row in `rows`
		// carries its originalName (the map key) and its current edited form;
		// pure helpers stitch the final shape together.
		function computeDraft() {
			let d = {
				tags: JSON.parse(JSON.stringify(live.tags || {})),
				colors: JSON.parse(JSON.stringify(live.colors || {})),
				schemaVersion: 1,
				ratings: live.ratings || {},
				cache: live.cache || {},
			};
			for (const [originalName, row] of rows) {
				if (row.pendingRemoval) {
					d = removeTagInState(d, originalName);
				} else if (row.currentName !== originalName) {
					d = renameTagInState(d, originalName, row.currentName);
				}
			}
			return d;
		}

		function renderOverlay() {
			const computed = computeDraft();
			draft.tags = computed.tags;
			draft.colors = computed.colors;

			const counts = countsFromState(computed);
			const needle = filter.trim().toLowerCase();

			const entries = [...rows.entries()]
				.map(([originalName, row]) => {
					const displayName = row.pendingRemoval
						? originalName
						: row.currentName;
					const count = row.pendingRemoval ? 0 : counts[row.currentName] || 0;
					const color =
						computed.colors[row.currentName] ||
						live.colors[originalName] ||
						null;
					return { originalName, row, displayName, count, color };
				})
				.filter(({ displayName }) =>
					needle === "" ? true : displayName.toLowerCase().includes(needle),
				);

			entries.sort((a, b) => {
				if (sortMode === "count") {
					if (a.count !== b.count) return a.count - b.count;
				}
				return a.displayName
					.toLowerCase()
					.localeCompare(b.displayName.toLowerCase());
			});

			sortNameBtn.classList.toggle("active", sortMode === "name");
			sortCountBtn.classList.toggle("active", sortMode === "count");
			headerCount.textContent = isStale
				? `${rows.size} tags • changed in another tab`
				: `${rows.size} tags`;
			saveBtn.disabled = isStale;
			saveBtn.title = isStale
				? "Close and reopen the tag manager before saving."
				: "";

			list.replaceChildren();
			for (const entry of entries) {
				list.appendChild(buildRow(entry));
			}
		}

		function buildRow({ originalName, row, displayName, count, color }) {
			const dirty = row.pendingRemoval || row.currentName !== originalName;
			const rowEl = h("div", {
				class: [
					"hn-tagmgr-row",
					dirty ? "dirty" : "",
					row.pendingRemoval ? "removed" : "",
				]
					.filter(Boolean)
					.join(" "),
			});

			const swatch = h("span", { class: "hn-tagmgr-swatch" });
			if (color?.bgColor) swatch.style.backgroundColor = color.bgColor;

			const nameEl = h("span", {
				class: "hn-tagmgr-name",
				text: displayName,
			});
			if (color?.bgColor) nameEl.style.backgroundColor = color.bgColor;
			if (color?.textColor) nameEl.style.color = color.textColor;

			const countEl = h("span", {
				class: `hn-tagmgr-count${count === 0 ? " zero" : ""}`,
				text: String(count),
			});

			const icons = h("div", { class: "hn-tagmgr-icons" });
			const editIcon = h("span", {
				class: "hn-tagmgr-icon",
				title: "Rename tag",
				text: "✏️", // pencil
				onclick: () => {
					// Swap name span for an input; Enter/blur commits, Escape
					// cancels the field (does not close the overlay).
					const input = h("input", {
						type: "text",
						class: "hn-tagmgr-name-input",
						value: row.currentName,
					});
					nameEl.replaceWith(input);
					input.focus();
					input.select();

					const commit = () => {
						const proposed = input.value.trim();
						if (!proposed || proposed === row.currentName) {
							renderOverlay();
							return;
						}
						// Collision check: does another row currently carry `proposed`?
						const collidesWith = [...rows.entries()].find(
							([orig, r]) =>
								orig !== originalName &&
								!r.pendingRemoval &&
								r.currentName === proposed,
						);
						if (collidesWith) {
							const srcCount =
								countsFromState(computeDraft())[row.currentName] || 0;
							if (
								!confirm(
									`Merge "${row.currentName}" into "${proposed}"? ${srcCount} user${srcCount === 1 ? "" : "s"} will be updated.`,
								)
							) {
								renderOverlay();
								return;
							}
							// Rename the source row into the destination so
							// computeDraft() applies renameTagInState on save
							// (which handles the merge). Drop the destination
							// row so the overlay doesn't show two identical
							// entries for the now-merged tag.
							row.currentName = proposed;
							rows.delete(collidesWith[0]);
						} else {
							row.currentName = proposed;
						}
						renderOverlay();
					};

					let cancelled = false;
					input.addEventListener("keydown", (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							cancelled = true;
							renderOverlay();
						}
					});
					input.addEventListener("blur", () => {
						if (cancelled) return;
						commit();
					});
				},
			});
			icons.appendChild(editIcon);

			if (dirty) {
				const undoIcon = h("span", {
					class: "hn-tagmgr-icon",
					title: "Undo changes to this row",
					text: "↩", // hook arrow
					onclick: () => {
						row.currentName = originalName;
						row.pendingRemoval = false;
						renderOverlay();
					},
				});
				icons.appendChild(undoIcon);
			}

			const removeIcon = h("span", {
				class: "hn-tagmgr-icon",
				title: row.pendingRemoval ? "Keep tag" : "Remove tag",
				text: "✖", // x
				onclick: () => {
					row.pendingRemoval = !row.pendingRemoval;
					renderOverlay();
				},
			});
			icons.appendChild(removeIcon);

			rowEl.appendChild(swatch);
			rowEl.appendChild(nameEl);
			rowEl.appendChild(countEl);
			rowEl.appendChild(icons);
			return rowEl;
		}

		renderOverlay();
		filterInput.focus();
	}

	return {
		open,
		getActive: () => activeTagManager,
	};
}


// ===== src/features/toolbar.js =====

// Floating toolbar with Save state / Restore state buttons. Mounted on
// item pages.
function createToolbar({ store, backend }) {
	let buttonsContainer = null;

	function exportState() {
		const data = stateToExport(store._snapshot());
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = h("a", {
			href: url,
			download: `hn-user-data-${new Date().toISOString().split("T")[0]}.json`,
		});
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			a.remove();
			URL.revokeObjectURL(url);
		}, 100);
	}

	function importState() {
		const input = h("input", { type: "file", accept: ".json" });
		input.addEventListener("change", (event) => {
			const file = event.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const raw = JSON.parse(e.target.result);
					const parsed = parseImport(raw);
					// Write the consolidated blob directly and reload so the page
					// rebuilds from a fresh store.
					backend.set(STATE_KEY, JSON.stringify(parsed));
					alert("Data imported successfully! The page will now reload.");
					location.reload();
				} catch (error) {
					alert(`Error importing data: ${error.message}`);
					console.error("Error importing data:", error);
				}
			};
			reader.readAsText(file);
		});
		input.click();
	}

	function mount() {
		const dragHandle = h("div", { class: "hn-drag-handle" });
		buttonsContainer = h("div", { class: "hn-toolbar-buttons" }, [
			h("button", {
				class: "hn-toolbar-btn",
				text: "Save state",
				onclick: exportState,
			}),
			h("button", {
				class: "hn-toolbar-btn",
				text: "Restore state",
				onclick: importState,
			}),
		]);
		const toolbar = h("div", { class: "hn-toolbar" }, [
			dragHandle,
			buttonsContainer,
		]);
		document.body.appendChild(toolbar);

		// Drag listeners live only for the duration of a drag, rather than
		// sitting on document forever.
		dragHandle.addEventListener("mousedown", (e) => {
			const rect = toolbar.getBoundingClientRect();
			const offsetX = e.clientX - rect.left;
			const offsetY = e.clientY - rect.top;
			e.preventDefault();

			const onMove = (ev) => {
				toolbar.style.left = `${ev.clientX - offsetX}px`;
				toolbar.style.top = `${ev.clientY - offsetY}px`;
				toolbar.style.right = "auto";
			};
			const onUp = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
			};
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});
	}

	// Returns the buttons container after mount() runs, or null before.
	// External features (e.g. watched-comment-nav) use it to append
	// their own toolbar buttons without knowing the toolbar's internals.
	function getButtonsContainer() {
		return buttonsContainer;
	}

	return { mount, getButtonsContainer };
}


// ===== src/main.js =====

// Browser-side bootstrap. The build script wraps this (and every module
// imported above it) in a single IIFE inside the userscript bundle, so
// everything below runs once on load inside the userscript runtime.



























GM_addStyle(STYLES);

// Adapter from GM_* to the {get, set, list} interface the store and
// migration expect.
const backend = {
	get: (key) => GM_getValue(key, undefined),
	set: (key, value) => GM_setValue(key, value),
	list: () => (typeof GM_listValues === "function" ? GM_listValues() : []),
};

migrateLegacyKeys(backend);
const store = createStore(backend);
const { fetchUser, fetchItem } = createApi({ store });
const hoverPopup = createHoverPopup();

// Tag manager and user-render reference each other; both bindings exist by
// the time either's stored callback runs (on a click), so the closures
// resolve fine despite the forward reference.
const tagManager = createTagManager({
	store,
	rerenderUserTags: (username) => userRender.rerenderUserTags(username),
});
const userRender = createUserRender({
	store,
	fetchUser,
	openTagManager: () => tagManager.open(),
});
const toolbar = createToolbar({ store, backend });

// Sync state from other tabs. GM_addValueChangeListener fires whenever
// another tab writes to the same GM storage key. We invalidate the
// in-memory cache and re-render every user visible on this page.
if (typeof GM_addValueChangeListener === "function") {
	GM_addValueChangeListener(STATE_KEY, (_name, _oldVal, _newVal, remote) => {
		if (!remote) return;
		tagManager.getActive()?.markStale();
		store._invalidate();
		const usernames = new Set();
		for (const el of document.querySelectorAll("[data-hn-user]")) {
			usernames.add(el.dataset.hnUser);
		}
		for (const username of usernames) {
			userRender.rerenderUserTags(username);
			userRender.rerenderUserRatings(username);
		}
	});
}

applyDownvotedClass();
transformQuotes();
// Linkify and sort-stories are page-gated internally (linkify by
// pathname, sort by listing-table presence), so call unconditionally.
setupLinkifyUserAbout();
setupSortStories();
setupWatchedListingHighlights({ store, fetchItem });

if (isItemPage()) {
	setupCommentBoxToggle();
	setupClickIndentToggle();
	setupCollapseRootComment();
	transformBackticksToMonospace();
	setupToggleAllComments();
	setupHighlightUnreadComments({ store });
	userRender.renderAllUsernames();
	setupAutoCollapseLowScore({ store });
	setupWatchToggles({ store, fetchItem });
	setupItemInfoHover({ fetchItem, popup: hoverPopup });
	setupParentHover({ fetchItem, popup: hoverPopup });
	setupReplyInline();
	toolbar.mount();
	setupWatchedCommentNav({ store, toolbar });
}

// User-info hover wires every .hnuser on every page (except /user
// itself, which the feature checks internally). Must run AFTER
// renderAllUsernames on item pages: that pass hides each original
// .hnuser and inserts a visible clone, so the hover handler has to
// land on the clone.
setupUserInfoHover({ fetchUser, popup: hoverPopup });


})();

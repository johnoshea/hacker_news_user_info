// Single backend key holding all user-visible state. Consolidating everything
// here means exports are one JSON.stringify and imports are one assignment,
// and it eliminates the legacy prefix-scan over GM_listValues.
export const STATE_KEY = "hn_state";
export const STATE_SCHEMA_VERSION = 1;

// Pre-0.4 storage layout. Migration reads these on first run; after that the
// keys are left in place for one version as a rollback safety net.
export const LEGACY_RATING_PREFIX = "hn_author_rating_";
export const LEGACY_TAGS_PREFIX = "hn_custom_tags_";
export const LEGACY_COLOR_PREFIX = "hn_custom_tag_color_";

// How long a cached {created, karma} pair is considered fresh. Karma drifts
// slowly; 6h means a repeat-visitor sees a fully-rendered page with zero
// network requests for users they've already seen today.
export const USER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Per-request ceiling. Without it, GM_xmlhttpRequest can hang forever and
// the page never finishes rendering. Firebase's HN endpoint is fast in the
// common case; 8s is generous.
export const USER_FETCH_TIMEOUT_MS = 8000;

// How long the highlight-unread feature remembers the comment IDs it
// saw on a previous visit to a given item. Three days matches refined-
// hacker-news's default and means a thread you opened on Friday still
// shows new replies on Monday morning.
export const READ_COMMENTS_TTL_MS = 3 * 24 * 60 * 60 * 1000;

// The per-comment "[toggle replies]" link from refined-hacker-news's
// toggle-all-comments-and-replies feature. Default off because adding
// a link to every comment scales linearly with thread size and slows
// page render on items with hundreds of comments. The fatitem-level
// "[toggle all]" link is always on.
export const TOGGLE_ALL_REPLIES_ENABLED = false;

// Hover-panel TTL/timeout/dwell. Item content (title, score, comment
// count, etc.) drifts about as slowly as user karma, so a 6h cache is
// enough for the hover preview to feel current without re-fetching the
// same item every time the cursor passes over a link.
export const ITEM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Per-request ceiling for the hover fetcher. Same shape as the user
// fetch — without it a hung request would leave the popup stuck on
// "loading…" until the tab is closed.
export const ITEM_FETCH_TIMEOUT_MS = 8000;
// How long the cursor must rest on a link before we trigger a fetch.
// Keeps the hover from firing during cursor-fly-over events on long
// pages; short enough to feel responsive when the user actually wants
// the preview.
export const HOVER_DWELL_MS = 250;

// How long a watched comment persists before being silently pruned.
// HN threads rarely receive replies after two weeks, and the TTL stops
// the watch list growing forever on threads that have gone cold.
export const WATCH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Minimum interval between API rechecks of a single watched comment.
// 60 seconds is short enough that the listing-page highlight reflects
// new replies on the very next page load after they arrive (anything
// longer leaves the user staring at an unflagged comments link while
// the throttle still applies from the most recent item-page sync), and
// long enough to dedup tight reload spam. Each request is a tiny JSON
// behind fetchItem's inflight-dedup map, so the load impact is small
// even with several active watches.
export const WATCH_RECHECK_THROTTLE_MS = 60 * 1000;

// Authors whose stored rating sits at or below this value have their
// comments auto-collapsed on render. Rating defaults to 0, so the
// threshold must be negative (otherwise every unrated user would
// collapse). The value is intentionally a constant rather than a
// toolbar-configurable setting — it's a single edit if it ever needs
// to change, and the simplicity is worth more than the flexibility.
export const LOW_SCORE_COLLAPSE_THRESHOLD = -10;

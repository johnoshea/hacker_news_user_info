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

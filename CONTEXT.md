# CONTEXT.md

Canonical glossary of domain terms for this repo. **Authoritative over the
README and code comments** — when those drift, this wins. Architecture and
wiring live in `CLAUDE.md`; this file only defines vocabulary.

Two sources of terms: words we inherit from Hacker News' own markup and API,
and words this project coined. Config-driven thresholds are named by their
constant (in `src/config.js`) rather than their value, so this file stays
correct when the value is tuned.

## HN platform vocabulary (inherited)

Terms baked into the pages we modify. We depend on HN's class names and API
shape; if HN renames these, the corresponding feature breaks.

### DOM (HN's markup)

- **`.hnuser`** — the `<a>` wrapping a username. Our inline enrichment clones
  it and hides the original (HN's own click handlers may still reference it).
- **`tr.comtr`** — one comment's table row. The unit most comment-page passes
  iterate over.
- **`.commtext`** — a comment's body text. Carries **`.c00`** when alive (HN's
  default text color) and **`.cdd`** when dead (we recolour both).
- **`.comhead`** — a comment's metadata line: age · `parent` · `next` ·
  collapse toggle. We append markers here (`[op]`, `[collapse root]`,
  `[low score]`).
- **`.fatitem`** — the story-header block at the top of an item page: title,
  score, and the comment-submit form. The OP's `.hnuser` lives here.
- **`td.ind` (indent gutter)** — the left cell of a comment row. Its width
  encodes nesting depth at **40px per level** (level = `width / 40`); a root
  comment's gutter is ~0px wide.
- **`a.togg`** — HN's native subtree-collapse toggle (the `[–]`/`[+]` link).
  Several features fire it programmatically instead of reimplementing collapse.
- **`tr.athing.submission`** — a story row on a listing page (front page,
  `/newest`, etc.). `getStoryListTable()` anchors off these.
- **`.rank`** — the story's rank number on listings. We hide it.

### API (Firebase, `hacker-news.firebaseio.com/v0`)

- **`kids`** — an item's **direct** reply IDs (not the full subtree). The
  watch-for-replies feature diffs these to detect new replies.
- **`descendants`** — total comment count under an item (the "n comments"
  figure).
- **`karma`** — a user's accumulated points.
- **`created`** — account creation time, **unix seconds**. Age math elsewhere
  uses seconds; only the new-account threshold is in milliseconds.
- **OP / original poster** — the item's submitter. Their comments in the
  thread get the `[op]` marker.

## Project vocabulary (coined here)

- **legibility layer** — the passes that run on *every* HN page (font/spacing
  resets, quote rendering, downvoted-comment restyling).
- **enrichment layer** — the passes gated to item pages only (per-user
  controls, watches, collapse helpers, hovers).
- **item page** — `/item?id=*`; detected by `isItemPage()`.
- **listing page** — any page whose story table resolves via
  `getStoryListTable()` (front page, `/newest`, `/show`, etc.).
- **`hn_state` / `hn_cache`** — the two `GM` storage values holding persisted
  state. **`hn_state`** holds curated user data (ratings, tags, tag colours),
  written only on explicit edits. **`hn_cache`** holds the regenerable
  background caches (user/item digests, read-comment lists, watched comments,
  watched stories), rewritten constantly by the page-load fetch storm.
  Splitting them keeps that
  storm off the key carrying ratings, so a cache write can't clobber a rating.
  Maps in each are keyed by username, item id, or comment id.
- **store / backend** — `store` (from `createStore`) is the typed accessor that
  merges both keys into one in-memory snapshot; `backend` is the thin
  `{get, set, list}` adapter around the `GM_*` storage APIs the store writes
  through (`mutateUser` → `hn_state`, `mutateCache` → `hn_cache`).
- **RMW (read-modify-write)** — the mutation discipline for every store setter:
  re-read the key, apply the change, write it back. Makes *same-tab* sequential
  writes safe; cross-tab safety for curated data comes from the key split, since
  a tab's `GM_getValue` only sees another tab's write after an async listener
  delivery and so RMW alone can't serialize writes across tabs.
- **digest** — a cached summary object for a user or item, as returned by
  `fetchUser`/`fetchItem`, with its internal `fetchedAt` stamp stripped off.
- **fresh fetch** — a `fetchItem(id, { fresh: true })` that bypasses the
  persistent cache but still dedupes and writes through. Used by watch
  rechecks, which can't wait out the 6h cache TTL.
- **inflight dedup** — coalescing concurrent fetches for the same key into one
  in-memory promise, so N callers trigger one request.
- **watch / watched comment** — a per-*comment* (not per-user) reply-tracking
  entry under `watchedComments[commentId]`. One user with three comments can be
  watched on any subset of them.
- **seenKids / latestKids / hasNew** — the watch reply-detection triad.
  `latestKids` is the comment's current direct replies (refreshed on recheck);
  `seenKids` is the snapshot from your last item-page visit; **`hasNew`** is the
  derived predicate `latestKids.some(id => !seenKids.includes(id))`.
- **story watch / watched story** — a per-*story* new-comment tracker under
  `watchedStories[itemId]`, distinct from a watched comment: it flags the whole
  thread, not one subtree. Explicit opt-in via the 👁 in the fatitem subtext.
- **seenCount** — for a watched story, the total comment count the last time you
  opened the thread. The listing pass flags the story (`★` + bold, plus a
  `(+N)` delta) when HN's current count exceeds it, and an item-page visit
  refreshes `seenCount` to the current count (the "visiting clears the flag"
  step — the story analogue of `markWatchSeen`). No API: both the item-page
  fatitem and the listing row render the count in the DOM, parsed by
  `parseCommentCount`.
- **rating** — your per-user up/down integer opinion of an author. Defaults to
  0; `setRating(user, 0)` deletes the entry rather than storing a neutral 0.
- **tag** — a per-user label. Tag *colours* are shared across all users
  carrying that tag (one `colors` map, keyed by tag name).
- **low-score author** — a user whose rating is `<= LOW_SCORE_COLLAPSE_THRESHOLD`.
  Their comments auto-collapse with a `[low score]` marker.
- **new account** — an account younger than `NEW_ACCOUNT_MAX_AGE_MS` (currently
  6 months). Its inline `(age, karma)` blurb renders green.
- **read comments / unread highlight** — the comment IDs seen on your previous
  visit to an item (`readComments[itemId]`); IDs not in that set are tinted as
  new on the next visit.
- **"+" trigger / materialize** — most users in a thread are never tagged or
  rated, so their controls aren't built up front: they get a compact `+`
  trigger, and *materializing* it (on click, or when the user gains state)
  builds the real rating/tag controls in place.
- **affected users / rerender fan-out** — on a remote `hn_state` write, the set
  of users whose visible tag/rating UI actually changed (`affectedUsersByStateChange`).
  The cross-tab listener re-renders only those. Cache writes go to `hn_cache`,
  which has no listener, so they never trigger a fan-out at all.
- **pure-logic boundary** — `src/config.js`, `src/parsing.js`, `src/state.js`:
  no `document`/`window`/`GM_*`. The only modules tests import directly.

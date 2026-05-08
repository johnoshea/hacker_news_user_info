# Watch for replies — design

## Purpose

Browsing 20-60 HN comment pages a day, it's hard to remember which thread had the comment you thought might attract interesting replies. Without a marker, those comments slip past — and you only re-find them by accident, if at all.

This feature lets you flag a comment as "watched" with one click, so that:

1. The next time you load a listing page (`/news`, `/news?p=2`, etc.) where one of your watched comments is in the thread, the story's "n comments" link is visibly highlighted if new replies have arrived since you started watching.
2. Returning to that comment page, the watched comment is unmistakable on the page (a thick orange left-border and faint yellow tint) — no scroll-hunting.
3. Toolbar buttons jump between watched comments on the page, so multiple watches in one thread are easy to traverse.

Replies are detected proactively via the HN Firebase API (one cheap fetch per watched comment, throttled), so a story with new replies stands out *on the listing page* without requiring you to load the comment page first.

## User-facing behaviour

### Entry point — the watch icon

Every per-comment row produced by `user-render` grows a fourth glyph, placed between the rating control (`▲▼`) and the tag input. The icon is `👁` when the comment is unwatched and `👁‍🗨` when watched. Clicking toggles the state.

Tooltip on hover: "Watch for replies" / "Stop watching".

The watch is per-comment (not per-user). If the same author has three comments in the thread, you can watch one, two, or all three independently.

### Visited comment page — finding the watched comment

When the page loads, every watched comment whose id matches a `tr.comtr[id]` on the page gets:

- A 5px solid HN-orange (`var(--colour-hn-orange)`) left border on its `td.ind` cell.
- A faint yellow background (`rgba(255, 255, 0, 0.10)`) on every cell of the row.

This treatment is deliberately distinct from the `.hn-new-comment` faint-orange tint used by `highlight-unread-comments`. A row that is somehow both watched and new shows both: yellow tint plus orange left border (watched) plus orange tint (new).

### Toolbar — prev/next navigation

When at least one watched comment is on the current item page, the existing draggable toolbar (top-right, currently hosting Save/Restore state) gains two buttons:

- `↑ watch` — scroll to the previous watched comment (earlier in document order)
- `watch ↓` — scroll to the next watched comment (later in document order)

The current position starts as "before any watched comment" — i.e. on first click, `watch ↓` jumps to the first watched comment on the page.

`↑ watch` is disabled when the current position is at or before the first watched comment. `watch ↓` is disabled when the current position is at the last. With one watched comment on the page, only `watch ↓` is ever enabled.

There is no wrap-around.

### Listing page — highlighted "n comments" links

On any page rendering `table.itemlist` (front page, `/newest`, `/best`, `/ask`, `/show`, paginated variants), each story row is checked against the watched-comments map. If at least one watched comment in that thread has new replies — i.e. the most recent API check returned a `kids` list with ids the user hasn't yet acknowledged — the story's "n comments" link gets:

- Bold, HN-orange text colour (`var(--colour-hn-orange)`)
- A `★ ` prefix injected via `::before`

Stories with watched comments but no detected new replies, and stories with no watched comments at all, are unchanged.

### Visiting clears the highlight

When you load the comment page, every watch on that page has its `seenKids` set to `latestKids`, so subsequent listing-page renders no longer flag the link until *more* replies arrive. This makes the highlight a single-action signal: see the star, click through, the star is gone.

### Lifecycle

- **Toggle on:** the watch is created with `seenKids` and `latestKids` both initialized to the comment's current direct replies. You will not be notified about replies that already existed when you started watching.
- **Toggle off:** the watch is removed, and any visual highlight on this page disappears.
- **TTL backstop:** watches older than 14 days are silently pruned. HN threads rarely receive new replies after that window, and this stops the watch list from growing forever on threads that have gone cold.

## Architecture

The feature is split into pure helpers (`parsing.js`, `state.js`, both safe under Node and unit-tested) and three browser-only feature modules under `src/features/`.

### Three coordinated passes

| Pass | Runs on | Responsibility |
|---|---|---|
| `setupWatchToggles({ store, fetchItem })` | item pages | Inject the eye icon into each `.hn-main-row`. On click, toggle the watch state. On page load, mark every watched comment present on this page with `.hn-watched`, fire a fresh `fetchItem` for each, and on resolve sync both `latestKids` and `seenKids` to the response. |
| `setupWatchedCommentNav({ store, toolbar })` | item pages, only when ≥1 watch on this page | Append `↑ watch` / `watch ↓` buttons to the toolbar's button container; manage current-position state and disabled state. |
| `setupWatchedListingHighlights({ store, fetchItem })` | listing pages (`table.itemlist` present) | Group watches by itemId; for each story row matching, kick off a stale-aware `fetchItem` recheck, and on resolve restyle the "n comments" link if any watch in that thread has new replies. |

### Data model

A new map joins the consolidated `hn_state` blob:

```js
state.watchedComments: {
  [commentId]: {
    itemId,         // string — parent story id, for listing-page link lookup
    seenKids,       // [replyId] — kids the user has acknowledged
    latestKids,     // [replyId] — kids from the most recent API check
    lastCheckedAt,  // ms epoch — drives the recheck throttle
    addedAt,        // ms epoch — drives the TTL prune
  }
}
```

`hasNew` is derived: `latestKids.some(id => !seenKids.includes(id))`.

State transitions:

- **Toggle on:** call `fetchItem(commentId)`. On resolve, write `{ itemId, seenKids: kids, latestKids: kids, lastCheckedAt: now, addedAt: now }`.
- **Background recheck (per HN page load):** for each watch with `now - lastCheckedAt > WATCH_RECHECK_THROTTLE_MS`, call `fetchItem(commentId)`. On resolve, update `latestKids` and `lastCheckedAt`.
- **Visit clears "new":** for each watch on the current item page, fire a fresh `fetchItem` (throttle-aware); on resolve, set `latestKids = kids, seenKids = kids, lastCheckedAt = now`. Doing both in one step ensures `seenKids` is anchored to the freshest server view, not whatever stale `latestKids` was lying around.
- **Toggle off:** delete the entry.
- **TTL prune:** at the same call site as `pruneReadComments`, drop watches with `addedAt < now - WATCH_TTL_MS`.

If `fetchItem` returns null (network error, timeout, deleted comment), nothing is updated. The watch stays. The TTL backstop eventually cleans up stale entries on dead threads.

### Reusing `fetchItem`

`fetchItem` and `state.itemCache` already exist (powering the hover-popup feature) but currently discard `kids`. We extend the cached digest with a `kids: [replyId]` field. `kids` is additive — the hover popup destructures by name and ignores fields it doesn't read — so this is non-breaking.

The existing `fetchItem` machinery (in-memory inflight map for dedup, persistent cache with 6h TTL, 8s timeout) handles concurrent calls and dropped requests without further work.

#### Cache-freshness opt-in

`fetchItem` currently serves from a 6-hour persistent cache before consulting the network. For the hover popup that is fine — title, score and karma drift slowly. For watch rechecks we need actually-recent `kids`, otherwise the 30-minute recheck throttle is a no-op for the first six hours after a watch is created.

Solution: extend `fetchItem` with a `{ fresh = false }` option.

```js
function fetchItem(itemId, { fresh = false } = {}) {
    if (!fresh) {
        const cached = store.getCachedItem(itemId, Date.now(), ITEM_CACHE_TTL_MS);
        if (cached) return Promise.resolve(cached);
    }
    if (itemInflight.has(itemId)) return itemInflight.get(itemId);
    // ... existing fetch path; writes cache on resolve regardless of `fresh` ...
}
```

`fresh: true` skips the cache read but still participates in the inflight-dedup map and still updates the cache on resolve, so a subsequent default-cache call reads the just-written value. The hover popup keeps the default. Watch passes pass `fresh: true`.

### Cost ceiling

With a 14-day TTL and a typical browsing pattern of 1-3 listing pages per session, the steady-state cost is bounded:

- Watched comments live at any time: probably 10-30 (≈2/day average × 14-day TTL).
- Per session: each stale watch costs one fetch. Throttled to once per 30 minutes per comment via `WATCH_RECHECK_THROTTLE_MS`, plus deduped by the existing inflight map.
- Net: opening the front page after a 30-minute break fires ≤30 small JSON requests, all to the Firebase HN endpoint, none on the page-render critical path.

## Pure helpers

### In `src/parsing.js`

```js
// True iff `latestKids` contains an id that isn't in `seenKids`.
export function watchHasNewReplies(seenKids, latestKids)

// Mirrors pruneExpiredReadComments — returns a new map with expired entries removed.
export function pruneExpiredWatches(watchedMap, nowMs, ttlMs)

// True iff lastCheckedAt is older than nowMs - throttleMs.
export function isWatchCheckStale(entry, nowMs, throttleMs)

// Group a watchedComments map by itemId for listing-page lookup.
//   { itemId: [{ commentId, hasNew }, ...] }
export function watchesByItemId(watchedMap)
```

### In `src/state.js`

New store methods, all read-modify-write like the rest:

```js
store.getWatchedComments()
store.getWatchedComment(commentId)
store.setWatchedComment(commentId, entry)
store.removeWatchedComment(commentId)
store.markWatchSeen(commentId, nowMs)        // seenKids = latestKids
store.updateWatchKids(commentId, kids, nowMs) // latestKids = kids; lastCheckedAt = nowMs
store.pruneWatchedComments(nowMs, ttlMs)
```

`emptyState()` adds `watchedComments: {}`. The export format gains a `watches` slot at the top level:

```js
{
  customTags: { ... },         // existing
  users:      { ... },         // existing
  watches:    {                // new
    [commentId]: { itemId, seenKids, latestKids, addedAt, lastCheckedAt }
  }
}
```

`stateToExport` populates `watches` from `state.watchedComments`. `parseImport` rehydrates `state.watchedComments` from `data.watches`. Older export files without the `watches` slot import as before, with an empty watch list. The watch list is user data (a deliberate user choice), not perf scaffolding, so it belongs in exports alongside ratings and tags.

## Feature modules

### `src/features/watch-toggles.js`

Runs after `userRender.renderAllUsernames()` (which produces the `.hn-main-row` layout that this pass inserts into).

Per `tr.comtr` on the page:

1. Find the corresponding `.hn-main-row`.
2. Insert `<span class="hn-watch-icon" data-hn-comment="<id>">` between `.hn-rating-container` and `.hn-tag-input`. The glyph is `👁` (off) or `👁‍🗨` (on), set from `store.getWatchedComment(id)`.
3. Click handler:
   - If the watch is already on: `store.removeWatchedComment(id)`; remove `.hn-watched` from the row; remove `.hn-watching` from the icon; swap the glyph back to `👁`.
   - If off: read the page's `?id=` for itemId; apply `.hn-watched` to the row, `.hn-watching` to the icon, and swap the glyph to `👁‍🗨` immediately (visual response is synchronous); fire `fetchItem(id, { fresh: true })`. On resolve, double-check `store.getWatchedComment(id)` is still empty (the user may have toggled off) before writing the new entry.

After the per-row pass, for every watched comment on this page, fire `fetchItem(commentId, { fresh: true })` (parallel, throttle-aware via `isWatchCheckStale`); on resolve, call both `store.updateWatchKids(commentId, kids, now)` and `store.markWatchSeen(commentId, now)`. This is the "visit clears new" step — it pulls the freshest server view and acknowledges it in one go, so subsequent listing-page rechecks don't re-flag replies the user has implicitly seen by visiting.

### `src/features/watched-comment-nav.js`

Runs after `toolbar.mount()`.

1. Read the page's itemId. From `store.getWatchedComments()`, collect entries with matching `itemId`.
2. Resolve each to a DOM row (`document.getElementById(commentId)`); drop any that aren't on the page (e.g. on a paginated comment thread where a watched comment is on a different page).
3. If the resolved list is empty, do nothing.
4. Otherwise, append two buttons to the toolbar's button container:
   - `↑ watch` (class `hn-toolbar-btn hn-watch-nav hn-watch-nav-prev`)
   - `watch ↓` (class `hn-toolbar-btn hn-watch-nav hn-watch-nav-next`)
5. Maintain a closure-local `currentIndex`, initialized to `-1`. Click handlers update it (`+1` or `-1`, clamped to `[0, list.length - 1]`), call `list[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" })`, and re-evaluate `disabled` on both buttons.

`createToolbar` is extended to expose its button container after `mount()` runs (returning `{ mount, getButtonsContainer }` or similar) so this module is the only place that knows the toolbar's internal layout.

### `src/features/watched-listing-highlights.js`

Runs unconditionally; gates internally on `document.querySelector("table.itemlist")`.

1. Read all watches; group via `watchesByItemId`.
2. For each `tr.athing[id]` on the page, look up the itemId in the grouping. Skip on no match.
3. For matched stories, walk the watches in that thread:
   - If any has `isWatchCheckStale(entry, now, WATCH_RECHECK_THROTTLE_MS)` true, fire `fetchItem(commentId, { fresh: true }).then(d => { if (d) store.updateWatchKids(commentId, d.kids ?? [], now); evaluate(); })`.
   - The `evaluate()` step recomputes `hasNew` for the thread's watches and adds the `.hn-watched-link` class to the story's "n comments" link if any are now true.
4. Stories where every watch in that thread is fresh and `hasNew` is already true at page-load time get the highlight applied synchronously, with no fetch.

The "n comments" link is the last `a[href^="item?id="]` in the story's subtext row (the same heuristic `setupSortStories` uses to extract the comment count).

## Styles

```css
.hn-watch-icon {
    cursor: pointer;
    user-select: none;
    margin: 0 4px;
    opacity: 0.6;
}
.hn-watch-icon:hover { opacity: 1; }
.hn-watch-icon.hn-watching { opacity: 1; }

.hn-watched > td.ind {
    border-left: 5px solid var(--colour-hn-orange);
}
.hn-watched > td {
    background-color: rgba(255, 255, 0, 0.10);
}

.hn-watch-nav[disabled] {
    opacity: 0.35;
    cursor: not-allowed;
}

.hn-watched-link {
    font-weight: bold;
    color: var(--colour-hn-orange) !important;
}
.hn-watched-link::before {
    content: "★ ";
}
```

## Config

```js
// src/config.js
export const WATCH_TTL_MS = 14 * 24 * 60 * 60 * 1000;     // 14 days
export const WATCH_RECHECK_THROTTLE_MS = 30 * 60 * 1000;  // 30 min per comment
```

## Wiring (`src/main.js`)

```js
import { setupWatchToggles } from "./features/watch-toggles.js";
import { setupWatchedCommentNav } from "./features/watched-comment-nav.js";
import { setupWatchedListingHighlights } from "./features/watched-listing-highlights.js";

// ... existing setup ...

// Listing-page pass — gated internally by table.itemlist
setupWatchedListingHighlights({ store, fetchItem });

if (isItemPage()) {
    // ... existing item-page passes ...
    userRender.renderAllUsernames();
    setupWatchToggles({ store, fetchItem });
    toolbar.mount();
    setupWatchedCommentNav({ store, toolbar });
    // ... rest ...
}
```

The cross-tab `GM_addValueChangeListener` on `STATE_KEY` already invalidates the in-memory cache on remote write. Listing-page rendering happens once at page load, so a remote write that arrives mid-session is picked up on the next page navigation. Item-page watch icons don't need live rerendering — toggling in another tab while staring at the page is rare, and any recheck on the next navigation will reconcile.

## Edge cases

| Case | Handling |
|---|---|
| `fetchItem` returns null (network error, timeout, deleted comment) | Don't update `latestKids` or `lastCheckedAt`. Next page-load retries. The 14-day TTL eventually prunes dead entries. |
| User toggles on, then off, before the initial `fetchItem` resolves | Resolve handler reads `store.getWatchedComment(id)` and writes only if the entry still exists. |
| Comment thread is paginated and the watched comment is on a later page | `setupWatchedCommentNav` resolves DOM rows by `getElementById` and drops misses, so only on-page watches participate in nav. The watch itself stays valid. |
| Item page has zero comments | `setupWatchedCommentNav` finds an empty list and adds nothing to the toolbar. |
| Cross-tab toggle | Cross-tab listener invalidates the store cache. The current page's icons don't update live, but the next navigation reconciles. |
| `kids` field absent on the API response (very old or unusual items) | Treat as `[]`. `hasNew` becomes false; harmless. |
| Watched comment row is also a "new comment" (set in another tab between sessions) | Both classes apply. Yellow tint plus orange left-border (watched) plus faint orange row tint (new). Distinguishable. |

## Testing

Pure helpers get unit tests under `tests/`. Browser modules are not unit-tested (matches every other feature module).

### `tests/parsing-watch.test.js`

- `watchHasNewReplies`: empty arrays; `latestKids` is a subset of `seenKids`; one new id; multiple new ids.
- `pruneExpiredWatches`: nothing to prune (returns same reference); some expired; all expired.
- `isWatchCheckStale`: just-checked; exactly at threshold; well past.
- `watchesByItemId`: empty map; one watch; multiple watches in one item; multiple items.

### `tests/state-watch.test.js`

- `setWatchedComment` / `getWatchedComment` / `removeWatchedComment` round-trip via the in-memory backend.
- `markWatchSeen` updates `seenKids` only.
- `updateWatchKids` updates `latestKids` and `lastCheckedAt` only.
- `pruneWatchedComments` integrates with the prune helper.
- `stateToExport` / `parseImport` round-trip including the `watches` slot.

## Out of scope (v1)

- Auto-scrolling to the first watched comment on arrival.
- "n new replies" count in the listing-link tooltip or in the toolbar.
- Wraparound for prev/next nav.
- Bulk watch / unwatch / list-all-watches UI. The existing toolbar Save state covers backup.
- Notifications outside HN (push, desktop, email).
- Watching a story (as opposed to a comment).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tampermonkey/Violentmonkey userscript with two cooperating layers:

1. **Site-wide legibility layer** (every HN page, `news.ycombinator.com/*`): font reset, sizing, gutters, full-width main, downvoted-comment restyling (black-on-faint-grey), quoted-text rendering (`>`-prefixed text wrapped in `<p class="quote">` with HN-orange accents), and `.rank` hidden. CSS comes from a `:root` block with `--colour-hn-orange`, `--colour-hn-orange-pale`, `--gutter`, and `--border-radius` tokens. Adapted from [mgladdish/website-customisations](https://github.com/mgladdish/website-customisations).
2. **Comment-page enrichment layer** (only `news.ycombinator.com/item?id=*`, gated by `isItemPage()`): account age + karma inline, per-user custom tags with colors, per-user up/down rating, OP highlight (`[op]` suffix on every comment by the item submitter), click-the-indent-gutter to collapse, `[collapse root]` link on nested comments, "toggle all" link on the fatitem subtext, backtick-wrapped text rendered as `<code>`, highlight for comments new since last visit, hover-on-cited-item popup, dead-comment recolour, indent-gutter separator, `<pre>`/`<code>` styling, draggable toolbar for export/import, a "show comment box" toggle that collapses the page-bottom comment-submit form, a per-comment "watch for replies" toggle (eye icon) with toolbar prev/next nav between watched comments that have new direct replies, per-comment auto-collapse for users rated `<= -10` (with a `[low score]` marker in the comhead and click-the-gutter to expand), and a parent-link hover popup that previews the parent comment's body.
3. **Hover-on-username popup** runs on every HN page (except `/user`, where you're already looking at the profile): hovering any `.hnuser` for the dwell period (250ms) shows a popup with their account age, karma, and about-text snippet, fetched once and cached for 6h.
4. **Listing-page enhancements** (any page whose story table is found by `getStoryListTable()` in `src/dom.js` — anchors off a `tr.athing.submission` row, excluding the item-page fatitem header): a "sort: …" dropdown re-orders the story list in place — `default` / `time` / `score` / `ratio`, plus a `reverse` link.
5. **`/user` page enhancement**: plain-text URLs and email addresses in the about cell get turned into clickable links.
6. **Watch-for-replies cross-page layer**: `setupWatchedListingHighlights` runs on listing pages (anything `getStoryListTable()` resolves); for each story whose thread contains a watched comment, fires a throttle-aware Firebase API recheck and adds `.hn-watched-link` (bold HN orange + `★ ` prefix) to the "n comments" link when new direct replies have arrived since you started watching.

`src/main.js` runs the legibility passes (`applyDownvotedClass`, `transformQuotes`), `setupLinkifyUserAbout`, `setupSortStories`, and `setupWatchedListingHighlights` on every HN page (each feature internally checks whether its page is the right one). The enrichment passes (`setupCommentBoxToggle`, `setupClickIndentToggle`, `setupCollapseRootComment`, `transformBackticksToMonospace`, `setupToggleAllComments`, `setupHighlightUnreadComments`, `userRender.renderAllUsernames`, `setupItemInfoHover`, `setupReplyInline`, `toolbar.mount`) run only on item pages. `setupUserInfoHover` runs last and on every HN page (the feature internally skips `/user`); it has to come after `renderAllUsernames` so the hover handler lands on the visible cloned `.hnuser` rather than the now-hidden original.

## Commands

- **Test**: `just test` (or `node --test "tests/*.test.js"`)
- **Lint**: `just lint` (or `biome lint --write src/ tests/ scripts/`)
- **Format**: `just fmt` (or `biome format --write src/ tests/ scripts/`)
- **Build**: `just build` (or `node scripts/build.js`) — concatenates `src/` into the single `script.js` userscript bundle
- **All of the above**: `just check` (lint + fmt + test + build — the pre-commit gate)
- **Run**: load `script.js` in a userscript manager (Tampermonkey/Violentmonkey)

After any edit under `src/`, run `just build` (or `just check`) so `script.js` stays in sync. CI fails the PR if `script.js` doesn't match a fresh build of `src/`.

## Repository layout

```
src/
  config.js                  Storage key, schema version, TTL/timeout/threshold constants
  parsing.js                 Pure helpers: timeSince, stripLeadingQuoteMarker, parseTagInput,
                             findCommentRootIndices, splitBackticks,
                             findNewCommentIds, isReadCommentEntryFresh,
                             pruneExpiredReadComments, truncateText, extractDomain,
                             linkifySegments, sortStoriesBy,
                             shouldAutoCollapseAuthor, parseParentIdFromHref,
                             splitHtmlIntoParagraphs
  state.js                   createStore, migrateLegacyKeys, parseImport, stateToExport,
                             renameTagInState, removeTagInState, countsFromState
  dom.js                     h() factory, findCommentParent, isItemPage, getItemPageId,
                             getStoryListTable
  styles.js                  CSS as a single tagged-template export (STYLES)
  api.js                     createApi factory: fetchUser with cache + inflight + timeout
  features/
    legibility.js            applyDownvotedClass, transformQuotes (run on every HN page)
    comment-box-toggle.js    setupCommentBoxToggle (item pages only)
    click-indent-toggle.js   setupClickIndentToggle: makes td.ind a click target —
                             toggles `.hn-low-score-expanded` on score-managed rows,
                             fires HN's native a.togg on every other row
    collapse-root-comment.js setupCollapseRootComment: appends "[collapse root]" link
                             to every non-root comment's comhead
    backticks-to-monospace.js  transformBackticksToMonospace: walks .commtext text nodes,
                             wraps `inline code` in <code> via splitBackticks
    toggle-all-comments.js   setupToggleAllComments: "toggle all" link on fatitem subtext;
                             gated per-comment "[toggle replies]" link via config flag
    highlight-unread-comments.js setupHighlightUnreadComments: tints td.ind on comments
                             that weren't on the page last time you visited this item
    auto-collapse-low-score.js  setupAutoCollapseLowScore: tags every tr.comtr with
                             data-hn-author and applies .hn-low-score on rows whose
                             author's rating is <= LOW_SCORE_COLLAPSE_THRESHOLD;
                             appends "[low score]" tag to the comhead
    hover-popup.js           createHoverPopup factory: shared {show, hide, attachDwell}
                             primitive used by both hover features
    user-info-hover.js       setupUserInfoHover: hover any .hnuser for an account-info popup
    item-info-hover.js       setupItemInfoHover: hover an /item?id= link inside .commtext
                             for the cited item's title/score/author/comment-count preview
    parent-hover.js          setupParentHover: hovers on the "parent" link in each
                             comhead show the parent comment's body in the shared
                             popup; DOM-first with fetchItem fallback for off-page
                             parents (deep subtrees, story parents)
    linkify-user-about.js    setupLinkifyUserAbout: on /user pages, replaces plain-text
                             URLs / emails in the about cell with clickable <a> elements
    sort-stories.js          setupSortStories: dropdown above the listing
                             pages — sorts by default / time / score / ratio + reverse
    reply-inline.js          setupReplyInline: makes reply/edit/delete links inject the
                             relevant HN form into the comment instead of navigating away
    user-render.js           createUserRender factory: renderAllUsernames + per-user rerender
                             (also adds the .hn-op class + " [op]" marker on OP's comments)
    watch-toggles.js         setupWatchToggles: per-comment 👁/👁‍🗨 toggle in the
                             user-render row; on click, persists a watch entry
                             keyed by comment id; on page load, marks watched
                             rows and syncs seenKids/latestKids
    watched-comment-nav.js   setupWatchedCommentNav: appends ↑ watch / watch ↓
                             buttons to the toolbar when at least one watched
                             comment with new direct replies is on the page;
                             disabled state at ends
    watched-listing-highlights.js  setupWatchedListingHighlights: on listing
                             pages, restyles the "n comments" link of stories
                             whose thread contains a watched comment with new
                             replies (★ + bold HN orange)
    tag-manager.js           createTagManager factory: overlay state machine
    toolbar.js               createToolbar factory: floating Save/Restore-state buttons
  main.js                    Bootstrap: builds backend, store, api, features; wires
                             cross-tab listener; gates item-page passes via isItemPage()
scripts/
  build.js                   Concatenates src/ in dependency order, strips import/export,
                             IIFE-wraps, prepends ==UserScript== header, writes script.js
  clean-orphan-tags.js       One-off CLI: drops unused tag colors from an exported state file
tests/
  *.test.js                  node:test against pure-logic modules under src/
script.js                    Build artifact (committed to git; loaded by userscript managers)
```

## Architecture

The repository is split into pure logic, browser-only code, and a build step that fuses them into the userscript bundle.

### Build pipeline

`scripts/build.js` reads the files listed in its `SOURCES` array, in dependency order, strips ES module `import`/`export` declarations with regex (we only use the simple declaration forms), concatenates them with `// ===== <path> =====` separators, wraps the whole body in `(function () { "use strict"; … })()`, and prepends the `==UserScript==` header. The result is written to `script.js` at the repo root.

Because every module ends up in one shared IIFE scope, top-level `function foo(...)` declarations from different modules collide silently — a later definition overrides an earlier one with the same name, and the symptom (a caller invoking a function with the wrong signature) is hard to debug from runtime alone. `scripts/build.js` runs `checkForDuplicateTopLevelFunctions` over the stripped sources before writing the bundle and fails the build if it finds a collision. **Function names must be unique across `src/features/*.js`.** When the same helper genuinely belongs in two or more modules, extract it to `src/dom.js` (or `src/parsing.js` if it's pure) — `getItemPageId` lives in `dom.js` for exactly that reason. When two helpers are conceptually similar but read different inputs, name them explicitly for their input (e.g. `getItemPageId` reading `window.location.search` vs `getItemIdFromLinkHref` reading a hovered anchor's `href`).

The `@version` field embeds the current commit's git short hash (`0.10+abc1234`) so the userscript metadata in Tampermonkey/Violentmonkey is enough to identify which commit is loaded. CI's "is `script.js` up to date" diff uses `git diff -I '^// @version'` to ignore hunks consisting entirely of @version-line changes, since the committed-script.js's hash and a fresh CI build's hash always differ by one commit.

The pattern mirrors the sibling repo `url_destination_checker`. There is no bundler (no esbuild/rollup/webpack); the textual strip works because `src/` only uses `import { x } from "./y.js"` and `export function`/`export const`. If a contributor introduces a more exotic module pattern (`export *`, dynamic `import()`, `import` with side-effects only), the build script needs to grow.

### Pure-logic boundary

`src/config.js`, `src/parsing.js`, and `src/state.js` are pure: no `document`, `window`, `GM_*`, or other browser globals at module scope or inside their exports. They are the only modules tests import directly. The browser-only modules (`src/api.js`, everything under `src/features/`, `src/main.js`, `src/dom.js`, `src/styles.js`) reference DOM or `GM_*` globals freely; tests never import them.

When adding a helper that's safe under Node, put it in `parsing.js` or `state.js` and add a test. Anything that touches the DOM goes in a feature module.

### Storage

All state lives under a single `hn_state` key (`STATE_KEY` in `src/config.js`) with this shape:
```
{ schemaVersion: 1,
  ratings: { <user>: int },
  tags:    { <user>: [<tagName>, ...] },
  colors:  { <tagName>: { bgColor, textColor } },
  cache:   { <user>: { created, karma, fetchedAt } },
  itemCache: { <itemId>: { title, ..., kids, fetchedAt } },
  watchedComments: { <commentId>: { itemId, seenKids, latestKids, lastCheckedAt, addedAt } } }
```
Callers never touch `GM_setValue`/`GM_getValue` directly — they go through the `store` object returned by `createStore(backend)` in `src/state.js`, where `backend` is the `{ get, set, list }` adapter that `src/main.js` builds around the `GM_*` APIs. The store consolidates writes into one JSON blob and caches reads in memory.

Mutations are read-modify-write: each setter re-reads the disk blob, applies its mutation, and writes the whole blob back. This is what makes the store safe when the user has multiple HN tabs open at once (the typical pattern of cmd-clicking comment pages from the front page) — every tab's `setupHighlightUnreadComments` fires synchronously at page load, and without RMW their stale-snapshot writes would clobber each other on the way to disk. RMW absorbs concurrent writes from other tabs as long as the get-then-set pair isn't preempted; `GM_getValue`/`GM_setValue` are synchronous in Tampermonkey and Violentmonkey, so the race window is essentially zero per call site. The cross-tab listener (below) handles the in-memory cache invalidation; RMW handles the persistence side.

On first run, `migrateLegacyKeys(backend)` rewrites the pre-0.4 per-user keys (`hn_author_rating_*`, `hn_custom_tags_*`, `hn_custom_tag_color_*`) into the new format. Legacy keys are left in place for one version as a rollback safety net.

### Site-wide passes (`src/features/legibility.js`)

`applyDownvotedClass()` walks every `.commtext` and adds `.downvoted` to the parent `.comment` when the `c00` class is missing — that's HN's signal for a downvoted comment, and our CSS uses it to swap grey-on-grey for black on faint grey.

`transformQuotes()` walks every `<i>`, `<p>`, and `<span>` whose first text-node child starts with `>` and rewrites that text node into a `<p class="quote">`. Two shapes are handled: marker + body in one text node (`> text`) — body extracted via `stripLeadingQuoteMarker`; or marker alone in the text node with the body in the next sibling (e.g. `<i>&gt; <a>link</a></i>`) — the sibling is moved into the new `<p>` via `appendChild` so any nested elements survive intact. The pass is idempotent (skips elements already carrying `.quote`).

`setupCommentBoxToggle()` (in `src/features/comment-box-toggle.js`) runs only on item pages. It hides `.fatitem tr:last-of-type` (the comment-submit row), prepends a `<tr class="showComment">` carrying a "show comment box" link, and appends a "hide comment box" link inside the form. Both links toggle the same two classes. Returns early on missing nodes (locked threads, logged-out views).

### Comment-tree tweaks (item pages only)

A handful of small DOM passes that make the comment tree easier to read and faster to skim. All live under `src/features/` and are invoked once after the page loads.

`setupClickIndentToggle()` (in `src/features/click-indent-toggle.js`) walks every `tr.comtr`, adds the `.hn-clickable-indent` class to its `td.ind`, and attaches a click handler that routes by class: on rows tagged `.hn-low-score` (the auto-collapse-low-score feature) it toggles `.hn-low-score-expanded` to show or hide just that comment's body; on every other row it fires the row's native `a.togg` (HN's subtree-collapse). The CSS adds `cursor: pointer` and a hover box-shadow so the gutter looks clickable.

`setupCollapseRootComment()` (in `src/features/collapse-root-comment.js`) reads each comment's indent level from the width of `td.ind img` (HN renders one indent unit as 40px), passes the level array to the pure helper `findCommentRootIndices` in `src/parsing.js`, and uses the result to inject a `[collapse root]` link into every non-root comment's `span.comhead`. Clicking the link fires the root comment's `a.togg` and scrolls the page back to the (now-collapsed) root so the reader doesn't lose their place. Roots themselves don't get the link.

`transformBackticksToMonospace()` (in `src/features/backticks-to-monospace.js`) walks the text nodes inside every `.commtext` with a `TreeWalker`, calls the pure helper `splitBackticks` (in `src/parsing.js`) to chop each text node into alternating text/code segments at backtick pairs, and replaces the original text node with a `DocumentFragment` of `Text` and `<code>` nodes. The walker rejects text inside existing `<code>`, `<pre>`, and `<a>` elements so we don't mangle pre-formatted code blocks or rewrite link text. Empty backtick pairs (`` `` ``) survive as text — the regex requires at least one non-backtick character between the marks.

`setupToggleAllComments()` (in `src/features/toggle-all-comments.js`) appends a "toggle all" link to the fatitem subtext that fires `a.togg` on every top-level (`indent == 0`) `tr.comtr`. A second, opt-in pass under `TOGGLE_ALL_REPLIES_ENABLED` (in `src/config.js`, default `false`) adds a "[toggle replies]" link to every comment that has direct children. The reply pass is gated because adding a link to every comment scales linearly with thread size — refined-hacker-news warns that it slows page render on items with hundreds of comments.

`setupHighlightUnreadComments({ store })` (in `src/features/highlight-unread-comments.js`) reads the current page's comment IDs (from `tr.comtr[id]`), compares them against the IDs we stored on the previous visit to the same item under `state.readComments[itemId]`, and adds the `.hn-new-comment` class to the `tr.comtr` row of any ID that wasn't there before. (The class lives on the row rather than `td.ind` because the indent cell collapses to ~0 width on root-level comments, leaving any background paint invisible there.) The first visit to a thread doesn't highlight anything (there's nothing to compare against) but does store the ID list so the next visit can. Stale entries (older than `READ_COMMENTS_TTL_MS` = 3 days) are pruned on every item-page load via `store.pruneReadComments`. The pure helpers `findNewCommentIds`, `isReadCommentEntryFresh`, and `pruneExpiredReadComments` live in `src/parsing.js` and are unit-tested.

The remaining tweaks (dead-comment recolour, indent-gutter separator, `<pre>` and inline `<code>` background) are CSS-only — see the rules at the bottom of `src/styles.js`. They piggyback on HN's own classes (`.commtext.cdd` for dead, `tr.comtr td.ind` for the gutter) so no JS pass is needed.

### Auto-collapse low-score authors (`src/features/auto-collapse-low-score.js`)

`setupAutoCollapseLowScore({ store })` runs once per item-page load. It walks every `tr.comtr`, tags each with `data-hn-author=<username>` (so `rerenderUserRatings` can later target rows by author via the same `[data-hn-...]` selector pattern that the rest of the code uses), and adds the `.hn-low-score` class to rows whose author's stored rating is `<= LOW_SCORE_COLLAPSE_THRESHOLD` (`-10`, in `src/config.js`). A faint `[low score]` marker is appended to the comhead next to the existing `[collapse root]` link so the empty body has a visible reason.

The CSS in `src/styles.js` hides `.commtext` and `.reply` for `.hn-low-score` rows; the toggle marker `.hn-low-score-expanded` (added by `setupClickIndentToggle`'s click handler) reverts the hide on a single row at a time. Replies — which are separate `tr.comtr` rows at greater indent — are unaffected, which is the whole point of using a custom collapse rather than HN's native subtree toggle.

`rerenderUserRatings` (in `user-render.js`) is extended to apply or remove `.hn-low-score` (and clear `.hn-low-score-expanded`) on every row by the user when their rating changes, and to keep the `[low score]` comhead marker in lockstep with the class. Cross-tab rating writes flow through the same `rerenderUserRatings` call site that the existing per-user fan-out uses, so there's no second sync mechanism.

### Parent-link hover popup (`src/features/parent-hover.js`)

`setupParentHover({ fetchItem, popup })` finds every `parent` link in `span.comhead` and wires `popup.attachDwell` so a hover beyond `HOVER_DWELL_MS` opens the shared popup with the parent's body. Source resolution is DOM-first: `document.getElementById(parentId)` against the on-page comment table, falling back to `fetchItem(parentId)` (the same cache the cited-item hover uses) when the parent isn't rendered on the current page. The body is split into paragraphs by `splitHtmlIntoParagraphs` (in `src/parsing.js`), the first two are rendered, and an ellipsis line is appended when more were dropped. Author, timestamp, and score are deliberately omitted — the popup is a body-text reminder, not a metadata view.

Story parents (the case for top-level comments, whose `parent` link points back to the item itself) take the API path. The digest's `title` is rendered as a bold first line; the body — only present for Ask/Show — follows.

The shared `createHoverPopup` primitive grows a single document-level `Escape` `keydown` listener that calls its existing `hide()` when a popup is visible, so user/item/parent hovers all inherit keyboard dismissal at no extra cost.

### User rendering (`src/features/user-render.js`)

Exposed as a factory: `createUserRender({ store, fetchUser, openTagManager })` → `{ renderAllUsernames, rerenderUserTags, rerenderUserRatings }`. Wired in `src/main.js`.

`renderAllUsernames()` iterates `.hnuser` elements and for each one builds a skeleton row synchronously (rating controls, tag input, tag list) from store state. The `(age, karma)` blurb is a `(loading…)` placeholder that gets replaced asynchronously by `fetchUser(username).then(...)`. This means a slow or hung request cannot block the rest of the page from rendering.

OP highlight is folded into the same loop: `renderAllUsernames()` reads `.fatitem .hnuser` once at the top to capture the item author, then for every comment-row `.hnuser` whose text matches it adds the `.hn-op` class plus a " [op]" text node child. The `.fatitem` `.hnuser` itself is excluded (its OP-ness is already obvious from being in the item header). The CSS gives `.hn-op` an HN-orange `color` so the suffix and username read together as a single accent.

`fetchUser` (in `src/api.js`, returned by `createApi({ store })`) is protected by:
- A persistent cache (`store.getCachedUser`) with a 6h TTL — repeat users incur zero network cost.
- An in-memory `inflight` Map deduping concurrent fetches for the same username.
- An 8s `timeout` on `GM_xmlhttpRequest` — without it the request can hang forever and the page never finishes. A failed or timed-out fetch removes the placeholder rather than leaving a ghost.

Tag/rating mutations sync across all comments by the same user on the page. Injected DOM elements carry a `data-hn-user` attribute so `rerenderUserTags(username)` and `rerenderUserRatings(username)` can query all instances and update them in one pass, rather than only updating the single comment where the action occurred.

Cross-tab sync (in `src/main.js`) uses `GM_addValueChangeListener` on `STATE_KEY`. When another tab writes to `hn_state`, the listener fires with `remote === true`, the store's in-memory cache is invalidated via `store._invalidate()`, and all visible users are re-rendered. The listener is guarded behind a `typeof` check so the script degrades gracefully if the API is unavailable.

The rerender fires for every cross-tab write to `STATE_KEY`, not just tag/rating mutations — `setCachedUser`, `setCachedItem`, `updateWatchKids`, `setReadComments`, and so on all bump the same blob. To stop those incidental writes from clobbering text the user is mid-typing into a tag input, `rerenderUserTags(username)` skips both the focused `.hn-tag-input` and every `.hn-tag-group` for that user when one of its inputs has focus. The tag-group preview is left alone so the `renderPreview` keystroke handler stays the source of truth for what the user sees while typing; commit-on-blur is unaffected because the input has already lost focus by the time `commit` runs.

If the tag-management overlay is open when a remote write arrives, the listener also calls `tagManager.getActive()?.markStale()`. The overlay disables Save, shows a "changed in another tab" marker in its header, and blocks a dirty save with an alert — so the user can't silently overwrite newer data with a stale draft. They have to close and reopen the overlay to pick up the new state.

### Tag management overlay (`src/features/tag-manager.js`)

Exposed as a factory: `createTagManager({ store, rerenderUserTags })` → `{ open, getActive }`. Opened via the ☰ icon on any inline tag (wired through `openTagManager` in `createUserRender`'s deps). The filter input is focused on open so the user can start typing to narrow the list immediately. The overlay holds a draft `{tags, colors}` snapshot in a closure; edits are applied to the draft via three pure helpers (`renameTagInState`, `removeTagInState`, `countsFromState`), not to the store. Save calls `store.replaceTagsAndColors(draft.tags, draft.colors)`, which performs one backend write — this is also the one cross-tab broadcast. Cancel, Escape (with no field focused), and click-outside all discard the draft, with a confirm prompt if the draft differs from live state.

Each overlay row is keyed by the tag's name as it was when the overlay opened. Per-row state is `{currentName, pendingRemoval}` plus a dropped-when-merged marker. The displayed list and counts are derived from the draft on every re-render.

### Toolbar / export-import (`src/features/toolbar.js`)

Exposed as a factory: `createToolbar({ store, backend })` → `{ mount }`. `mount()` builds a small draggable bar in the top-right with Save state / Restore state buttons.

Export format extends the v0.3 shape with a `watches` slot, but is otherwise backward compatible: `{ customTags, users, watches }`. Old backups without `watches` import as before with an empty watch list. `stateToExport(state)` (in `src/state.js`) produces it from a snapshot of the store; `parseImport(raw)` accepts both the normalized format and the legacy flat-key dump. Import writes the new consolidated blob via the backend and reloads.

### Watch-for-replies (`src/features/watch-toggles.js`, `watched-comment-nav.js`, `watched-listing-highlights.js`)

A per-comment "watch this for replies" toggle. On click, the eye icon between the rating control and the tag input persists `state.watchedComments[commentId] = { itemId, seenKids, latestKids, lastCheckedAt, addedAt }`. The watch is per-comment (not per-user) — a single user with three comments in a thread can be watched on one, two, or all three independently.

Reply detection is proactive: every HN page load (including listing pages) walks the watches map, fires a `fetchItem(commentId, { fresh: true })` for any watch whose `lastCheckedAt` is past the 60-second throttle, and updates `latestKids` with the response. The `fresh` opt-in bypasses `fetchItem`'s 6-hour persistent cache; without it, the throttle would be a no-op for the first six hours after a watch is created. The throttle is short on purpose: anything longer leaves the listing-page highlight stale after the most recent item-page sync, since `markWatchSeen` resets `seenKids = latestKids` on every item-page visit.

`hasNew` is derived as `latestKids.some(id => !seenKids.includes(id))`. On listing pages, the "n comments" link gets `.hn-watched-link` (bold HN orange + a `★ ` prefix) when any watch in that thread has `hasNew`. On item pages, every watched-comment row on the page is given `.hn-watched` (orange left border + faint yellow tint), and `markWatchSeen` syncs `seenKids = latestKids` so the listing-page highlight is cleared by the act of visiting.

Lifecycle: watches persist until the user toggles off. A 14-day TTL (`WATCH_TTL_MS`) is enforced on every item-page load via `store.pruneWatchedComments` — HN threads rarely receive replies after that window, and the prune stops the list growing forever on cold threads.

The toolbar gains two extra buttons (`↑ watch`, `watch ↓`) when at least one watched comment WITH new direct replies is on the page, jumping between those comments in document order. Watched comments with no new replies are not nav targets — the buttons exist to surface activity, so a quiet watch shouldn't pull the user there. `watched-comment-nav` discovers the toolbar's button container via the new `toolbar.getButtonsContainer()` accessor — the toolbar itself doesn't know about watches.

### Wiring (`src/main.js`)

`main.js` is the bootstrap and the only place the GM_* globals are referenced for setup:

1. `GM_addStyle(STYLES)` injects all CSS.
2. Builds the `{ get, set, list }` backend adapter around `GM_getValue`/`GM_setValue`/`GM_listValues`.
3. `migrateLegacyKeys(backend)` then `createStore(backend)`.
4. `createApi({ store })` for `fetchUser`.
5. `createTagManager` and `createUserRender` are constructed with mutual references (each closes over a getter for the other; both bindings exist by the time either's stored callback runs on a click).
6. `createToolbar({ store, backend })` for export/import.
7. `GM_addValueChangeListener(STATE_KEY, …)` for cross-tab sync — calls `tagManager.getActive()?.markStale()` and the user-render rerender helpers.
8. Always: `applyDownvotedClass()`, `transformQuotes()`.
9. On item pages only (`isItemPage()`): `setupCommentBoxToggle()`, `userRender.renderAllUsernames()`, `toolbar.mount()`, `setupWatchedCommentNav()`, `setupWatchToggles()`. The nav must capture its targets before `setupWatchToggles`'s page-load sync runs — that sync calls `markWatchSeen` synchronously on the "not stale" path (when the listing-page recheck just ran within the 60s throttle), and `markWatchSeen` sets `seenKids = latestKids`, zeroing the `hasNew` predicate the nav reads.

## Userscript metadata

The `==UserScript==` header is owned by `scripts/build.js` (the `HEADER` constant) and prepended to the bundle on every build. It declares the `@match` (`https://news.ycombinator.com/*` — every HN page) and required `@grant`s: `GM_xmlhttpRequest`, `GM_setValue`, `GM_getValue`, `GM_addStyle`, `GM_listValues`, `GM_addValueChangeListener`. Adding any new `GM_*` API requires adding a matching `@grant` line in `scripts/build.js` or it will be undefined at runtime. The site-wide CSS and DOM passes apply on every match; the comment-page enrichment is gated at runtime via `isItemPage()` (in `src/dom.js`), which checks `window.location.pathname === "/item"`.

## Code style

- ES modules under `src/`. Use `import { x } from "./y.js"` (with the explicit `.js` extension, since this is plain Node ESM, no bundler resolution).
- Biome-enforced: tab indent, semicolons, double quotes. Run `just fmt` before committing.
- Class names on injected DOM that we own are namespaced `hn-*` to avoid clashing with HN's own styles. Class names that are CSS-only (no JS query-selector usage) and come from the legibility layer — `downvoted`, `quote`, `hidden`, `showComment`, `hideComment` — keep their original names so the upstream CSS rules apply unchanged.
- DOM creation goes through the `h(tag, props, children)` helper in `src/dom.js`, which intentionally does not support setting `innerHTML` — all text goes through `textContent`. The legibility-layer DOM passes (`transformQuotes`, `setupCommentBoxToggle`) use `h()` and proper DOM moves (`appendChild` to relocate live nodes) rather than the upstream's `innerText = innerHTML` shortcut, which silently flattened nested elements into literal text.
- Site-wide colors and spacing read from CSS custom properties (`--colour-hn-orange`, `--colour-hn-orange-pale`, `--gutter`, `--border-radius`) defined in `:root` (in `src/styles.js`). Our injected toolbar/overlay CSS uses these too — keep new rules consistent so theme changes stay one-line.

## Gotchas

- Pure-logic modules (`src/config.js`, `src/parsing.js`, `src/state.js`) must not reference `document`, `window`, or any `GM_*` API. If you need those, put the code in a feature module under `src/features/` (or `src/api.js`/`src/dom.js`/`src/main.js`).
- When adding a new pure helper, put it in `parsing.js` or `state.js`, export it, and add a test that imports from the source file directly. Tests never import the built `script.js`.
- The original `.hnuser` element is hidden (`display: none`) rather than removed, because HN's own click handlers may still reference it.
- HN's site-wide `input { padding }` rule from the legibility layer would otherwise inflate our compact `.hn-tag-input`, `.hn-tagmgr-filter`, and `.hn-tagmgr-name-input` fields, so each carries a tighter padding override. The orange `border` + `border-radius` from the site-wide rule are kept on purpose — those fields are intentionally styled the same as HN's native inputs.
- `transformQuotes` runs before `renderAllUsernames`. It selects `i, p, span` and rewrites the first text-node child when it starts with `>`. Usernames live in `.hnuser` (an `<a>`), so the two passes don't intersect — but if you ever inject elements that contain a `>`-prefixed text node before `transformQuotes` runs, that pass will rewrite them.
- The build script's import/export stripping is regex-based and only handles the simple forms we use today (`import { x } from "./y.js";`, `export function`, `export const`, `export let`, `export var`, `export class`, `export async function`). If you need re-exports, dynamic imports, or default exports, extend `scripts/build.js` accordingly.
- `script.js` is a build artifact. Don't hand-edit it — every change must come from `src/` and get rebuilt with `just build`.

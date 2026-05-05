# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tampermonkey/Violentmonkey userscript with two cooperating layers:

1. **Site-wide legibility layer** (every HN page, `news.ycombinator.com/*`): font reset, sizing, gutters, full-width main, downvoted-comment restyling (black-on-faint-grey), quoted-text rendering (`>`-prefixed text wrapped in `<p class="quote">` with HN-orange accents), and `.rank` hidden. CSS comes from a `:root` block with `--colour-hn-orange`, `--colour-hn-orange-pale`, `--gutter`, and `--border-radius` tokens. Adapted from [mgladdish/website-customisations](https://github.com/mgladdish/website-customisations).
2. **Comment-page enrichment layer** (only `news.ycombinator.com/item?id=*`, gated by `isItemPage()`): account age + karma inline, per-user custom tags with colors, per-user up/down rating, OP highlight (`[op]` suffix on every comment by the item submitter), click-the-indent-gutter to collapse, `[collapse root]` link on nested comments, dead-comment recolour, indent-gutter separator, `<pre>`/`<code>` styling, draggable toolbar for export/import, and a "show comment box" toggle that collapses the page-bottom comment-submit form.

`src/main.js` runs the legibility passes (`applyDownvotedClass`, `transformQuotes`) on every HN page and the enrichment passes (`setupCommentBoxToggle`, `setupClickIndentToggle`, `setupCollapseRootComment`, `userRender.renderAllUsernames`, `toolbar.mount`) only on item pages.

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
  config.js                  Storage key, schema version, TTL/timeout constants
  parsing.js                 Pure helpers: timeSince, stripLeadingQuoteMarker, parseTagInput,
                             findCommentRootIndices
  state.js                   createStore, migrateLegacyKeys, parseImport, stateToExport,
                             renameTagInState, removeTagInState, countsFromState
  dom.js                     h() factory, findCommentParent, isItemPage
  styles.js                  CSS as a single tagged-template export (STYLES)
  api.js                     createApi factory: fetchUser with cache + inflight + timeout
  features/
    legibility.js            applyDownvotedClass, transformQuotes (run on every HN page)
    comment-box-toggle.js    setupCommentBoxToggle (item pages only)
    click-indent-toggle.js   setupClickIndentToggle: makes td.ind a click target for a.togg
    collapse-root-comment.js setupCollapseRootComment: appends "[collapse root]" link
                             to every non-root comment's comhead
    user-render.js           createUserRender factory: renderAllUsernames + per-user rerender
                             (also adds the .hn-op class + " [op]" marker on OP's comments)
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
  cache:   { <user>: { created, karma, fetchedAt } } }
```
Callers never touch `GM_setValue`/`GM_getValue` directly — they go through the `store` object returned by `createStore(backend)` in `src/state.js`, where `backend` is the `{ get, set, list }` adapter that `src/main.js` builds around the `GM_*` APIs. The store consolidates writes into one JSON blob; reads are cached in memory.

On first run, `migrateLegacyKeys(backend)` rewrites the pre-0.4 per-user keys (`hn_author_rating_*`, `hn_custom_tags_*`, `hn_custom_tag_color_*`) into the new format. Legacy keys are left in place for one version as a rollback safety net.

### Site-wide passes (`src/features/legibility.js`)

`applyDownvotedClass()` walks every `.commtext` and adds `.downvoted` to the parent `.comment` when the `c00` class is missing — that's HN's signal for a downvoted comment, and our CSS uses it to swap grey-on-grey for black on faint grey.

`transformQuotes()` walks every `<i>`, `<p>`, and `<span>` whose first text-node child starts with `>` and rewrites that text node into a `<p class="quote">`. Two shapes are handled: marker + body in one text node (`> text`) — body extracted via `stripLeadingQuoteMarker`; or marker alone in the text node with the body in the next sibling (e.g. `<i>&gt; <a>link</a></i>`) — the sibling is moved into the new `<p>` via `appendChild` so any nested elements survive intact. The pass is idempotent (skips elements already carrying `.quote`).

`setupCommentBoxToggle()` (in `src/features/comment-box-toggle.js`) runs only on item pages. It hides `.fatitem tr:last-of-type` (the comment-submit row), prepends a `<tr class="showComment">` carrying a "show comment box" link, and appends a "hide comment box" link inside the form. Both links toggle the same two classes. Returns early on missing nodes (locked threads, logged-out views).

### Comment-tree tweaks (item pages only)

A handful of small DOM passes that make the comment tree easier to read and faster to skim. All three live under `src/features/` and are invoked once after the page loads.

`setupClickIndentToggle()` (in `src/features/click-indent-toggle.js`) walks every `tr.comtr`, adds the `.hn-clickable-indent` class to its `td.ind`, and attaches a click handler that fires the row's native `a.togg`. The CSS adds `cursor: pointer` and a hover box-shadow so the gutter looks clickable.

`setupCollapseRootComment()` (in `src/features/collapse-root-comment.js`) reads each comment's indent level from the width of `td.ind img` (HN renders one indent unit as 40px), passes the level array to the pure helper `findCommentRootIndices` in `src/parsing.js`, and uses the result to inject a `[collapse root]` link into every non-root comment's `span.comhead`. Clicking the link fires the root comment's `a.togg` and scrolls the page back to the (now-collapsed) root so the reader doesn't lose their place. Roots themselves don't get the link.

The remaining tweaks (dead-comment recolour, indent-gutter separator, `<pre>` and inline `<code>` background) are CSS-only — see the rules at the bottom of `src/styles.js`. They piggyback on HN's own classes (`.commtext.cdd` for dead, `tr.comtr td.ind` for the gutter) so no JS pass is needed.

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

If the tag-management overlay is open when a remote write arrives, the listener also calls `tagManager.getActive()?.markStale()`. The overlay disables Save, shows a "changed in another tab" marker in its header, and blocks a dirty save with an alert — so the user can't silently overwrite newer data with a stale draft. They have to close and reopen the overlay to pick up the new state.

### Tag management overlay (`src/features/tag-manager.js`)

Exposed as a factory: `createTagManager({ store, rerenderUserTags })` → `{ open, getActive }`. Opened via the ☰ icon on any inline tag (wired through `openTagManager` in `createUserRender`'s deps). The filter input is focused on open so the user can start typing to narrow the list immediately. The overlay holds a draft `{tags, colors}` snapshot in a closure; edits are applied to the draft via three pure helpers (`renameTagInState`, `removeTagInState`, `countsFromState`), not to the store. Save calls `store.replaceTagsAndColors(draft.tags, draft.colors)`, which performs one backend write — this is also the one cross-tab broadcast. Cancel, Escape (with no field focused), and click-outside all discard the draft, with a confirm prompt if the draft differs from live state.

Each overlay row is keyed by the tag's name as it was when the overlay opened. Per-row state is `{currentName, pendingRemoval}` plus a dropped-when-merged marker. The displayed list and counts are derived from the draft on every re-render.

### Toolbar / export-import (`src/features/toolbar.js`)

Exposed as a factory: `createToolbar({ store, backend })` → `{ mount }`. `mount()` builds a small draggable bar in the top-right with Save state / Restore state buttons.

Export format is unchanged from v0.3 for backward compatibility: `{ customTags, users }`. `stateToExport(state)` (in `src/state.js`) produces it from a snapshot of the store; `parseImport(raw)` accepts both the normalized format and the legacy flat-key dump. Import writes the new consolidated blob via the backend and reloads.

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
9. On item pages only (`isItemPage()`): `setupCommentBoxToggle()`, `userRender.renderAllUsernames()`, `toolbar.mount()`.

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

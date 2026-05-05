# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Tampermonkey/Violentmonkey userscript with two cooperating layers, both inside `script.js`:

1. **Site-wide legibility layer** (every HN page, `news.ycombinator.com/*`): font reset, sizing, gutters, full-width main, downvoted-comment restyling (black-on-faint-grey), quoted-text rendering (`>`-prefixed text wrapped in `<p class="quote">` with HN-orange accents), and `.rank` hidden. CSS comes from a `:root` block with `--colour-hn-orange`, `--colour-hn-orange-pale`, `--gutter`, and `--border-radius` tokens. Adapted from [mgladdish/website-customisations](https://github.com/mgladdish/website-customisations).
2. **Comment-page enrichment layer** (only `news.ycombinator.com/item?id=*`, gated by `isItemPage()`): account age + karma inline, per-user custom tags with colors, per-user up/down rating, draggable toolbar for export/import, and a "show comment box" toggle that collapses the page-bottom comment-submit form.

The bootstrap runs the legibility passes (`applyDownvotedClass`, `transformQuotes`) on every HN page and the enrichment passes (`setupCommentBoxToggle`, `renderAllUsernames`, `createToolbar`) only on item pages.

## Commands

- **Test**: `just test` (or `node --test "tests/*.test.js"`)
- **Lint**: `just lint` (or `biome lint --write script.js`)
- **Format**: `just fmt` (or `biome format --write script.js`)
- **All of the above**: `just check` (runs lint, fmt, and test — the pre-commit gate)
- **Run**: load `script.js` in a userscript manager (Tampermonkey/Violentmonkey). No build step.

## Architecture

`script.js` has two halves separated by a hard boundary:

1. **Pure logic (top of file, above the `if (typeof GM_addStyle !== "undefined")` guard).** Node-testable helpers: no DOM, no `GM_*` references. The authoritative list of what's testable lives in the `module.exports` block at the bottom of this section — consult it rather than duplicating the list here. Tests live in `tests/` and run on `node:test`.
2. **Browser bootstrap (below the guard).** Does DOM manipulation, network I/O, and event wiring. Runs only inside a userscript runtime.

### Storage

All state lives under a single `hn_state` key (`STATE_KEY`) with this shape:
```
{ schemaVersion: 1,
  ratings: { <user>: int },
  tags:    { <user>: [<tagName>, ...] },
  colors:  { <tagName>: { bgColor, textColor } },
  cache:   { <user>: { created, karma, fetchedAt } } }
```
Callers never touch `GM_setValue`/`GM_getValue` directly — go through the `store` object returned by `createStore(backend)` where `backend` is the `{ get, set, list }` adapter wrapping the `GM_*` APIs. The store consolidates writes into one JSON blob; reads are cached in memory.

On first run, `migrateLegacyKeys(backend)` rewrites the pre-0.4 per-user keys (`hn_author_rating_*`, `hn_custom_tags_*`, `hn_custom_tag_color_*`) into the new format. Legacy keys are left in place for one version as a rollback safety net.

### Site-wide passes

`applyDownvotedClass()` walks every `.commtext` and adds `.downvoted` to the parent `.comment` when the `c00` class is missing — that's HN's signal for a downvoted comment, and our CSS uses it to swap grey-on-grey for black on faint grey.

`transformQuotes()` walks every `<i>`, `<p>`, and `<span>` whose first text-node child starts with `>` and rewrites that text node into a `<p class="quote">`. Two shapes are handled: marker + body in one text node (`> text`) — body extracted via `stripLeadingQuoteMarker`; or marker alone in the text node with the body in the next sibling (e.g. `<i>&gt; <a>link</a></i>`) — the sibling is moved into the new `<p>` via `appendChild` so any nested elements survive intact. The pass is idempotent (skips elements already carrying `.quote`).

`setupCommentBoxToggle()` runs only on item pages. It hides `.fatitem tr:last-of-type` (the comment-submit row), prepends a `<tr class="showComment">` carrying a "show comment box" link, and appends a "hide comment box" link inside the form. Both links toggle the same two classes. Returns early on missing nodes (locked threads, logged-out views).

### Rendering

`renderAllUsernames()` iterates `.hnuser` elements and for each one builds a skeleton row synchronously (rating controls, tag input, tag list) from store state. The `(age, karma)` blurb is a `(loading…)` placeholder that gets replaced asynchronously by `fetchUser(username).then(...)`. This means a slow or hung request cannot block the rest of the page from rendering.

`fetchUser` is protected by:
- A persistent cache (`store.getCachedUser`) with a 6h TTL — repeat users incur zero network cost.
- An in-memory `inflight` Map deduping concurrent fetches for the same username.
- An 8s `timeout` on `GM_xmlhttpRequest` — without it the request can hang forever and the page never finishes. A failed or timed-out fetch removes the placeholder rather than leaving a ghost.

Tag/rating mutations sync across all comments by the same user on the page. Injected DOM elements carry a `data-hn-user` attribute so `rerenderUserTags(username)` and `rerenderUserRatings(username)` can query all instances and update them in one pass, rather than only updating the single comment where the action occurred.

Cross-tab sync uses `GM_addValueChangeListener` on `STATE_KEY`. When another tab writes to `hn_state`, the listener fires with `remote === true`, the store's in-memory cache is invalidated via `store._invalidate()`, and all visible users are re-rendered. The listener is guarded behind a `typeof` check so the script degrades gracefully if the API is unavailable.

If the tag-management overlay is open when a remote write arrives, the listener also calls `activeTagManager?.markStale()`. The overlay disables Save, shows a "changed in another tab" marker in its header, and blocks a dirty save with an alert — so the user can't silently overwrite newer data with a stale draft. They have to close and reopen the overlay to pick up the new state.

### Tag management overlay

Opened via the ☰ icon on any inline tag. The filter input is focused on open so the user can start typing to narrow the list immediately. The overlay holds a draft `{tags, colors}` snapshot in a closure; edits are applied to the draft via three pure helpers (`renameTagInState`, `removeTagInState`, `countsFromState`), not to the store. Save calls `store.replaceTagsAndColors(draft.tags, draft.colors)`, which performs one backend write — this is also the one cross-tab broadcast. Cancel, Escape (with no field focused), and click-outside all discard the draft, with a confirm prompt if the draft differs from live state.

Each overlay row is keyed by the tag's name as it was when the overlay opened. Per-row state is `{currentName, pendingRemoval}` plus a dropped-when-merged marker. The displayed list and counts are derived from the draft on every re-render.

### Export/import

Export format is unchanged from v0.3 for backward compatibility: `{ customTags, users }`. `stateToExport(state)` produces it from the consolidated store; `parseImport(raw)` accepts both the normalized format and the legacy flat-key dump. Import writes the new consolidated blob and reloads.

## Userscript metadata

The `==UserScript==` header at the top of `script.js` declares the `@match` (`https://news.ycombinator.com/*` — every HN page) and required `@grant`s: `GM_xmlhttpRequest`, `GM_setValue`, `GM_getValue`, `GM_addStyle`, `GM_listValues`, `GM_addValueChangeListener`. Adding any new `GM_*` API requires adding a matching `@grant` line or it will be undefined at runtime. The site-wide CSS and DOM passes apply on every match; the comment-page enrichment is gated at runtime via `isItemPage()`, which checks `window.location.pathname === "/item"`.

## Code style

- Biome-enforced: tab indent, semicolons, double quotes. Run `just fmt` before committing.
- Class names on injected DOM that we own are namespaced `hn-*` to avoid clashing with HN's own styles. Class names that are CSS-only (no JS query-selector usage) and come from the legibility layer — `downvoted`, `quote`, `hidden`, `showComment`, `hideComment` — keep their original names so the upstream CSS rules apply unchanged.
- DOM creation goes through the `h(tag, props, children)` helper, which intentionally does not support setting `innerHTML` — all text goes through `textContent`. The legibility-layer DOM passes (`transformQuotes`, `setupCommentBoxToggle`) use `h()` and proper DOM moves (`appendChild` to relocate live nodes) rather than the upstream's `innerText = innerHTML` shortcut, which silently flattened nested elements into literal text.
- Site-wide colors and spacing read from CSS custom properties (`--colour-hn-orange`, `--colour-hn-orange-pale`, `--gutter`, `--border-radius`) defined in `:root`. Our injected toolbar/overlay CSS uses these too — keep new rules consistent so theme changes stay one-line.

## Gotchas

- The pure-logic section must not reference `document`, `window`, or any `GM_*` API. If you need those, put the code below the bootstrap guard.
- The original `.hnuser` element is hidden (`display: none`) rather than removed, because HN's own click handlers may still reference it.
- When adding a new pure function, also add it to the `module.exports` block near the bottom of the pure-logic section, or tests can't see it.
- HN's site-wide `input { padding }` and `input { border }` rules from the legibility layer would otherwise inflate our compact `.hn-tag-input`, `.hn-tagmgr-filter`, and `.hn-tagmgr-name-input` fields. Their CSS rules carry explicit `padding`/`border`/`border-radius` overrides for that reason — don't drop them when refactoring.
- `transformQuotes` runs before `renderAllUsernames`. It selects `i, p, span` and rewrites the first text-node child when it starts with `>`. Usernames live in `.hnuser` (an `<a>`), so the two passes don't intersect — but if you ever inject elements above the bootstrap guard that contain a `>`-prefixed text node, `transformQuotes` will rewrite them.

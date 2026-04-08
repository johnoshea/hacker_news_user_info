# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Tampermonkey/Violentmonkey userscript that augments Hacker News comment pages (`news.ycombinator.com/item?id=*` only) with: account age + karma inline, per-user custom tags with colors, and a per-user up/down rating. Also adds a draggable toolbar for exporting/importing all local state as JSON.

## Commands

- **Test**: `just test` (or `node --test "tests/*.test.js"`)
- **Lint**: `just lint` (or `biome lint --write script.js`)
- **Format**: `just fmt` (or `biome format --write script.js`)
- **Run**: load `script.js` in a userscript manager (Tampermonkey/Violentmonkey). No build step.

## Architecture

`script.js` has two halves separated by a hard boundary:

1. **Pure logic (top of file, above the `if (typeof GM_addStyle !== "undefined")` guard).** Contains `timeSince`, `createStore`, `migrateLegacyKeys`, `parseImport`, `stateToExport`, and their constants. Node-testable: no DOM, no GM_* references. Exported via a conditional `module.exports` block so `require("./script.js")` in Node returns the pure functions while the userscript runtime ignores the export. Tests live in `tests/` and run on `node:test`.
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

### Rendering

`renderAllUsernames()` iterates `.hnuser` elements and for each one builds a skeleton row synchronously (rating controls, tag input, tag list) from store state. The `(age, karma)` blurb is a `(loading…)` placeholder that gets replaced asynchronously by `fetchUser(username).then(...)`. This means a slow or hung request cannot block the rest of the page from rendering.

`fetchUser` is protected by:
- A persistent cache (`store.getCachedUser`) with a 6h TTL — repeat users incur zero network cost.
- An in-memory `inflight` Map deduping concurrent fetches for the same username.
- An 8s `timeout` on `GM_xmlhttpRequest` — without it the request can hang forever and the page never finishes. A failed or timed-out fetch removes the placeholder rather than leaving a ghost.

Tag edit/remove re-renders the affected user's `.hn-tag-group` in place (`renderTagGroup(username, container)`) instead of reloading the page.

### Export/import

Export format is unchanged from v0.3 for backward compatibility: `{ customTags, users }`. `stateToExport(state)` produces it from the consolidated store; `parseImport(raw)` accepts both the normalized format and the legacy flat-key dump. Import writes the new consolidated blob and reloads.

## Userscript metadata

The `==UserScript==` header at the top of `script.js` declares the `@match` (only HN item pages) and required `@grant`s: `GM_xmlhttpRequest`, `GM_setValue`, `GM_getValue`, `GM_addStyle`, `GM_listValues`. Adding any new `GM_*` API requires adding a matching `@grant` line or it will be undefined at runtime.

## Code style

- Biome-enforced: tab indent, semicolons, double quotes. Run `just fmt` before committing.
- Class names on injected DOM are namespaced `hn-*` to avoid clashing with HN's own styles.
- DOM creation goes through the `h(tag, props, children)` helper, which intentionally does not support setting `innerHTML` — all text goes through `textContent`.

## Gotchas

- The pure-logic section must not reference `document`, `window`, or any `GM_*` API. If you need those, put the code below the bootstrap guard.
- The original `.hnuser` element is hidden (`display: none`) rather than removed, because HN's own click handlers may still reference it.
- When adding a new pure function, also add it to the `module.exports` block near the bottom of the pure-logic section, or tests can't see it.

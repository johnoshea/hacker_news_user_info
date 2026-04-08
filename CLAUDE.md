# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Tampermonkey/Violentmonkey userscript that augments Hacker News comment pages (`news.ycombinator.com/item?id=*` only) with: account age + karma inline, per-user custom tags with colors, and a per-user up/down rating. Also adds a draggable toolbar for exporting/importing all local state as JSON.

## Commands

- **Lint**: `biome lint --write script.js`
- **Format**: `biome format --write script.js`
- **Run**: load `script.js` in a userscript manager (Tampermonkey/Violentmonkey). No build step.

There are no tests.

## Architecture

Everything lives in `script.js` as one IIFE. Inside it, code is organized into named sub-objects — when changing behavior, find the matching section rather than grepping blindly:

- `GM_addStyle(...)` block at top — all CSS, kept separate from DOM code.
- `fetchUserData(username)` — wraps `GM_xmlhttpRequest` against `hacker-news.firebaseio.com/v0/user/{username}.json`, with an in-memory `userDataCache` Map to dedupe.
- `storage` — thin wrapper over `GM_setValue`/`GM_getValue`. **Key conventions** (load-bearing — anything touching state must use these):
  - `hn_author_rating_<username>` → integer
  - `hn_custom_tags_<username>` → JSON array of `{value, bgColor, textColor}`
  - `hn_custom_tag_color_<tag>` → JSON `{bgColor, textColor}` (shared color per tag name)
- `colorUtils` — random pastel HSL generator + HSL→luminance contrast picker for tag text.
- `ui` — DOM factory functions (`createRatingControls`, `createTagInput`, `createTagSpan`, `createAccountInfoSpan`).
- `displayAccountInfoAndTags()` — main pass: collects `.hnuser` elements, fetches all users in parallel, builds a `.hn-post-layout` grid (main row + tag column) and inserts it after each comment header.
- `stateManagement.exportState/importState` — normalized export format: `{ customTags: { <tag>: {bgColor, textColor} }, users: { <username>: { rating, tags: [<tag>...] } } }`. Import also accepts a legacy flat-key format. Export uses `GM_listValues` to enumerate all `hn_*` keys; import clears existing `hn_*` keys before loading.
- `createToolbar()` — fixed-position toolbar with Save/Restore buttons and a left-edge drag handle (`mousedown`/`mousemove`/`mouseup` on `document`).

## Userscript metadata

The `==UserScript==` header at the top of `script.js` declares the `@match` (only HN item pages) and required `@grant`s: `GM_xmlhttpRequest`, `GM_setValue`, `GM_getValue`, `GM_addStyle`, `GM_listValues`, `GM_deleteValue`. Adding any new `GM_*` API requires adding a matching `@grant` line or it will be undefined at runtime.

## Code style

- Biome-enforced: 2-space indent, semicolons, double quotes. Run `biome format --write script.js` before committing.
- Match the existing module-object pattern (`storage`, `ui`, `colorUtils`) when adding new groups of related functions.
- Class names on injected DOM are namespaced `hn-*` to avoid clashing with HN's own styles.

## Gotchas

- Edits and removals on tags currently `location.reload()` to refresh the view rather than re-rendering — intentional, keep it unless reworking the render path.
- The original `.hnuser` element is hidden (`display: none`) rather than removed, because HN's own click handlers may still reference it.
- `biome_fixes.txt` in the repo root is a stale artifact from a past lint run — ignore it; consider gitignoring.

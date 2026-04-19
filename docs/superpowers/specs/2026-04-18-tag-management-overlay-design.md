# Tag management overlay — design

Closes #4.

## Purpose

Give the user a single place to review every tag they have ever created, find typos and near-duplicates, and fix them — either by renaming, merging, or removing — without having to hunt for a comment by each affected user.

The feature serves three intents:

1. Find and fix typos in existing tags.
2. Spot similar tags that should be merged (e.g. `engineer` → `Engineer`).
3. Identify tags that are no longer in use so they can be pruned.

## User-facing behaviour

### Entry point

Every inline tag span grows a third icon, placed between the existing edit (`✏️`) and remove (`✖`) icons. The new icon uses the three-horizontal-lines glyph (`☰`, U+2630) with the tooltip "Manage all tags". Clicking it opens the overlay. Subsequent clicks while the overlay is open are a no-op.

### Overlay shell

- Fixed position, flush to the right edge of the viewport.
- Width `33vw`, height `90vh`, vertically centred (`top: 5vh`).
- `z-index` above the existing toolbar.
- A transparent full-viewport click-catcher sits behind the overlay; clicks on it are treated as Cancel.

Layout, top to bottom:

1. **Header** — title "Manage tags" and a count summary (e.g. "47 tags").
2. **Filter row** — a single text input. Case-insensitive substring match on tag name, live as the user types.
3. **Sort row** — two toggles: `Name (A→Z)` (default) and `Uses (0 first)`. The inactive toggle is visually suppressed. Secondary sort is always tag name A→Z for stability.
4. **Scrollable list** — one row per tag (see below).
5. **Footer** — `Save` (primary) and `Cancel` (secondary), right-aligned.

All CSS classes are namespaced `hn-tagmgr-*` to avoid clashing with existing `hn-*` classes.

### Row layout and interactions

Each row is a single horizontal line with four columns:

```
[swatch]  [name or edit field]          [count]  [✏️ ↩ ✖]
```

- **Swatch.** A 12×12 colour block showing the tag's background colour. Read-only in this PR.
- **Name.** Rendered with the tag's background and text colours (so the overlay visually matches the inline tags). Clicking `✏️` swaps the name for a text input pre-filled with the current name.
- **Count.** Derived per-render from the draft state. Count 0 rows are rendered muted (low opacity) but not hidden.
- **Row icons.** `✏️` enters rename mode. `✖` marks the row for removal. `↩` (undo) appears only when the row has a pending change and reverts that single row's edits back to the live state.

### Rename mechanics

- **Enter** commits the pending rename.
- **Blur** also commits.
- **Escape** while the rename input is focused cancels only the field edit (overriding the global "Escape closes overlay" behaviour while an input has focus).
- Name comparison for collision is case-sensitive: renaming `engineer` → `Engineer` counts as a rename-into-existing tag if `Engineer` exists, a pure rename otherwise.
- On a collision, the user sees `confirm("Merge \"X\" into \"Y\"? N users will be updated.")`. If cancelled, the rename is dropped and the input retains focus.
- A no-op rename (new name equal to current) is dropped.

### Pending-state visuals

- Rows with pending edits get a 2px left border in `#ff6600`.
- Rows pending removal additionally get a strikethrough on the name and are dimmed.
- The undo (`↩`) icon is visible only on rows with pending edits.

Sort and filter operate on the draft state, so renamed rows can stay in place mid-edit without re-sorting pulling focus away from the input. After commit (not after each keystroke), rows re-sort.

### Save / Cancel / Escape / click-outside

**Cancel paths**, all equivalent:

- Click the `Cancel` button.
- Press `Escape` while no input in the overlay has focus.
- Click outside the overlay (the click-catcher).

If the draft differs from the live state, any cancel path first triggers `confirm("Discard unsaved tag changes?")`.

**Save path.** No keyboard shortcut (per spec).

1. Compute the final `{tags, colors}` shape from the draft.
2. Call a new store method `store.replaceTagsAndColors(tags, colors)` that overwrites both slices atomically (a single `backend.set(STATE_KEY, ...)` → a single cross-tab broadcast). Ratings and the user-info cache are untouched.
3. Invalidate the in-memory store state via the existing `_invalidate()`.
4. Close the overlay.
5. Re-render affected users by walking every `data-hn-user` element in the DOM and calling `rerenderUserTags(username)` on each. The existing same-page sync machinery handles this.

**Idempotent Save.** If Save is clicked with zero pending edits, the store write is skipped (no spurious cross-tab broadcast).

### Cross-tab sync

Comes along for free. The single `STATE_KEY` write at Save time fires the existing `GM_addValueChangeListener` in other tabs, which invalidate their stores and re-render. No new listener wiring is needed.

## Architecture

The file already has a hard split between pure logic (Node-testable, top of `script.js`) and browser bootstrap (DOM and `GM_*`, below the `GM_addStyle !== "undefined"` guard). The feature respects that split.

### New pure functions (above the guard)

Added next to `stateToExport` / `parseImport`, and exported via the existing `module.exports` block:

- `renameTagInState(state, oldName, newName) → state`
  - Pure rename when `newName` does not exist in `state.colors` and is not carried by any user: every user carrying `oldName` gets `newName` at the same position; `colors[newName]` is set to the value of `colors[oldName]`; `colors[oldName]` is deleted.
  - Merge rename when `newName` already exists: users with only `oldName` get `newName` at that position; users with both get one entry of `newName` at the position of the `oldName` entry (de-duped); `colors[oldName]` is deleted; `colors[newName]` is kept as-is (destination colour wins).
  - No-op when `oldName === newName`, when `oldName` is not present, or when `newName` is empty / whitespace-only. Returns the same reference when a no-op.

- `removeTagInState(state, tagName) → state`
  - Strips `tagName` from every user's tag list; deletes `colors[tagName]`. Ratings and cache are untouched.
  - No-op when the tag is not present. Returns the same reference when a no-op.

- `countsFromState(state) → { [tagName]: number }`
  - One entry per tag name that appears in `state.tags` values or in `state.colors`. The value is the number of distinct users carrying that tag.

Neither mutates its input: each returns a new top-level object when it changes anything. Tests pin the no-op-returns-same-reference behaviour so callers can cheap-compare draft versus live.

### New store method (above the guard)

- `store.replaceTagsAndColors(tagsByUser, colorsByTag)` — replaces `state.tags` and `state.colors` with the supplied shapes, leaves `state.ratings` and `state.cache` untouched, and writes once.

### New browser-side code (below the guard)

- `openTagManager()` — idempotent opener. Creates the overlay DOM, snapshots the current `{tags, colors}` shape into a draft, wires handlers, focuses the filter input.
- `closeTagManager({ commit })` — removes overlay DOM and click-catcher; if `commit` is true, writes `store.replaceTagsAndColors(draft.tags, draft.colors)` (unless the draft is a no-op relative to the live state) and re-renders every visible user.
- Keyboard/click handlers for Enter, Escape, and the click-catcher.
- A new list-icon in `renderTagSpan` whose `onclick` calls `openTagManager()`.

No changes to existing data-in-store shapes. No new `@grant` lines. No new dependencies.

## Testing strategy

New file `tests/tagManagement.test.js` covers the pure functions:

### `renameTagInState`

- Pure rename: every user with the old name now has the new name in the same position; colour entry moves from old → new; old name gone from colours.
- Merge rename: users with only the old tag get the new tag; users with both get one entry of the new tag at the old tag's position, de-duped; destination colour wins; source colour dropped.
- No-op rename (old === new): same reference returned.
- Rename of nonexistent tag: same reference returned.
- Rename to empty / whitespace-only name: same reference returned (the overlay also guards against this, but the pure function is defensive).

### `removeTagInState`

- Removes tag from every user; drops the colour entry; other tags and ratings untouched.
- Remove of nonexistent tag: same reference returned.

### `countsFromState`

- Counts per tag reflect the number of distinct users carrying that tag.
- Tags present in `colors` but with zero users appear with count 0.
- Ratings and cache slices are ignored.

### Composition

- A rename followed by a remove (simulating a multi-step draft) produces the expected final shape.

### Store

One new test in `tests/store.test.js`:

- `replaceTagsAndColors` replaces both slices, leaves ratings and cache untouched, and produces exactly one backend `set`.

### Not unit-tested

Consistent with the existing split, the overlay DOM, keyboard handlers, and click-catcher are verified manually in a userscript manager on a real HN page. The PR description will include a short manual test plan:

- Open overlay via the list icon.
- Rename a tag and Save; inline tags update across comments.
- Rename into an existing tag name; confirm dialog appears; on confirm, the merge is applied.
- Remove a tag via the `✖` icon; strikethrough/dim visible; Save removes it.
- Undo on a row reverts just that row.
- Cancel with unsaved edits prompts to discard.
- Escape with unsaved edits prompts to discard; Escape in a focused rename input cancels the field only.
- Click outside with unsaved edits prompts to discard.
- Save with no pending edits is a no-op (no cross-tab broadcast).
- Two tabs open: Save in one triggers re-render in the other.

## Out of scope

- **Tag colour editing.** Colours remain auto-generated on first use. A future issue can add a colour-swatch picker to the same overlay.
- **Bulk operations.** No multi-select, no "remove all orphan tags" button. The count-sort plus single-row remove covers the stated goal well enough.
- **Undo after Save.** Once Save commits, there is no in-overlay undo. The user's existing export/import flow is the recovery path (consistent with every other tag mutation today).

## Documentation

Per the project's working rule, README and CLAUDE.md will be updated in the same PR:

- README — a short section under "Using it" for the new overlay.
- CLAUDE.md — a note in the Rendering section describing the draft-state model and the new pure helpers.

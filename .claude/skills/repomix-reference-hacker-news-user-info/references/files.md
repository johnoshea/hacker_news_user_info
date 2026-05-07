# Files

## File: docs/superpowers/plans/2026-04-18-tag-management-overlay.md
````markdown
# Tag Management Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an overlay that lists every tag the user has ever created, lets them rename (including merge), remove, filter, and sort them, and commits all edits atomically on Save. Closes #4.

**Architecture:** Pure-function state transforms above the existing `GM_addStyle !== "undefined"` guard (Node-testable). A draft-state object held in the overlay, rebuilt from pure helpers on every edit. A single new store method `replaceTagsAndColors` commits the draft atomically. No new `@grant` lines, no new dependencies.

**Tech Stack:** Vanilla JS userscript, `node:test` for tests, Biome for lint/format, `just` task runner.

**Relevant existing files:**
- `script.js` — single source file, split pure-logic (top) / browser bootstrap (bottom) by a runtime guard.
- `tests/*.test.js` — Node-side tests for pure logic only.
- `docs/superpowers/specs/2026-04-18-tag-management-overlay-design.md` — spec for this plan.

**File structure after this plan:**
- `script.js` — gains ~3 new pure functions, 1 new store method, ~10 new CSS classes, and the overlay code (≈150 extra lines in the browser section).
- `tests/tagManagement.test.js` — new.
- `tests/store.test.js` — one added test.
- `README.md` — one new "Using it" sub-section.
- `CLAUDE.md` — short update under Rendering.

---

## Task 1: Pure function — `renameTagInState` (pure-rename path)

**Files:**
- Test: `tests/tagManagement.test.js` (create)
- Modify: `script.js` (add function above the `if (typeof GM_addStyle !== "undefined")` guard; also added to the `module.exports` block)

- [ ] **Step 1: Write the failing test**

Create `tests/tagManagement.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { renameTagInState } = require("./_load");

// Pure rename: when the destination name does not exist, the tag's color
// entry moves to the new name and every user carrying the old name has it
// replaced at the same position.
test("renameTagInState: pure rename moves color and updates all users", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 3 },
		tags: {
			alice: ["engineer", "rustacean"],
			bob: ["engineer"],
		},
		colors: {
			engineer: { bgColor: "hsl(1,50%,80%)", textColor: "black" },
			rustacean: { bgColor: "hsl(2,50%,80%)", textColor: "black" },
		},
		cache: {},
	};

	const next = renameTagInState(state, "engineer", "Engineer");

	assert.deepEqual(next.tags, {
		alice: ["Engineer", "rustacean"],
		bob: ["Engineer"],
	});
	assert.deepEqual(next.colors, {
		Engineer: { bgColor: "hsl(1,50%,80%)", textColor: "black" },
		rustacean: { bgColor: "hsl(2,50%,80%)", textColor: "black" },
	});
	// Untouched slices.
	assert.deepEqual(next.ratings, { alice: 3 });
	assert.deepEqual(next.cache, {});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test`
Expected: FAIL with `renameTagInState is not a function` (or similar) because the function isn't defined yet.

- [ ] **Step 3: Implement the function**

In `script.js`, above the `if (typeof GM_addStyle !== "undefined")` guard, near `stateToExport`, add:

```js
// Returns a new state with every user's `oldName` tag replaced by `newName`
// and the color entry moved accordingly. If `newName` already exists as a
// tag (in colors or any user's tag list), this becomes a merge: the
// destination's color is kept, the source color is dropped, and any user
// carrying both ends up with one entry (first-occurrence wins, so the
// relative order of other tags is preserved). Empty / whitespace-only
// `newName`, a no-op rename, or a rename of a tag that isn't present
// anywhere returns the same reference.
function renameTagInState(state, oldName, newName) {
	const trimmed = typeof newName === "string" ? newName.trim() : "";
	if (!trimmed || trimmed === oldName) return state;

	const tags = state.tags || {};
	const colors = state.colors || {};
	const inColors = Object.prototype.hasOwnProperty.call(colors, oldName);
	const inTags = Object.values(tags).some((list) => list.includes(oldName));
	if (!inColors && !inTags) return state;

	const destExists = Object.prototype.hasOwnProperty.call(colors, trimmed);

	const newTags = {};
	for (const [user, list] of Object.entries(tags)) {
		if (!list.includes(oldName)) {
			newTags[user] = list.slice();
			continue;
		}
		const renamed = list.map((t) => (t === oldName ? trimmed : t));
		const seen = new Set();
		newTags[user] = renamed.filter((t) => {
			if (seen.has(t)) return false;
			seen.add(t);
			return true;
		});
	}

	const newColors = { ...colors };
	delete newColors[oldName];
	if (!destExists && inColors) {
		newColors[trimmed] = colors[oldName];
	}

	return { ...state, tags: newTags, colors: newColors };
}
```

Then update the `module.exports` block near the bottom of the pure section:

```js
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		timeSince,
		createStore,
		migrateLegacyKeys,
		parseImport,
		stateToExport,
		renameTagInState,
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test`
Expected: PASS. Existing tests should also continue to pass.

- [ ] **Step 5: Commit**

```bash
git add script.js tests/tagManagement.test.js
git commit -m "feat: Add renameTagInState pure helper (rename path)"
```

---

## Task 2: `renameTagInState` — merge path and no-op edges

**Files:**
- Modify: `tests/tagManagement.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/tagManagement.test.js`:

```js
// Merge rename: when the destination already exists, the tag's users are
// folded into the destination. Users carrying both end up with one entry
// (first occurrence kept). The destination's color is preserved.
test("renameTagInState: merge folds users and keeps destination color", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: {
			alice: ["engineer", "rustacean"],
			bob: ["Engineer", "engineer"],
			carol: ["Engineer"],
		},
		colors: {
			engineer: { bgColor: "src", textColor: "black" },
			Engineer: { bgColor: "dest", textColor: "black" },
			rustacean: { bgColor: "rst", textColor: "black" },
		},
		cache: {},
	};

	const next = renameTagInState(state, "engineer", "Engineer");

	assert.deepEqual(next.tags, {
		alice: ["Engineer", "rustacean"],
		bob: ["Engineer"],
		carol: ["Engineer"],
	});
	assert.deepEqual(next.colors, {
		Engineer: { bgColor: "dest", textColor: "black" },
		rustacean: { bgColor: "rst", textColor: "black" },
	});
});

// A no-op rename (old === new, empty string, whitespace-only, or a tag
// that doesn't exist) returns the same reference so callers can cheap-
// compare draft against live.
test("renameTagInState: no-ops return the same reference", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: { alice: ["foo"] },
		colors: { foo: { bgColor: "x", textColor: "black" } },
		cache: {},
	};
	assert.equal(renameTagInState(state, "foo", "foo"), state);
	assert.equal(renameTagInState(state, "foo", ""), state);
	assert.equal(renameTagInState(state, "foo", "   "), state);
	assert.equal(renameTagInState(state, "missing", "x"), state);
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `just test`
Expected: PASS. The implementation from Task 1 already covers these cases.

If any test fails, the Task 1 implementation has a bug — fix it before committing.

- [ ] **Step 3: Commit**

```bash
git add tests/tagManagement.test.js
git commit -m "test: Cover merge path and no-op edges of renameTagInState"
```

---

## Task 3: Pure function — `removeTagInState`

**Files:**
- Modify: `script.js`, `tests/tagManagement.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/tagManagement.test.js`:

```js
const { removeTagInState } = require("./_load");

// Removal strips the tag from every user's list and deletes the color
// entry. Ratings and cache slices are untouched.
test("removeTagInState: strips tag from all users and deletes color", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 2 },
		tags: {
			alice: ["foo", "bar"],
			bob: ["foo"],
		},
		colors: {
			foo: { bgColor: "fooc", textColor: "black" },
			bar: { bgColor: "barc", textColor: "black" },
		},
		cache: { alice: { created: 1, karma: 2, fetchedAt: 3 } },
	};

	const next = removeTagInState(state, "foo");

	assert.deepEqual(next.tags, { alice: ["bar"], bob: [] });
	assert.deepEqual(next.colors, {
		bar: { bgColor: "barc", textColor: "black" },
	});
	assert.deepEqual(next.ratings, { alice: 2 });
	assert.deepEqual(next.cache, { alice: { created: 1, karma: 2, fetchedAt: 3 } });
});

// Removal of a tag that isn't present anywhere is a no-op and returns
// the same reference.
test("removeTagInState: missing tag returns the same reference", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: { alice: ["foo"] },
		colors: { foo: { bgColor: "x", textColor: "black" } },
		cache: {},
	};
	assert.equal(removeTagInState(state, "notpresent"), state);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `just test`
Expected: FAIL with `removeTagInState is not a function`.

- [ ] **Step 3: Implement the function**

In `script.js`, directly below `renameTagInState`:

```js
// Returns a new state with `tagName` removed from every user's tag list
// and from the colors map. No-op (same reference) if the tag isn't
// present anywhere.
function removeTagInState(state, tagName) {
	const tags = state.tags || {};
	const colors = state.colors || {};
	const inColors = Object.prototype.hasOwnProperty.call(colors, tagName);
	const inTags = Object.values(tags).some((list) => list.includes(tagName));
	if (!inColors && !inTags) return state;

	const newTags = {};
	for (const [user, list] of Object.entries(tags)) {
		newTags[user] = list.includes(tagName)
			? list.filter((t) => t !== tagName)
			: list.slice();
	}

	const newColors = { ...colors };
	delete newColors[tagName];

	return { ...state, tags: newTags, colors: newColors };
}
```

Add to the `module.exports` block:

```js
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		timeSince,
		createStore,
		migrateLegacyKeys,
		parseImport,
		stateToExport,
		renameTagInState,
		removeTagInState,
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `just test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add script.js tests/tagManagement.test.js
git commit -m "feat: Add removeTagInState pure helper"
```

---

## Task 4: Pure function — `countsFromState`

**Files:**
- Modify: `script.js`, `tests/tagManagement.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/tagManagement.test.js`:

```js
const { countsFromState } = require("./_load");

// Counts include every tag that has a color entry OR appears on any
// user. Orphan tags (color entry only, no users) show as count 0.
// Duplicates in a single user's list are counted once.
test("countsFromState: counts distinct users per tag, includes orphans", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 99 },
		tags: {
			alice: ["foo", "bar"],
			bob: ["foo"],
			carol: ["foo", "foo"], // accidental duplicate — counted once
		},
		colors: {
			foo: { bgColor: "x", textColor: "black" },
			bar: { bgColor: "y", textColor: "black" },
			baz: { bgColor: "z", textColor: "black" }, // orphan
		},
		cache: {},
	};

	assert.deepEqual(countsFromState(state), { foo: 3, bar: 1, baz: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `just test`
Expected: FAIL with `countsFromState is not a function`.

- [ ] **Step 3: Implement the function**

In `script.js`, below `removeTagInState`:

```js
// Distinct-users-per-tag count. Includes tags that appear only in the
// colors map (orphans) with a count of 0.
function countsFromState(state) {
	const tags = state.tags || {};
	const colors = state.colors || {};
	const counts = {};
	for (const tagName of Object.keys(colors)) counts[tagName] = 0;
	for (const list of Object.values(tags)) {
		const seen = new Set();
		for (const t of list) {
			if (seen.has(t)) continue;
			seen.add(t);
			counts[t] = (counts[t] || 0) + 1;
		}
	}
	return counts;
}
```

Add to the `module.exports` block:

```js
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		timeSince,
		createStore,
		migrateLegacyKeys,
		parseImport,
		stateToExport,
		renameTagInState,
		removeTagInState,
		countsFromState,
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `just test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add script.js tests/tagManagement.test.js
git commit -m "feat: Add countsFromState pure helper"
```

---

## Task 5: Composition test

**Files:**
- Modify: `tests/tagManagement.test.js`

- [ ] **Step 1: Write and run the composition test**

Append to `tests/tagManagement.test.js`:

```js
// Multi-step draft composition: rename + remove applied in sequence
// produces the expected shape. Verifies the helpers chain cleanly,
// which is how the overlay builds a draft.
test("renameTagInState + removeTagInState compose", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: {
			alice: ["engineer", "rustacean", "obsolete"],
			bob: ["Engineer", "obsolete"],
		},
		colors: {
			engineer: { bgColor: "src", textColor: "black" },
			Engineer: { bgColor: "dest", textColor: "black" },
			rustacean: { bgColor: "rst", textColor: "black" },
			obsolete: { bgColor: "old", textColor: "black" },
		},
		cache: {},
	};

	const afterRename = renameTagInState(state, "engineer", "Engineer");
	const afterRemove = removeTagInState(afterRename, "obsolete");

	assert.deepEqual(afterRemove.tags, {
		alice: ["Engineer", "rustacean"],
		bob: ["Engineer"],
	});
	assert.deepEqual(afterRemove.colors, {
		Engineer: { bgColor: "dest", textColor: "black" },
		rustacean: { bgColor: "rst", textColor: "black" },
	});
});
```

Run: `just test`
Expected: PASS.

- [ ] **Step 2: Commit**

```bash
git add tests/tagManagement.test.js
git commit -m "test: Verify rename+remove pure helper composition"
```

---

## Task 6: Store method — `replaceTagsAndColors`

**Files:**
- Modify: `script.js`, `tests/store.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/store.test.js`:

```js
// Single-shot replacement of the tags and colors slices. Must leave
// ratings and cache untouched and must produce exactly one backend
// write, so cross-tab listeners fire once per user Save action.
test("store: replaceTagsAndColors writes once, leaves ratings/cache alone", () => {
	const backend = makeFakeBackend();
	let writes = 0;
	const countingBackend = {
		get: backend.get,
		set: (k, v) => {
			writes += 1;
			backend.set(k, v);
		},
		list: backend.list,
		data: backend.data,
	};
	const store = createStore(countingBackend);
	store.setRating("alice", 5);
	store.setCachedUser("alice", { created: 1, karma: 2 }, 12345);
	const before = writes;

	store.replaceTagsAndColors(
		{ alice: ["x"], bob: ["x", "y"] },
		{
			x: { bgColor: "xc", textColor: "black" },
			y: { bgColor: "yc", textColor: "black" },
		},
	);

	assert.equal(writes - before, 1, "replaceTagsAndColors should write once");

	const persisted = JSON.parse(backend.data.hn_state);
	assert.deepEqual(persisted.tags, { alice: ["x"], bob: ["x", "y"] });
	assert.deepEqual(persisted.colors, {
		x: { bgColor: "xc", textColor: "black" },
		y: { bgColor: "yc", textColor: "black" },
	});
	assert.equal(persisted.ratings.alice, 5);
	assert.equal(persisted.cache.alice.created, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test`
Expected: FAIL with `store.replaceTagsAndColors is not a function`.

- [ ] **Step 3: Implement the store method**

In `script.js`, inside the `createStore` return object, directly above the `_snapshot` method:

```js
		replaceTagsAndColors(tagsByUser, colorsByTag) {
			const s = load();
			s.tags = tagsByUser;
			s.colors = colorsByTag;
			save();
		},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add script.js tests/store.test.js
git commit -m "feat: Add store.replaceTagsAndColors for atomic draft commit"
```

---

## Task 7: Overlay CSS

**Files:**
- Modify: `script.js` (inside the existing `GM_addStyle` template literal)

- [ ] **Step 1: Append the overlay styles**

Inside the `GM_addStyle(\`...\`)` template literal in `script.js`, add these rules at the end of the existing block (just before the closing backtick):

```css
    .hn-tagmgr-catcher {
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: transparent;
    }
    .hn-tagmgr-overlay {
      position: fixed;
      top: 5vh;
      right: 0;
      width: 33vw;
      min-width: 320px;
      height: 90vh;
      background-color: white;
      border: 1px solid #ff6600;
      border-radius: 4px 0 0 4px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      font-size: 0.9em;
    }
    .hn-tagmgr-header {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: bold;
    }
    .hn-tagmgr-header-count { color: #888; font-weight: normal; }
    .hn-tagmgr-controls {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .hn-tagmgr-filter {
      width: 100%;
      padding: 4px 6px;
      box-sizing: border-box;
    }
    .hn-tagmgr-sort { display: flex; gap: 6px; }
    .hn-tagmgr-sort-btn {
      font-size: 0.85em;
      padding: 2px 8px;
      background: #f4f4f4;
      border: 1px solid #ccc;
      border-radius: 3px;
      cursor: pointer;
    }
    .hn-tagmgr-sort-btn.active {
      background: #ff6600;
      color: white;
      border-color: #ff6600;
    }
    .hn-tagmgr-list {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 4px 0;
    }
    .hn-tagmgr-row {
      display: flex;
      align-items: center;
      padding: 4px 12px;
      gap: 8px;
      border-left: 2px solid transparent;
    }
    .hn-tagmgr-row.dirty { border-left-color: #ff6600; }
    .hn-tagmgr-row.removed .hn-tagmgr-name { text-decoration: line-through; }
    .hn-tagmgr-row.removed { opacity: 0.6; }
    .hn-tagmgr-swatch {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      flex: 0 0 12px;
      border: 1px solid rgba(0,0,0,0.1);
    }
    .hn-tagmgr-name {
      flex: 1 1 auto;
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: bold;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hn-tagmgr-name-input {
      flex: 1 1 auto;
      font-size: 1em;
      padding: 1px 5px;
    }
    .hn-tagmgr-count {
      flex: 0 0 auto;
      font-size: 0.85em;
      color: #666;
      min-width: 2em;
      text-align: right;
    }
    .hn-tagmgr-count.zero { color: #bbb; }
    .hn-tagmgr-icons { display: flex; gap: 4px; flex: 0 0 auto; }
    .hn-tagmgr-icon {
      cursor: pointer;
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-size: 0.9em;
    }
    .hn-tagmgr-icon:hover { background: #eee; }
    .hn-tagmgr-footer {
      padding: 8px 12px;
      border-top: 1px solid #eee;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .hn-tagmgr-btn {
      background: white;
      border: 1px solid #ccc;
      border-radius: 3px;
      padding: 5px 14px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-tagmgr-btn.primary {
      background: #ff6600;
      color: white;
      border-color: #ff6600;
    }
    .hn-tagmgr-btn:hover { filter: brightness(0.95); }
```

- [ ] **Step 2: Run lint to confirm syntax**

Run: `just lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add script.js
git commit -m "style: Add tag manager overlay CSS"
```

---

## Task 8: Overlay open/close scaffolding

**Files:**
- Modify: `script.js` (below the `createToolbar` function, still inside the `if (typeof GM_addStyle !== "undefined")` block)

- [ ] **Step 1: Add the overlay state + openTagManager skeleton**

In `script.js`, add this block directly after `createToolbar() { ... }` and before `if (typeof GM_addValueChangeListener === "function")`:

```js
	// Single-instance tag-management overlay. The overlay holds a draft
	// snapshot of {tags, colors}; edits mutate the draft via pure helpers,
	// and Save writes the draft back atomically.
	let tagManagerOpen = false;

	function isDraftDirty(liveSnapshot, draft) {
		return (
			JSON.stringify(liveSnapshot.tags || {}) !== JSON.stringify(draft.tags) ||
			JSON.stringify(liveSnapshot.colors || {}) !== JSON.stringify(draft.colors)
		);
	}

	function openTagManager() {
		if (tagManagerOpen) return;
		tagManagerOpen = true;

		const live = store._snapshot();
		const draft = {
			tags: JSON.parse(JSON.stringify(live.tags || {})),
			colors: JSON.parse(JSON.stringify(live.colors || {})),
		};

		// Per-row state keyed by the tag name as it existed when the overlay
		// opened. Undo on a row reverts that row's changes only.
		const rows = new Map(); // originalName -> { currentName, pendingRemoval }
		const allNames = new Set([
			...Object.keys(live.colors || {}),
			...Object.values(live.tags || {}).flat(),
		]);
		for (const name of allNames) {
			rows.set(name, { currentName: name, pendingRemoval: false });
		}

		let filter = "";
		let sortMode = "name"; // "name" | "count"

		const catcher = h("div", { class: "hn-tagmgr-catcher" });
		const overlay = h("div", { class: "hn-tagmgr-overlay" });
		document.body.appendChild(catcher);
		document.body.appendChild(overlay);

		function closeTagManager({ commit }) {
			if (commit) {
				if (isDraftDirty(live, draft)) {
					store.replaceTagsAndColors(draft.tags, draft.colors);
					store._invalidate();
					const visibleUsers = new Set();
					for (const el of document.querySelectorAll("[data-hn-user]")) {
						visibleUsers.add(el.dataset.hnUser);
					}
					for (const username of visibleUsers) rerenderUserTags(username);
				}
			}
			document.removeEventListener("keydown", onKeyDown);
			catcher.remove();
			overlay.remove();
			tagManagerOpen = false;
		}

		function confirmDiscardIfDirty() {
			if (!isDraftDirty(live, draft)) return true;
			return confirm("Discard unsaved tag changes?");
		}

		function onKeyDown(e) {
			if (e.key !== "Escape") return;
			// If focus is inside a rename input, let the row handle its own
			// Escape (cancels the field, doesn't close the overlay).
			const active = document.activeElement;
			if (active && active.classList.contains("hn-tagmgr-name-input")) return;
			e.preventDefault();
			if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
		}
		document.addEventListener("keydown", onKeyDown);

		catcher.addEventListener("click", () => {
			if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
		});

		// Footer (Save / Cancel) wired immediately; list + controls wired by
		// later tasks via renderOverlay().
		const saveBtn = h("button", {
			class: "hn-tagmgr-btn primary",
			text: "Save",
			onclick: () => closeTagManager({ commit: true }),
		});
		const cancelBtn = h("button", {
			class: "hn-tagmgr-btn",
			text: "Cancel",
			onclick: () => {
				if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
			},
		});
		const footer = h("div", { class: "hn-tagmgr-footer" }, [cancelBtn, saveBtn]);

		// Placeholder body — replaced by renderOverlay in the next task.
		const body = h("div", { class: "hn-tagmgr-list" });

		overlay.appendChild(
			h("div", { class: "hn-tagmgr-header" }, [
				h("span", { text: "Manage tags" }),
				h("span", { class: "hn-tagmgr-header-count", text: `${allNames.size} tags` }),
			]),
		);
		overlay.appendChild(body);
		overlay.appendChild(footer);

		// Expose internal state onto the overlay element for the next task
		// (which installs the list rendering). Using a closed-over reference
		// would require folding all of Tasks 8-12 into one commit; this lets
		// each task be a tight, testable commit.
		overlay._tagmgr = { live, draft, rows, body, getFilter: () => filter, setFilter: (v) => { filter = v; }, getSortMode: () => sortMode, setSortMode: (v) => { sortMode = v; } };
	}
```

- [ ] **Step 2: Lint**

Run: `just lint`
Expected: no errors.

- [ ] **Step 3: Manual QA**

Temporarily wire a test trigger: in DevTools on a HN comment page with the script installed, run `openTagManager()` in the console. Verify:

- Overlay appears on the right with correct sizing.
- Footer has `Cancel` and `Save` buttons.
- `Cancel` closes the overlay. `Escape` (with no input focused) closes the overlay. Clicking outside (on the click-catcher) closes the overlay.
- None of the above attempts to save because nothing has changed yet.

- [ ] **Step 4: Commit**

```bash
git add script.js
git commit -m "feat: Add tag manager overlay scaffolding"
```

---

## Task 9: Filter, sort, and row rendering

**Files:**
- Modify: `script.js` (inside `openTagManager`; add `renderOverlay` + row builder + wire controls)

- [ ] **Step 1: Add filter input, sort buttons, and the row renderer**

In `script.js`, inside `openTagManager`, replace the `body` placeholder and the current `overlay.appendChild(body)` sequence with a full control block + render loop. Concretely, replace this section:

```js
		// Placeholder body — replaced by renderOverlay in the next task.
		const body = h("div", { class: "hn-tagmgr-list" });

		overlay.appendChild(
			h("div", { class: "hn-tagmgr-header" }, [
				h("span", { text: "Manage tags" }),
				h("span", { class: "hn-tagmgr-header-count", text: `${allNames.size} tags` }),
			]),
		);
		overlay.appendChild(body);
		overlay.appendChild(footer);

		// Expose internal state onto the overlay element for the next task
		// (which installs the list rendering). Using a closed-over reference
		// would require folding all of Tasks 8-12 into one commit; this lets
		// each task be a tight, testable commit.
		overlay._tagmgr = { live, draft, rows, body, getFilter: () => filter, setFilter: (v) => { filter = v; }, getSortMode: () => sortMode, setSortMode: (v) => { sortMode = v; } };
```

with:

```js
		const list = h("div", { class: "hn-tagmgr-list" });

		const filterInput = h("input", {
			type: "text",
			class: "hn-tagmgr-filter",
			placeholder: "Filter tags…",
		});
		filterInput.addEventListener("input", () => {
			filter = filterInput.value;
			renderOverlay();
		});

		const sortNameBtn = h("button", {
			class: "hn-tagmgr-sort-btn active",
			text: "Name (A→Z)",
			onclick: () => {
				sortMode = "name";
				renderOverlay();
			},
		});
		const sortCountBtn = h("button", {
			class: "hn-tagmgr-sort-btn",
			text: "Uses (0 first)",
			onclick: () => {
				sortMode = "count";
				renderOverlay();
			},
		});

		const controls = h("div", { class: "hn-tagmgr-controls" }, [
			filterInput,
			h("div", { class: "hn-tagmgr-sort" }, [sortNameBtn, sortCountBtn]),
		]);

		const headerCount = h("span", { class: "hn-tagmgr-header-count" });
		overlay.appendChild(
			h("div", { class: "hn-tagmgr-header" }, [
				h("span", { text: "Manage tags" }),
				headerCount,
			]),
		);
		overlay.appendChild(controls);
		overlay.appendChild(list);
		overlay.appendChild(footer);

		// Derive the draft from the rows map each time. Each row in `rows`
		// carries its originalName (the map key) and its current edited form;
		// pure helpers stitch the final shape together.
		function computeDraft() {
			let d = {
				tags: JSON.parse(JSON.stringify(live.tags || {})),
				colors: JSON.parse(JSON.stringify(live.colors || {})),
				schemaVersion: 1,
				ratings: live.ratings || {},
				cache: live.cache || {},
			};
			for (const [originalName, row] of rows) {
				if (row.pendingRemoval) {
					d = removeTagInState(d, originalName);
				} else if (row.currentName !== originalName) {
					d = renameTagInState(d, originalName, row.currentName);
				}
			}
			return d;
		}

		function renderOverlay() {
			const computed = computeDraft();
			draft.tags = computed.tags;
			draft.colors = computed.colors;

			const counts = countsFromState(computed);
			const needle = filter.trim().toLowerCase();

			const entries = [...rows.entries()]
				.map(([originalName, row]) => {
					const displayName = row.pendingRemoval ? originalName : row.currentName;
					const count = row.pendingRemoval
						? 0
						: counts[row.currentName] || 0;
					const color = computed.colors[row.currentName] || live.colors[originalName] || null;
					return { originalName, row, displayName, count, color };
				})
				.filter(({ displayName }) =>
					needle === "" ? true : displayName.toLowerCase().includes(needle),
				);

			entries.sort((a, b) => {
				if (sortMode === "count") {
					if (a.count !== b.count) return a.count - b.count;
				}
				return a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase());
			});

			sortNameBtn.classList.toggle("active", sortMode === "name");
			sortCountBtn.classList.toggle("active", sortMode === "count");
			headerCount.textContent = `${rows.size} tags`;

			list.replaceChildren();
			for (const entry of entries) {
				list.appendChild(buildRow(entry));
			}
		}

		function buildRow({ originalName, row, displayName, count, color }) {
			const dirty = row.pendingRemoval || row.currentName !== originalName;
			const rowEl = h("div", {
				class: [
					"hn-tagmgr-row",
					dirty ? "dirty" : "",
					row.pendingRemoval ? "removed" : "",
				]
					.filter(Boolean)
					.join(" "),
			});

			const swatch = h("span", { class: "hn-tagmgr-swatch" });
			if (color?.bgColor) swatch.style.backgroundColor = color.bgColor;

			const nameEl = h("span", {
				class: "hn-tagmgr-name",
				text: displayName,
			});
			if (color?.bgColor) nameEl.style.backgroundColor = color.bgColor;
			if (color?.textColor) nameEl.style.color = color.textColor;

			const countEl = h("span", {
				class: `hn-tagmgr-count${count === 0 ? " zero" : ""}`,
				text: String(count),
			});

			const icons = h("div", { class: "hn-tagmgr-icons" });
			// Individual icon wiring arrives in Tasks 10–12.

			rowEl.appendChild(swatch);
			rowEl.appendChild(nameEl);
			rowEl.appendChild(countEl);
			rowEl.appendChild(icons);
			return rowEl;
		}

		renderOverlay();
```

- [ ] **Step 2: Lint**

Run: `just lint`
Expected: no errors.

- [ ] **Step 3: Manual QA**

In DevTools on a HN page with some existing tags, run `openTagManager()`. Verify:

- All tags are listed, each with swatch, name, and count.
- Orphan tags (if any) show count `0` in muted grey.
- Filter input narrows the list live by case-insensitive substring.
- `Name` sort is alphabetical (case-insensitive). `Uses` sort brings zeros to the top; ties break alphabetically.

- [ ] **Step 4: Commit**

```bash
git add script.js
git commit -m "feat: Render filter, sort, and tag rows in tag manager"
```

---

## Task 10: Rename interaction

**Files:**
- Modify: `script.js` (inside `buildRow`)

- [ ] **Step 1: Add the rename icon and inline editor**

In `script.js`, inside `buildRow`, replace the comment `// Individual icon wiring arrives in Tasks 10–12.` with the rename icon block:

```js
			const editIcon = h("span", {
				class: "hn-tagmgr-icon",
				title: "Rename tag",
				text: "\u270F\uFE0F", // ✏️
				onclick: () => {
					// Swap name span for an input; Enter/blur commits, Escape
					// cancels the field (does not close the overlay).
					const input = h("input", {
						type: "text",
						class: "hn-tagmgr-name-input",
						value: row.currentName,
					});
					nameEl.replaceWith(input);
					input.focus();
					input.select();

					const commit = () => {
						const proposed = input.value.trim();
						if (!proposed || proposed === row.currentName) {
							renderOverlay();
							return;
						}
						// Collision check: does another row currently carry `proposed`?
						const collidesWith = [...rows.entries()].find(
							([orig, r]) =>
								orig !== originalName &&
								!r.pendingRemoval &&
								r.currentName === proposed,
						);
						if (collidesWith) {
							const srcCount = countsFromState(computeDraft())[row.currentName] || 0;
							if (!confirm(`Merge "${row.currentName}" into "${proposed}"? ${srcCount} user${srcCount === 1 ? "" : "s"} will be updated.`)) {
								renderOverlay();
								return;
							}
							// Drop the source row: the destination absorbs it.
							rows.delete(originalName);
						} else {
							row.currentName = proposed;
						}
						renderOverlay();
					};

					let cancelled = false;
					input.addEventListener("keydown", (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							cancelled = true;
							renderOverlay();
						}
					});
					input.addEventListener("blur", () => {
						if (cancelled) return;
						commit();
					});
				},
			});
			icons.appendChild(editIcon);
```

- [ ] **Step 2: Lint**

Run: `just lint`
Expected: no errors.

- [ ] **Step 3: Manual QA**

In the overlay:

- Click the ✏️ icon on a row. The name becomes an input.
- Type a new name, press **Enter**. The row re-renders with the new name; the left border turns orange (dirty).
- Click ✏️ again. Type an existing tag name, press **Enter**. A confirm dialog appears ("Merge X into Y? N users will be updated."). Confirm → the source row disappears and the destination's count has increased.
- Click ✏️, type something, press **Escape**. The field collapses back to the original name with no edit applied, and the overlay does NOT close.
- Click ✏️, type a new name, click outside the input (but still inside the overlay). Blur commits the rename.

- [ ] **Step 4: Commit**

```bash
git add script.js
git commit -m "feat: Rename interaction with merge-collision confirm in tag manager"
```

---

## Task 11: Remove and undo interactions

**Files:**
- Modify: `script.js` (inside `buildRow`)

- [ ] **Step 1: Add the remove and undo icons**

In `script.js`, inside `buildRow`, directly after `icons.appendChild(editIcon);`, add:

```js
			if (dirty) {
				const undoIcon = h("span", {
					class: "hn-tagmgr-icon",
					title: "Undo changes to this row",
					text: "\u21A9", // ↩
					onclick: () => {
						row.currentName = originalName;
						row.pendingRemoval = false;
						renderOverlay();
					},
				});
				icons.appendChild(undoIcon);
			}

			const removeIcon = h("span", {
				class: "hn-tagmgr-icon",
				title: row.pendingRemoval ? "Keep tag" : "Remove tag",
				text: "\u2716", // ✖
				onclick: () => {
					row.pendingRemoval = !row.pendingRemoval;
					renderOverlay();
				},
			});
			icons.appendChild(removeIcon);
```

- [ ] **Step 2: Lint**

Run: `just lint`
Expected: no errors.

- [ ] **Step 3: Manual QA**

In the overlay:

- Click ✖ on a row. The row renders with strikethrough and dim, left border orange.
- An ↩ icon appears on the row. Click it. The row returns to its original, non-dirty state.
- Rename a row (Task 10), then click ↩. The rename is reverted.
- Click ✖ again — second click re-enables the tag (toggle).

- [ ] **Step 4: Commit**

```bash
git add script.js
git commit -m "feat: Remove and undo interactions in tag manager"
```

---

## Task 12: Wire the list icon into inline tags

**Files:**
- Modify: `script.js` (inside `renderTagSpan`)

- [ ] **Step 1: Add the list icon between edit and remove icons**

In `script.js`, inside `renderTagSpan`, change the last `h("div", ...)` call to include a list-icon between `editIcon` and `removeIcon`. Locate this block:

```js
		const span = h("div", { class: "hn-tag" }, [
			h("span", { class: "hn-tag-text", text: tag.value }),
			h("div", { class: "hn-tag-icons" }, [editIcon, removeIcon]),
		]);
```

Replace it with:

```js
		const manageIcon = h("span", {
			class: "hn-tag-icon",
			title: "Manage all tags",
			text: "\u2630", // ☰
			onclick: (e) => {
				e.stopPropagation();
				openTagManager();
			},
		});

		const span = h("div", { class: "hn-tag" }, [
			h("span", { class: "hn-tag-text", text: tag.value }),
			h("div", { class: "hn-tag-icons" }, [editIcon, manageIcon, removeIcon]),
		]);
```

- [ ] **Step 2: Lint and test**

Run: `just check`
Expected: lint clean; all existing tests still pass.

- [ ] **Step 3: Manual QA end-to-end**

Load the userscript on a real HN comment page. Verify:

- Every inline tag now has three icons: ✏️ ☰ ✖ in that order.
- Clicking ☰ on any tag opens the overlay.
- Rename a tag, click Save. Inline tags update across every comment by affected users on the page. Open a second HN tab — the other tab's tags update too (cross-tab sync).
- Rename an existing tag into another existing tag (merge). Save. Every user who had either name now has the destination name; old name is gone.
- Mark a tag for removal. Save. Every user who had it has it no longer; colour entry gone.
- Open overlay, make edits, press Cancel. Discard-changes confirm appears. Confirm → nothing persists.
- Open overlay, make edits, press Escape (no input focused). Discard-changes confirm appears.
- Open overlay, no edits, press Save. Overlay closes. Other tabs do NOT receive a cross-tab change event (verify via DevTools console: `GM_addValueChangeListener` in the other tab should not fire).

- [ ] **Step 4: Commit**

```bash
git add script.js
git commit -m "feat: Add list icon to open tag manager from inline tags"
```

---

## Task 13: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add an overlay section under "Using it"**

In `README.md`, directly after the "**Removing a tag.**" paragraph and before "**Cross-tab sync.**", add:

```markdown
**Managing all tags.** Click the ☰ icon on any tag to open the tag manager overlay on the right-hand side of the page. It lists every tag you have ever created, sortable by name or by usage count and filterable by substring. From there you can rename a tag (press Enter to commit; renaming to a name that already exists prompts to merge), mark a tag for removal, or undo pending changes on a row. Click **Save** to apply everything at once, or **Cancel** / press **Escape** / click outside the overlay to discard your changes.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: Document tag management overlay in README"
```

---

## Task 14: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Extend the Rendering section**

In `CLAUDE.md`, at the end of the `### Rendering` section (immediately before `### Export/import`), add:

```markdown
### Tag management overlay

Opened via the ☰ icon on any inline tag. The overlay holds a draft `{tags, colors}` snapshot in a closure; edits are applied to the draft via three pure helpers (`renameTagInState`, `removeTagInState`, `countsFromState`), not to the store. Save calls `store.replaceTagsAndColors(draft.tags, draft.colors)`, which performs one backend write — this is also the one cross-tab broadcast. Cancel, Escape (with no field focused), and click-outside all discard the draft, with a confirm prompt if the draft differs from live state.

Each overlay row is keyed by the tag's name as it was when the overlay opened. Per-row state is `{currentName, pendingRemoval}` plus a dropped-when-merged marker. The displayed list and counts are derived from the draft on every re-render.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Describe tag management overlay in CLAUDE.md"
```

---

## Task 15: Push branch and open PR

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/tag-management-overlay
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "Add tag management overlay" --body "$(cat <<'EOF'
## Summary

- Adds a tag management overlay, opened via a new ☰ icon on every inline tag, that lists every tag the user has created with filter, sort-by-name and sort-by-usage controls
- Supports in-overlay rename (with merge-on-collision confirm), remove, and per-row undo
- Batches all edits into a single atomic Save that commits via a new `store.replaceTagsAndColors` (single backend write → single cross-tab broadcast)
- Cancel / Escape / click-outside discard the draft (with confirm if dirty); Save has no keyboard shortcut per spec
- Adds pure-function helpers `renameTagInState`, `removeTagInState`, `countsFromState` with Node-side unit tests; browser-side overlay is verified manually

Closes #4

## Test plan

- [x] `just check` — lint + format + tests all clean
- [ ] Overlay opens from the ☰ icon on any inline tag
- [ ] Rename a tag → Save → inline tags update on the current page and in a second open HN tab
- [ ] Rename into an existing tag prompts a merge confirm; confirm applies the merge
- [ ] Remove a tag → row gets strikethrough + dim; Save strips it from every user and deletes its color entry
- [ ] Undo icon on a dirty row reverts that row only
- [ ] Cancel / Escape / click-outside with dirty state prompts "Discard unsaved tag changes?"
- [ ] Save with zero pending edits does not trigger a cross-tab broadcast
- [ ] Sort-by-uses brings orphan (count 0) tags to the top
- [ ] Filter narrows the list by case-insensitive substring on tag name

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report PR URL**

Output the PR URL so John can click through and review.

---

## Self-review

- **Spec coverage.** Each spec bullet maps to at least one task: list icon (Task 12), overlay shell + sizing (Tasks 7–8), header/filter/sort/rows/footer (Task 9), rename + merge confirm (Task 10), remove + undo (Task 11), Save (Task 8 + `replaceTagsAndColors` Task 6), Cancel / Escape / click-outside with dirty confirm (Task 8), cross-tab sync reuses the existing listener (no new code — validated in Task 12 manual QA), pure helpers (Tasks 1–5), documentation (Tasks 13–14).
- **Placeholders.** None. Every code block is complete; every test shows real data; commands show expected output states.
- **Type consistency.** Function names are consistent: `renameTagInState`, `removeTagInState`, `countsFromState`, `replaceTagsAndColors`, `openTagManager`, `closeTagManager`. CSS class names `hn-tagmgr-*` used consistently across CSS (Task 7) and JS (Tasks 8–11). Store-snapshot shape matches what `createStore._snapshot()` already returns.
````

## File: docs/superpowers/specs/2026-04-18-tag-management-overlay-design.md
````markdown
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
````

## File: src/features/backticks-to-monospace.js
````javascript
// Walk the text nodes inside every .commtext and replace `inline code`
// segments (delimited by backticks) with proper <code> elements. The
// pure helper splitBackticks(text) does the actual splitting; this
// module is the DOM glue.
//
// Skips text inside existing <code>, <pre>, and <a> elements so we
// don't mangle pre-formatted code blocks or rewrite link text.

import { splitBackticks } from "../parsing.js";

const SKIP_TAGS = new Set(["code", "pre", "a"]);

export function transformBackticksToMonospace() {
	for (const commtext of document.querySelectorAll(".commtext")) {
		// Two-pass: collect candidate text nodes first, then mutate. A
		// single pass that mutates while walking would have the walker
		// skip nodes that get inserted during replacement.
		const candidates = [];
		const walker = document.createTreeWalker(commtext, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const parent = node.parentNode;
				if (!parent) return NodeFilter.FILTER_REJECT;
				const tag = parent.tagName?.toLowerCase();
				if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
				// Quick prefilter: a text node with no backticks won't
				// match anything in splitBackticks, so don't bother.
				if (!node.data.includes("`")) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let n = walker.nextNode();
		while (n !== null) {
			candidates.push(n);
			n = walker.nextNode();
		}

		for (const node of candidates) {
			const segments = splitBackticks(node.data);
			if (!segments.some((s) => s.kind === "code")) continue;
			const fragment = document.createDocumentFragment();
			for (const seg of segments) {
				if (seg.kind === "text") {
					fragment.appendChild(document.createTextNode(seg.value));
				} else {
					const code = document.createElement("code");
					code.textContent = seg.value;
					fragment.appendChild(code);
				}
			}
			node.replaceWith(fragment);
		}
	}
}
````

## File: src/features/click-indent-toggle.js
````javascript
// Make the empty indent column on each comment a click target that fires
// HN's native toggle (collapse/expand). Cheap to add, big quality-of-life
// win on long threads — there's a lot of indent gutter to click.

export function setupClickIndentToggle() {
	for (const row of document.querySelectorAll("tr.comtr")) {
		const indentCell = row.querySelector("td.ind");
		const toggleBtn = row.querySelector("a.togg");
		if (!indentCell || !toggleBtn) continue;
		indentCell.classList.add("hn-clickable-indent");
		indentCell.addEventListener("click", () => {
			toggleBtn.click();
		});
	}
}
````

## File: src/features/collapse-root-comment.js
````javascript
// On each non-root comment, append a "[collapse root]" link to the
// comhead. Clicking it fires the root comment's native toggle and
// scrolls the page back to the (now-collapsed) root, so a reader who
// has descended deep into a thread can dismiss the whole subtree
// without losing their place in the page.

import { h } from "../dom.js";
import { findCommentRootIndices } from "../parsing.js";

export function setupCollapseRootComment() {
	const comments = Array.from(document.querySelectorAll("tr.comtr"));
	if (comments.length === 0) return;

	// HN renders indentation as an <img> in td.ind whose width is
	// `40 * level` pixels. We read that width once per comment to build
	// the level array, then hand it to the pure helper.
	const indentLevels = comments.map((row) => {
		const img = row.querySelector("td.ind img");
		if (!img) return 0;
		const width = Number(img.getAttribute("width")) || img.width || 0;
		return Math.round(width / 40);
	});

	const rootIndices = findCommentRootIndices(indentLevels);

	for (let i = 0; i < comments.length; i++) {
		const rootIdx = rootIndices[i];
		if (rootIdx === -1) continue;
		const root = comments[rootIdx];
		const head = comments[i].querySelector("span.comhead");
		if (!head) continue;

		const link = h("a", {
			class: "hn-collapse-root",
			href: "javascript:void(0)",
			text: "[collapse root]",
			onclick: (e) => {
				e.preventDefault();
				const rootToggle = root.querySelector("a.togg");
				if (!rootToggle) return;
				rootToggle.click();
				// Scroll the (now collapsed) root into view so the reader
				// doesn't lose their place after the subtree disappears.
				const rect = root.getBoundingClientRect();
				const top = rect.top + window.scrollY;
				window.scrollTo({ top, left: 0 });
			},
		});

		head.append(link);
	}
}
````

## File: src/features/comment-box-toggle.js
````javascript
// Item pages: hide the comment-submit form behind a "show comment box"
// link. Returning early on missing nodes covers locked threads and
// logged-out views, where the form (and possibly the row) isn't there.

import { h } from "../dom.js";

export function setupCommentBoxToggle() {
	const addComment = document.querySelector(".fatitem tr:last-of-type");
	const commentForm = document.querySelector("form[action='comment']");
	if (!addComment || !commentForm) return;

	addComment.classList.add("hidden");

	const showLink = h("a", {
		href: "#",
		text: "show comment box",
	});
	const showRow = h("tr", { class: "showComment" }, [
		h("td", { colSpan: 2 }),
		h("td", {}, [showLink]),
	]);
	const toggle = (e) => {
		e.preventDefault();
		showRow.classList.toggle("hidden");
		addComment.classList.toggle("hidden");
	};
	showLink.addEventListener("click", toggle);

	const hideLink = h("a", {
		href: "#",
		class: "hideComment",
		text: "hide comment box",
		onclick: toggle,
	});

	addComment.parentNode.insertBefore(showRow, addComment);
	commentForm.append(hideLink);
}
````

## File: src/features/hover-popup.js
````javascript
// Shared hover-popup primitive used by user-info-hover and item-info-hover.
// Builds a single fixed-position div appended to <body>, plus an
// attachDwell helper that wires the standard "cursor rests for N ms ->
// fetch -> render -> show" pattern. One popup per page; whichever
// hover wins last replaces the content.

import { HOVER_DWELL_MS } from "../config.js";
import { h } from "../dom.js";

export function createHoverPopup() {
	const popup = h("div", { class: "hn-hover-popup hidden" });
	document.body.appendChild(popup);

	let currentToken = 0; // monotonic; bumped on every show/hide
	let visibleNear = null;

	function setContent(nodes) {
		popup.replaceChildren(...nodes);
	}

	function position(near) {
		const rect = near.getBoundingClientRect();
		// Anchor below the link, scrolled-position-aware. Clamp to the
		// viewport so the popup doesn't escape off the right or bottom
		// edge on long usernames near the screen edge.
		const top = rect.bottom + window.scrollY + 6;
		const proposedLeft = rect.left + window.scrollX;
		const maxLeft = window.scrollX + document.documentElement.clientWidth - 360;
		const left = Math.max(window.scrollX + 4, Math.min(proposedLeft, maxLeft));
		popup.style.top = `${top}px`;
		popup.style.left = `${left}px`;
	}

	function show(near, contentNodes) {
		setContent(contentNodes);
		position(near);
		popup.classList.remove("hidden");
		visibleNear = near;
	}

	function hide() {
		currentToken += 1;
		popup.classList.add("hidden");
		visibleNear = null;
		popup.replaceChildren();
	}

	// Wire mouseenter/mouseleave on `target` so that, after HOVER_DWELL_MS
	// of continuous hover, `loader()` is invoked. If it resolves and the
	// cursor is still on the target, `render(data)` is called and its
	// returned nodes are shown in the popup. Mouse leaving the target at
	// any time aborts the in-flight chain via a token bump.
	function attachDwell(target, loader, render) {
		let dwellTimer = null;
		let myToken = -1;

		target.addEventListener("mouseenter", () => {
			if (dwellTimer) clearTimeout(dwellTimer);
			currentToken += 1;
			myToken = currentToken;
			dwellTimer = setTimeout(() => {
				if (myToken !== currentToken) return;
				Promise.resolve(loader()).then((data) => {
					if (myToken !== currentToken) return;
					if (!data) {
						hide();
						return;
					}
					show(target, render(data));
				});
			}, HOVER_DWELL_MS);
		});

		target.addEventListener("mouseleave", () => {
			if (dwellTimer) {
				clearTimeout(dwellTimer);
				dwellTimer = null;
			}
			// Only hide if this target's hover is still the visible one;
			// avoids hiding the popup the user just moved into a second
			// candidate over.
			if (visibleNear === target) hide();
			currentToken += 1;
			myToken = -1;
		});
	}

	return { show, hide, attachDwell };
}
````

## File: src/features/legibility.js
````javascript
// Site-wide legibility passes. Run on every HN page: restyle downvoted
// comments and rewrite ">"-prefixed text into styled quote blocks.

import { h } from "../dom.js";
import { stripLeadingQuoteMarker } from "../parsing.js";

// HN comment styling: any .commtext that lacks the .c00 class has been
// downvoted (HN drops the class to express grey-on-grey). We tag the
// surrounding .comment so our CSS can restore black text on a faint-grey
// background.
export function applyDownvotedClass() {
	for (const el of document.querySelectorAll(".commtext")) {
		if (!el.classList.contains("c00")) {
			el.parentElement?.classList.add("downvoted");
		}
	}
}

// Find <i>/<p>/<span> whose first text-node child starts with ">" and
// re-render it as a styled <p class="quote"> block. Two shapes seen in
// HN markup:
//   1. The first text node contains both the marker and the quoted body
//      (e.g. <i>&gt; quoted text</i>) -> strip the marker, set the body
//      as text on the new <p>.
//   2. The first text node is just the marker, with the quoted content
//      sitting in the next sibling (e.g. <i>&gt; <a>link</a></i>) -> move
//      the sibling into the <p> so any nested elements survive.
export function transformQuotes() {
	const candidates = document.querySelectorAll("i, p, span");
	for (const el of candidates) {
		if (el.classList.contains("quote")) continue;
		const textNode = Array.from(el.childNodes).find(
			(n) => n.nodeType === Node.TEXT_NODE,
		);
		if (!textNode?.data.trimStart().startsWith(">")) continue;

		const p = h("p", { class: "quote" });
		if (textNode.data.trim() === ">") {
			const next = textNode.nextSibling;
			if (next) p.appendChild(next);
		} else {
			p.textContent = stripLeadingQuoteMarker(textNode.data);
		}
		textNode.replaceWith(p);
	}
}
````

## File: src/features/linkify-user-about.js
````javascript
// On /user pages, walk the about-cell text nodes and replace plain-
// text URLs / email addresses with clickable <a> elements. The pure
// helper linkifySegments (in src/parsing.js) does the splitting; this
// module is the DOM glue.
//
// Skips text already inside an <a> so HN's own pre-existing links
// don't get wrapped a second time. Refined-hacker-news pulls in
// linkifyjs for this; we use a small in-house regex linker instead
// to avoid the npm dep.

import { linkifySegments } from "../parsing.js";

function findAboutCell() {
	// HN's user page has a nested table inside #hnmain; the inner table
	// has rows for "user:", "created:", "karma:", "about:". The "about:"
	// label is in the first cell; the body is in the next sibling cell.
	const rows = document.querySelectorAll("#hnmain table table tr");
	for (const row of rows) {
		const labelCell = row.querySelector("td");
		if (!labelCell) continue;
		if (labelCell.textContent.trim() === "about:") {
			return labelCell.nextElementSibling;
		}
	}
	return null;
}

function isInsideAnchor(node) {
	let cursor = node.parentNode;
	while (cursor && cursor.nodeType === Node.ELEMENT_NODE) {
		if (cursor.tagName === "A") return true;
		cursor = cursor.parentNode;
	}
	return false;
}

function buildLinkifiedFragment(text) {
	const fragment = document.createDocumentFragment();
	for (const seg of linkifySegments(text)) {
		if (seg.kind === "text") {
			fragment.appendChild(document.createTextNode(seg.value));
		} else if (seg.kind === "url") {
			const a = document.createElement("a");
			a.href = seg.value;
			a.rel = "noopener noreferrer";
			a.textContent = seg.value;
			fragment.appendChild(a);
		} else if (seg.kind === "email") {
			const a = document.createElement("a");
			a.href = `mailto:${seg.value}`;
			a.rel = "noopener noreferrer";
			a.textContent = seg.value;
			fragment.appendChild(a);
		}
	}
	return fragment;
}

export function setupLinkifyUserAbout() {
	if (window.location.pathname !== "/user") return;
	const cell = findAboutCell();
	if (!cell) return;

	// Two-pass walk to avoid the walker skipping over text nodes we
	// just inserted while replacing.
	const candidates = [];
	const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (isInsideAnchor(node)) return NodeFilter.FILTER_REJECT;
			const segs = linkifySegments(node.data);
			const hasLink = segs.some((s) => s.kind === "url" || s.kind === "email");
			return hasLink ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
		},
	});
	let n = walker.nextNode();
	while (n !== null) {
		candidates.push(n);
		n = walker.nextNode();
	}

	for (const node of candidates) {
		const fragment = buildLinkifiedFragment(node.data);
		node.replaceWith(fragment);
	}
}
````

## File: src/features/sort-stories.js
````javascript
// On listing pages (/news, /newest, /ask, /show, /best, /front, etc.)
// add a "sort: …" dropdown above table.itemlist. Selecting an option
// reorders the story rows in place; a "reverse" link flips the
// current order. Sort options:
//   - default: HN's server-supplied rank
//   - time:    newer items first (by id, which is monotonically
//              increasing)
//   - score:   highest first
//   - ratio:   comments/score descending — proxy for "most-discussed
//              given its score", surfaces controversial threads
//
// All three of these are non-persistent (per page load). The pure
// helper sortStoriesBy in src/parsing.js does the actual ordering.

import { h } from "../dom.js";
import { sortStoriesBy } from "../parsing.js";

const MODES = [
	{ value: "default", label: "default" },
	{ value: "time", label: "time" },
	{ value: "score", label: "score" },
	{ value: "ratio", label: "comments/score ratio" },
];

// Read each story's metadata + the 3 row group it occupies in
// table.itemlist > tbody. HN renders each story as exactly:
//   <tr class="athing">    -- title row, id=NNNN
//   <tr>...</tr>           -- subtext row (score, by, time, comments)
//   <tr style="height:5px">-- spacer row
function parseStoryRows(table) {
	const rows = Array.from(table.querySelectorAll("tbody > tr"));
	const stories = [];
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (!row.classList.contains("athing")) continue;
		const subtext = rows[i + 1];
		if (!subtext) continue;
		const spacer = rows[i + 2];

		const id = row.id;
		const rankText = row.querySelector(".rank")?.textContent || "";
		const defaultRank =
			Number(rankText.replace(/\.$/, "")) || stories.length + 1;
		const scoreText = subtext.querySelector(".score")?.textContent || "";
		const score = Number(scoreText.split(" ")[0]) || 0;
		// Comment count: the last "X comments" / "discuss" link in the
		// subtext. "discuss" means 0 comments; missing means it's a job
		// posting (no discussion).
		let commentsCount = 0;
		const commentLinks = subtext.querySelectorAll('a[href^="item?id="]');
		const lastLink = commentLinks[commentLinks.length - 1];
		if (lastLink) {
			const txt = lastLink.textContent.trim();
			const m = txt.match(/^(\d+)/);
			if (m) commentsCount = Number(m[1]);
		}

		const elements = [row, subtext];
		if (spacer && !spacer.classList.contains("athing")) {
			elements.push(spacer);
		}
		stories.push({ id, score, commentsCount, defaultRank, elements });
	}
	return stories;
}

function rerenderStories(tbody, stories) {
	// HN appends a "More" link as the last row of itemlist (and a
	// matching morespace row above it). Preserve those at the end so
	// pagination still works after reorder.
	const allRows = Array.from(tbody.children);
	const moreRow = allRows[allRows.length - 1];
	const moreSpace = allRows[allRows.length - 2];

	// Detach every story group's rows, then re-append in the requested
	// order. The DOM mutations are cheap because we're just moving
	// existing elements, not creating new ones.
	for (const story of stories) {
		for (const el of story.elements) {
			el.remove();
		}
	}

	// Find a stable insertion point: just before moreSpace (if present)
	// or at the end otherwise.
	const anchor =
		moreSpace && tbody.contains(moreSpace) ? moreSpace : moreRow || null;
	for (const story of stories) {
		for (const el of story.elements) {
			if (anchor && tbody.contains(anchor)) {
				tbody.insertBefore(el, anchor);
			} else {
				tbody.appendChild(el);
			}
		}
	}
}

export function setupSortStories() {
	const table = document.querySelector("table.itemlist");
	if (!table) return;
	const tbody = table.querySelector("tbody");
	if (!tbody) return;

	// Capture the original story list (with default-rank metadata) once.
	// Subsequent sorts work from this snapshot so "default" really
	// restores the server-supplied ordering, not the most recent sort.
	const original = parseStoryRows(table);
	if (original.length === 0) return;

	const select = h("select", { class: "hn-sort-select" });
	for (const { value, label } of MODES) {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = label;
		select.appendChild(option);
	}
	const reverse = h("a", {
		class: "hn-sort-reverse",
		href: "javascript:void(0)",
		text: "reverse",
	});

	let currentMode = "default";
	let isReversed = false;

	function applyOrder() {
		let stories = sortStoriesBy(original, currentMode);
		if (isReversed) stories = stories.slice().reverse();
		rerenderStories(tbody, stories);
	}

	select.addEventListener("change", () => {
		currentMode = select.value;
		isReversed = false;
		applyOrder();
	});
	reverse.addEventListener("click", (e) => {
		e.preventDefault();
		isReversed = !isReversed;
		applyOrder();
	});

	const bar = h("div", { class: "hn-sort-bar" }, [
		h("label", { text: "sort: ", htmlFor: "hn-sort-select" }),
		select,
		reverse,
	]);
	table.parentNode.insertBefore(bar, table);
}
````

## File: src/features/tag-manager.js
````javascript
// Single-instance tag-management overlay. The overlay holds a draft
// snapshot of {tags, colors}; edits mutate the draft via pure helpers,
// and Save writes the draft back atomically.

import { h } from "../dom.js";
import {
	countsFromState,
	removeTagInState,
	renameTagInState,
} from "../state.js";

function isDraftDirty(liveSnapshot, draft) {
	return (
		JSON.stringify(liveSnapshot.tags || {}) !== JSON.stringify(draft.tags) ||
		JSON.stringify(liveSnapshot.colors || {}) !== JSON.stringify(draft.colors)
	);
}

// Factory. `rerenderUserTags(username)` is invoked after a successful Save
// for every user visible on the page so their inline tag pills refresh.
//
// Returns:
//   open()       - opens the overlay (no-op if already open)
//   getActive()  - returns the active overlay handle (with markStale())
//                  while open, null otherwise. Used by the cross-tab
//                  listener in main.js to flag a remote write while the
//                  overlay is mid-edit.
export function createTagManager({ store, rerenderUserTags }) {
	let tagManagerOpen = false;
	let activeTagManager = null;

	function open() {
		if (tagManagerOpen) return;
		tagManagerOpen = true;

		const live = store._snapshot();
		const draft = {
			tags: JSON.parse(JSON.stringify(live.tags || {})),
			colors: JSON.parse(JSON.stringify(live.colors || {})),
		};

		// Per-row state keyed by the tag name as it existed when the overlay
		// opened. Undo on a row reverts that row's changes only.
		const rows = new Map(); // originalName -> { currentName, pendingRemoval }
		const allNames = new Set([
			...Object.keys(live.colors || {}),
			...Object.values(live.tags || {}).flat(),
		]);
		for (const name of allNames) {
			rows.set(name, { currentName: name, pendingRemoval: false });
		}

		let filter = "";
		let sortMode = "name"; // "name" | "count"
		let isStale = false;

		const catcher = h("div", { class: "hn-tagmgr-catcher" });
		const overlay = h("div", { class: "hn-tagmgr-overlay" });
		document.body.appendChild(catcher);
		document.body.appendChild(overlay);

		activeTagManager = {
			markStale() {
				if (isStale) return;
				isStale = true;
				renderOverlay();
			},
		};

		function closeTagManager({ commit }) {
			if (commit) {
				if (isDraftDirty(live, draft)) {
					if (isStale) {
						alert(
							"Tags changed in another tab while this overlay was open. Close and reopen before saving so you do not overwrite newer data.",
						);
						return;
					}
					store.replaceTagsAndColors(draft.tags, draft.colors);
					store._invalidate();
					const visibleUsers = new Set();
					for (const el of document.querySelectorAll("[data-hn-user]")) {
						visibleUsers.add(el.dataset.hnUser);
					}
					for (const username of visibleUsers) rerenderUserTags(username);
				}
			}
			document.removeEventListener("keydown", onKeyDown);
			catcher.remove();
			overlay.remove();
			tagManagerOpen = false;
			activeTagManager = null;
		}

		function confirmDiscardIfDirty() {
			if (!isDraftDirty(live, draft)) return true;
			return confirm("Discard unsaved tag changes?");
		}

		function onKeyDown(e) {
			if (e.key !== "Escape") return;
			// If focus is inside a rename input, let the row handle its own
			// Escape (cancels the field, doesn't close the overlay).
			const active = document.activeElement;
			if (active?.classList.contains("hn-tagmgr-name-input")) return;
			e.preventDefault();
			if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
		}
		document.addEventListener("keydown", onKeyDown);

		catcher.addEventListener("click", () => {
			if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
		});

		// Footer (Save / Cancel) wired immediately; list + controls wired by
		// later tasks via renderOverlay().
		const saveBtn = h("button", {
			class: "hn-tagmgr-btn primary",
			text: "Save",
			onclick: () => closeTagManager({ commit: true }),
		});
		const cancelBtn = h("button", {
			class: "hn-tagmgr-btn",
			text: "Cancel",
			onclick: () => {
				if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
			},
		});
		const footer = h("div", { class: "hn-tagmgr-footer" }, [
			cancelBtn,
			saveBtn,
		]);

		const list = h("div", { class: "hn-tagmgr-list" });

		const filterInput = h("input", {
			type: "text",
			class: "hn-tagmgr-filter",
			placeholder: "Filter tags…",
		});
		filterInput.addEventListener("input", () => {
			filter = filterInput.value;
			renderOverlay();
		});

		const sortNameBtn = h("button", {
			class: "hn-tagmgr-sort-btn active",
			text: "Name (A→Z)",
			onclick: () => {
				sortMode = "name";
				renderOverlay();
			},
		});
		const sortCountBtn = h("button", {
			class: "hn-tagmgr-sort-btn",
			text: "Uses (0 first)",
			onclick: () => {
				sortMode = "count";
				renderOverlay();
			},
		});

		const controls = h("div", { class: "hn-tagmgr-controls" }, [
			filterInput,
			h("div", { class: "hn-tagmgr-sort" }, [sortNameBtn, sortCountBtn]),
		]);

		const headerCount = h("span", { class: "hn-tagmgr-header-count" });
		overlay.appendChild(
			h("div", { class: "hn-tagmgr-header" }, [
				h("span", { text: "Manage tags" }),
				headerCount,
			]),
		);
		overlay.appendChild(controls);
		overlay.appendChild(list);
		overlay.appendChild(footer);

		// Derive the draft from the rows map each time. Each row in `rows`
		// carries its originalName (the map key) and its current edited form;
		// pure helpers stitch the final shape together.
		function computeDraft() {
			let d = {
				tags: JSON.parse(JSON.stringify(live.tags || {})),
				colors: JSON.parse(JSON.stringify(live.colors || {})),
				schemaVersion: 1,
				ratings: live.ratings || {},
				cache: live.cache || {},
			};
			for (const [originalName, row] of rows) {
				if (row.pendingRemoval) {
					d = removeTagInState(d, originalName);
				} else if (row.currentName !== originalName) {
					d = renameTagInState(d, originalName, row.currentName);
				}
			}
			return d;
		}

		function renderOverlay() {
			const computed = computeDraft();
			draft.tags = computed.tags;
			draft.colors = computed.colors;

			const counts = countsFromState(computed);
			const needle = filter.trim().toLowerCase();

			const entries = [...rows.entries()]
				.map(([originalName, row]) => {
					const displayName = row.pendingRemoval
						? originalName
						: row.currentName;
					const count = row.pendingRemoval ? 0 : counts[row.currentName] || 0;
					const color =
						computed.colors[row.currentName] ||
						live.colors[originalName] ||
						null;
					return { originalName, row, displayName, count, color };
				})
				.filter(({ displayName }) =>
					needle === "" ? true : displayName.toLowerCase().includes(needle),
				);

			entries.sort((a, b) => {
				if (sortMode === "count") {
					if (a.count !== b.count) return a.count - b.count;
				}
				return a.displayName
					.toLowerCase()
					.localeCompare(b.displayName.toLowerCase());
			});

			sortNameBtn.classList.toggle("active", sortMode === "name");
			sortCountBtn.classList.toggle("active", sortMode === "count");
			headerCount.textContent = isStale
				? `${rows.size} tags • changed in another tab`
				: `${rows.size} tags`;
			saveBtn.disabled = isStale;
			saveBtn.title = isStale
				? "Close and reopen the tag manager before saving."
				: "";

			list.replaceChildren();
			for (const entry of entries) {
				list.appendChild(buildRow(entry));
			}
		}

		function buildRow({ originalName, row, displayName, count, color }) {
			const dirty = row.pendingRemoval || row.currentName !== originalName;
			const rowEl = h("div", {
				class: [
					"hn-tagmgr-row",
					dirty ? "dirty" : "",
					row.pendingRemoval ? "removed" : "",
				]
					.filter(Boolean)
					.join(" "),
			});

			const swatch = h("span", { class: "hn-tagmgr-swatch" });
			if (color?.bgColor) swatch.style.backgroundColor = color.bgColor;

			const nameEl = h("span", {
				class: "hn-tagmgr-name",
				text: displayName,
			});
			if (color?.bgColor) nameEl.style.backgroundColor = color.bgColor;
			if (color?.textColor) nameEl.style.color = color.textColor;

			const countEl = h("span", {
				class: `hn-tagmgr-count${count === 0 ? " zero" : ""}`,
				text: String(count),
			});

			const icons = h("div", { class: "hn-tagmgr-icons" });
			const editIcon = h("span", {
				class: "hn-tagmgr-icon",
				title: "Rename tag",
				text: "✏️", // pencil
				onclick: () => {
					// Swap name span for an input; Enter/blur commits, Escape
					// cancels the field (does not close the overlay).
					const input = h("input", {
						type: "text",
						class: "hn-tagmgr-name-input",
						value: row.currentName,
					});
					nameEl.replaceWith(input);
					input.focus();
					input.select();

					const commit = () => {
						const proposed = input.value.trim();
						if (!proposed || proposed === row.currentName) {
							renderOverlay();
							return;
						}
						// Collision check: does another row currently carry `proposed`?
						const collidesWith = [...rows.entries()].find(
							([orig, r]) =>
								orig !== originalName &&
								!r.pendingRemoval &&
								r.currentName === proposed,
						);
						if (collidesWith) {
							const srcCount =
								countsFromState(computeDraft())[row.currentName] || 0;
							if (
								!confirm(
									`Merge "${row.currentName}" into "${proposed}"? ${srcCount} user${srcCount === 1 ? "" : "s"} will be updated.`,
								)
							) {
								renderOverlay();
								return;
							}
							// Rename the source row into the destination so
							// computeDraft() applies renameTagInState on save
							// (which handles the merge). Drop the destination
							// row so the overlay doesn't show two identical
							// entries for the now-merged tag.
							row.currentName = proposed;
							rows.delete(collidesWith[0]);
						} else {
							row.currentName = proposed;
						}
						renderOverlay();
					};

					let cancelled = false;
					input.addEventListener("keydown", (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							cancelled = true;
							renderOverlay();
						}
					});
					input.addEventListener("blur", () => {
						if (cancelled) return;
						commit();
					});
				},
			});
			icons.appendChild(editIcon);

			if (dirty) {
				const undoIcon = h("span", {
					class: "hn-tagmgr-icon",
					title: "Undo changes to this row",
					text: "↩", // hook arrow
					onclick: () => {
						row.currentName = originalName;
						row.pendingRemoval = false;
						renderOverlay();
					},
				});
				icons.appendChild(undoIcon);
			}

			const removeIcon = h("span", {
				class: "hn-tagmgr-icon",
				title: row.pendingRemoval ? "Keep tag" : "Remove tag",
				text: "✖", // x
				onclick: () => {
					row.pendingRemoval = !row.pendingRemoval;
					renderOverlay();
				},
			});
			icons.appendChild(removeIcon);

			rowEl.appendChild(swatch);
			rowEl.appendChild(nameEl);
			rowEl.appendChild(countEl);
			rowEl.appendChild(icons);
			return rowEl;
		}

		renderOverlay();
		filterInput.focus();
	}

	return {
		open,
		getActive: () => activeTagManager,
	};
}
````

## File: src/features/toggle-all-comments.js
````javascript
// "[toggle all]" link in the fatitem subtext that fires every
// top-level comment's a.togg in one click — useful on long threads
// where you've already drilled into one subtree and want to dismiss
// the rest, or want to expand a fully-collapsed page in one go.
//
// Optionally also adds a per-comment "[toggle replies]" link that
// fires every direct child's a.togg. Gated by TOGGLE_ALL_REPLIES_ENABLED
// in src/config.js because adding a link to every commentscales
// linearly with thread size; refined-hacker-news warns that it slows
// page render on items with hundreds of comments. Default off.

import { TOGGLE_ALL_REPLIES_ENABLED } from "../config.js";
import { h } from "../dom.js";

function indentLevel(row) {
	const img = row.querySelector("td.ind img");
	if (!img) return 0;
	const width = Number(img.getAttribute("width")) || img.width || 0;
	return Math.round(width / 40);
}

function fireToggle(row) {
	row.querySelector("a.togg")?.click();
}

export function setupToggleAllComments() {
	const subtext = document.querySelector(".fatitem .subtext");
	const allRows = Array.from(document.querySelectorAll("tr.comtr"));
	if (!subtext || allRows.length === 0) return;

	const levels = allRows.map(indentLevel);

	// Fatitem-level toggle: collect all root rows up front so the click
	// handler doesn't re-query the DOM on every press.
	const rootRows = allRows.filter((_, i) => levels[i] === 0);
	if (rootRows.length > 0) {
		const link = h("a", {
			class: "hn-toggle-all",
			href: "javascript:void(0)",
			text: "toggle all",
			onclick: (e) => {
				e.preventDefault();
				for (const row of rootRows) fireToggle(row);
			},
		});
		// Match HN's subtext separator pattern: " | <link>".
		subtext.append(document.createTextNode(" | "));
		subtext.append(link);
	}

	if (!TOGGLE_ALL_REPLIES_ENABLED) return;

	// Per-comment "[toggle replies]" links. For each row, find its
	// immediate children (the contiguous run of following rows whose
	// indent is exactly +1 deeper, stopping when we hit one at <= the
	// parent's level). Skip rows that have no replies.
	for (let i = 0; i < allRows.length; i++) {
		const parent = allRows[i];
		const parentLevel = levels[i];
		const replies = [];
		for (let j = i + 1; j < allRows.length; j++) {
			if (levels[j] <= parentLevel) break;
			if (levels[j] === parentLevel + 1) replies.push(allRows[j]);
		}
		if (replies.length === 0) continue;

		const head = parent.querySelector("span.comhead");
		if (!head) continue;

		head.append(
			h("a", {
				class: "hn-toggle-replies",
				href: "javascript:void(0)",
				text: "[toggle replies]",
				onclick: (e) => {
					e.preventDefault();
					for (const row of replies) fireToggle(row);
				},
			}),
		);
	}
}
````

## File: src/features/toolbar.js
````javascript
// Floating toolbar with Save state / Restore state buttons. Mounted on
// item pages.

import { STATE_KEY } from "../config.js";
import { h } from "../dom.js";
import { parseImport, stateToExport } from "../state.js";

export function createToolbar({ store, backend }) {
	function exportState() {
		const data = stateToExport(store._snapshot());
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = h("a", {
			href: url,
			download: `hn-user-data-${new Date().toISOString().split("T")[0]}.json`,
		});
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			a.remove();
			URL.revokeObjectURL(url);
		}, 100);
	}

	function importState() {
		const input = h("input", { type: "file", accept: ".json" });
		input.addEventListener("change", (event) => {
			const file = event.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const raw = JSON.parse(e.target.result);
					const parsed = parseImport(raw);
					// Write the consolidated blob directly and reload so the page
					// rebuilds from a fresh store.
					backend.set(STATE_KEY, JSON.stringify(parsed));
					alert("Data imported successfully! The page will now reload.");
					location.reload();
				} catch (error) {
					alert(`Error importing data: ${error.message}`);
					console.error("Error importing data:", error);
				}
			};
			reader.readAsText(file);
		});
		input.click();
	}

	function mount() {
		const dragHandle = h("div", { class: "hn-drag-handle" });
		const buttons = h("div", { class: "hn-toolbar-buttons" }, [
			h("button", {
				class: "hn-toolbar-btn",
				text: "Save state",
				onclick: exportState,
			}),
			h("button", {
				class: "hn-toolbar-btn",
				text: "Restore state",
				onclick: importState,
			}),
		]);
		const toolbar = h("div", { class: "hn-toolbar" }, [dragHandle, buttons]);
		document.body.appendChild(toolbar);

		// Drag listeners live only for the duration of a drag, rather than
		// sitting on document forever.
		dragHandle.addEventListener("mousedown", (e) => {
			const rect = toolbar.getBoundingClientRect();
			const offsetX = e.clientX - rect.left;
			const offsetY = e.clientY - rect.top;
			e.preventDefault();

			const onMove = (ev) => {
				toolbar.style.left = `${ev.clientX - offsetX}px`;
				toolbar.style.top = `${ev.clientY - offsetY}px`;
				toolbar.style.right = "auto";
			};
			const onUp = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
			};
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});
	}

	return { mount };
}
````

## File: src/dom.js
````javascript
// Tiny element factory. Accepts text content and event handlers but
// intentionally does NOT accept innerHTML - all text goes through
// textContent so it can't become an XSS foothold even if we later pass a
// username or tag name through it.
export function h(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === "class") node.className = v;
		else if (k === "text") node.textContent = v;
		else if (k.startsWith("on") && typeof v === "function") {
			node.addEventListener(k.slice(2).toLowerCase(), v);
		} else {
			node[k] = v;
		}
	}
	for (const child of children) {
		if (child) node.appendChild(child);
	}
	return node;
}

export function findCommentParent(usernameEl) {
	return usernameEl.closest(".comhead") || usernameEl.parentElement;
}

export function isItemPage() {
	return window.location.pathname === "/item";
}
````

## File: tests/findCommentRootIndices.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { findCommentRootIndices } from "../src/parsing.js";

// findCommentRootIndices(indentLevels) maps each comment in DOM order to
// the index of its containing root, or -1 if the comment is a root itself.
// The collapse-root-comment feature uses this to know which root's toggle
// to fire when a "[collapse root]" link on an indented comment is clicked.

test("findCommentRootIndices: empty input returns empty array", () => {
	assert.deepEqual(findCommentRootIndices([]), []);
});

test("findCommentRootIndices: a single root has no parent root", () => {
	assert.deepEqual(findCommentRootIndices([0]), [-1]);
});

test("findCommentRootIndices: every non-root comment points back to its root", () => {
	// Two top-level threads:
	//   index 0: root A
	//     index 1: reply (level 1)
	//       index 2: nested reply (level 2)
	//     index 3: another reply (level 1)
	//   index 4: root B
	//     index 5: reply (level 1)
	//       index 6: nested reply (level 2)
	const indents = [0, 1, 2, 1, 0, 1, 2];
	assert.deepEqual(findCommentRootIndices(indents), [-1, 0, 0, 0, -1, 4, 4]);
});

test("findCommentRootIndices: thread with no roots leaves leading entries with -1", () => {
	// Defensive: if the first comments are mid-thread (shouldn't happen on
	// HN, but the helper is pure so we make its output predictable),
	// `currentRoot` is -1 until a level-0 comment is seen.
	assert.deepEqual(findCommentRootIndices([1, 2, 0, 1]), [-1, -1, -1, 2]);
});

test("findCommentRootIndices: multiple consecutive roots each map to themselves", () => {
	assert.deepEqual(findCommentRootIndices([0, 0, 0]), [-1, -1, -1]);
});
````

## File: tests/hoverHelpers.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDomain, truncateText } from "../src/parsing.js";

// Two small pure helpers behind the hover-panel features (PR-4):
//   - truncateText: trims long previews so the popup doesn't grow huge
//   - extractDomain: pulls "github.com" out of a story URL for the
//     item-info popup, matching the "(domain)" badge HN uses on
//     listing pages.

test("truncateText: short input is returned unchanged", () => {
	assert.equal(truncateText("hi", 10), "hi");
});

test("truncateText: exactly-at-limit input is unchanged (no ellipsis)", () => {
	assert.equal(truncateText("abcde", 5), "abcde");
});

test("truncateText: longer-than-limit input is sliced and ellipsised", () => {
	assert.equal(truncateText("abcdefghij", 4), "abcd…");
});

test("truncateText: defensive against non-string / bad maxLen", () => {
	assert.equal(truncateText(null, 10), "");
	assert.equal(truncateText(undefined, 10), "");
	assert.equal(truncateText("hi", -1), "hi");
	assert.equal(truncateText("hi", "not a number"), "hi");
});

test("extractDomain: pulls hostname from a normal URL", () => {
	assert.equal(extractDomain("https://example.com/path"), "example.com");
	assert.equal(extractDomain("http://example.com/"), "example.com");
});

test("extractDomain: strips a leading www.", () => {
	assert.equal(extractDomain("https://www.github.com/foo"), "github.com");
});

test("extractDomain: handles ports and subdomains", () => {
	assert.equal(
		extractDomain("https://blog.example.com:8080/x"),
		"blog.example.com",
	);
});

test("extractDomain: returns null for non-URL input", () => {
	assert.equal(extractDomain(""), null);
	assert.equal(extractDomain("not a url"), null);
	assert.equal(extractDomain(null), null);
	assert.equal(extractDomain(undefined), null);
});
````

## File: tests/itemCache.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../src/state.js";

// itemCache mirrors the user cache: digest in, fetchedAt stamped on
// write, TTL-checked on read. The hover-panel feature (PR-4) reads
// from it before falling back to the network so cursor passes over
// already-hovered links cost zero requests.

function makeFakeBackend(initial = {}) {
	const data = { ...initial };
	return {
		data,
		get: (k) => (k in data ? data[k] : undefined),
		set: (k, v) => {
			data[k] = v;
		},
	};
}

const HOUR_MS = 60 * 60 * 1000;
const SAMPLE_DIGEST = {
	title: "Show HN: Foo",
	url: "https://example.com/foo",
	by: "alice",
	score: 42,
	descendants: 7,
	time: 1_700_000_000,
	text: "",
	type: "story",
};

test("itemCache: miss on empty store", () => {
	const store = createStore(makeFakeBackend());
	assert.equal(store.getCachedItem("123", Date.now(), HOUR_MS), null);
});

test("itemCache: hit within TTL returns the digest (without fetchedAt)", () => {
	const store = createStore(makeFakeBackend());
	const t0 = 1_000_000_000_000;
	store.setCachedItem("123", SAMPLE_DIGEST, t0);
	const hit = store.getCachedItem("123", t0 + HOUR_MS - 1, HOUR_MS);
	assert.deepEqual(hit, SAMPLE_DIGEST);
	assert.equal(hit.fetchedAt, undefined);
});

test("itemCache: miss when past TTL", () => {
	const store = createStore(makeFakeBackend());
	const t0 = 1_000_000_000_000;
	store.setCachedItem("123", SAMPLE_DIGEST, t0);
	assert.equal(store.getCachedItem("123", t0 + HOUR_MS + 1, HOUR_MS), null);
});

test("itemCache: persists across store instances", () => {
	const backend = makeFakeBackend();
	const t0 = 1_000_000_000_000;
	createStore(backend).setCachedItem("123", SAMPLE_DIGEST, t0);
	const hit = createStore(backend).getCachedItem("123", t0, HOUR_MS);
	assert.deepEqual(hit, SAMPLE_DIGEST);
});

test("itemCache: setCachedItem overwrites the previous digest", () => {
	const store = createStore(makeFakeBackend());
	store.setCachedItem("123", SAMPLE_DIGEST, 1000);
	store.setCachedItem("123", { ...SAMPLE_DIGEST, score: 999 }, 2000);
	const hit = store.getCachedItem("123", 2000, HOUR_MS);
	assert.equal(hit.score, 999);
});
````

## File: tests/linkifyAndSort.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { linkifySegments, sortStoriesBy } from "../src/parsing.js";

// Pure helpers behind PR-5 features:
//   - linkifySegments: splits user about-text into text/url/email
//     segments for the linkify-user-about DOM glue
//   - sortStoriesBy: reorders a story list for the sort-stories
//     dropdown (default / time / score / ratio)

test("linkifySegments: empty string and non-string input", () => {
	assert.deepEqual(linkifySegments(""), []);
	assert.deepEqual(linkifySegments(null), []);
	assert.deepEqual(linkifySegments(undefined), []);
});

test("linkifySegments: plain text with no links yields one text segment", () => {
	assert.deepEqual(linkifySegments("just some prose"), [
		{ kind: "text", value: "just some prose" },
	]);
});

test("linkifySegments: a bare https URL is one url segment", () => {
	assert.deepEqual(linkifySegments("https://example.com"), [
		{ kind: "url", value: "https://example.com" },
	]);
});

test("linkifySegments: trailing punctuation is split out as a text segment", () => {
	assert.deepEqual(linkifySegments("see https://example.com."), [
		{ kind: "text", value: "see " },
		{ kind: "url", value: "https://example.com" },
		{ kind: "text", value: "." },
	]);
});

test("linkifySegments: closing parenthesis is split out", () => {
	assert.deepEqual(linkifySegments("(https://example.com)"), [
		{ kind: "text", value: "(" },
		{ kind: "url", value: "https://example.com" },
		{ kind: "text", value: ")" },
	]);
});

test("linkifySegments: email address is recognised", () => {
	assert.deepEqual(linkifySegments("contact: foo@example.com"), [
		{ kind: "text", value: "contact: " },
		{ kind: "email", value: "foo@example.com" },
	]);
});

test("linkifySegments: multiple URLs in one string", () => {
	assert.deepEqual(linkifySegments("first https://a.com then https://b.com"), [
		{ kind: "text", value: "first " },
		{ kind: "url", value: "https://a.com" },
		{ kind: "text", value: " then " },
		{ kind: "url", value: "https://b.com" },
	]);
});

test("linkifySegments: http (not https) is also matched", () => {
	const segs = linkifySegments("legacy http://example.org/path");
	assert.equal(segs.at(-1).kind, "url");
	assert.equal(segs.at(-1).value, "http://example.org/path");
});

test("linkifySegments: round-trips back to the original input", () => {
	const inputs = [
		"plain text",
		"see https://example.com.",
		"(https://example.com)",
		"foo@example.com is mine",
		"first https://a.com then https://b.com",
		"",
		"https://example.com",
	];
	for (const input of inputs) {
		const segs = linkifySegments(input);
		const joined = segs.map((s) => s.value).join("");
		assert.equal(
			joined,
			input,
			`round-trip mismatch: ${JSON.stringify(input)}`,
		);
	}
});

// --- sortStoriesBy ---

const STORIES = [
	{ id: "100", score: 10, commentsCount: 5, defaultRank: 3 },
	{ id: "200", score: 50, commentsCount: 200, defaultRank: 1 },
	{ id: "150", score: 30, commentsCount: 1, defaultRank: 2 },
];

test("sortStoriesBy: default uses defaultRank ascending", () => {
	const sorted = sortStoriesBy(STORIES, "default");
	assert.deepEqual(
		sorted.map((s) => s.id),
		["200", "150", "100"], // ranks 1, 2, 3
	);
});

test("sortStoriesBy: time uses id descending (newer first)", () => {
	const sorted = sortStoriesBy(STORIES, "time");
	assert.deepEqual(
		sorted.map((s) => s.id),
		["200", "150", "100"],
	);
});

test("sortStoriesBy: score is descending", () => {
	const sorted = sortStoriesBy(STORIES, "score");
	assert.deepEqual(
		sorted.map((s) => s.id),
		["200", "150", "100"], // 50, 30, 10
	);
});

test("sortStoriesBy: ratio is comments/score descending (high discussion first)", () => {
	const sorted = sortStoriesBy(STORIES, "ratio");
	// Ratios: 100 → 0.5, 200 → 4.0, 150 → 0.033 → 200, 100, 150
	assert.deepEqual(
		sorted.map((s) => s.id),
		["200", "100", "150"],
	);
});

test("sortStoriesBy: unknown mode falls back to default", () => {
	const sorted = sortStoriesBy(STORIES, "totally-bogus");
	assert.deepEqual(
		sorted.map((s) => s.id),
		["200", "150", "100"],
	);
});

test("sortStoriesBy: does not mutate the input array", () => {
	const original = STORIES.slice();
	const _sorted = sortStoriesBy(STORIES, "score");
	assert.deepEqual(STORIES, original);
});

test("sortStoriesBy: empty / nullish input returns an empty array", () => {
	assert.deepEqual(sortStoriesBy([], "score"), []);
	assert.deepEqual(sortStoriesBy(null, "score"), []);
});

test("sortStoriesBy: zero or missing score doesn't divide-by-zero in ratio", () => {
	const stories = [
		{ id: "1", score: 0, commentsCount: 5, defaultRank: 1 },
		{ id: "2", score: 10, commentsCount: 5, defaultRank: 2 },
	];
	const sorted = sortStoriesBy(stories, "ratio");
	// Score 0 → divisor clamped to 1 → ratio 5; score 10 → ratio 0.5
	assert.deepEqual(
		sorted.map((s) => s.id),
		["1", "2"],
	);
});
````

## File: tests/readComments.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	findNewCommentIds,
	isReadCommentEntryFresh,
	pruneExpiredReadComments,
} from "../src/parsing.js";

// Pure helpers behind the highlight-unread-comments feature. The DOM
// pass collects current comment IDs from tr.comtr[id], asks the store
// for the previously-stored IDs, hands both arrays here, and uses the
// result to mark new comments. The store is cleaned up on every item
// page load via pruneExpiredReadComments to keep the slice from growing
// unboundedly.

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 3 * DAY_MS;

test("findNewCommentIds: no stored ids means everything is new", () => {
	assert.deepEqual(findNewCommentIds(["a", "b", "c"], []), ["a", "b", "c"]);
});

test("findNewCommentIds: empty current list yields empty new list", () => {
	assert.deepEqual(findNewCommentIds([], ["a"]), []);
});

test("findNewCommentIds: returns only ids not present in stored", () => {
	assert.deepEqual(findNewCommentIds(["a", "b", "c", "d"], ["a", "c"]), [
		"b",
		"d",
	]);
});

test("findNewCommentIds: preserves the order from currentIds", () => {
	assert.deepEqual(findNewCommentIds(["c", "a", "b"], ["a"]), ["c", "b"]);
});

test("findNewCommentIds: defensive against null inputs", () => {
	assert.deepEqual(findNewCommentIds(null, null), []);
	assert.deepEqual(findNewCommentIds(undefined, undefined), []);
});

test("isReadCommentEntryFresh: fresh entry within TTL", () => {
	const now = 1_000_000_000_000;
	assert.equal(
		isReadCommentEntryFresh({ fetchedAt: now - DAY_MS, ids: [] }, now, TTL_MS),
		true,
	);
});

test("isReadCommentEntryFresh: stale entry past TTL", () => {
	const now = 1_000_000_000_000;
	assert.equal(
		isReadCommentEntryFresh(
			{ fetchedAt: now - 4 * DAY_MS, ids: [] },
			now,
			TTL_MS,
		),
		false,
	);
});

test("isReadCommentEntryFresh: missing entry / missing fetchedAt is stale", () => {
	const now = 1_000_000_000_000;
	assert.equal(isReadCommentEntryFresh(null, now, TTL_MS), false);
	assert.equal(isReadCommentEntryFresh(undefined, now, TTL_MS), false);
	assert.equal(isReadCommentEntryFresh({}, now, TTL_MS), false);
	assert.equal(
		isReadCommentEntryFresh(
			{ ids: [], fetchedAt: "not a number" },
			now,
			TTL_MS,
		),
		false,
	);
});

test("pruneExpiredReadComments: keeps fresh, drops stale", () => {
	const now = 1_000_000_000_000;
	const map = {
		fresh: { fetchedAt: now - DAY_MS, ids: ["x"] },
		stale: { fetchedAt: now - 5 * DAY_MS, ids: ["y"] },
		brand_new: { fetchedAt: now, ids: [] },
	};
	const pruned = pruneExpiredReadComments(map, now, TTL_MS);
	assert.deepEqual(Object.keys(pruned).sort(), ["brand_new", "fresh"]);
});

test("pruneExpiredReadComments: empty map is empty", () => {
	assert.deepEqual(pruneExpiredReadComments({}, 100, TTL_MS), {});
	assert.deepEqual(pruneExpiredReadComments(null, 100, TTL_MS), {});
});
````

## File: tests/splitBackticks.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { splitBackticks } from "../src/parsing.js";

// splitBackticks(text) is the pure helper behind the
// backticks-to-monospace pass. The DOM walker collects text nodes
// inside .commtext, calls this, and replaces each text node with a
// DocumentFragment built from the segments.

test("splitBackticks: empty string returns empty array", () => {
	assert.deepEqual(splitBackticks(""), []);
});

test("splitBackticks: non-string input returns empty array", () => {
	assert.deepEqual(splitBackticks(null), []);
	assert.deepEqual(splitBackticks(undefined), []);
});

test("splitBackticks: text with no backticks returns one text segment", () => {
	assert.deepEqual(splitBackticks("plain prose"), [
		{ kind: "text", value: "plain prose" },
	]);
});

test("splitBackticks: a single backtick pair extracts the code", () => {
	assert.deepEqual(splitBackticks("before `foo` after"), [
		{ kind: "text", value: "before " },
		{ kind: "code", value: "foo" },
		{ kind: "text", value: " after" },
	]);
});

test("splitBackticks: code at the very start has no leading text segment", () => {
	assert.deepEqual(splitBackticks("`code` then text"), [
		{ kind: "code", value: "code" },
		{ kind: "text", value: " then text" },
	]);
});

test("splitBackticks: code at the very end has no trailing text segment", () => {
	assert.deepEqual(splitBackticks("text then `code`"), [
		{ kind: "text", value: "text then " },
		{ kind: "code", value: "code" },
	]);
});

test("splitBackticks: multiple pairs are all extracted", () => {
	assert.deepEqual(splitBackticks("a `b` c `d` e"), [
		{ kind: "text", value: "a " },
		{ kind: "code", value: "b" },
		{ kind: "text", value: " c " },
		{ kind: "code", value: "d" },
		{ kind: "text", value: " e" },
	]);
});

test("splitBackticks: adjacent pairs produce back-to-back code segments", () => {
	assert.deepEqual(splitBackticks("`a``b`"), [
		{ kind: "code", value: "a" },
		{ kind: "code", value: "b" },
	]);
});

test("splitBackticks: an unmatched backtick stays in the surrounding text", () => {
	// No closing backtick, so the whole thing is a single text segment.
	assert.deepEqual(splitBackticks("a `b without close"), [
		{ kind: "text", value: "a `b without close" },
	]);
});

test("splitBackticks: empty backtick pair survives as text (no code, no eat)", () => {
	// `` is two backticks with nothing between them. The /`([^`]+)`/
	// regex requires at least one non-backtick character between the
	// pair, so this stays as literal text rather than becoming an
	// empty <code> element.
	assert.deepEqual(splitBackticks("a `` b"), [
		{ kind: "text", value: "a `` b" },
	]);
});

test("splitBackticks: result re-joins to the original input", () => {
	// Sanity check: a round trip via the segments preserves the input
	// exactly (modulo backtick wrapping for code segments).
	const inputs = [
		"plain text",
		"a `b` c",
		"`code only`",
		"`a` `b` `c`",
		"`a``b`",
		"unmatched `tick",
		"",
	];
	for (const input of inputs) {
		const segs = splitBackticks(input);
		const joined = segs
			.map((s) => (s.kind === "code" ? `\`${s.value}\`` : s.value))
			.join("");
		assert.equal(
			joined,
			input,
			`round-trip mismatch for: ${JSON.stringify(input)}`,
		);
	}
});
````

## File: .gitignore
````
.aider*
.env
````

## File: .claude/settings.local.json
````json
{
  "permissions": {
    "allow": [
      "Bash(agent-browser --help)",
      "Bash(biome --version)",
      "Bash(biome check:*)",
      "Bash(biome format:*)",
      "Bash(biome lint:*)",
      "Bash(command -v biome)",
      "Bash(curl *)",
      "Bash(gh api *)",
      "Bash(gh auth *)",
      "Bash(gh issue *)",
      "Bash(gh pr:*)",
      "Bash(git *)",
      "Bash(git add:*)",
      "Bash(git branch:*)",
      "Bash(git checkout:*)",
      "Bash(git commit:*)",
      "Bash(git fetch:*)",
      "Bash(git pull:*)",
      "Bash(git push:*)",
      "Bash(just build *)",
      "Bash(just check *)",
      "Bash(just fmt:*)",
      "Bash(just lint:*)",
      "Bash(just test:*)",
      "Bash(node --check script.js)",
      "Bash(node --test 'tests/*.test.js')",
      "Bash(node --test \"tests/*.test.js\")",
      "Bash(node --test tests/)",
      "Bash(npm test *)",
      "Read(//tmp/**)",
      "Skill(code-review:code-review)",
      "WebFetch(domain:github.com)",
      "WebFetch(domain:raw.githubusercontent.com)",
      "mcp__fetch__fetch"
    ]
  }
}
````

## File: scripts/clean-orphan-tags.js
````javascript
#!/usr/bin/env node
// One-off cleanup for exported state JSON files. Drops every entry from
// `customTags` whose name is not carried by any user in the export. The
// input file is never mutated; a cleaned copy is written to a sibling
// path.
//
// Usage:
//   node scripts/clean-orphan-tags.js <input.json> [<output.json>]
//
// Flow: Save state via the userscript toolbar -> run this script against
// the downloaded JSON -> Restore state from the cleaned file.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseImport, stateToExport } from "../src/state.js";

export function cleanOrphans(exported) {
	const state = parseImport(exported);
	const usedTags = new Set();
	for (const tags of Object.values(state.tags)) {
		for (const t of tags) usedTags.add(t);
	}
	const cleanedColors = {};
	const removed = [];
	for (const [name, info] of Object.entries(state.colors)) {
		if (usedTags.has(name)) {
			cleanedColors[name] = info;
		} else {
			removed.push(name);
		}
	}
	state.colors = cleanedColors;
	return { cleaned: stateToExport(state), removed };
}

export function defaultOutputPath(inputPath) {
	const ext = path.extname(inputPath);
	const dir = path.dirname(inputPath);
	const base = path.basename(inputPath, ext);
	return path.join(dir, `${base}.cleaned${ext || ".json"}`);
}

function runCli(argv) {
	const [inputPath, outputPath] = argv;
	if (!inputPath) {
		console.error(
			"Usage: node scripts/clean-orphan-tags.js <input.json> [<output.json>]",
		);
		process.exit(1);
	}
	const raw = JSON.parse(readFileSync(inputPath, "utf8"));
	const { cleaned, removed } = cleanOrphans(raw);
	const outPath = outputPath || defaultOutputPath(inputPath);
	writeFileSync(outPath, JSON.stringify(cleaned, null, 2));

	console.log(`Removed ${removed.length} orphan tag(s):`);
	for (const name of removed.sort()) console.log(`  - ${name}`);
	console.log(`\nWrote cleaned export to ${outPath}`);
}

const isMain =
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) runCli(process.argv.slice(2));
````

## File: src/features/highlight-unread-comments.js
````javascript
// Mark comment rows that weren't on the page the last time you visited
// this thread. Keeps a per-item ID list in the consolidated store under
// state.readComments[itemId] = { ids, fetchedAt }, with a 3-day TTL
// (READ_COMMENTS_TTL_MS in config). Stale entries are pruned on every
// item-page load so the slice can't grow unboundedly.
//
// First visit (no stored entry): nothing is highlighted, but every
// visible comment ID is recorded so the *next* visit knows which
// comments are new.
//
// Subsequent visits: ids in the current page that weren't in the
// stored entry get a .hn-new-comment class on their tr.comtr row.
// (The class lives on the row, not on td.ind, because the indent cell
// has ~0 width on root-level comments — anything painted on it would
// be invisible there.)

import { READ_COMMENTS_TTL_MS } from "../config.js";
import { findNewCommentIds } from "../parsing.js";

// Read the item id from the current page's URL. Distinct from
// item-info-hover's same-purpose helper, which reads from a hovered
// link's href. The build concatenates every module into one IIFE, so
// function names must be unique across src/features/*.js — same-name
// declarations would silently override each other.
function getCurrentItemIdFromUrl() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || null;
}

function getCurrentCommentIds() {
	return Array.from(document.querySelectorAll("tr.comtr"))
		.map((row) => row.id)
		.filter(Boolean);
}

export function setupHighlightUnreadComments({ store }) {
	const itemId = getCurrentItemIdFromUrl();
	if (!itemId) return;

	const now = Date.now();

	// Drop expired entries first so a user who hasn't visited a thread
	// in months doesn't carry around its dead ID list forever.
	store.pruneReadComments(now, READ_COMMENTS_TTL_MS);

	const currentIds = getCurrentCommentIds();
	if (currentIds.length === 0) return;

	const stored = store.getReadComments(itemId);
	const isFreshSecondVisit =
		stored !== null && now - stored.fetchedAt <= READ_COMMENTS_TTL_MS;

	if (isFreshSecondVisit) {
		const newIds = findNewCommentIds(currentIds, stored.ids);
		for (const id of newIds) {
			const row = document.getElementById(id);
			if (row) row.classList.add("hn-new-comment");
		}
	}

	// Always update the stored snapshot to match what's currently on
	// the page — next visit's "new" set is derived from this.
	store.setReadComments(itemId, currentIds, now);
}
````

## File: src/features/item-info-hover.js
````javascript
// Hover any link to /item?id=N inside a comment to see a preview of
// that item: title, domain, author, score, comment count, time, and
// (for Ask/Show items) a snippet of the body text. Useful when a
// commenter cites another submission and you want context without
// leaving the page.
//
// Scoped to `.commtext a[href*='/item?id=']` so we only enrich
// commenter-cited links, not navigation chrome (like the "parent" /
// "next" links that point to other items).

import { h } from "../dom.js";
import { extractDomain, timeSince, truncateText } from "../parsing.js";

const TEXT_PREVIEW_MAX = 280;

// Distinct from highlight-unread's URL-based helper. The build flattens
// every module into one IIFE, so two same-name function declarations
// would silently override each other.
function getItemIdFromLinkHref(link) {
	try {
		const url = new URL(link.href);
		return url.searchParams.get("id") || null;
	} catch {
		return null;
	}
}

function textToPreview(html) {
	if (!html) return "";
	const doc = new DOMParser().parseFromString(html, "text/html");
	const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
	return truncateText(text, TEXT_PREVIEW_MAX);
}

function renderItemPopup(digest) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const titleNodes = [h("strong", { text: digest.title || "(untitled)" })];
	const domain = extractDomain(digest.url);
	if (domain) {
		titleNodes.push(
			h("span", { class: "hn-hover-popup-domain", text: ` (${domain})` }),
		);
	}

	const lines = [h("div", { class: "hn-hover-popup-title" }, titleNodes)];

	const metaParts = [];
	if (digest.score) metaParts.push(`${digest.score} points`);
	if (digest.by) metaParts.push(`by ${digest.by}`);
	if (digest.time) metaParts.push(`${timeSince(digest.time, nowSeconds)} ago`);
	if (typeof digest.descendants === "number") {
		metaParts.push(
			`${digest.descendants} comment${digest.descendants === 1 ? "" : "s"}`,
		);
	}
	if (metaParts.length > 0) {
		lines.push(
			h("div", { class: "hn-hover-popup-meta", text: metaParts.join(" · ") }),
		);
	}

	const body = textToPreview(digest.text);
	if (body) {
		lines.push(h("div", { class: "hn-hover-popup-body", text: body }));
	}
	return lines;
}

export function setupItemInfoHover({ fetchItem, popup }) {
	const links = document.querySelectorAll(".commtext a[href*='/item?id=']");
	for (const link of links) {
		const id = getItemIdFromLinkHref(link);
		if (!id) continue;
		popup.attachDwell(
			link,
			() => fetchItem(id),
			(digest) => renderItemPopup(digest),
		);
	}
}
````

## File: src/features/reply-inline.js
````javascript
// Inline reply / edit / delete: instead of navigating away to
// /reply?id=N or /edit?id=N when the user clicks one of those links,
// fetch the page in the background and inject its <form> into the
// comment's div.reply. Click again to hide. If text is selected
// before the click, prepend it as a "> " quoted block to the
// textarea so users can quote-reply with the keyboard.
//
// Adapted from refined-hacker-news's reply-without-leaving-page,
// minus the italics-on-quote option (always plain "> "). Network
// fetches go through GM_xmlhttpRequest with a timeout — without it
// a hung request would silently strand the spinner forever.

import { h } from "../dom.js";

const FETCH_TIMEOUT_MS = 8000;

function fetchPageDom(url) {
	return new Promise((resolve) => {
		GM_xmlhttpRequest({
			method: "GET",
			url,
			timeout: FETCH_TIMEOUT_MS,
			onload: (response) => {
				if (response.status !== 200 || !response.responseText) {
					resolve(null);
					return;
				}
				try {
					const doc = new DOMParser().parseFromString(
						response.responseText,
						"text/html",
					);
					resolve(doc);
				} catch (_err) {
					resolve(null);
				}
			},
			onerror: () => resolve(null),
			ontimeout: () => resolve(null),
		});
	});
}

// Wrap the user's current text selection (if any) into a "> "-prefixed
// block, suitable for prepending to a reply textarea.
function quoteSelection() {
	const text = window.getSelection().toString().trim();
	if (!text) return "";
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => `> ${line}`)
		.join("\n\n");
}

function isClickModified(event) {
	return (
		event.button !== 0 ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.altKey
	);
}

function attachActionLink(link, replyDiv, state) {
	const originalText = link.textContent;

	link.addEventListener("click", async (event) => {
		// Modified clicks (cmd/ctrl/middle/shift) keep their default
		// behaviour — opening in a new tab is still useful.
		if (isClickModified(event)) return;
		event.preventDefault();

		const quoted = quoteSelection();

		// If a form is currently open from any action on this comment,
		// remove it. If the same button was clicked, that's the toggle-
		// off path; if a different button, fall through after removal
		// to fetch the new form.
		if (state.activeForm) {
			state.activeForm.remove();
			state.activeForm = null;
			if (state.activeButton) {
				state.activeButton.textContent = state.activeButton.dataset.hnOriginal;
				state.activeButton.dataset.hnOriginal = "";
			}
			const wasSameButton = state.activeButton === link;
			state.activeButton = null;
			if (wasSameButton) return;
		}

		// Visual cue while the fetch is in flight.
		const loader = h("span", {
			class: "hn-reply-loader",
			text: " (loading…)",
		});
		link.after(loader);

		const dom = await fetchPageDom(link.href);
		loader.remove();
		if (!dom) {
			alert(
				"Couldn't load the form for that action. Try clicking the link directly to navigate to the page.",
			);
			return;
		}
		const form = dom.querySelector("form");
		if (!form) {
			alert(
				"The fetched page didn't contain a form. Try clicking the link directly.",
			);
			return;
		}
		form.classList.add("hn-injected-form");

		state.activeForm = form;
		state.activeButton = link;
		link.dataset.hnOriginal = originalText;
		link.textContent = `hide ${originalText}`;
		replyDiv.append(form);

		const textarea = form.querySelector("textarea");
		if (textarea) {
			if (quoted.length > 0) {
				textarea.value = `${textarea.value ? `${textarea.value}\n\n` : ""}${quoted}\n\n`;
			}
			textarea.focus();
		}
	});
}

export function setupReplyInline() {
	for (const comment of document.querySelectorAll("tr.comtr")) {
		const replyDiv = comment.querySelector("div.reply");
		if (!replyDiv) continue;

		// Per-comment shared state across the action buttons so opening
		// one form auto-closes another on the same comment.
		const state = { activeForm: null, activeButton: null };

		for (const action of ["reply", "edit", "delete-confirm"]) {
			const link = comment.querySelector(`a[href^="${action}"]`);
			if (link) attachActionLink(link, replyDiv, state);
		}
	}
}
````

## File: src/features/user-info-hover.js
````javascript
// Hover any .hnuser link to see a popup with the user's account age,
// karma, and (if any) about-text snippet. Shares the popup primitive
// with item-info-hover, and the user-data cache with renderAllUsernames
// — repeat hovers cost zero requests.
//
// Skipped on the /user page itself (you're already looking at the
// profile).
//
// On item pages, renderAllUsernames hides each original .hnuser and
// inserts a visible clone inside .hn-main-row — so this pass must run
// after renderAllUsernames, and we attach to every .hnuser we find.
// Handlers on the hidden originals never fire (display:none = no mouse
// events); the visible clones do, and the popup adds the about-text
// snippet that the inline (age, karma) blurb doesn't show.

import { h } from "../dom.js";
import { timeSince, truncateText } from "../parsing.js";

const ABOUT_PREVIEW_MAX = 280;

function isOnUserPage() {
	return window.location.pathname === "/user";
}

// HN serves `about` as HTML (links, paragraphs, italic). For the
// preview popup, we want a plain-text rendering — strips tags via the
// browser's HTML parser and trims to a fixed length so a long bio
// doesn't make the popup the size of a small monitor.
function aboutToText(html) {
	if (!html) return "";
	const doc = new DOMParser().parseFromString(html, "text/html");
	const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
	return truncateText(text, ABOUT_PREVIEW_MAX);
}

function renderUserPopup(username, data) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const lines = [
		h("div", { class: "hn-hover-popup-title" }, [
			h("strong", { text: username }),
		]),
		h("div", {
			class: "hn-hover-popup-meta",
			text: `${timeSince(data.created, nowSeconds)} old · ${data.karma} karma`,
		}),
	];
	const about = aboutToText(data.about);
	if (about) {
		lines.push(h("div", { class: "hn-hover-popup-body", text: about }));
	}
	return lines;
}

export function setupUserInfoHover({ fetchUser, popup }) {
	if (isOnUserPage()) return;
	for (const link of document.querySelectorAll("a.hnuser")) {
		const username = link.textContent;
		if (!username) continue;
		popup.attachDwell(
			link,
			() => fetchUser(username),
			(data) => renderUserPopup(username, data),
		);
	}
}
````

## File: src/features/user-render.js
````javascript
// Per-user inline UI on item pages: account info blurb, rating controls,
// editable tag list, plus the rerender-by-user fan-out used after any
// store write so all comments by the same author stay in sync.

import { findCommentParent, h } from "../dom.js";
import { parseTagInput, timeSince } from "../parsing.js";

// Pastel HSL. The lightness floor (75%) guarantees black text is always the
// high-contrast choice, so we don't need a luminance calculator.
function randomPastelColor() {
	const r = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1) + lo);
	return `hsl(${r(0, 359)}, ${r(30, 100)}%, ${r(75, 95)}%)`;
}

// Factory. Wiring done in main.js:
//   - `store` is the consolidated store from src/state.js
//   - `fetchUser` is from src/api.js
//   - `openTagManager` is the overlay opener from src/features/tag-manager.js
//     (passed as a getter so it can refer to a forward-declared variable).
export function createUserRender({ store, fetchUser, openTagManager }) {
	function ensureTagColor(tagName) {
		const existing = store.getTagColor(tagName);
		if (existing?.bgColor) return existing;
		const color = { bgColor: randomPastelColor(), textColor: "black" };
		store.setTagColor(tagName, color);
		return color;
	}

	function renderRatingControls(username) {
		const display = h("span", {
			class: "hn-rating-display",
			text: String(store.getRating(username)),
		});
		display.dataset.hnUser = username;
		const mkBtn = (glyph, delta) =>
			h("button", {
				class: "hn-rating-btn",
				text: glyph,
				tabIndex: -1,
				onclick: (e) => {
					e.preventDefault();
					e.currentTarget.blur();
					const next = store.getRating(username) + delta;
					store.setRating(username, next);
					rerenderUserRatings(username);
				},
			});
		return h("span", { class: "hn-rating-container" }, [
			mkBtn("▲", 1),
			mkBtn("▼", -1),
			display,
		]);
	}

	// Renders the tag list for a user into `container` (clearing first). Called
	// on initial render and after any tag edit/remove so we don't need a full
	// page reload.
	function renderTagGroup(username, container) {
		container.replaceChildren();
		for (const tag of store.getUserTags(username)) {
			container.appendChild(renderTagSpan(username, tag));
		}
	}

	// Re-renders tag groups and updates tag inputs for every instance of a
	// user on the page. Called after any tag mutation so all comments by the
	// same author stay in sync.
	function rerenderUserTags(username) {
		const esc = CSS.escape(username);
		for (const group of document.querySelectorAll(
			`.hn-tag-group[data-hn-user="${esc}"]`,
		)) {
			renderTagGroup(username, group);
		}
		const names = store.getUserTags(username).map((t) => t.value);
		for (const input of document.querySelectorAll(
			`.hn-tag-input[data-hn-user="${esc}"]`,
		)) {
			input.value = names.join(", ");
		}
	}

	function rerenderUserRatings(username) {
		const esc = CSS.escape(username);
		const text = String(store.getRating(username));
		for (const rd of document.querySelectorAll(
			`.hn-rating-display[data-hn-user="${esc}"]`,
		)) {
			rd.textContent = text;
		}
	}

	function renderTagSpan(username, tag) {
		const editIcon = h("span", {
			class: "hn-tag-icon",
			title: "Edit tag",
			text: "✏️", // pencil
			onclick: (e) => {
				e.stopPropagation();
				const raw = prompt("Edit tag name:", tag.value);
				const newName = raw ? raw.trim() : "";
				if (!newName || newName === tag.value) return;
				const current = store.getUserTags(username);
				const color = ensureTagColor(newName);
				const updated = current.map((t) =>
					t.value === tag.value
						? {
								value: newName,
								bgColor: color.bgColor,
								textColor: color.textColor,
							}
						: t,
				);
				store.setUserTags(username, updated);
				rerenderUserTags(username);
			},
		});
		const removeIcon = h("span", {
			class: "hn-tag-icon",
			title: "Remove tag",
			text: "✖", // x
			onclick: (e) => {
				e.stopPropagation();
				if (!confirm(`Remove tag "${tag.value}"?`)) return;
				const current = store.getUserTags(username);
				store.setUserTags(
					username,
					current.filter((t) => t.value !== tag.value),
				);
				rerenderUserTags(username);
			},
		});

		const manageIcon = h("span", {
			class: "hn-tag-icon",
			title: "Manage all tags",
			text: "☰", // hamburger
			onclick: (e) => {
				e.stopPropagation();
				openTagManager();
			},
		});

		const span = h("div", { class: "hn-tag" }, [
			h("span", { class: "hn-tag-text", text: tag.value }),
			h("div", { class: "hn-tag-icons" }, [editIcon, manageIcon, removeIcon]),
		]);
		span.style.backgroundColor = tag.bgColor || "";
		span.style.color = tag.textColor || "black";
		return span;
	}

	function renderTagInput(username) {
		const currentNames = store.getUserTags(username).map((t) => t.value);
		const input = h("input", {
			type: "text",
			class: "hn-tag-input",
			value: currentNames.join(", "),
			placeholder: "Add tags (comma separated)",
		});
		input.dataset.hnUser = username;

		// Keystrokes update a live preview only; the store is written on blur
		// or Enter. Writing per-keystroke was persisting every partial string
		// the user typed (e.g. "Are" -> "Areg" -> "Argen" -> "Argentinian"
		// all ended up as distinct saved tags), which polluted both the
		// user's tag list and the shared colors map.
		const previewColors = new Map();
		const previewColorFor = (name) => {
			const real = store.getTagColor(name);
			if (real?.bgColor) return real;
			if (previewColors.has(name)) return previewColors.get(name);
			const color = { bgColor: randomPastelColor(), textColor: "black" };
			previewColors.set(name, color);
			return color;
		};

		const parseNames = () => parseTagInput(input.value);

		const renderPreview = () => {
			const esc = CSS.escape(username);
			const names = parseNames();
			for (const group of document.querySelectorAll(
				`.hn-tag-group[data-hn-user="${esc}"]`,
			)) {
				group.replaceChildren();
				for (const name of names) {
					const color = previewColorFor(name);
					group.appendChild(
						renderTagSpan(username, {
							value: name,
							bgColor: color.bgColor,
							textColor: color.textColor,
						}),
					);
				}
			}
		};

		const commit = () => {
			const names = parseNames();
			const updated = names.map((name) => {
				const color = ensureTagColor(name);
				return {
					value: name,
					bgColor: color.bgColor,
					textColor: color.textColor,
				};
			});
			store.setUserTags(username, updated);
			rerenderUserTags(username);
			previewColors.clear();
		};

		input.addEventListener("input", renderPreview);
		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			input.blur(); // triggers commit via the blur listener
		});
		return input;
	}

	function renderAccountInfo(created, karma) {
		const now = Math.floor(Date.now() / 1000);
		return h("span", {
			class: "hn-info",
			text: `(${timeSince(created, now)} old, ${karma} karma)`,
		});
	}

	// Skeleton-first: every row is built and inserted synchronously from the
	// store. The age/karma blurb gets filled in as each fetch resolves, so a
	// slow or hung request can't block the rest of the page.
	function renderAllUsernames() {
		const usernameElements = Array.from(document.querySelectorAll(".hnuser"));
		// The OP's username appears in .fatitem above the comments and again
		// on every comment they author within the thread. Reading it once
		// here lets us tag every comment-row authorship below as [op] without
		// also marking the fatitem's own hnuser (which is redundantly the OP
		// — we already know they posted the item).
		const itemAuthor =
			document.querySelector(".fatitem .hnuser")?.textContent || null;

		for (const usernameEl of usernameElements) {
			const username = usernameEl.textContent;
			const parent = findCommentParent(usernameEl);
			if (!parent) continue;

			const tagGroup = h("div", { class: "hn-tag-group" });
			tagGroup.dataset.hnUser = username;
			renderTagGroup(username, tagGroup);

			const usernameClone = usernameEl.cloneNode(true);
			usernameClone.className = `${usernameClone.className} hn-username`.trim();

			const isCommentAuthor = !!usernameEl.closest("tr.comtr");
			if (isCommentAuthor && itemAuthor && username === itemAuthor) {
				usernameClone.classList.add("hn-op");
				usernameClone.appendChild(document.createTextNode(" [op]"));
			}

			const infoSlot = h("span", {
				class: "hn-info hn-info-pending",
				text: "(loading…)",
			});

			const mainRow = h("div", { class: "hn-main-row" }, [
				usernameClone,
				infoSlot,
				renderRatingControls(username),
				renderTagInput(username),
			]);
			const tagContainer = h("div", { class: "hn-tag-container" }, [tagGroup]);
			const layout = h("div", { class: "hn-post-layout" }, [
				mainRow,
				tagContainer,
			]);

			parent.parentNode.insertBefore(layout, parent.nextSibling);
			usernameEl.style.display = "none";

			// Populate the info slot asynchronously. Cached users resolve on the
			// microtask queue (effectively synchronous). Failed or timed-out
			// fetches remove the slot rather than leaving a "loading…" ghost.
			fetchUser(username).then((data) => {
				if (data) {
					infoSlot.replaceWith(renderAccountInfo(data.created, data.karma));
				} else {
					infoSlot.remove();
				}
			});
		}
	}

	return {
		renderAllUsernames,
		rerenderUserTags,
		rerenderUserRatings,
	};
}
````

## File: src/api.js
````javascript
// HN Firebase API access. Browser-side only - imports the GM_xmlhttpRequest
// global at call time so this module never references it at import time
// (so the build artifact, which inlines this, doesn't crash if loaded
// outside a userscript runtime).
import {
	ITEM_CACHE_TTL_MS,
	ITEM_FETCH_TIMEOUT_MS,
	USER_CACHE_TTL_MS,
	USER_FETCH_TIMEOUT_MS,
} from "./config.js";

// Factory over a store. Returns { fetchUser, fetchItem } where each
// resolves to a digest object or null. Both are protected by:
//   - A persistent cache (store.getCachedUser/getCachedItem) with a TTL
//     declared in config.
//   - An in-memory inflight Map that dedupes concurrent fetches for
//     the same key.
//   - A per-request timeout so a hung request can't leave a popup
//     stuck on "loading…" forever.
export function createApi({ store }) {
	const userInflight = new Map();
	const itemInflight = new Map();

	function fetchUser(username) {
		const cached = store.getCachedUser(username, Date.now(), USER_CACHE_TTL_MS);
		if (cached) return Promise.resolve(cached);
		if (userInflight.has(username)) return userInflight.get(username);

		const promise = new Promise((resolve) => {
			GM_xmlhttpRequest({
				method: "GET",
				url: `https://hacker-news.firebaseio.com/v0/user/${username}.json`,
				timeout: USER_FETCH_TIMEOUT_MS,
				onload: (response) => {
					if (response.status !== 200 || !response.responseText) {
						resolve(null);
						return;
					}
					try {
						const data = JSON.parse(response.responseText);
						if (data && typeof data.created === "number") {
							store.setCachedUser(
								username,
								{
									created: data.created,
									karma: data.karma,
									about: data.about || "",
								},
								Date.now(),
							);
							resolve({
								created: data.created,
								karma: data.karma,
								about: data.about || "",
							});
						} else {
							resolve(null);
						}
					} catch (_err) {
						resolve(null);
					}
				},
				onerror: () => resolve(null),
				ontimeout: () => resolve(null),
			});
		}).finally(() => {
			userInflight.delete(username);
		});
		userInflight.set(username, promise);
		return promise;
	}

	function fetchItem(itemId) {
		const cached = store.getCachedItem(itemId, Date.now(), ITEM_CACHE_TTL_MS);
		if (cached) return Promise.resolve(cached);
		if (itemInflight.has(itemId)) return itemInflight.get(itemId);

		const promise = new Promise((resolve) => {
			GM_xmlhttpRequest({
				method: "GET",
				url: `https://hacker-news.firebaseio.com/v0/item/${itemId}.json`,
				timeout: ITEM_FETCH_TIMEOUT_MS,
				onload: (response) => {
					if (response.status !== 200 || !response.responseText) {
						resolve(null);
						return;
					}
					try {
						const data = JSON.parse(response.responseText);
						if (!data || typeof data.id !== "number") {
							resolve(null);
							return;
						}
						const digest = {
							title: data.title || "",
							url: data.url || "",
							by: data.by || "",
							score: typeof data.score === "number" ? data.score : 0,
							descendants:
								typeof data.descendants === "number" ? data.descendants : 0,
							time: typeof data.time === "number" ? data.time : 0,
							text: data.text || "",
							type: data.type || "story",
						};
						store.setCachedItem(itemId, digest, Date.now());
						resolve(digest);
					} catch (_err) {
						resolve(null);
					}
				},
				onerror: () => resolve(null),
				ontimeout: () => resolve(null),
			});
		}).finally(() => {
			itemInflight.delete(itemId);
		});
		itemInflight.set(itemId, promise);
		return promise;
	}

	return { fetchUser, fetchItem };
}
````

## File: tests/cache.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../src/state.js";

function makeFakeBackend(initial = {}) {
	const data = { ...initial };
	return {
		data,
		get: (k) => (k in data ? data[k] : undefined),
		set: (k, v) => {
			data[k] = v;
		},
	};
}

const HOUR_MS = 60 * 60 * 1000;

test("cache: miss on empty store", () => {
	const store = createStore(makeFakeBackend());
	assert.equal(store.getCachedUser("alice", Date.now(), HOUR_MS), null);
});

test("cache: hit when within TTL", () => {
	const store = createStore(makeFakeBackend());
	const t0 = 1_000_000_000_000;
	store.setCachedUser("alice", { created: 123, karma: 45 }, t0);
	const hit = store.getCachedUser("alice", t0 + HOUR_MS - 1, HOUR_MS);
	assert.deepEqual(hit, { created: 123, karma: 45 });
});

test("cache: miss when past TTL", () => {
	const store = createStore(makeFakeBackend());
	const t0 = 1_000_000_000_000;
	store.setCachedUser("alice", { created: 123, karma: 45 }, t0);
	const miss = store.getCachedUser("alice", t0 + HOUR_MS + 1, HOUR_MS);
	assert.equal(miss, null);
});

test("cache: persists across store instances backed by same backend", () => {
	const backend = makeFakeBackend();
	const t0 = 1_000_000_000_000;
	createStore(backend).setCachedUser("alice", { created: 1, karma: 2 }, t0);
	const hit = createStore(backend).getCachedUser("alice", t0, HOUR_MS);
	assert.deepEqual(hit, { created: 1, karma: 2 });
});

test("cache: setCachedUser overwrites fetchedAt", () => {
	const store = createStore(makeFakeBackend());
	store.setCachedUser("alice", { created: 1, karma: 2 }, 1000);
	store.setCachedUser("alice", { created: 1, karma: 99 }, 5000);
	const hit = store.getCachedUser("alice", 5000, HOUR_MS);
	assert.equal(hit.karma, 99);
});
````

## File: tests/cleanOrphans.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanOrphans } from "../scripts/clean-orphan-tags.js";

// Orphan color entries (tag names in `customTags` that no user carries)
// are dropped; in-use tags, their colors, ratings, and per-user tag
// lists are preserved. This mirrors the typing-artifact cleanup that
// motivated the script.
test("cleanOrphans drops unused color entries and preserves the rest", () => {
	const exported = {
		customTags: {
			used: { bgColor: "u", textColor: "black" },
			orphan: { bgColor: "o", textColor: "black" },
			also: { bgColor: "a", textColor: "black" },
		},
		users: {
			alice: { rating: 2, tags: ["used", "also"] },
			bob: { rating: 0, tags: ["used"] },
		},
	};

	const { cleaned, removed } = cleanOrphans(exported);

	assert.deepEqual(cleaned.customTags, {
		used: { bgColor: "u", textColor: "black" },
		also: { bgColor: "a", textColor: "black" },
	});
	assert.deepEqual(cleaned.users, {
		alice: { rating: 2, tags: ["used", "also"] },
		bob: { rating: 0, tags: ["used"] },
	});
	assert.deepEqual(removed, ["orphan"]);
});

// An export with no orphans round-trips through the cleaner unchanged.
// Guards against accidental filtering of in-use tags or users.
test("cleanOrphans is a no-op when every tag has a user", () => {
	const exported = {
		customTags: {
			foo: { bgColor: "f", textColor: "black" },
		},
		users: {
			alice: { rating: 1, tags: ["foo"] },
		},
	};

	const { cleaned, removed } = cleanOrphans(exported);

	assert.deepEqual(cleaned, exported);
	assert.deepEqual(removed, []);
});
````

## File: tests/importParser.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseImport, stateToExport } from "../src/state.js";

// parseImport accepts either:
//   (A) the normalized export format: { customTags, users }
//   (B) the legacy flat-key dump: { hn_author_rating_<u>, hn_custom_tags_<u>, ... }
// and returns a consolidated state object matching the internal shape.

test("parseImport: normalized format produces expected state", () => {
	const imported = {
		customTags: {
			spammer: { bgColor: "hsl(10,50%,80%)", textColor: "black" },
			expert: { bgColor: "hsl(120,50%,80%)", textColor: "black" },
		},
		users: {
			alice: { rating: 3, tags: ["spammer", "expert"] },
			bob: { rating: -1, tags: [] },
		},
	};
	const state = parseImport(imported);
	assert.equal(state.ratings.alice, 3);
	assert.equal(state.ratings.bob, -1);
	assert.deepEqual(state.tags.alice, ["spammer", "expert"]);
	assert.deepEqual(state.tags.bob, []);
	assert.deepEqual(state.colors.spammer, {
		bgColor: "hsl(10,50%,80%)",
		textColor: "black",
	});
});

test("parseImport: legacy flat-key format produces expected state", () => {
	const imported = {
		hn_author_rating_alice: 5,
		hn_custom_tags_alice: JSON.stringify([
			{ value: "t", bgColor: "hsl(1,50%,80%)", textColor: "black" },
		]),
		hn_custom_tag_color_t: JSON.stringify({
			bgColor: "hsl(1,50%,80%)",
			textColor: "black",
		}),
	};
	const state = parseImport(imported);
	assert.equal(state.ratings.alice, 5);
	assert.deepEqual(state.tags.alice, ["t"]);
	assert.deepEqual(state.colors.t, {
		bgColor: "hsl(1,50%,80%)",
		textColor: "black",
	});
});

test("parseImport: normalized format with orphan tag color is preserved", () => {
	const imported = {
		customTags: { orphan: { bgColor: "hsl(1,50%,80%)", textColor: "black" } },
		users: {},
	};
	const state = parseImport(imported);
	assert.deepEqual(state.colors.orphan, {
		bgColor: "hsl(1,50%,80%)",
		textColor: "black",
	});
});

test("stateToExport: produces normalized format consumable by parseImport", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 2 },
		tags: { alice: ["spammer"] },
		colors: { spammer: { bgColor: "hsl(10,50%,80%)", textColor: "black" } },
		cache: { alice: { created: 1, karma: 2, fetchedAt: 3 } },
	};
	const exported = stateToExport(state);
	assert.deepEqual(exported, {
		customTags: {
			spammer: { bgColor: "hsl(10,50%,80%)", textColor: "black" },
		},
		users: {
			alice: { rating: 2, tags: ["spammer"] },
		},
	});
	// Round-trip.
	const parsed = parseImport(exported);
	assert.equal(parsed.ratings.alice, 2);
	assert.deepEqual(parsed.tags.alice, ["spammer"]);
	assert.deepEqual(parsed.colors.spammer, {
		bgColor: "hsl(10,50%,80%)",
		textColor: "black",
	});
});

test("stateToExport: excludes cache (it's an internal perf concern, not user data)", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: {},
		colors: {},
		cache: { alice: { created: 1, karma: 2, fetchedAt: 3 } },
	};
	const exported = stateToExport(state);
	assert.equal(exported.cache, undefined);
});

test("stateToExport: excludes users with no rating and no tags", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 0 },
		tags: { alice: [] },
		colors: {},
		cache: {},
	};
	const exported = stateToExport(state);
	assert.deepEqual(exported.users, {});
});
````

## File: tests/migration.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, migrateLegacyKeys } from "../src/state.js";

// Legacy layout: one backend key per user-rating, per user-tags, per tag-color.
// The migration walks a listing backend, collects everything into the single
// consolidated key, and leaves the legacy keys alone (one-version safety net).
function makeListingBackend(initial = {}) {
	const store = { ...initial };
	return {
		data: store,
		get: (key) => (key in store ? store[key] : undefined),
		set: (key, value) => {
			store[key] = value;
		},
		list: () => Object.keys(store),
	};
}

test("migration: no legacy keys is a no-op", () => {
	const backend = makeListingBackend();
	migrateLegacyKeys(backend);
	assert.equal(backend.data.hn_state, undefined);
});

test("migration: collects ratings", () => {
	const backend = makeListingBackend({
		hn_author_rating_alice: 3,
		hn_author_rating_bob: -1,
	});
	migrateLegacyKeys(backend);
	const store = createStore(backend);
	assert.equal(store.getRating("alice"), 3);
	assert.equal(store.getRating("bob"), -1);
});

test("migration: collects tags and tag colors", () => {
	const backend = makeListingBackend({
		hn_custom_tags_alice: JSON.stringify([
			{ value: "spammer", bgColor: "hsl(10,50%,80%)", textColor: "black" },
		]),
		hn_custom_tag_color_spammer: JSON.stringify({
			bgColor: "hsl(10,50%,80%)",
			textColor: "black",
		}),
	});
	migrateLegacyKeys(backend);
	const store = createStore(backend);
	const tags = store.getUserTags("alice");
	assert.equal(tags.length, 1);
	assert.equal(tags[0].value, "spammer");
	assert.equal(tags[0].bgColor, "hsl(10,50%,80%)");
	assert.equal(tags[0].textColor, "black");
});

test("migration: color-only legacy entries are preserved", () => {
	// A user may have deleted all tags using 'orphan' but the global color is
	// still in storage. We want to preserve it so rehydrating the tag later
	// reuses the same color.
	const backend = makeListingBackend({
		hn_custom_tag_color_orphan: JSON.stringify({
			bgColor: "hsl(200,50%,80%)",
			textColor: "black",
		}),
	});
	migrateLegacyKeys(backend);
	const store = createStore(backend);
	assert.deepEqual(store.getTagColor("orphan"), {
		bgColor: "hsl(200,50%,80%)",
		textColor: "black",
	});
});

test("migration: leaves legacy keys in place (safety net)", () => {
	const backend = makeListingBackend({
		hn_author_rating_alice: 5,
	});
	migrateLegacyKeys(backend);
	assert.equal(backend.data.hn_author_rating_alice, 5);
});

test("migration: is idempotent (running twice changes nothing)", () => {
	const backend = makeListingBackend({
		hn_author_rating_alice: 5,
		hn_custom_tags_alice: JSON.stringify([
			{ value: "t", bgColor: "hsl(1,50%,80%)", textColor: "black" },
		]),
	});
	migrateLegacyKeys(backend);
	const snapshot1 = backend.data.hn_state;
	migrateLegacyKeys(backend);
	assert.equal(backend.data.hn_state, snapshot1);
});

test("migration: skips when new state already exists", () => {
	// User has already migrated; don't clobber their current state with stale
	// legacy data.
	const existingState = JSON.stringify({
		schemaVersion: 1,
		ratings: { alice: 99 },
		tags: {},
		colors: {},
		cache: {},
	});
	const backend = makeListingBackend({
		hn_state: existingState,
		hn_author_rating_alice: 3, // stale legacy value
	});
	migrateLegacyKeys(backend);
	assert.equal(backend.data.hn_state, existingState);
});

test("migration: malformed legacy JSON is skipped, not fatal", () => {
	const backend = makeListingBackend({
		hn_custom_tags_alice: "not json{",
		hn_author_rating_alice: 2,
	});
	migrateLegacyKeys(backend); // must not throw
	const store = createStore(backend);
	assert.equal(store.getRating("alice"), 2);
	assert.deepEqual(store.getUserTags("alice"), []);
});
````

## File: tests/quotes.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { stripLeadingQuoteMarker } from "../src/parsing.js";

// stripLeadingQuoteMarker(text) is the helper used by the inline-quote
// renderer to extract the body of a "> quoted text" string. It removes the
// leading `>` (with surrounding whitespace) and trims the result so the body
// can be set directly on a `<p class="quote">` text node.

test("stripLeadingQuoteMarker: with a single space after the marker", () => {
	assert.equal(stripLeadingQuoteMarker("> hello"), "hello");
});

test("stripLeadingQuoteMarker: with no space after the marker", () => {
	assert.equal(stripLeadingQuoteMarker(">hello"), "hello");
});

test("stripLeadingQuoteMarker: with leading whitespace before the marker", () => {
	assert.equal(stripLeadingQuoteMarker("   > hello"), "hello");
});

test("stripLeadingQuoteMarker: with multiple spaces around the marker", () => {
	assert.equal(stripLeadingQuoteMarker("  >   hello world"), "hello world");
});

test("stripLeadingQuoteMarker: marker only", () => {
	assert.equal(stripLeadingQuoteMarker(">"), "");
	assert.equal(stripLeadingQuoteMarker("> "), "");
});

test("stripLeadingQuoteMarker: trailing whitespace is trimmed", () => {
	assert.equal(stripLeadingQuoteMarker("> hello   "), "hello");
});

test("stripLeadingQuoteMarker: empty / non-string returns empty string", () => {
	assert.equal(stripLeadingQuoteMarker(""), "");
	assert.equal(stripLeadingQuoteMarker(null), "");
	assert.equal(stripLeadingQuoteMarker(undefined), "");
});

test("stripLeadingQuoteMarker: leaves non-quote text unchanged (defensive)", () => {
	assert.equal(stripLeadingQuoteMarker("hello"), "hello");
});
````

## File: tests/timeSince.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { timeSince } from "../src/parsing.js";

// timeSince(createdUnixSeconds, nowUnixSeconds) -> human-readable duration.
// Keeping the existing format: "N days" / "N months" / "N years", singular for 1.

const DAY = 86400;
const MONTH = 2592000; // matches legacy (30-day) definition
const YEAR = 31536000; // matches legacy (365-day) definition

test("timeSince: under a month returns days", () => {
	const now = 1_000_000_000;
	assert.equal(timeSince(now - 1 * DAY, now), "1 day");
	assert.equal(timeSince(now - 5 * DAY, now), "5 days");
	assert.equal(timeSince(now - 29 * DAY, now), "29 days");
});

test("timeSince: under a year returns months", () => {
	const now = 1_000_000_000;
	assert.equal(timeSince(now - 1 * MONTH, now), "1 month");
	assert.equal(timeSince(now - 11 * MONTH, now), "11 months");
});

test("timeSince: a year or more returns years", () => {
	const now = 1_000_000_000;
	assert.equal(timeSince(now - 1 * YEAR, now), "1 year");
	assert.equal(timeSince(now - 7 * YEAR, now), "7 years");
});

test("timeSince: zero elapsed returns 0 days", () => {
	const now = 1_000_000_000;
	assert.equal(timeSince(now, now), "0 days");
});
````

## File: .github/workflows/ci.yml
````yaml
name: CI

# No untrusted inputs are interpolated into `run:` steps — the only things
# this workflow runs are `node --test`, `biome check`, and `node scripts/build.js`
# over files checked out from the repo.
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Run tests
        run: node --test "tests/*.test.js"

      - uses: biomejs/setup-biome@v2
        with:
          version: "2.4.10"

      - name: Biome check
        run: biome check src/ tests/ scripts/

      - name: Verify script.js is up to date with src/
        # Catches PRs that change src/ but forget to rebuild. Users install the
        # built artifact, so a stale script.js means features silently don't ship.
        # The @version line embeds the current commit's short hash, which on CI
        # is typically the merge commit and therefore differs from whatever HEAD
        # was when the developer ran `just build` locally. `-I` excludes hunks
        # that consist entirely of @version-line changes.
        run: |
          node scripts/build.js
          git diff --exit-code -I '^// @version' script.js
````

## File: src/config.js
````javascript
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
````

## File: tests/tagManagement.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTagInput } from "../src/parsing.js";
import {
	countsFromState,
	removeTagInState,
	renameTagInState,
} from "../src/state.js";

// Pure rename: when the destination name does not exist, the tag's color
// entry moves to the new name and every user carrying the old name has it
// replaced at the same position.
test("renameTagInState: pure rename moves color and updates all users", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 3 },
		tags: {
			alice: ["engineer", "rustacean"],
			bob: ["engineer"],
		},
		colors: {
			engineer: { bgColor: "hsl(1,50%,80%)", textColor: "black" },
			rustacean: { bgColor: "hsl(2,50%,80%)", textColor: "black" },
		},
		cache: {},
	};

	const next = renameTagInState(state, "engineer", "Engineer");

	assert.deepEqual(next.tags, {
		alice: ["Engineer", "rustacean"],
		bob: ["Engineer"],
	});
	assert.deepEqual(next.colors, {
		Engineer: { bgColor: "hsl(1,50%,80%)", textColor: "black" },
		rustacean: { bgColor: "hsl(2,50%,80%)", textColor: "black" },
	});
	// Untouched slices.
	assert.deepEqual(next.ratings, { alice: 3 });
	assert.deepEqual(next.cache, {});
});

// Merge rename: when the destination already exists, the tag's users are
// folded into the destination. Users carrying both end up with one entry
// (first occurrence kept). The destination's color is preserved.
test("renameTagInState: merge folds users and keeps destination color", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: {
			alice: ["engineer", "rustacean"],
			bob: ["Engineer", "engineer"],
			carol: ["Engineer"],
		},
		colors: {
			engineer: { bgColor: "src", textColor: "black" },
			Engineer: { bgColor: "dest", textColor: "black" },
			rustacean: { bgColor: "rst", textColor: "black" },
		},
		cache: {},
	};

	const next = renameTagInState(state, "engineer", "Engineer");

	assert.deepEqual(next.tags, {
		alice: ["Engineer", "rustacean"],
		bob: ["Engineer"],
		carol: ["Engineer"],
	});
	assert.deepEqual(next.colors, {
		Engineer: { bgColor: "dest", textColor: "black" },
		rustacean: { bgColor: "rst", textColor: "black" },
	});
});

// A no-op rename (old === new, empty string, whitespace-only, or a tag
// that doesn't exist) returns the same reference so callers can cheap-
// compare draft against live.
test("renameTagInState: no-ops return the same reference", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: { alice: ["foo"] },
		colors: { foo: { bgColor: "x", textColor: "black" } },
		cache: {},
	};
	assert.equal(renameTagInState(state, "foo", "foo"), state);
	assert.equal(renameTagInState(state, "foo", ""), state);
	assert.equal(renameTagInState(state, "foo", "   "), state);
	assert.equal(renameTagInState(state, "missing", "x"), state);
});

// Removal strips the tag from every user's list and deletes the color
// entry. Ratings and cache slices are untouched.
test("removeTagInState: strips tag from all users and deletes color", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 2 },
		tags: {
			alice: ["foo", "bar"],
			bob: ["foo"],
		},
		colors: {
			foo: { bgColor: "fooc", textColor: "black" },
			bar: { bgColor: "barc", textColor: "black" },
		},
		cache: { alice: { created: 1, karma: 2, fetchedAt: 3 } },
	};

	const next = removeTagInState(state, "foo");

	assert.deepEqual(next.tags, { alice: ["bar"], bob: [] });
	assert.deepEqual(next.colors, {
		bar: { bgColor: "barc", textColor: "black" },
	});
	assert.deepEqual(next.ratings, { alice: 2 });
	assert.deepEqual(next.cache, {
		alice: { created: 1, karma: 2, fetchedAt: 3 },
	});
});

// Removal of a tag that isn't present anywhere is a no-op and returns
// the same reference.
test("removeTagInState: missing tag returns the same reference", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: { alice: ["foo"] },
		colors: { foo: { bgColor: "x", textColor: "black" } },
		cache: {},
	};
	assert.equal(removeTagInState(state, "notpresent"), state);
});

// Counts include every tag that has a color entry OR appears on any
// user. Orphan tags (color entry only, no users) show as count 0.
// Duplicates in a single user's list are counted once.
test("countsFromState: counts distinct users per tag, includes orphans", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 99 },
		tags: {
			alice: ["foo", "bar"],
			bob: ["foo"],
			carol: ["foo", "foo"], // accidental duplicate — counted once
		},
		colors: {
			foo: { bgColor: "x", textColor: "black" },
			bar: { bgColor: "y", textColor: "black" },
			baz: { bgColor: "z", textColor: "black" }, // orphan
		},
		cache: {},
	};

	assert.deepEqual(countsFromState(state), { foo: 3, bar: 1, baz: 0 });
});

// Multi-step draft composition: rename + remove applied in sequence
// produces the expected shape. Verifies the helpers chain cleanly,
// which is how the overlay builds a draft.
test("renameTagInState + removeTagInState compose", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: {
			alice: ["engineer", "rustacean", "obsolete"],
			bob: ["Engineer", "obsolete"],
		},
		colors: {
			engineer: { bgColor: "src", textColor: "black" },
			Engineer: { bgColor: "dest", textColor: "black" },
			rustacean: { bgColor: "rst", textColor: "black" },
			obsolete: { bgColor: "old", textColor: "black" },
		},
		cache: {},
	};

	const afterRename = renameTagInState(state, "engineer", "Engineer");
	const afterRemove = removeTagInState(afterRename, "obsolete");

	assert.deepEqual(afterRemove.tags, {
		alice: ["Engineer", "rustacean"],
		bob: ["Engineer"],
	});
	assert.deepEqual(afterRemove.colors, {
		Engineer: { bgColor: "dest", textColor: "black" },
		rustacean: { bgColor: "rst", textColor: "black" },
	});
});

// Comma-separated tag input is the primary entry point for multi-tag edits.
// Previously parseTagInput trimmed each name but allowed duplicates to reach
// setUserTags, which stored them verbatim - so a user who typed "x, x" ended
// up with two identical tag pills. Dedup must happen at parse time to keep
// per-user tag lists canonical.
test("parseTagInput: trims, drops empties, and dedupes repeats", () => {
	assert.deepEqual(parseTagInput("engineer,  engineer , rustacean"), [
		"engineer",
		"rustacean",
	]);
	assert.deepEqual(parseTagInput(" , ,engineer,,"), ["engineer"]);
	assert.deepEqual(parseTagInput(""), []);
	assert.deepEqual(parseTagInput("a,b,c"), ["a", "b", "c"]);
});
````

## File: justfile
````
default: test

test:
    node --test "tests/*.test.js"

lint:
    biome lint --write src/ tests/ scripts/

fmt:
    biome format --write src/ tests/ scripts/

build:
    node scripts/build.js

check: lint fmt test build
````

## File: src/state.js
````javascript
// Storage and pure state mutators. No DOM, no GM_* APIs - safe to import
// under Node. The browser bootstrap (main.js) wraps the GM_* APIs into the
// {get, set, list} backend that createStore expects.

import {
	LEGACY_COLOR_PREFIX,
	LEGACY_RATING_PREFIX,
	LEGACY_TAGS_PREFIX,
	STATE_KEY,
	STATE_SCHEMA_VERSION,
} from "./config.js";
import { pruneExpiredReadComments } from "./parsing.js";

export function emptyState() {
	return {
		schemaVersion: STATE_SCHEMA_VERSION,
		ratings: {},
		tags: {}, // username -> [tagName, ...]
		colors: {}, // tagName  -> { bgColor, textColor }
		cache: {}, // username -> { created, karma, fetchedAt }
		readComments: {}, // itemId -> { ids: [...], fetchedAt }
		itemCache: {}, // itemId -> { title, url, by, score, descendants, time, text, type, fetchedAt }
	};
}

// Factory over a { get(key), set(key, value) } backend. Loads the consolidated
// state on first access; mutations are read-modify-write (re-read disk, apply
// the mutation, write back) so writes from other tabs that landed since the
// last read are absorbed instead of clobbered. The pre-RMW design was racy:
// at page load every tab the user had cmd-clicked open from the front page
// would call setReadComments synchronously with a stale in-memory snapshot,
// and the last writer's snapshot wiped everyone else's entry. The cross-tab
// listener can't fix that after the fact — it only invalidates the in-memory
// cache, it doesn't merge in-flight writes.
export function createStore(backend) {
	let state = null;

	const readDisk = () => {
		const raw = backend.get(STATE_KEY);
		if (raw === undefined || raw === null || raw === "") {
			return emptyState();
		}
		try {
			const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
			return { ...emptyState(), ...parsed };
		} catch (_err) {
			return emptyState();
		}
	};

	const load = () => {
		if (state !== null) return state;
		state = readDisk();
		return state;
	};

	// Apply a mutation against the latest disk state. The mutator runs on
	// a fresh read of the blob, then we write the whole thing back; this
	// absorbs concurrent writes from other tabs as long as our get-then-set
	// pair isn't preempted (GM_getValue and GM_setValue are synchronous in
	// Tampermonkey/Violentmonkey, so the race window is essentially zero
	// per call site). The mutator may return `false` to signal "no change,
	// don't write" — used by pruneReadComments when nothing's stale.
	const mutate = (mutator) => {
		const fresh = readDisk();
		const result = mutator(fresh);
		if (result !== false) {
			backend.set(STATE_KEY, JSON.stringify(fresh));
		}
		state = fresh;
	};

	const hydrateTag = (tagName) => {
		const color = load().colors[tagName] || {
			bgColor: undefined,
			textColor: undefined,
		};
		return {
			value: tagName,
			bgColor: color.bgColor,
			textColor: color.textColor,
		};
	};

	return {
		getRating(username) {
			return load().ratings[username] || 0;
		},
		setRating(username, rating) {
			mutate((s) => {
				s.ratings[username] = rating;
			});
		},
		getUserTags(username) {
			const names = load().tags[username] || [];
			return names.map(hydrateTag);
		},
		setUserTags(username, tags) {
			mutate((s) => {
				s.tags[username] = tags.map((t) => t.value);
				// Record any color info that came along with the tag. If a tag
				// already has a color, a caller-supplied color overrides it
				// (setTagColor is the explicit "update the shared color"
				// operation; passing a color here is how new tags get their
				// initial color).
				for (const t of tags) {
					if (t.bgColor && t.textColor) {
						s.colors[t.value] = {
							bgColor: t.bgColor,
							textColor: t.textColor,
						};
					}
				}
			});
		},
		getTagColor(tagName) {
			return load().colors[tagName] || null;
		},
		setTagColor(tagName, { bgColor, textColor }) {
			mutate((s) => {
				s.colors[tagName] = { bgColor, textColor };
			});
		},
		// User-data cache. The `now` and `ttlMs` arguments are injected so tests
		// can control time without mocking the clock. The browser call site
		// passes Date.now() and a hardcoded TTL (USER_CACHE_TTL_MS in config).
		// `data` is treated as opaque so future call sites (e.g. the hover
		// panel adding `about`) don't need to extend this method's signature.
		getCachedUser(username, nowMs, ttlMs) {
			const entry = load().cache[username];
			if (!entry) return null;
			if (nowMs - entry.fetchedAt > ttlMs) return null;
			const { fetchedAt: _f, ...rest } = entry;
			return rest;
		},
		setCachedUser(username, data, nowMs) {
			mutate((s) => {
				s.cache[username] = { ...data, fetchedAt: nowMs };
			});
		},
		// Item-info cache for the hover-panel feature. Stores a digest
		// (title/url/by/score/descendants/time/text/type) of items the
		// user has hovered, so subsequent hovers resolve from local
		// state without re-hitting the Firebase API.
		getCachedItem(itemId, nowMs, ttlMs) {
			const entry = load().itemCache?.[itemId];
			if (!entry) return null;
			if (nowMs - entry.fetchedAt > ttlMs) return null;
			const { fetchedAt: _f, ...digest } = entry;
			return digest;
		},
		setCachedItem(itemId, digest, nowMs) {
			mutate((s) => {
				s.itemCache[itemId] = { ...digest, fetchedAt: nowMs };
			});
		},

		// Read-comments cache for highlight-unread. Returns the stored
		// entry { ids, fetchedAt } if it exists, else null. The browser
		// caller decides what to do with a missing entry (highlight
		// nothing, since this is a first visit) vs a stale one (treat as
		// missing — pruneReadComments below drops stale entries on every
		// item-page load so this is mostly a belt-and-braces check).
		getReadComments(itemId) {
			const entry = load().readComments?.[itemId];
			if (!entry) return null;
			return { ids: entry.ids || [], fetchedAt: entry.fetchedAt || 0 };
		},
		// Replace the stored ID list for an item. Always overwrites — the
		// caller decides whether to merge with previous ids or replace them.
		// (We replace, since a comment that's no longer on the page must
		// have been deleted/flagged, and there's no value in tracking it.)
		setReadComments(itemId, ids, nowMs) {
			mutate((s) => {
				s.readComments[itemId] = { ids: ids.slice(), fetchedAt: nowMs };
			});
		},
		// Drop expired entries from the readComments map. Run on every
		// item-page load so a user who reads-then-never-revisits doesn't
		// accumulate dead entries forever.
		pruneReadComments(nowMs, ttlMs) {
			mutate((s) => {
				const before = s.readComments;
				const after = pruneExpiredReadComments(before, nowMs, ttlMs);
				if (Object.keys(after).length === Object.keys(before).length) {
					return false;
				}
				s.readComments = after;
			});
		},
		replaceTagsAndColors(tagsByUser, colorsByTag) {
			mutate((s) => {
				s.tags = tagsByUser;
				s.colors = colorsByTag;
			});
		},
		// Expose raw state for export and for callers that need to iterate.
		_snapshot() {
			return load();
		},
		// Drop the in-memory cache so the next read reloads from the backend.
		// Used when another tab writes to the same key. Mutations don't need
		// this because they always re-read disk before writing.
		_invalidate() {
			state = null;
		},
	};
}

// One-shot migration from the pre-rework key layout:
//   hn_author_rating_<user>   -> int
//   hn_custom_tags_<user>     -> JSON array of {value, bgColor, textColor}
//   hn_custom_tag_color_<tag> -> JSON {bgColor, textColor}
// to the single consolidated `hn_state` key. Legacy keys are left in place for
// one version so a rollback of the script doesn't lose data. The migration is
// idempotent and a no-op when hn_state already exists.
//
// Backend must additionally support list(): string[].
export function migrateLegacyKeys(backend) {
	if (backend.get(STATE_KEY) !== undefined) return;
	if (typeof backend.list !== "function") return;

	const keys = backend.list();
	const hasLegacy = keys.some(
		(k) =>
			k.startsWith(LEGACY_RATING_PREFIX) ||
			k.startsWith(LEGACY_TAGS_PREFIX) ||
			k.startsWith(LEGACY_COLOR_PREFIX),
	);
	if (!hasLegacy) return;

	const state = emptyState();

	const parseJSON = (raw, fallback) => {
		try {
			return typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch (_err) {
			return fallback;
		}
	};

	for (const key of keys) {
		if (key.startsWith(LEGACY_RATING_PREFIX)) {
			const username = key.slice(LEGACY_RATING_PREFIX.length);
			const value = backend.get(key);
			const rating = typeof value === "number" ? value : Number(value);
			if (!Number.isNaN(rating)) state.ratings[username] = rating;
		} else if (key.startsWith(LEGACY_COLOR_PREFIX)) {
			const tagName = key.slice(LEGACY_COLOR_PREFIX.length);
			const color = parseJSON(backend.get(key), null);
			if (color?.bgColor) {
				state.colors[tagName] = {
					bgColor: color.bgColor,
					textColor: color.textColor || "black",
				};
			}
		}
	}

	// Tags are processed after colors so legacy tag entries can contribute
	// their embedded color info without overwriting the explicit color key.
	for (const key of keys) {
		if (!key.startsWith(LEGACY_TAGS_PREFIX)) continue;
		const username = key.slice(LEGACY_TAGS_PREFIX.length);
		const legacyTags = parseJSON(backend.get(key), []);
		if (!Array.isArray(legacyTags)) continue;
		const tagNames = [];
		for (const t of legacyTags) {
			if (!t || typeof t.value !== "string") continue;
			tagNames.push(t.value);
			if (!state.colors[t.value] && t.bgColor) {
				state.colors[t.value] = {
					bgColor: t.bgColor,
					textColor: t.textColor || "black",
				};
			}
		}
		state.tags[username] = tagNames;
	}

	backend.set(STATE_KEY, JSON.stringify(state));
}

// Accepts either the normalized export shape ({customTags, users}) or the
// legacy flat-key dump ({hn_author_rating_<u>: N, hn_custom_tags_<u>: "...", ...})
// and produces a consolidated state object. The cache slot is left empty -
// import is a user-data operation, not a cache restore.
export function parseImport(data) {
	const state = emptyState();
	if (!data || typeof data !== "object") return state;

	// Normalized format.
	if (data.customTags || data.users) {
		if (data.customTags && typeof data.customTags === "object") {
			for (const [tagName, info] of Object.entries(data.customTags)) {
				if (info?.bgColor) {
					state.colors[tagName] = {
						bgColor: info.bgColor,
						textColor: info.textColor || "black",
					};
				}
			}
		}
		if (data.users && typeof data.users === "object") {
			for (const [username, userData] of Object.entries(data.users)) {
				if (!userData) continue;
				if (typeof userData.rating === "number" && userData.rating !== 0) {
					state.ratings[username] = userData.rating;
				}
				if (Array.isArray(userData.tags)) {
					state.tags[username] = userData.tags.slice();
				}
			}
		}
		return state;
	}

	// Legacy flat-key format - mirrors migrateLegacyKeys but reads from a plain
	// object instead of a backend.
	const parseJSON = (raw, fallback) => {
		try {
			return typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch (_err) {
			return fallback;
		}
	};
	for (const [key, value] of Object.entries(data)) {
		if (key.startsWith(LEGACY_RATING_PREFIX)) {
			const username = key.slice(LEGACY_RATING_PREFIX.length);
			const rating = typeof value === "number" ? value : Number(value);
			if (!Number.isNaN(rating)) state.ratings[username] = rating;
		} else if (key.startsWith(LEGACY_COLOR_PREFIX)) {
			const tagName = key.slice(LEGACY_COLOR_PREFIX.length);
			const color = parseJSON(value, null);
			if (color?.bgColor) {
				state.colors[tagName] = {
					bgColor: color.bgColor,
					textColor: color.textColor || "black",
				};
			}
		}
	}
	for (const [key, value] of Object.entries(data)) {
		if (!key.startsWith(LEGACY_TAGS_PREFIX)) continue;
		const username = key.slice(LEGACY_TAGS_PREFIX.length);
		const legacyTags = parseJSON(value, []);
		if (!Array.isArray(legacyTags)) continue;
		const names = [];
		for (const t of legacyTags) {
			if (!t || typeof t.value !== "string") continue;
			names.push(t.value);
			if (!state.colors[t.value] && t.bgColor) {
				state.colors[t.value] = {
					bgColor: t.bgColor,
					textColor: t.textColor || "black",
				};
			}
		}
		state.tags[username] = names;
	}
	return state;
}

// Normalized export shape. Stable across versions so old backups stay
// interoperable. Cache is intentionally dropped - it's perf scaffolding,
// not user data, and shouldn't bloat export files.
export function stateToExport(state) {
	const customTags = {};
	for (const [tagName, info] of Object.entries(state.colors || {})) {
		customTags[tagName] = {
			bgColor: info.bgColor,
			textColor: info.textColor,
		};
	}
	const users = {};
	const allUsernames = new Set([
		...Object.keys(state.ratings || {}),
		...Object.keys(state.tags || {}),
	]);
	for (const username of allUsernames) {
		const rating = state.ratings[username] || 0;
		const tags = state.tags[username] || [];
		if (rating === 0 && tags.length === 0) continue;
		users[username] = { rating, tags: tags.slice() };
	}
	return { customTags, users };
}

// Returns a new state with every user's `oldName` tag replaced by `newName`
// and the color entry moved accordingly. If `newName` already exists as a
// tag (in colors or any user's tag list), this becomes a merge: the
// destination's color is kept, the source color is dropped, and any user
// carrying both ends up with one entry (first-occurrence wins, so the
// relative order of other tags is preserved). Empty / whitespace-only
// `newName`, a no-op rename, or a rename of a tag that isn't present
// anywhere returns the same reference.
export function renameTagInState(state, oldName, newName) {
	const trimmed = typeof newName === "string" ? newName.trim() : "";
	if (!trimmed || trimmed === oldName) return state;

	const tags = state.tags || {};
	const colors = state.colors || {};
	const inColors = Object.hasOwn(colors, oldName);
	const inTags = Object.values(tags).some((list) => list.includes(oldName));
	if (!inColors && !inTags) return state;

	const destExists = Object.hasOwn(colors, trimmed);

	const newTags = {};
	for (const [user, list] of Object.entries(tags)) {
		if (!list.includes(oldName)) {
			newTags[user] = list.slice();
			continue;
		}
		const renamed = list.map((t) => (t === oldName ? trimmed : t));
		const seen = new Set();
		newTags[user] = renamed.filter((t) => {
			if (seen.has(t)) return false;
			seen.add(t);
			return true;
		});
	}

	const newColors = { ...colors };
	delete newColors[oldName];
	if (!destExists && inColors) {
		newColors[trimmed] = colors[oldName];
	}

	return { ...state, tags: newTags, colors: newColors };
}

// Returns a new state with `tagName` removed from every user's tag list
// and from the colors map. No-op (same reference) if the tag isn't
// present anywhere.
export function removeTagInState(state, tagName) {
	const tags = state.tags || {};
	const colors = state.colors || {};
	const inColors = Object.hasOwn(colors, tagName);
	const inTags = Object.values(tags).some((list) => list.includes(tagName));
	if (!inColors && !inTags) return state;

	const newTags = {};
	for (const [user, list] of Object.entries(tags)) {
		newTags[user] = list.includes(tagName)
			? list.filter((t) => t !== tagName)
			: list.slice();
	}

	const newColors = { ...colors };
	delete newColors[tagName];

	return { ...state, tags: newTags, colors: newColors };
}

// Distinct-users-per-tag count. Includes tags that appear only in the
// colors map (orphans) with a count of 0.
export function countsFromState(state) {
	const tags = state.tags || {};
	const colors = state.colors || {};
	const counts = {};
	for (const tagName of Object.keys(colors)) counts[tagName] = 0;
	for (const list of Object.values(tags)) {
		const seen = new Set();
		for (const t of list) {
			if (seen.has(t)) continue;
			seen.add(t);
			counts[t] = (counts[t] || 0) + 1;
		}
	}
	return counts;
}
````

## File: src/parsing.js
````javascript
// Pure-logic helpers. No DOM, no GM_* APIs - safe to import under Node.

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_MONTH = 2592000; // 30-day month, matches legacy behavior
const SECONDS_PER_YEAR = 31536000; // 365-day year, matches legacy behavior

export function timeSince(createdUnixSeconds, nowUnixSeconds) {
	const seconds = Math.floor(nowUnixSeconds - createdUnixSeconds);
	const years = Math.floor(seconds / SECONDS_PER_YEAR);
	if (years >= 1) return `${years} year${years === 1 ? "" : "s"}`;
	const months = Math.floor(seconds / SECONDS_PER_MONTH);
	if (months >= 1) return `${months} month${months === 1 ? "" : "s"}`;
	const days = Math.floor(seconds / SECONDS_PER_DAY);
	return `${days} day${days === 1 ? "" : "s"}`;
}

// Strip a leading "> " (with any surrounding whitespace) from a quoted-comment
// text node, then trim the result. Used by the quote-rendering pass to set
// the body of a `<p class="quote">` directly. Defensive against non-strings
// because the caller pulls from DOM where `.data` could be missing.
export function stripLeadingQuoteMarker(text) {
	if (typeof text !== "string") return "";
	return text.replace(/^\s*>\s*/, "").trim();
}

// For an item page's comment list (top-down DOM order), return for each
// comment the index of its current root (a top-level comment with indent
// level 0), or -1 if the comment is itself a root.
//
// Used by collapse-root-comment to inject a "[collapse root]" link on
// every non-root comment that points at the right root toggle.
export function findCommentRootIndices(indentLevels) {
	const out = new Array(indentLevels.length);
	let currentRoot = -1;
	for (let i = 0; i < indentLevels.length; i++) {
		if (indentLevels[i] === 0) {
			currentRoot = i;
			out[i] = -1; // a root has no parent root to collapse to
		} else {
			out[i] = currentRoot;
		}
	}
	return out;
}

// Split a string into alternating { kind: "text" } and { kind: "code" }
// segments based on backtick pairs. Used by the backticks-to-monospace
// pass to walk text nodes and replace them with DOM nodes that render
// `inline code` segments inside <code> elements.
//
// Rules:
//   - A `code` segment is the shortest run between two backticks. Empty
//     pairs (two backticks with nothing between them) are not treated
//     as code; they survive as text.
//   - An unmatched backtick (no closing pair) stays in place inside the
//     surrounding text segment.
//   - The result preserves the original characters exactly when joined
//     back together (text + "`" + code + "`" + text + ...).
export function splitBackticks(text) {
	if (typeof text !== "string" || text === "") return [];
	const segments = [];
	const pattern = /`([^`]+)`/g;
	let lastIndex = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index;
		if (start > lastIndex) {
			segments.push({ kind: "text", value: text.slice(lastIndex, start) });
		}
		segments.push({ kind: "code", value: match[1] });
		lastIndex = start + match[0].length;
	}
	if (lastIndex < text.length) {
		segments.push({ kind: "text", value: text.slice(lastIndex) });
	}
	return segments;
}

// Given the comment IDs visible on the current page and the IDs we
// stored on a previous visit to the same item, return the IDs that are
// new (i.e. present now but not before). Used by highlight-unread to
// decide which td.ind cells to mark.
export function findNewCommentIds(currentIds, storedIds) {
	const seen = new Set(storedIds || []);
	const out = [];
	for (const id of currentIds || []) {
		if (!seen.has(id)) out.push(id);
	}
	return out;
}

// True iff the entry was last updated within ttlMs of now. A missing
// entry, missing fetchedAt, or stale entry returns false. Used both for
// freshness checks at read time and for cleanup-on-load.
export function isReadCommentEntryFresh(entry, nowMs, ttlMs) {
	if (!entry || typeof entry.fetchedAt !== "number") return false;
	return nowMs - entry.fetchedAt <= ttlMs;
}

// Return a new map containing only the entries that are still fresh.
// Used when persisting to drop expired item IDs from storage so the
// readComments slice doesn't grow unboundedly.
export function pruneExpiredReadComments(map, nowMs, ttlMs) {
	const out = {};
	for (const [itemId, entry] of Object.entries(map || {})) {
		if (isReadCommentEntryFresh(entry, nowMs, ttlMs)) {
			out[itemId] = entry;
		}
	}
	return out;
}

// Truncate a string to at most maxLen characters, appending an ellipsis
// (…) when the original was longer. Used by the hover popups to keep
// long item-text or user-about previews from overflowing the popup.
//
// Keeps it simple: counts code units, not graphemes. HN content is
// overwhelmingly ASCII/BMP so this is fine in practice.
export function truncateText(text, maxLen) {
	if (typeof text !== "string") return "";
	if (typeof maxLen !== "number" || maxLen < 0) return text;
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen)}…`;
}

// Pull the hostname out of an absolute URL, or null if the input isn't
// parseable. Used by the item-info hover to render a "(github.com)"
// badge next to a story's title — same convention HN uses on listing
// pages.
export function extractDomain(url) {
	if (typeof url !== "string" || url === "") return null;
	try {
		const host = new URL(url).hostname;
		return host.startsWith("www.") ? host.slice(4) : host;
	} catch {
		return null;
	}
}

// Split a string into alternating { kind: "text" | "url" | "email" }
// segments. Used by linkify-user-about to walk the about-text cell on
// /user pages and replace plain-text URLs / email addresses with
// clickable <a> elements.
//
// In-house instead of pulling in linkifyjs (saves ~12KB of dep we'd
// barely use). The trade-off is that we don't handle weird URL shapes
// (FTP, gopher, scheme-less domains like "example.com") — only http(s)
// and email. That covers the overwhelming majority of HN about-texts.
//
// Trailing sentence punctuation (.,;:!?)]}>) is split back out into a
// following text segment so "see https://example.com." renders as a
// link followed by a literal period.
export function linkifySegments(text) {
	if (typeof text !== "string" || text === "") return [];
	const out = [];
	const pattern = /(https?:\/\/[^\s<>"]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;
	const trailing = /[.,;:!?)\]}>]+$/;
	let lastIndex = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index;
		if (start > lastIndex) {
			out.push({ kind: "text", value: text.slice(lastIndex, start) });
		}
		const matched = match[0];
		const trail = matched.match(trailing)?.[0] || "";
		const linkBody = trail ? matched.slice(0, -trail.length) : matched;
		const kind = match[1] ? "url" : "email";
		// Defensive: if all that's left after trimming is empty, skip the
		// link entirely and emit the original characters as text.
		if (!linkBody) {
			out.push({ kind: "text", value: matched });
		} else {
			out.push({ kind, value: linkBody });
			if (trail) out.push({ kind: "text", value: trail });
		}
		lastIndex = start + matched.length;
	}
	if (lastIndex < text.length) {
		out.push({ kind: "text", value: text.slice(lastIndex) });
	}
	return out;
}

// Sort a story list by the chosen mode. Stories must carry
// { id, score, commentsCount, defaultRank } at minimum (other fields
// are passed through unchanged). Mode "default" restores HN's
// server-side ranking; "time" newest-first by id; "score" highest
// first; "ratio" highest comments-to-score ratio first (a rough
// "discussion intensity" proxy that surfaces controversial items).
export function sortStoriesBy(stories, mode) {
	const sorted = (stories || []).slice();
	switch (mode) {
		case "time":
			sorted.sort((a, b) => Number(b.id) - Number(a.id));
			break;
		case "score":
			sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
			break;
		case "ratio":
			sorted.sort((a, b) => {
				const ra = (a.commentsCount || 0) / Math.max(a.score || 1, 1);
				const rb = (b.commentsCount || 0) / Math.max(b.score || 1, 1);
				return rb - ra;
			});
			break;
		default: // "default"
			sorted.sort((a, b) => (a.defaultRank || 0) - (b.defaultRank || 0));
			break;
	}
	return sorted;
}

// Parse a raw comma-separated tag string into a canonical list: each name
// trimmed, empty entries dropped, duplicates (first-wins) removed. Used by
// the inline tag input so duplicates never reach setUserTags.
export function parseTagInput(text) {
	const seen = new Set();
	const out = [];
	for (const part of (text || "").split(",")) {
		const name = part.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}
````

## File: tests/store.test.js
````javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../src/state.js";

// Backend contract: { get(key) -> string|undefined, set(key, string) }.
// The store persists everything under a single key so export/import
// and reads-on-startup are one operation each.
function makeFakeBackend(initial = {}) {
	const store = { ...initial };
	return {
		data: store,
		get: (key) => (key in store ? store[key] : undefined),
		set: (key, value) => {
			store[key] = value;
		},
	};
}

test("store: empty backend yields default rating of 0", () => {
	const store = createStore(makeFakeBackend());
	assert.equal(store.getRating("alice"), 0);
});

test("store: setRating persists and round-trips", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setRating("alice", 3);
	assert.equal(store.getRating("alice"), 3);

	// A fresh store reading the same backend sees the same value.
	const store2 = createStore(backend);
	assert.equal(store2.getRating("alice"), 3);
});

test("store: empty backend yields empty tag list", () => {
	const store = createStore(makeFakeBackend());
	assert.deepEqual(store.getUserTags("alice"), []);
});

test("store: setUserTags hydrates with stored tag colors", () => {
	const store = createStore(makeFakeBackend());
	store.setUserTags("alice", [
		{ value: "spammer", bgColor: "hsl(10,50%,80%)", textColor: "black" },
	]);
	const tags = store.getUserTags("alice");
	assert.equal(tags.length, 1);
	assert.equal(tags[0].value, "spammer");
	assert.equal(tags[0].bgColor, "hsl(10,50%,80%)");
	assert.equal(tags[0].textColor, "black");
});

test("store: tag colors are shared across users", () => {
	const store = createStore(makeFakeBackend());
	store.setUserTags("alice", [
		{ value: "expert", bgColor: "hsl(120,50%,80%)", textColor: "black" },
	]);
	store.setUserTags("bob", [{ value: "expert" }]); // bob picks up the color
	const bobTags = store.getUserTags("bob");
	assert.equal(bobTags[0].bgColor, "hsl(120,50%,80%)");
	assert.equal(bobTags[0].textColor, "black");
});

test("store: setTagColor updates color for all users with that tag", () => {
	const store = createStore(makeFakeBackend());
	store.setUserTags("alice", [
		{ value: "t", bgColor: "hsl(1,50%,80%)", textColor: "black" },
	]);
	store.setTagColor("t", { bgColor: "hsl(2,50%,80%)", textColor: "white" });
	assert.equal(store.getUserTags("alice")[0].bgColor, "hsl(2,50%,80%)");
});

test("store: getTagColor returns null for unknown tag", () => {
	const store = createStore(makeFakeBackend());
	assert.equal(store.getTagColor("nope"), null);
});

test("store: _invalidate forces re-read from backend", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setRating("alice", 5);
	assert.equal(store.getRating("alice"), 5);

	// Simulate another tab writing directly to the backend.
	const foreign = createStore(backend);
	foreign.setRating("alice", 42);

	// Without invalidation, the in-memory cache still returns the old value.
	assert.equal(store.getRating("alice"), 5);

	// After invalidation, the store re-reads the backend and sees the update.
	store._invalidate();
	assert.equal(store.getRating("alice"), 42);
});

test("store: everything lives under a single backend key", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setRating("alice", 1);
	store.setUserTags("alice", [
		{ value: "t", bgColor: "hsl(1,50%,80%)", textColor: "black" },
	]);
	const keys = Object.keys(backend.data);
	assert.equal(keys.length, 1, `expected 1 key, got: ${keys.join(",")}`);
});

// Two stores backed by the same backend simulate two browser tabs
// writing to the same GM storage key. The pre-RMW design clobbered
// the second tab's earlier-loaded snapshot over the first tab's
// write — this is the bug that wiped out readComments at page load
// when the user cmd-clicked many comment pages from the front page
// at once. With read-modify-write, the second tab re-reads disk
// before applying its mutation, so both writes survive.
test("store: concurrent setReadComments from two stores both persist", () => {
	const backend = makeFakeBackend();
	const tabA = createStore(backend);
	const tabB = createStore(backend);

	// Force both stores to materialize an initial empty snapshot, the way
	// page-load reads (e.g. hydrating a user's existing tags) would.
	tabA.getRating("noone");
	tabB.getRating("noone");

	// Tab A writes first.
	tabA.setReadComments("48000001", ["a1", "a2"], 1000);
	// Tab B's in-memory snapshot doesn't include Tab A's write, but RMW
	// re-reads disk before mutating, so Tab A's entry is preserved.
	tabB.setReadComments("48000002", ["b1"], 2000);

	const persisted = JSON.parse(backend.data.hn_state);
	assert.deepEqual(persisted.readComments, {
		48000001: { ids: ["a1", "a2"], fetchedAt: 1000 },
		48000002: { ids: ["b1"], fetchedAt: 2000 },
	});
});

// Single-shot replacement of the tags and colors slices. Must leave
// ratings and cache untouched and must produce exactly one backend
// write, so cross-tab listeners fire once per user Save action.
test("store: replaceTagsAndColors writes once, leaves ratings/cache alone", () => {
	const backend = makeFakeBackend();
	let writes = 0;
	const countingBackend = {
		get: backend.get,
		set: (k, v) => {
			writes += 1;
			backend.set(k, v);
		},
		list: backend.list,
		data: backend.data,
	};
	const store = createStore(countingBackend);
	store.setRating("alice", 5);
	store.setCachedUser("alice", { created: 1, karma: 2 }, 12345);
	const before = writes;

	store.replaceTagsAndColors(
		{ alice: ["x"], bob: ["x", "y"] },
		{
			x: { bgColor: "xc", textColor: "black" },
			y: { bgColor: "yc", textColor: "black" },
		},
	);

	assert.equal(writes - before, 1, "replaceTagsAndColors should write once");

	const persisted = JSON.parse(backend.data.hn_state);
	assert.deepEqual(persisted.tags, { alice: ["x"], bob: ["x", "y"] });
	assert.deepEqual(persisted.colors, {
		x: { bgColor: "xc", textColor: "black" },
		y: { bgColor: "yc", textColor: "black" },
	});
	assert.equal(persisted.ratings.alice, 5);
	assert.equal(persisted.cache.alice.created, 1);
});
````

## File: package.json
````json
{
	"name": "hacker-news-user-info",
	"version": "0.9.0",
	"type": "module",
	"private": true,
	"scripts": {
		"test": "node --test 'tests/*.test.js'",
		"build": "node scripts/build.js"
	}
}
````

## File: scripts/build.js
````javascript
#!/usr/bin/env node
// Build the ViolentMonkey userscript by concatenating src/ modules.
//
// Strips ES module `import` and `export` syntax (we only use the simple
// declaration forms - `import { x } from "./y.js";` and `export function`,
// `export const`). The resulting body is wrapped in an IIFE and prefixed
// with the userscript metadata block.
//
// Mirrors the build approach used by ../url_destination_checker so the two
// repos stay structurally consistent.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// Embed the current commit's short hash in @version so a glance at the
// userscript metadata in Tampermonkey/Violentmonkey is enough to tell
// which commit is loaded. Base version is bumped manually for releases;
// the hash is the per-commit fingerprint. Falls back to "unknown" if git
// isn't available (shouldn't happen during normal use, but the build
// shouldn't crash on it). execFileSync (not execSync) so no shell is
// involved — args are hardcoded, but the no-shell habit is cheap.
function gitShortHash() {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd: repoRoot,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch (_e) {
		return "unknown";
	}
}

const BASE_VERSION = "0.10";
const VERSION = `${BASE_VERSION}+${gitShortHash()}`;

// Order matters: dependencies first.
const SOURCES = [
	"src/config.js",
	"src/parsing.js",
	"src/state.js",
	"src/dom.js",
	"src/styles.js",
	"src/api.js",
	"src/features/legibility.js",
	"src/features/comment-box-toggle.js",
	"src/features/click-indent-toggle.js",
	"src/features/collapse-root-comment.js",
	"src/features/backticks-to-monospace.js",
	"src/features/toggle-all-comments.js",
	"src/features/highlight-unread-comments.js",
	"src/features/hover-popup.js",
	"src/features/user-info-hover.js",
	"src/features/item-info-hover.js",
	"src/features/linkify-user-about.js",
	"src/features/sort-stories.js",
	"src/features/reply-inline.js",
	"src/features/user-render.js",
	"src/features/tag-manager.js",
	"src/features/toolbar.js",
	"src/main.js",
];

const HEADER = `// ==UserScript==
// @name         Hacker News - Inline Account Info, Legible Custom Tags and Rating
// @namespace    Violent Monkey
// @version      ${VERSION}
// @description  Inline account info, custom tags and ratings on comment pages, plus site-wide legibility tweaks (quote rendering, downvote contrast, font/layout cleanup, optional comment-box toggle)
// @author       You
// @match        https://news.ycombinator.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ycombinator.com
// ==/UserScript==
`;

function stripModuleSyntax(src) {
	// Remove import statements (single-line or multi-line up to the closing
	// semicolon on its own line). Non-greedy so it stops at the first ; not
	// the file's last one.
	let out = src.replace(/^import\b[\s\S]*?;\s*$/gm, "");
	// Strip leading `export ` from declarations.
	out = out.replace(
		/^\s*export\s+(const|let|var|function|class|async\s+function)/gm,
		"$1",
	);
	return out;
}

// Surface duplicate top-level `function name(...)` declarations across
// modules. Each src/ file is its own ES module so collisions go unnoticed
// in tests, but the build concatenates everything into one IIFE — same-name
// function declarations silently override each other in that scope, and
// the symptom (caller invokes a function with a wrong signature, gets
// surprise behaviour) is hard to debug. A name-clash here happened once;
// the next-best place to catch it is at build time.
function checkForDuplicateTopLevelFunctions(modules) {
	// Match `function foo(` at the start of a line so we only see top-level
	// declarations, not nested ones inside a closure body. Stripping the
	// `export ` prefix has already happened by the time we look.
	const declRe = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
	const seen = new Map(); // name -> [ relPath, ... ]
	for (const { path, body } of modules) {
		for (const m of body.matchAll(declRe)) {
			const name = m[1];
			if (!seen.has(name)) seen.set(name, []);
			seen.get(name).push(path);
		}
	}
	const collisions = [...seen.entries()].filter(
		([, paths]) => paths.length > 1,
	);
	if (collisions.length === 0) return;
	const lines = collisions.map(
		([name, paths]) => `  ${name}: ${paths.join(", ")}`,
	);
	throw new Error(
		`build: duplicate top-level function declarations across modules ` +
			`(later definitions silently override earlier ones in the bundled IIFE):\n${lines.join("\n")}`,
	);
}

function buildBody() {
	const modules = SOURCES.map((rel) => ({
		path: rel,
		body: stripModuleSyntax(readFileSync(join(repoRoot, rel), "utf8")),
	}));
	checkForDuplicateTopLevelFunctions(modules);
	const parts = [];
	for (const { path, body } of modules) {
		parts.push(`// ===== ${path} =====`);
		parts.push(body);
	}
	return parts.join("\n\n");
}

const body = buildBody();
const out = `${HEADER}\n(function () {\n"use strict";\n\n${body}\n\n})();\n`;

const outPath = join(repoRoot, "script.js");
writeFileSync(outPath, out, "utf8");
console.log(`built ${outPath} (${out.length} bytes)`);
````

## File: src/main.js
````javascript
// Browser-side bootstrap. The build script wraps this (and every module
// imported above it) in a single IIFE inside the userscript bundle, so
// everything below runs once on load inside the userscript runtime.

import { createApi } from "./api.js";
import { STATE_KEY } from "./config.js";
import { isItemPage } from "./dom.js";
import { transformBackticksToMonospace } from "./features/backticks-to-monospace.js";
import { setupClickIndentToggle } from "./features/click-indent-toggle.js";
import { setupCollapseRootComment } from "./features/collapse-root-comment.js";
import { setupCommentBoxToggle } from "./features/comment-box-toggle.js";
import { setupHighlightUnreadComments } from "./features/highlight-unread-comments.js";
import { createHoverPopup } from "./features/hover-popup.js";
import { setupItemInfoHover } from "./features/item-info-hover.js";
import { applyDownvotedClass, transformQuotes } from "./features/legibility.js";
import { setupLinkifyUserAbout } from "./features/linkify-user-about.js";
import { setupReplyInline } from "./features/reply-inline.js";
import { setupSortStories } from "./features/sort-stories.js";
import { createTagManager } from "./features/tag-manager.js";
import { setupToggleAllComments } from "./features/toggle-all-comments.js";
import { createToolbar } from "./features/toolbar.js";
import { setupUserInfoHover } from "./features/user-info-hover.js";
import { createUserRender } from "./features/user-render.js";
import { createStore, migrateLegacyKeys } from "./state.js";
import { STYLES } from "./styles.js";

GM_addStyle(STYLES);

// Adapter from GM_* to the {get, set, list} interface the store and
// migration expect.
const backend = {
	get: (key) => GM_getValue(key, undefined),
	set: (key, value) => GM_setValue(key, value),
	list: () => (typeof GM_listValues === "function" ? GM_listValues() : []),
};

migrateLegacyKeys(backend);
const store = createStore(backend);
const { fetchUser, fetchItem } = createApi({ store });
const hoverPopup = createHoverPopup();

// Tag manager and user-render reference each other; both bindings exist by
// the time either's stored callback runs (on a click), so the closures
// resolve fine despite the forward reference.
const tagManager = createTagManager({
	store,
	rerenderUserTags: (username) => userRender.rerenderUserTags(username),
});
const userRender = createUserRender({
	store,
	fetchUser,
	openTagManager: () => tagManager.open(),
});
const toolbar = createToolbar({ store, backend });

// Sync state from other tabs. GM_addValueChangeListener fires whenever
// another tab writes to the same GM storage key. We invalidate the
// in-memory cache and re-render every user visible on this page.
if (typeof GM_addValueChangeListener === "function") {
	GM_addValueChangeListener(STATE_KEY, (_name, _oldVal, _newVal, remote) => {
		if (!remote) return;
		tagManager.getActive()?.markStale();
		store._invalidate();
		const usernames = new Set();
		for (const el of document.querySelectorAll("[data-hn-user]")) {
			usernames.add(el.dataset.hnUser);
		}
		for (const username of usernames) {
			userRender.rerenderUserTags(username);
			userRender.rerenderUserRatings(username);
		}
	});
}

applyDownvotedClass();
transformQuotes();
// Linkify and sort-stories are page-gated internally (linkify by
// pathname, sort by table.itemlist presence), so call unconditionally.
setupLinkifyUserAbout();
setupSortStories();

if (isItemPage()) {
	setupCommentBoxToggle();
	setupClickIndentToggle();
	setupCollapseRootComment();
	transformBackticksToMonospace();
	setupToggleAllComments();
	setupHighlightUnreadComments({ store });
	userRender.renderAllUsernames();
	setupItemInfoHover({ fetchItem, popup: hoverPopup });
	setupReplyInline();
	toolbar.mount();
}

// User-info hover wires every .hnuser on every page (except /user
// itself, which the feature checks internally). Must run AFTER
// renderAllUsernames on item pages: that pass hides each original
// .hnuser and inserts a visible clone, so the hover handler has to
// land on the clone.
setupUserInfoHover({ fetchUser, popup: hoverPopup });
````

## File: src/styles.js
````javascript
// CSS for the userscript: site-wide legibility tweaks plus our injected UI.
// Tokens (`--colour-hn-orange`, `--gutter`, `--border-radius`) are declared
// on `:root` so feature-specific rules added later can reuse them.
//
// The site-wide block is adapted from
// https://github.com/mgladdish/website-customisations.
export const STYLES = `
    :root {
      --colour-hn-orange: #ff6600;
      --colour-hn-orange-pale: rgba(255, 102, 0, 0.05);
      --gutter: 0.5rem;
      --border-radius: 3px;
    }

    /* Site-wide legibility tweaks, adapted from
       https://github.com/mgladdish/website-customisations. */
    html, body, td, .title, .comment, .default {
      font-family: "Verdana", "Arial", sans-serif;
    }
    html, body { margin-top: 0; }
    body { padding: 0; margin: 0; }
    body, td, .title, .pagetop, .comment { font-size: 1rem; }

    html[op="news"] .title,
    .votelinks,
    .fatitem .title + .votelinks { vertical-align: inherit; }

    .comment-tree .votelinks,
    html[op="threads"] .votelinks,
    html[op="item"] .votelinks,
    xhtml[op="newcomments"] .votelinks { vertical-align: top; }

    span.titleline {
      font-size: 1rem;
      margin-top: var(--gutter);
      margin-bottom: var(--gutter);
      display: block;
    }
    html[op="item"] span.titleline { font-size: 1.2rem; }

    .rank { display: none; }

    html[op="news"]        #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="newest"]      #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="ask"]         #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="newcomments"] #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="shownew"]     #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="submitted"]   #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="favorites"]   #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2),
    html[op="front"]       #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2),
    html[op="show"]        #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2) {
      margin-left: var(--gutter);
    }

    .sitebit.comhead { margin-left: var(--gutter); }
    .subtext, .subline { font-size: 0.75rem; }

    #hnmain {
      width: 100%;
      background-color: white;
    }
    #hnmain > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) {
      padding: var(--gutter);
    }
    #hnmain > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) {
      padding-right: var(--gutter) !important;
    }

    .comment, .toptext { max-width: 40em; }
    .toptext, a { color: black; }
    a:visited { color: #4c2c92; }
    a:hover { text-decoration: underline; }

    input { padding: var(--gutter); }
    input, textarea {
      background-color: white;
      border: 2px solid var(--colour-hn-orange);
      border-radius: var(--border-radius);
    }
    input[type="button"], input[type="submit"] { cursor: pointer; }

    .downvoted {
      background-color: rgb(245, 245, 245);
      border-radius: var(--border-radius);
      padding: 6px;
    }
    .downvoted .commtext {
      color: black;
      font-size: smaller;
    }

    .quote {
      border-left: 3px solid var(--colour-hn-orange);
      padding: 6px 6px 6px 9px;
      font-style: italic;
      background-color: var(--colour-hn-orange-pale);
      border-radius: var(--border-radius);
    }

    .hidden { display: none; }

    .showComment a,
    .hideComment,
    .hideComment:link,
    .hideComment:visited {
      color: var(--colour-hn-orange);
      text-decoration: underline;
    }
    .hideComment { margin-left: var(--gutter); }

    /* Our own injected UI (account info, custom tags, ratings, toolbar,
       tag-management overlay). The site-wide input padding rule would
       otherwise inflate our compact fields, so the inputs below carry
       tighter padding overrides - but the orange border + radius from
       the site-wide rule are kept on purpose. */

    .hn-post-layout {
      display: grid;
      grid-template-columns: 1fr auto;
      margin: 5px 0;
      width: 100%;
    }
    .comment { padding-top: 10px; }
    /* Hide the stray <br>s HN puts above comment bodies.
       :has() is supported in all current evergreen browsers. */
    br:has(+ div.comment) { display: none; }
    .hn-username {
      font-weight: 700;
      font-size: 1.15em;
      margin-right: 5px;
    }
    .hn-main-row {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      padding-bottom: 2px;
      grid-column: 1;
    }
    .hn-info {
      font-size: 0.8em;
      margin-left: 4px;
      white-space: nowrap;
    }
    .hn-info-pending { opacity: 0.4; }
    .hn-tag-container {
      display: flex;
      flex-direction: column;
      grid-column: 2;
      padding-left: 10px;
      margin-left: 10px;
    }
    .hn-tag-group {
      display: flex;
      flex-direction: column;
    }
    .hn-tag {
      padding: 3px 6px;
      margin-bottom: 3px;
      margin-right: 5px;
      border-radius: 5px;
      font-size: 0.9em;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: fit-content;
    }
    .hn-tag-text { margin-right: 5px; }
    .hn-tag-icons {
      display: flex;
      align-items: center;
    }
    .hn-tag-icon {
      cursor: pointer;
      margin-left: 3px;
      font-size: 0.8em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.3);
    }
    .hn-tag-icon:hover { background-color: rgba(255, 255, 255, 0.6); }
    .hn-tag-input {
      font-size: 0.8em;
      margin-left: 4px;
      width: 250px;
      height: 30px;
      line-height: 30px;
      display: inline-block;
      vertical-align: middle;
      /* Tighter padding than the site-wide rule so the field stays
         compact; the orange border + radius from the site-wide rule
         are kept by design. */
      padding: 0 4px;
    }
    .hn-rating-container {
      margin-left: 4px;
      white-space: nowrap;
      display: flex;
      align-items: center;
    }
    .hn-rating-btn {
      font-size: 0.6em;
      padding: 1px 2px;
      margin-right: 2px;
    }
    .hn-rating-display {
      font-size: 1.3em;
      padding: 0 4px 0 2px;
      color: #575F94;
      font-weight: 700;
    }
    .hn-toolbar {
      position: fixed;
      top: 10px;
      right: 10px;
      background-color: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: 4px;
      padding: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      z-index: 9999;
      display: flex;
      align-items: center;
    }
    .hn-drag-handle {
      width: 12.5px;
      height: 100%;
      background-color: rgba(255, 102, 0, 0.5);
      cursor: move;
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      border-top-left-radius: 3px;
      border-bottom-left-radius: 3px;
    }
    .hn-toolbar-buttons {
      display: flex;
      padding-left: 8px;
    }
    .hn-toolbar-btn {
      background-color: var(--colour-hn-orange);
      color: white;
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      margin: 0 5px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-toolbar-btn:hover { background-color: #ff8533; }
    .hn-tagmgr-catcher {
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: transparent;
    }
    .hn-tagmgr-overlay {
      position: fixed;
      top: 5vh;
      right: 0;
      width: 33vw;
      min-width: 320px;
      height: 90vh;
      background-color: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: 4px 0 0 4px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      font-size: 0.9em;
    }
    .hn-tagmgr-header {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: bold;
    }
    .hn-tagmgr-header-count { color: #888; font-weight: normal; }
    .hn-tagmgr-controls {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .hn-tagmgr-filter {
      width: 100%;
      padding: 4px 6px;
      box-sizing: border-box;
    }
    .hn-tagmgr-sort { display: flex; gap: 6px; }
    .hn-tagmgr-sort-btn {
      font-size: 0.85em;
      padding: 2px 8px;
      background: #f4f4f4;
      border: 1px solid #ccc;
      border-radius: 3px;
      cursor: pointer;
    }
    .hn-tagmgr-sort-btn.active {
      background: var(--colour-hn-orange);
      color: white;
      border-color: var(--colour-hn-orange);
    }
    .hn-tagmgr-list {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 4px 0;
    }
    .hn-tagmgr-row {
      display: flex;
      align-items: center;
      padding: 4px 12px;
      gap: 8px;
      border-left: 2px solid transparent;
    }
    .hn-tagmgr-row.dirty { border-left-color: var(--colour-hn-orange); }
    .hn-tagmgr-row.removed .hn-tagmgr-name { text-decoration: line-through; }
    .hn-tagmgr-row.removed { opacity: 0.6; }
    .hn-tagmgr-swatch {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      flex: 0 0 12px;
      border: 1px solid rgba(0,0,0,0.1);
    }
    .hn-tagmgr-name {
      flex: 1 1 auto;
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: bold;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hn-tagmgr-name-input {
      flex: 1 1 auto;
      font-size: 1em;
      padding: 1px 5px;
    }
    .hn-tagmgr-count {
      flex: 0 0 auto;
      font-size: 0.85em;
      color: #666;
      min-width: 2em;
      text-align: right;
    }
    .hn-tagmgr-count.zero { color: #bbb; }
    .hn-tagmgr-icons { display: flex; gap: 4px; flex: 0 0 auto; }
    .hn-tagmgr-icon {
      cursor: pointer;
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-size: 0.9em;
    }
    .hn-tagmgr-icon:hover { background: #eee; }
    .hn-tagmgr-footer {
      padding: 8px 12px;
      border-top: 1px solid #eee;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .hn-tagmgr-btn {
      background: white;
      border: 1px solid #ccc;
      border-radius: 3px;
      padding: 5px 14px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-tagmgr-btn.primary {
      background: var(--colour-hn-orange);
      color: white;
      border-color: var(--colour-hn-orange);
    }
    .hn-tagmgr-btn:hover { filter: brightness(0.95); }

    /* Refined-HN-derived comment-tree tweaks (PR-2). HN's site-wide CSS
       sets .commtext.cdd to grey-on-grey for dead comments; we recolour
       it to a faint red so showdead users can spot them at a glance.
       The indent border puts a 1px shadow on the indent gutter so reply
       depth is visible without counting indents. <pre> and inline
       <code> get a subtle grey background to look like code, matching
       how most readers expect monospace text to render. */
    .commtext.cdd,
    .commtext.cdd * {
      color: #d89899 !important;
    }
    tr.comtr td.ind {
      box-shadow: inset -1px 0 #ccc;
    }
    .hn-clickable-indent {
      cursor: pointer;
    }
    .hn-clickable-indent:hover {
      box-shadow: inset -1px 0 #888;
    }
    div.comment span.commtext pre,
    div.comment span.commtext *:not(pre) > code {
      background: #e4e4e4;
      border-radius: var(--border-radius);
    }
    div.comment span.commtext *:not(pre) > code {
      padding: 0 4px;
      display: inline-block;
    }

    /* OP highlight: the [op] suffix is appended as a text node by
       user-render so the marker is grep-able in the DOM, and the
       .hn-op class colours the whole username (including the suffix)
       in HN orange. */
    .hn-op {
      color: var(--colour-hn-orange) !important;
    }

    /* The collapse-root link sits inline next to "parent | next" in the
       comhead. Match HN's existing comhead link size so it doesn't
       overpower the row. */
    a.hn-collapse-root,
    a.hn-collapse-root:link,
    a.hn-collapse-root:visited {
      color: var(--colour-hn-orange);
      margin-left: 4px;
    }
    a.hn-collapse-root:hover {
      text-decoration: underline;
    }

    /* Highlight-unread tints every cell of a new comment's row so the
       marker stays visible regardless of indent depth. (Painting only
       td.ind leaves root comments unmarked because their indent cell
       collapses to ~0 width.) */
    .hn-new-comment > td {
      background-color: rgba(255, 102, 0, 0.12);
    }

    /* "[toggle all]" sits next to the existing fatitem subtext links;
       "[toggle replies]" (when enabled) lives in each comment's comhead
       like "[collapse root]". Same orange/underline treatment as the
       collapse-root link for visual consistency. */
    a.hn-toggle-all,
    a.hn-toggle-all:link,
    a.hn-toggle-all:visited,
    a.hn-toggle-replies,
    a.hn-toggle-replies:link,
    a.hn-toggle-replies:visited {
      color: var(--colour-hn-orange);
      margin-left: 4px;
    }
    a.hn-toggle-all:hover,
    a.hn-toggle-replies:hover {
      text-decoration: underline;
    }

    /* PR-4: shared hover-popup primitive used by user-info-hover and
       item-info-hover. Fixed-position-via-absolute (anchored relative
       to scrollY/scrollX in the JS) so it floats above page content
       without joining the document flow. The .hidden rule is shared
       with the comment-box-toggle. */
    .hn-hover-popup {
      position: absolute;
      max-width: 360px;
      background: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: var(--border-radius);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      padding: 8px 10px;
      font-size: 0.85em;
      z-index: 10000;
      pointer-events: none;
    }
    .hn-hover-popup-title {
      font-size: 1em;
      margin-bottom: 4px;
    }
    .hn-hover-popup-domain {
      color: #888;
      font-weight: normal;
    }
    .hn-hover-popup-meta {
      color: #555;
      margin-bottom: 4px;
    }
    .hn-hover-popup-body {
      color: #333;
      margin-top: 4px;
      max-height: 8em;
      overflow: hidden;
    }

    /* PR-5: sort-stories dropdown sits above table.itemlist on listing
       pages. Match HN's subtext font size so it doesn't dominate the
       layout. */
    .hn-sort-bar {
      padding: 6px 10px;
      font-size: 0.8em;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .hn-sort-select {
      padding: 1px 4px;
      font-size: inherit;
    }
    a.hn-sort-reverse,
    a.hn-sort-reverse:link,
    a.hn-sort-reverse:visited {
      color: var(--colour-hn-orange);
      margin-left: 4px;
    }
    a.hn-sort-reverse:hover {
      text-decoration: underline;
    }

    /* reply-inline injects HN's own reply/edit/delete <form> into
       div.reply with this class so we can give it some top margin
       (otherwise it bumps right up against the parent comment). */
    .hn-injected-form {
      margin-top: 10px;
    }
    .hn-reply-loader {
      color: #888;
      font-size: 0.85em;
    }
  `;
````

## File: README.md
````markdown
# Hacker News User Info

A userscript that makes Hacker News easier to read and annotates every comment with the author's account age, karma, a personal up/down rating, and custom colored tags.

![match scope: news.ycombinator.com/*](https://img.shields.io/badge/scope-news.ycombinator.com-ff6600)

## What it does

### Site-wide (every HN page)

- **Legibility tweaks**: Verdana/Arial body font, larger base size, gutters, full-width main, smaller subtext.
- **Readable downvoted comments**: black text on a faint-grey background instead of HN's default grey-on-grey.
- **Quoted-text rendering**: lines starting with `>` get an HN-orange left border, faint orange background, and italic body — easier to spot a quote at a glance.
- **Hidden cruft**: rank numbers on listing pages.
- **Sort stories**: a "sort: …" dropdown above the story list lets you reorder by `default` (HN's ranking), `time` (newest first), `score`, or `comments/score ratio` (a rough proxy for "most-discussed given its score"). Reset by reloading the page, or click `reverse` to flip the current order.
- **Linkify user about**: on a `/user` profile, plain-text URLs and email addresses in the about field are converted to clickable links.

The legibility and quote/downvote restyling are adapted from [mgladdish/website-customisations](https://github.com/mgladdish/website-customisations).

### On comment pages (`news.ycombinator.com/item?id=*`)

Each commenter's username is augmented with:

- **Account age and karma** pulled from HN's public API, e.g. `(7 years old, 12345 karma)`.
- **Up/down rating buttons** (▲ / ▼) that track your own opinion of the author. The rating is stored locally and persists across visits.
- **A tag input** where you can type comma-separated tags (e.g. `expert, javascript, helpful`). Each tag gets a random pastel color the first time you use it, and reuses the same color for every user you apply it to.
- **A tag list** in the right column showing all tags you've applied to the commenter, each with inline edit and remove icons.
- **Original-poster highlight**: every comment by the item's submitter gets a `[op]` suffix and HN-orange username so you can spot the OP's replies at a glance.

The comment tree itself gets a few tweaks for skim-ability:

- **Hover any username** to see a popup with their account age, karma, and (if any) about-text snippet — works on every HN page that shows usernames, and reuses the same 6h cache as the inline (age, karma) blurb on item pages so repeat hovers are free.
- **Hover any link to another HN item** inside a comment to see a popup with the item's title, domain, author, score, comment count, and (for Ask/Show items) a snippet of the body text. Useful when a commenter cites another submission and you want context without leaving the page.
- **Reply / edit / delete inline**: clicking those links on any comment fetches the relevant form in the background and injects it into the comment, so you can write a reply without leaving the page. If you select text before clicking reply, the selection is automatically prepended to the textarea as a `> ` quoted block. Click the link a second time to hide the form.
- **Click anywhere on the indent gutter to collapse a comment** — no more hunting for the small `[-]` link.
- **`[collapse root]`** link in every nested comment's header that collapses the whole top-level thread it belongs to and scrolls back to the (now-collapsed) root, so you can dismiss an entire branch and pick up where you left off without losing your place.
- **`toggle all`** link in the item's subtext that collapses or expands every top-level comment in one click — handy when you want to scan headers on a long thread.
- **Visible indentation gutter** with a thin separator on the left of each indent column, making reply depth easier to follow than counting indents.
- **Highlighted unread comments**: comments that weren't on the page the last time you visited the same thread get a faint orange tint in their indent gutter. The "seen" list is per-item with a 3-day TTL.
- **Backtick → monospace**: text wrapped in `` ` ``backticks`` ` `` inside a comment is rendered as inline `<code>` so code-in-prose looks like code without the author having to use raw HTML.
- **Dead-comment recolour**: dead comments shown via HN's `showdead` setting get a faint red colour instead of HN's grey-on-grey.
- **Inline `<code>` and `<pre>` blocks** get a subtle grey background and rounded corners so monospace text inside comments actually looks like code.

The page-bottom comment-submit form is also collapsed behind a **show comment box** link to keep the bottom of long threads tidy.

A small draggable toolbar in the top-right corner has **Save state** and **Restore state** buttons for exporting and importing all your data as JSON.

## Install

1. Install a userscript manager:
   - [Violentmonkey](https://violentmonkey.github.io/) (recommended, open source)
   - [Tampermonkey](https://www.tampermonkey.net/)
2. Open [`script.js`](./script.js) in your browser and click the "Install" prompt your manager raises, or copy the file contents into a new script in the manager's dashboard.
3. Visit Hacker News — the legibility tweaks apply on every page; the per-commenter augmentations appear on comment pages.

`script.js` is a single-file build artifact assembled from the modules under `src/`. End users only need that one file; see [Development](#development) below for how it's produced.

## Using it

**Rating a commenter.** Click ▲ or ▼ next to any username. The number updates immediately on every comment by that user on the page. Revisiting the same thread (or any other thread the same person comments on) shows your stored rating.

**Tagging a commenter.** Type into the tag input next to the username, separating tags with commas. Tags are saved automatically after you stop typing for about half a second. Each tag name gets a color the first time you use it anywhere, and that same color is reused for every subsequent use.

**Editing a tag.** Click the ✏️ icon on a tag to rename it. The change applies to every comment by that user on the page.

**Removing a tag.** Click the ✖ icon on a tag to remove it from that user across all their comments on the page.

**Managing all tags.** Click the ☰ icon on any tag to open the tag manager overlay on the right-hand side of the page. It lists every tag you have ever created, sortable by name or by usage count and filterable by substring — the filter box is focused as soon as the overlay opens, so you can start typing immediately. From there you can rename a tag (press Enter to commit; renaming to a name that already exists prompts to merge), mark a tag for removal, or undo pending changes on a row. Click **Save** to apply everything at once, or **Cancel** / press **Escape** / click outside the overlay to discard your changes.

**Cross-tab sync.** Rating and tag changes made in one tab are automatically reflected in other open HN tabs.

**Backing up your data.** Click **Save state** in the top-right toolbar. A JSON file downloads containing all your ratings, tags, and tag colors.

**Restoring your data.** Click **Restore state** and pick a previously-exported JSON file. Your current data is replaced and the page reloads.

**Moving the toolbar.** Grab the orange handle on the left edge of the toolbar and drag it.

## Performance notes

User data is fetched from HN's Firebase API, which is one request per unique username. To keep pages snappy even on long threads:

- Every row renders immediately from local state. The `(age, karma)` blurb is a placeholder that gets filled in asynchronously as each fetch lands, so a slow request never blocks anything else.
- Fetched data is cached locally for 6 hours. Once you've seen a commenter recently, subsequent page loads don't hit the network for them at all.
- Each request has an 8-second timeout. A hanging request silently drops its placeholder instead of leaving the row in a loading state forever.

## Privacy

Everything is stored locally in your userscript manager's storage. Nothing is sent anywhere except requests to `hacker-news.firebaseio.com` to fetch public account info for the commenters on the page you're viewing.

## Development

See [CLAUDE.md](./CLAUDE.md) for architecture notes. Source lives under `src/` (ES modules); `scripts/build.js` concatenates them, strips `import`/`export`, and wraps the result in an IIFE with the `==UserScript==` header to produce the single `script.js` users install.

Common tasks:

```sh
just test   # run the Node test suite (pure logic only)
just lint   # biome lint + autofix
just fmt    # biome format
just build  # rebuild script.js from src/
just check  # lint + format + test + build (the pre-commit gate)
```

Always run `just build` (or `just check`) after editing `src/` so the built `script.js` stays in sync — CI fails the PR otherwise.

Tests cover the pure-logic layer (storage, migration, cache, time formatting, import/export parsing). Rendering and GM_* integration are verified manually in a userscript manager.

### Utilities

`scripts/clean-orphan-tags.js` strips unused tag colour entries from an exported state file. Save state from the toolbar, run the script on the downloaded JSON, then Restore state from the cleaned file:

```sh
node scripts/clean-orphan-tags.js ~/Downloads/hn-user-data-YYYY-MM-DD.json
```

The cleaned file is written alongside the input with a `.cleaned.json` suffix; the original is untouched.
````

## File: CLAUDE.md
````markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tampermonkey/Violentmonkey userscript with two cooperating layers:

1. **Site-wide legibility layer** (every HN page, `news.ycombinator.com/*`): font reset, sizing, gutters, full-width main, downvoted-comment restyling (black-on-faint-grey), quoted-text rendering (`>`-prefixed text wrapped in `<p class="quote">` with HN-orange accents), and `.rank` hidden. CSS comes from a `:root` block with `--colour-hn-orange`, `--colour-hn-orange-pale`, `--gutter`, and `--border-radius` tokens. Adapted from [mgladdish/website-customisations](https://github.com/mgladdish/website-customisations).
2. **Comment-page enrichment layer** (only `news.ycombinator.com/item?id=*`, gated by `isItemPage()`): account age + karma inline, per-user custom tags with colors, per-user up/down rating, OP highlight (`[op]` suffix on every comment by the item submitter), click-the-indent-gutter to collapse, `[collapse root]` link on nested comments, "toggle all" link on the fatitem subtext, backtick-wrapped text rendered as `<code>`, highlight for comments new since last visit, hover-on-cited-item popup, dead-comment recolour, indent-gutter separator, `<pre>`/`<code>` styling, draggable toolbar for export/import, and a "show comment box" toggle that collapses the page-bottom comment-submit form.
3. **Hover-on-username popup** runs on every HN page (except `/user`, where you're already looking at the profile): hovering any `.hnuser` for the dwell period (250ms) shows a popup with their account age, karma, and about-text snippet, fetched once and cached for 6h.
4. **Listing-page enhancements** (any page with a `table.itemlist`): a "sort: …" dropdown re-orders the story list in place — `default` / `time` / `score` / `ratio`, plus a `reverse` link.
5. **`/user` page enhancement**: plain-text URLs and email addresses in the about cell get turned into clickable links.

`src/main.js` runs the legibility passes (`applyDownvotedClass`, `transformQuotes`), `setupLinkifyUserAbout`, and `setupSortStories` on every HN page (each feature internally checks whether its page is the right one). The enrichment passes (`setupCommentBoxToggle`, `setupClickIndentToggle`, `setupCollapseRootComment`, `transformBackticksToMonospace`, `setupToggleAllComments`, `setupHighlightUnreadComments`, `userRender.renderAllUsernames`, `setupItemInfoHover`, `setupReplyInline`, `toolbar.mount`) run only on item pages. `setupUserInfoHover` runs last and on every HN page (the feature internally skips `/user`); it has to come after `renderAllUsernames` so the hover handler lands on the visible cloned `.hnuser` rather than the now-hidden original.

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
                             findCommentRootIndices, splitBackticks,
                             findNewCommentIds, isReadCommentEntryFresh,
                             pruneExpiredReadComments, truncateText, extractDomain,
                             linkifySegments, sortStoriesBy
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
    backticks-to-monospace.js  transformBackticksToMonospace: walks .commtext text nodes,
                             wraps `inline code` in <code> via splitBackticks
    toggle-all-comments.js   setupToggleAllComments: "toggle all" link on fatitem subtext;
                             gated per-comment "[toggle replies]" link via config flag
    highlight-unread-comments.js setupHighlightUnreadComments: tints td.ind on comments
                             that weren't on the page last time you visited this item
    hover-popup.js           createHoverPopup factory: shared {show, hide, attachDwell}
                             primitive used by both hover features
    user-info-hover.js       setupUserInfoHover: hover any .hnuser for an account-info popup
    item-info-hover.js       setupItemInfoHover: hover an /item?id= link inside .commtext
                             for the cited item's title/score/author/comment-count preview
    linkify-user-about.js    setupLinkifyUserAbout: on /user pages, replaces plain-text
                             URLs / emails in the about cell with clickable <a> elements
    sort-stories.js          setupSortStories: dropdown above table.itemlist on listing
                             pages — sorts by default / time / score / ratio + reverse
    reply-inline.js          setupReplyInline: makes reply/edit/delete links inject the
                             relevant HN form into the comment instead of navigating away
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

Because every module ends up in one shared IIFE scope, top-level `function foo(...)` declarations from different modules collide silently — a later definition overrides an earlier one with the same name, and the symptom (a caller invoking a function with the wrong signature) is hard to debug from runtime alone. `scripts/build.js` runs `checkForDuplicateTopLevelFunctions` over the stripped sources before writing the bundle and fails the build if it finds a collision. **Function names must be unique across `src/features/*.js`.** Local helpers that conceptually overlap should be named explicitly for their input (e.g. `getCurrentItemIdFromUrl` vs `getItemIdFromLinkHref`).

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
  cache:   { <user>: { created, karma, fetchedAt } } }
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

`setupClickIndentToggle()` (in `src/features/click-indent-toggle.js`) walks every `tr.comtr`, adds the `.hn-clickable-indent` class to its `td.ind`, and attaches a click handler that fires the row's native `a.togg`. The CSS adds `cursor: pointer` and a hover box-shadow so the gutter looks clickable.

`setupCollapseRootComment()` (in `src/features/collapse-root-comment.js`) reads each comment's indent level from the width of `td.ind img` (HN renders one indent unit as 40px), passes the level array to the pure helper `findCommentRootIndices` in `src/parsing.js`, and uses the result to inject a `[collapse root]` link into every non-root comment's `span.comhead`. Clicking the link fires the root comment's `a.togg` and scrolls the page back to the (now-collapsed) root so the reader doesn't lose their place. Roots themselves don't get the link.

`transformBackticksToMonospace()` (in `src/features/backticks-to-monospace.js`) walks the text nodes inside every `.commtext` with a `TreeWalker`, calls the pure helper `splitBackticks` (in `src/parsing.js`) to chop each text node into alternating text/code segments at backtick pairs, and replaces the original text node with a `DocumentFragment` of `Text` and `<code>` nodes. The walker rejects text inside existing `<code>`, `<pre>`, and `<a>` elements so we don't mangle pre-formatted code blocks or rewrite link text. Empty backtick pairs (`` `` ``) survive as text — the regex requires at least one non-backtick character between the marks.

`setupToggleAllComments()` (in `src/features/toggle-all-comments.js`) appends a "toggle all" link to the fatitem subtext that fires `a.togg` on every top-level (`indent == 0`) `tr.comtr`. A second, opt-in pass under `TOGGLE_ALL_REPLIES_ENABLED` (in `src/config.js`, default `false`) adds a "[toggle replies]" link to every comment that has direct children. The reply pass is gated because adding a link to every comment scales linearly with thread size — refined-hacker-news warns that it slows page render on items with hundreds of comments.

`setupHighlightUnreadComments({ store })` (in `src/features/highlight-unread-comments.js`) reads the current page's comment IDs (from `tr.comtr[id]`), compares them against the IDs we stored on the previous visit to the same item under `state.readComments[itemId]`, and adds the `.hn-new-comment` class to the `tr.comtr` row of any ID that wasn't there before. (The class lives on the row rather than `td.ind` because the indent cell collapses to ~0 width on root-level comments, leaving any background paint invisible there.) The first visit to a thread doesn't highlight anything (there's nothing to compare against) but does store the ID list so the next visit can. Stale entries (older than `READ_COMMENTS_TTL_MS` = 3 days) are pruned on every item-page load via `store.pruneReadComments`. The pure helpers `findNewCommentIds`, `isReadCommentEntryFresh`, and `pruneExpiredReadComments` live in `src/parsing.js` and are unit-tested.

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
````

## File: script.js
````javascript
// ==UserScript==
// @name         Hacker News - Inline Account Info, Legible Custom Tags and Rating
// @namespace    Violent Monkey
// @version      0.10+864b47b
// @description  Inline account info, custom tags and ratings on comment pages, plus site-wide legibility tweaks (quote rendering, downvote contrast, font/layout cleanup, optional comment-box toggle)
// @author       You
// @match        https://news.ycombinator.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ycombinator.com
// ==/UserScript==

(function () {
"use strict";

// ===== src/config.js =====

// Single backend key holding all user-visible state. Consolidating everything
// here means exports are one JSON.stringify and imports are one assignment,
// and it eliminates the legacy prefix-scan over GM_listValues.
const STATE_KEY = "hn_state";
const STATE_SCHEMA_VERSION = 1;

// Pre-0.4 storage layout. Migration reads these on first run; after that the
// keys are left in place for one version as a rollback safety net.
const LEGACY_RATING_PREFIX = "hn_author_rating_";
const LEGACY_TAGS_PREFIX = "hn_custom_tags_";
const LEGACY_COLOR_PREFIX = "hn_custom_tag_color_";

// How long a cached {created, karma} pair is considered fresh. Karma drifts
// slowly; 6h means a repeat-visitor sees a fully-rendered page with zero
// network requests for users they've already seen today.
const USER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Per-request ceiling. Without it, GM_xmlhttpRequest can hang forever and
// the page never finishes rendering. Firebase's HN endpoint is fast in the
// common case; 8s is generous.
const USER_FETCH_TIMEOUT_MS = 8000;

// How long the highlight-unread feature remembers the comment IDs it
// saw on a previous visit to a given item. Three days matches refined-
// hacker-news's default and means a thread you opened on Friday still
// shows new replies on Monday morning.
const READ_COMMENTS_TTL_MS = 3 * 24 * 60 * 60 * 1000;

// The per-comment "[toggle replies]" link from refined-hacker-news's
// toggle-all-comments-and-replies feature. Default off because adding
// a link to every comment scales linearly with thread size and slows
// page render on items with hundreds of comments. The fatitem-level
// "[toggle all]" link is always on.
const TOGGLE_ALL_REPLIES_ENABLED = false;

// Hover-panel TTL/timeout/dwell. Item content (title, score, comment
// count, etc.) drifts about as slowly as user karma, so a 6h cache is
// enough for the hover preview to feel current without re-fetching the
// same item every time the cursor passes over a link.
const ITEM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Per-request ceiling for the hover fetcher. Same shape as the user
// fetch — without it a hung request would leave the popup stuck on
// "loading…" until the tab is closed.
const ITEM_FETCH_TIMEOUT_MS = 8000;
// How long the cursor must rest on a link before we trigger a fetch.
// Keeps the hover from firing during cursor-fly-over events on long
// pages; short enough to feel responsive when the user actually wants
// the preview.
const HOVER_DWELL_MS = 250;


// ===== src/parsing.js =====

// Pure-logic helpers. No DOM, no GM_* APIs - safe to import under Node.

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_MONTH = 2592000; // 30-day month, matches legacy behavior
const SECONDS_PER_YEAR = 31536000; // 365-day year, matches legacy behavior
function timeSince(createdUnixSeconds, nowUnixSeconds) {
	const seconds = Math.floor(nowUnixSeconds - createdUnixSeconds);
	const years = Math.floor(seconds / SECONDS_PER_YEAR);
	if (years >= 1) return `${years} year${years === 1 ? "" : "s"}`;
	const months = Math.floor(seconds / SECONDS_PER_MONTH);
	if (months >= 1) return `${months} month${months === 1 ? "" : "s"}`;
	const days = Math.floor(seconds / SECONDS_PER_DAY);
	return `${days} day${days === 1 ? "" : "s"}`;
}

// Strip a leading "> " (with any surrounding whitespace) from a quoted-comment
// text node, then trim the result. Used by the quote-rendering pass to set
// the body of a `<p class="quote">` directly. Defensive against non-strings
// because the caller pulls from DOM where `.data` could be missing.
function stripLeadingQuoteMarker(text) {
	if (typeof text !== "string") return "";
	return text.replace(/^\s*>\s*/, "").trim();
}

// For an item page's comment list (top-down DOM order), return for each
// comment the index of its current root (a top-level comment with indent
// level 0), or -1 if the comment is itself a root.
//
// Used by collapse-root-comment to inject a "[collapse root]" link on
// every non-root comment that points at the right root toggle.
function findCommentRootIndices(indentLevels) {
	const out = new Array(indentLevels.length);
	let currentRoot = -1;
	for (let i = 0; i < indentLevels.length; i++) {
		if (indentLevels[i] === 0) {
			currentRoot = i;
			out[i] = -1; // a root has no parent root to collapse to
		} else {
			out[i] = currentRoot;
		}
	}
	return out;
}

// Split a string into alternating { kind: "text" } and { kind: "code" }
// segments based on backtick pairs. Used by the backticks-to-monospace
// pass to walk text nodes and replace them with DOM nodes that render
// `inline code` segments inside <code> elements.
//
// Rules:
//   - A `code` segment is the shortest run between two backticks. Empty
//     pairs (two backticks with nothing between them) are not treated
//     as code; they survive as text.
//   - An unmatched backtick (no closing pair) stays in place inside the
//     surrounding text segment.
//   - The result preserves the original characters exactly when joined
//     back together (text + "`" + code + "`" + text + ...).
function splitBackticks(text) {
	if (typeof text !== "string" || text === "") return [];
	const segments = [];
	const pattern = /`([^`]+)`/g;
	let lastIndex = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index;
		if (start > lastIndex) {
			segments.push({ kind: "text", value: text.slice(lastIndex, start) });
		}
		segments.push({ kind: "code", value: match[1] });
		lastIndex = start + match[0].length;
	}
	if (lastIndex < text.length) {
		segments.push({ kind: "text", value: text.slice(lastIndex) });
	}
	return segments;
}

// Given the comment IDs visible on the current page and the IDs we
// stored on a previous visit to the same item, return the IDs that are
// new (i.e. present now but not before). Used by highlight-unread to
// decide which td.ind cells to mark.
function findNewCommentIds(currentIds, storedIds) {
	const seen = new Set(storedIds || []);
	const out = [];
	for (const id of currentIds || []) {
		if (!seen.has(id)) out.push(id);
	}
	return out;
}

// True iff the entry was last updated within ttlMs of now. A missing
// entry, missing fetchedAt, or stale entry returns false. Used both for
// freshness checks at read time and for cleanup-on-load.
function isReadCommentEntryFresh(entry, nowMs, ttlMs) {
	if (!entry || typeof entry.fetchedAt !== "number") return false;
	return nowMs - entry.fetchedAt <= ttlMs;
}

// Return a new map containing only the entries that are still fresh.
// Used when persisting to drop expired item IDs from storage so the
// readComments slice doesn't grow unboundedly.
function pruneExpiredReadComments(map, nowMs, ttlMs) {
	const out = {};
	for (const [itemId, entry] of Object.entries(map || {})) {
		if (isReadCommentEntryFresh(entry, nowMs, ttlMs)) {
			out[itemId] = entry;
		}
	}
	return out;
}

// Truncate a string to at most maxLen characters, appending an ellipsis
// (…) when the original was longer. Used by the hover popups to keep
// long item-text or user-about previews from overflowing the popup.
//
// Keeps it simple: counts code units, not graphemes. HN content is
// overwhelmingly ASCII/BMP so this is fine in practice.
function truncateText(text, maxLen) {
	if (typeof text !== "string") return "";
	if (typeof maxLen !== "number" || maxLen < 0) return text;
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen)}…`;
}

// Pull the hostname out of an absolute URL, or null if the input isn't
// parseable. Used by the item-info hover to render a "(github.com)"
// badge next to a story's title — same convention HN uses on listing
// pages.
function extractDomain(url) {
	if (typeof url !== "string" || url === "") return null;
	try {
		const host = new URL(url).hostname;
		return host.startsWith("www.") ? host.slice(4) : host;
	} catch {
		return null;
	}
}

// Split a string into alternating { kind: "text" | "url" | "email" }
// segments. Used by linkify-user-about to walk the about-text cell on
// /user pages and replace plain-text URLs / email addresses with
// clickable <a> elements.
//
// In-house instead of pulling in linkifyjs (saves ~12KB of dep we'd
// barely use). The trade-off is that we don't handle weird URL shapes
// (FTP, gopher, scheme-less domains like "example.com") — only http(s)
// and email. That covers the overwhelming majority of HN about-texts.
//
// Trailing sentence punctuation (.,;:!?)]}>) is split back out into a
// following text segment so "see https://example.com." renders as a
// link followed by a literal period.
function linkifySegments(text) {
	if (typeof text !== "string" || text === "") return [];
	const out = [];
	const pattern = /(https?:\/\/[^\s<>"]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;
	const trailing = /[.,;:!?)\]}>]+$/;
	let lastIndex = 0;
	for (const match of text.matchAll(pattern)) {
		const start = match.index;
		if (start > lastIndex) {
			out.push({ kind: "text", value: text.slice(lastIndex, start) });
		}
		const matched = match[0];
		const trail = matched.match(trailing)?.[0] || "";
		const linkBody = trail ? matched.slice(0, -trail.length) : matched;
		const kind = match[1] ? "url" : "email";
		// Defensive: if all that's left after trimming is empty, skip the
		// link entirely and emit the original characters as text.
		if (!linkBody) {
			out.push({ kind: "text", value: matched });
		} else {
			out.push({ kind, value: linkBody });
			if (trail) out.push({ kind: "text", value: trail });
		}
		lastIndex = start + matched.length;
	}
	if (lastIndex < text.length) {
		out.push({ kind: "text", value: text.slice(lastIndex) });
	}
	return out;
}

// Sort a story list by the chosen mode. Stories must carry
// { id, score, commentsCount, defaultRank } at minimum (other fields
// are passed through unchanged). Mode "default" restores HN's
// server-side ranking; "time" newest-first by id; "score" highest
// first; "ratio" highest comments-to-score ratio first (a rough
// "discussion intensity" proxy that surfaces controversial items).
function sortStoriesBy(stories, mode) {
	const sorted = (stories || []).slice();
	switch (mode) {
		case "time":
			sorted.sort((a, b) => Number(b.id) - Number(a.id));
			break;
		case "score":
			sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
			break;
		case "ratio":
			sorted.sort((a, b) => {
				const ra = (a.commentsCount || 0) / Math.max(a.score || 1, 1);
				const rb = (b.commentsCount || 0) / Math.max(b.score || 1, 1);
				return rb - ra;
			});
			break;
		default: // "default"
			sorted.sort((a, b) => (a.defaultRank || 0) - (b.defaultRank || 0));
			break;
	}
	return sorted;
}

// Parse a raw comma-separated tag string into a canonical list: each name
// trimmed, empty entries dropped, duplicates (first-wins) removed. Used by
// the inline tag input so duplicates never reach setUserTags.
function parseTagInput(text) {
	const seen = new Set();
	const out = [];
	for (const part of (text || "").split(",")) {
		const name = part.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}


// ===== src/state.js =====

// Storage and pure state mutators. No DOM, no GM_* APIs - safe to import
// under Node. The browser bootstrap (main.js) wraps the GM_* APIs into the
// {get, set, list} backend that createStore expects.
function emptyState() {
	return {
		schemaVersion: STATE_SCHEMA_VERSION,
		ratings: {},
		tags: {}, // username -> [tagName, ...]
		colors: {}, // tagName  -> { bgColor, textColor }
		cache: {}, // username -> { created, karma, fetchedAt }
		readComments: {}, // itemId -> { ids: [...], fetchedAt }
		itemCache: {}, // itemId -> { title, url, by, score, descendants, time, text, type, fetchedAt }
	};
}

// Factory over a { get(key), set(key, value) } backend. Loads the consolidated
// state on first access; mutations are read-modify-write (re-read disk, apply
// the mutation, write back) so writes from other tabs that landed since the
// last read are absorbed instead of clobbered. The pre-RMW design was racy:
// at page load every tab the user had cmd-clicked open from the front page
// would call setReadComments synchronously with a stale in-memory snapshot,
// and the last writer's snapshot wiped everyone else's entry. The cross-tab
// listener can't fix that after the fact — it only invalidates the in-memory
// cache, it doesn't merge in-flight writes.
function createStore(backend) {
	let state = null;

	const readDisk = () => {
		const raw = backend.get(STATE_KEY);
		if (raw === undefined || raw === null || raw === "") {
			return emptyState();
		}
		try {
			const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
			return { ...emptyState(), ...parsed };
		} catch (_err) {
			return emptyState();
		}
	};

	const load = () => {
		if (state !== null) return state;
		state = readDisk();
		return state;
	};

	// Apply a mutation against the latest disk state. The mutator runs on
	// a fresh read of the blob, then we write the whole thing back; this
	// absorbs concurrent writes from other tabs as long as our get-then-set
	// pair isn't preempted (GM_getValue and GM_setValue are synchronous in
	// Tampermonkey/Violentmonkey, so the race window is essentially zero
	// per call site). The mutator may return `false` to signal "no change,
	// don't write" — used by pruneReadComments when nothing's stale.
	const mutate = (mutator) => {
		const fresh = readDisk();
		const result = mutator(fresh);
		if (result !== false) {
			backend.set(STATE_KEY, JSON.stringify(fresh));
		}
		state = fresh;
	};

	const hydrateTag = (tagName) => {
		const color = load().colors[tagName] || {
			bgColor: undefined,
			textColor: undefined,
		};
		return {
			value: tagName,
			bgColor: color.bgColor,
			textColor: color.textColor,
		};
	};

	return {
		getRating(username) {
			return load().ratings[username] || 0;
		},
		setRating(username, rating) {
			mutate((s) => {
				s.ratings[username] = rating;
			});
		},
		getUserTags(username) {
			const names = load().tags[username] || [];
			return names.map(hydrateTag);
		},
		setUserTags(username, tags) {
			mutate((s) => {
				s.tags[username] = tags.map((t) => t.value);
				// Record any color info that came along with the tag. If a tag
				// already has a color, a caller-supplied color overrides it
				// (setTagColor is the explicit "update the shared color"
				// operation; passing a color here is how new tags get their
				// initial color).
				for (const t of tags) {
					if (t.bgColor && t.textColor) {
						s.colors[t.value] = {
							bgColor: t.bgColor,
							textColor: t.textColor,
						};
					}
				}
			});
		},
		getTagColor(tagName) {
			return load().colors[tagName] || null;
		},
		setTagColor(tagName, { bgColor, textColor }) {
			mutate((s) => {
				s.colors[tagName] = { bgColor, textColor };
			});
		},
		// User-data cache. The `now` and `ttlMs` arguments are injected so tests
		// can control time without mocking the clock. The browser call site
		// passes Date.now() and a hardcoded TTL (USER_CACHE_TTL_MS in config).
		// `data` is treated as opaque so future call sites (e.g. the hover
		// panel adding `about`) don't need to extend this method's signature.
		getCachedUser(username, nowMs, ttlMs) {
			const entry = load().cache[username];
			if (!entry) return null;
			if (nowMs - entry.fetchedAt > ttlMs) return null;
			const { fetchedAt: _f, ...rest } = entry;
			return rest;
		},
		setCachedUser(username, data, nowMs) {
			mutate((s) => {
				s.cache[username] = { ...data, fetchedAt: nowMs };
			});
		},
		// Item-info cache for the hover-panel feature. Stores a digest
		// (title/url/by/score/descendants/time/text/type) of items the
		// user has hovered, so subsequent hovers resolve from local
		// state without re-hitting the Firebase API.
		getCachedItem(itemId, nowMs, ttlMs) {
			const entry = load().itemCache?.[itemId];
			if (!entry) return null;
			if (nowMs - entry.fetchedAt > ttlMs) return null;
			const { fetchedAt: _f, ...digest } = entry;
			return digest;
		},
		setCachedItem(itemId, digest, nowMs) {
			mutate((s) => {
				s.itemCache[itemId] = { ...digest, fetchedAt: nowMs };
			});
		},

		// Read-comments cache for highlight-unread. Returns the stored
		// entry { ids, fetchedAt } if it exists, else null. The browser
		// caller decides what to do with a missing entry (highlight
		// nothing, since this is a first visit) vs a stale one (treat as
		// missing — pruneReadComments below drops stale entries on every
		// item-page load so this is mostly a belt-and-braces check).
		getReadComments(itemId) {
			const entry = load().readComments?.[itemId];
			if (!entry) return null;
			return { ids: entry.ids || [], fetchedAt: entry.fetchedAt || 0 };
		},
		// Replace the stored ID list for an item. Always overwrites — the
		// caller decides whether to merge with previous ids or replace them.
		// (We replace, since a comment that's no longer on the page must
		// have been deleted/flagged, and there's no value in tracking it.)
		setReadComments(itemId, ids, nowMs) {
			mutate((s) => {
				s.readComments[itemId] = { ids: ids.slice(), fetchedAt: nowMs };
			});
		},
		// Drop expired entries from the readComments map. Run on every
		// item-page load so a user who reads-then-never-revisits doesn't
		// accumulate dead entries forever.
		pruneReadComments(nowMs, ttlMs) {
			mutate((s) => {
				const before = s.readComments;
				const after = pruneExpiredReadComments(before, nowMs, ttlMs);
				if (Object.keys(after).length === Object.keys(before).length) {
					return false;
				}
				s.readComments = after;
			});
		},
		replaceTagsAndColors(tagsByUser, colorsByTag) {
			mutate((s) => {
				s.tags = tagsByUser;
				s.colors = colorsByTag;
			});
		},
		// Expose raw state for export and for callers that need to iterate.
		_snapshot() {
			return load();
		},
		// Drop the in-memory cache so the next read reloads from the backend.
		// Used when another tab writes to the same key. Mutations don't need
		// this because they always re-read disk before writing.
		_invalidate() {
			state = null;
		},
	};
}

// One-shot migration from the pre-rework key layout:
//   hn_author_rating_<user>   -> int
//   hn_custom_tags_<user>     -> JSON array of {value, bgColor, textColor}
//   hn_custom_tag_color_<tag> -> JSON {bgColor, textColor}
// to the single consolidated `hn_state` key. Legacy keys are left in place for
// one version so a rollback of the script doesn't lose data. The migration is
// idempotent and a no-op when hn_state already exists.
//
// Backend must additionally support list(): string[].
function migrateLegacyKeys(backend) {
	if (backend.get(STATE_KEY) !== undefined) return;
	if (typeof backend.list !== "function") return;

	const keys = backend.list();
	const hasLegacy = keys.some(
		(k) =>
			k.startsWith(LEGACY_RATING_PREFIX) ||
			k.startsWith(LEGACY_TAGS_PREFIX) ||
			k.startsWith(LEGACY_COLOR_PREFIX),
	);
	if (!hasLegacy) return;

	const state = emptyState();

	const parseJSON = (raw, fallback) => {
		try {
			return typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch (_err) {
			return fallback;
		}
	};

	for (const key of keys) {
		if (key.startsWith(LEGACY_RATING_PREFIX)) {
			const username = key.slice(LEGACY_RATING_PREFIX.length);
			const value = backend.get(key);
			const rating = typeof value === "number" ? value : Number(value);
			if (!Number.isNaN(rating)) state.ratings[username] = rating;
		} else if (key.startsWith(LEGACY_COLOR_PREFIX)) {
			const tagName = key.slice(LEGACY_COLOR_PREFIX.length);
			const color = parseJSON(backend.get(key), null);
			if (color?.bgColor) {
				state.colors[tagName] = {
					bgColor: color.bgColor,
					textColor: color.textColor || "black",
				};
			}
		}
	}

	// Tags are processed after colors so legacy tag entries can contribute
	// their embedded color info without overwriting the explicit color key.
	for (const key of keys) {
		if (!key.startsWith(LEGACY_TAGS_PREFIX)) continue;
		const username = key.slice(LEGACY_TAGS_PREFIX.length);
		const legacyTags = parseJSON(backend.get(key), []);
		if (!Array.isArray(legacyTags)) continue;
		const tagNames = [];
		for (const t of legacyTags) {
			if (!t || typeof t.value !== "string") continue;
			tagNames.push(t.value);
			if (!state.colors[t.value] && t.bgColor) {
				state.colors[t.value] = {
					bgColor: t.bgColor,
					textColor: t.textColor || "black",
				};
			}
		}
		state.tags[username] = tagNames;
	}

	backend.set(STATE_KEY, JSON.stringify(state));
}

// Accepts either the normalized export shape ({customTags, users}) or the
// legacy flat-key dump ({hn_author_rating_<u>: N, hn_custom_tags_<u>: "...", ...})
// and produces a consolidated state object. The cache slot is left empty -
// import is a user-data operation, not a cache restore.
function parseImport(data) {
	const state = emptyState();
	if (!data || typeof data !== "object") return state;

	// Normalized format.
	if (data.customTags || data.users) {
		if (data.customTags && typeof data.customTags === "object") {
			for (const [tagName, info] of Object.entries(data.customTags)) {
				if (info?.bgColor) {
					state.colors[tagName] = {
						bgColor: info.bgColor,
						textColor: info.textColor || "black",
					};
				}
			}
		}
		if (data.users && typeof data.users === "object") {
			for (const [username, userData] of Object.entries(data.users)) {
				if (!userData) continue;
				if (typeof userData.rating === "number" && userData.rating !== 0) {
					state.ratings[username] = userData.rating;
				}
				if (Array.isArray(userData.tags)) {
					state.tags[username] = userData.tags.slice();
				}
			}
		}
		return state;
	}

	// Legacy flat-key format - mirrors migrateLegacyKeys but reads from a plain
	// object instead of a backend.
	const parseJSON = (raw, fallback) => {
		try {
			return typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch (_err) {
			return fallback;
		}
	};
	for (const [key, value] of Object.entries(data)) {
		if (key.startsWith(LEGACY_RATING_PREFIX)) {
			const username = key.slice(LEGACY_RATING_PREFIX.length);
			const rating = typeof value === "number" ? value : Number(value);
			if (!Number.isNaN(rating)) state.ratings[username] = rating;
		} else if (key.startsWith(LEGACY_COLOR_PREFIX)) {
			const tagName = key.slice(LEGACY_COLOR_PREFIX.length);
			const color = parseJSON(value, null);
			if (color?.bgColor) {
				state.colors[tagName] = {
					bgColor: color.bgColor,
					textColor: color.textColor || "black",
				};
			}
		}
	}
	for (const [key, value] of Object.entries(data)) {
		if (!key.startsWith(LEGACY_TAGS_PREFIX)) continue;
		const username = key.slice(LEGACY_TAGS_PREFIX.length);
		const legacyTags = parseJSON(value, []);
		if (!Array.isArray(legacyTags)) continue;
		const names = [];
		for (const t of legacyTags) {
			if (!t || typeof t.value !== "string") continue;
			names.push(t.value);
			if (!state.colors[t.value] && t.bgColor) {
				state.colors[t.value] = {
					bgColor: t.bgColor,
					textColor: t.textColor || "black",
				};
			}
		}
		state.tags[username] = names;
	}
	return state;
}

// Normalized export shape. Stable across versions so old backups stay
// interoperable. Cache is intentionally dropped - it's perf scaffolding,
// not user data, and shouldn't bloat export files.
function stateToExport(state) {
	const customTags = {};
	for (const [tagName, info] of Object.entries(state.colors || {})) {
		customTags[tagName] = {
			bgColor: info.bgColor,
			textColor: info.textColor,
		};
	}
	const users = {};
	const allUsernames = new Set([
		...Object.keys(state.ratings || {}),
		...Object.keys(state.tags || {}),
	]);
	for (const username of allUsernames) {
		const rating = state.ratings[username] || 0;
		const tags = state.tags[username] || [];
		if (rating === 0 && tags.length === 0) continue;
		users[username] = { rating, tags: tags.slice() };
	}
	return { customTags, users };
}

// Returns a new state with every user's `oldName` tag replaced by `newName`
// and the color entry moved accordingly. If `newName` already exists as a
// tag (in colors or any user's tag list), this becomes a merge: the
// destination's color is kept, the source color is dropped, and any user
// carrying both ends up with one entry (first-occurrence wins, so the
// relative order of other tags is preserved). Empty / whitespace-only
// `newName`, a no-op rename, or a rename of a tag that isn't present
// anywhere returns the same reference.
function renameTagInState(state, oldName, newName) {
	const trimmed = typeof newName === "string" ? newName.trim() : "";
	if (!trimmed || trimmed === oldName) return state;

	const tags = state.tags || {};
	const colors = state.colors || {};
	const inColors = Object.hasOwn(colors, oldName);
	const inTags = Object.values(tags).some((list) => list.includes(oldName));
	if (!inColors && !inTags) return state;

	const destExists = Object.hasOwn(colors, trimmed);

	const newTags = {};
	for (const [user, list] of Object.entries(tags)) {
		if (!list.includes(oldName)) {
			newTags[user] = list.slice();
			continue;
		}
		const renamed = list.map((t) => (t === oldName ? trimmed : t));
		const seen = new Set();
		newTags[user] = renamed.filter((t) => {
			if (seen.has(t)) return false;
			seen.add(t);
			return true;
		});
	}

	const newColors = { ...colors };
	delete newColors[oldName];
	if (!destExists && inColors) {
		newColors[trimmed] = colors[oldName];
	}

	return { ...state, tags: newTags, colors: newColors };
}

// Returns a new state with `tagName` removed from every user's tag list
// and from the colors map. No-op (same reference) if the tag isn't
// present anywhere.
function removeTagInState(state, tagName) {
	const tags = state.tags || {};
	const colors = state.colors || {};
	const inColors = Object.hasOwn(colors, tagName);
	const inTags = Object.values(tags).some((list) => list.includes(tagName));
	if (!inColors && !inTags) return state;

	const newTags = {};
	for (const [user, list] of Object.entries(tags)) {
		newTags[user] = list.includes(tagName)
			? list.filter((t) => t !== tagName)
			: list.slice();
	}

	const newColors = { ...colors };
	delete newColors[tagName];

	return { ...state, tags: newTags, colors: newColors };
}

// Distinct-users-per-tag count. Includes tags that appear only in the
// colors map (orphans) with a count of 0.
function countsFromState(state) {
	const tags = state.tags || {};
	const colors = state.colors || {};
	const counts = {};
	for (const tagName of Object.keys(colors)) counts[tagName] = 0;
	for (const list of Object.values(tags)) {
		const seen = new Set();
		for (const t of list) {
			if (seen.has(t)) continue;
			seen.add(t);
			counts[t] = (counts[t] || 0) + 1;
		}
	}
	return counts;
}


// ===== src/dom.js =====

// Tiny element factory. Accepts text content and event handlers but
// intentionally does NOT accept innerHTML - all text goes through
// textContent so it can't become an XSS foothold even if we later pass a
// username or tag name through it.
function h(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === "class") node.className = v;
		else if (k === "text") node.textContent = v;
		else if (k.startsWith("on") && typeof v === "function") {
			node.addEventListener(k.slice(2).toLowerCase(), v);
		} else {
			node[k] = v;
		}
	}
	for (const child of children) {
		if (child) node.appendChild(child);
	}
	return node;
}
function findCommentParent(usernameEl) {
	return usernameEl.closest(".comhead") || usernameEl.parentElement;
}
function isItemPage() {
	return window.location.pathname === "/item";
}


// ===== src/styles.js =====

// CSS for the userscript: site-wide legibility tweaks plus our injected UI.
// Tokens (`--colour-hn-orange`, `--gutter`, `--border-radius`) are declared
// on `:root` so feature-specific rules added later can reuse them.
//
// The site-wide block is adapted from
// https://github.com/mgladdish/website-customisations.
const STYLES = `
    :root {
      --colour-hn-orange: #ff6600;
      --colour-hn-orange-pale: rgba(255, 102, 0, 0.05);
      --gutter: 0.5rem;
      --border-radius: 3px;
    }

    /* Site-wide legibility tweaks, adapted from
       https://github.com/mgladdish/website-customisations. */
    html, body, td, .title, .comment, .default {
      font-family: "Verdana", "Arial", sans-serif;
    }
    html, body { margin-top: 0; }
    body { padding: 0; margin: 0; }
    body, td, .title, .pagetop, .comment { font-size: 1rem; }

    html[op="news"] .title,
    .votelinks,
    .fatitem .title + .votelinks { vertical-align: inherit; }

    .comment-tree .votelinks,
    html[op="threads"] .votelinks,
    html[op="item"] .votelinks,
    xhtml[op="newcomments"] .votelinks { vertical-align: top; }

    span.titleline {
      font-size: 1rem;
      margin-top: var(--gutter);
      margin-bottom: var(--gutter);
      display: block;
    }
    html[op="item"] span.titleline { font-size: 1.2rem; }

    .rank { display: none; }

    html[op="news"]        #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="newest"]      #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="ask"]         #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="newcomments"] #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="shownew"]     #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="submitted"]   #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="favorites"]   #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2),
    html[op="front"]       #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2),
    html[op="show"]        #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2) {
      margin-left: var(--gutter);
    }

    .sitebit.comhead { margin-left: var(--gutter); }
    .subtext, .subline { font-size: 0.75rem; }

    #hnmain {
      width: 100%;
      background-color: white;
    }
    #hnmain > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) {
      padding: var(--gutter);
    }
    #hnmain > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) {
      padding-right: var(--gutter) !important;
    }

    .comment, .toptext { max-width: 40em; }
    .toptext, a { color: black; }
    a:visited { color: #4c2c92; }
    a:hover { text-decoration: underline; }

    input { padding: var(--gutter); }
    input, textarea {
      background-color: white;
      border: 2px solid var(--colour-hn-orange);
      border-radius: var(--border-radius);
    }
    input[type="button"], input[type="submit"] { cursor: pointer; }

    .downvoted {
      background-color: rgb(245, 245, 245);
      border-radius: var(--border-radius);
      padding: 6px;
    }
    .downvoted .commtext {
      color: black;
      font-size: smaller;
    }

    .quote {
      border-left: 3px solid var(--colour-hn-orange);
      padding: 6px 6px 6px 9px;
      font-style: italic;
      background-color: var(--colour-hn-orange-pale);
      border-radius: var(--border-radius);
    }

    .hidden { display: none; }

    .showComment a,
    .hideComment,
    .hideComment:link,
    .hideComment:visited {
      color: var(--colour-hn-orange);
      text-decoration: underline;
    }
    .hideComment { margin-left: var(--gutter); }

    /* Our own injected UI (account info, custom tags, ratings, toolbar,
       tag-management overlay). The site-wide input padding rule would
       otherwise inflate our compact fields, so the inputs below carry
       tighter padding overrides - but the orange border + radius from
       the site-wide rule are kept on purpose. */

    .hn-post-layout {
      display: grid;
      grid-template-columns: 1fr auto;
      margin: 5px 0;
      width: 100%;
    }
    .comment { padding-top: 10px; }
    /* Hide the stray <br>s HN puts above comment bodies.
       :has() is supported in all current evergreen browsers. */
    br:has(+ div.comment) { display: none; }
    .hn-username {
      font-weight: 700;
      font-size: 1.15em;
      margin-right: 5px;
    }
    .hn-main-row {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      padding-bottom: 2px;
      grid-column: 1;
    }
    .hn-info {
      font-size: 0.8em;
      margin-left: 4px;
      white-space: nowrap;
    }
    .hn-info-pending { opacity: 0.4; }
    .hn-tag-container {
      display: flex;
      flex-direction: column;
      grid-column: 2;
      padding-left: 10px;
      margin-left: 10px;
    }
    .hn-tag-group {
      display: flex;
      flex-direction: column;
    }
    .hn-tag {
      padding: 3px 6px;
      margin-bottom: 3px;
      margin-right: 5px;
      border-radius: 5px;
      font-size: 0.9em;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: fit-content;
    }
    .hn-tag-text { margin-right: 5px; }
    .hn-tag-icons {
      display: flex;
      align-items: center;
    }
    .hn-tag-icon {
      cursor: pointer;
      margin-left: 3px;
      font-size: 0.8em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.3);
    }
    .hn-tag-icon:hover { background-color: rgba(255, 255, 255, 0.6); }
    .hn-tag-input {
      font-size: 0.8em;
      margin-left: 4px;
      width: 250px;
      height: 30px;
      line-height: 30px;
      display: inline-block;
      vertical-align: middle;
      /* Tighter padding than the site-wide rule so the field stays
         compact; the orange border + radius from the site-wide rule
         are kept by design. */
      padding: 0 4px;
    }
    .hn-rating-container {
      margin-left: 4px;
      white-space: nowrap;
      display: flex;
      align-items: center;
    }
    .hn-rating-btn {
      font-size: 0.6em;
      padding: 1px 2px;
      margin-right: 2px;
    }
    .hn-rating-display {
      font-size: 1.3em;
      padding: 0 4px 0 2px;
      color: #575F94;
      font-weight: 700;
    }
    .hn-toolbar {
      position: fixed;
      top: 10px;
      right: 10px;
      background-color: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: 4px;
      padding: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      z-index: 9999;
      display: flex;
      align-items: center;
    }
    .hn-drag-handle {
      width: 12.5px;
      height: 100%;
      background-color: rgba(255, 102, 0, 0.5);
      cursor: move;
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      border-top-left-radius: 3px;
      border-bottom-left-radius: 3px;
    }
    .hn-toolbar-buttons {
      display: flex;
      padding-left: 8px;
    }
    .hn-toolbar-btn {
      background-color: var(--colour-hn-orange);
      color: white;
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      margin: 0 5px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-toolbar-btn:hover { background-color: #ff8533; }
    .hn-tagmgr-catcher {
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: transparent;
    }
    .hn-tagmgr-overlay {
      position: fixed;
      top: 5vh;
      right: 0;
      width: 33vw;
      min-width: 320px;
      height: 90vh;
      background-color: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: 4px 0 0 4px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      font-size: 0.9em;
    }
    .hn-tagmgr-header {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: bold;
    }
    .hn-tagmgr-header-count { color: #888; font-weight: normal; }
    .hn-tagmgr-controls {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .hn-tagmgr-filter {
      width: 100%;
      padding: 4px 6px;
      box-sizing: border-box;
    }
    .hn-tagmgr-sort { display: flex; gap: 6px; }
    .hn-tagmgr-sort-btn {
      font-size: 0.85em;
      padding: 2px 8px;
      background: #f4f4f4;
      border: 1px solid #ccc;
      border-radius: 3px;
      cursor: pointer;
    }
    .hn-tagmgr-sort-btn.active {
      background: var(--colour-hn-orange);
      color: white;
      border-color: var(--colour-hn-orange);
    }
    .hn-tagmgr-list {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 4px 0;
    }
    .hn-tagmgr-row {
      display: flex;
      align-items: center;
      padding: 4px 12px;
      gap: 8px;
      border-left: 2px solid transparent;
    }
    .hn-tagmgr-row.dirty { border-left-color: var(--colour-hn-orange); }
    .hn-tagmgr-row.removed .hn-tagmgr-name { text-decoration: line-through; }
    .hn-tagmgr-row.removed { opacity: 0.6; }
    .hn-tagmgr-swatch {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      flex: 0 0 12px;
      border: 1px solid rgba(0,0,0,0.1);
    }
    .hn-tagmgr-name {
      flex: 1 1 auto;
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: bold;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hn-tagmgr-name-input {
      flex: 1 1 auto;
      font-size: 1em;
      padding: 1px 5px;
    }
    .hn-tagmgr-count {
      flex: 0 0 auto;
      font-size: 0.85em;
      color: #666;
      min-width: 2em;
      text-align: right;
    }
    .hn-tagmgr-count.zero { color: #bbb; }
    .hn-tagmgr-icons { display: flex; gap: 4px; flex: 0 0 auto; }
    .hn-tagmgr-icon {
      cursor: pointer;
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-size: 0.9em;
    }
    .hn-tagmgr-icon:hover { background: #eee; }
    .hn-tagmgr-footer {
      padding: 8px 12px;
      border-top: 1px solid #eee;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .hn-tagmgr-btn {
      background: white;
      border: 1px solid #ccc;
      border-radius: 3px;
      padding: 5px 14px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-tagmgr-btn.primary {
      background: var(--colour-hn-orange);
      color: white;
      border-color: var(--colour-hn-orange);
    }
    .hn-tagmgr-btn:hover { filter: brightness(0.95); }

    /* Refined-HN-derived comment-tree tweaks (PR-2). HN's site-wide CSS
       sets .commtext.cdd to grey-on-grey for dead comments; we recolour
       it to a faint red so showdead users can spot them at a glance.
       The indent border puts a 1px shadow on the indent gutter so reply
       depth is visible without counting indents. <pre> and inline
       <code> get a subtle grey background to look like code, matching
       how most readers expect monospace text to render. */
    .commtext.cdd,
    .commtext.cdd * {
      color: #d89899 !important;
    }
    tr.comtr td.ind {
      box-shadow: inset -1px 0 #ccc;
    }
    .hn-clickable-indent {
      cursor: pointer;
    }
    .hn-clickable-indent:hover {
      box-shadow: inset -1px 0 #888;
    }
    div.comment span.commtext pre,
    div.comment span.commtext *:not(pre) > code {
      background: #e4e4e4;
      border-radius: var(--border-radius);
    }
    div.comment span.commtext *:not(pre) > code {
      padding: 0 4px;
      display: inline-block;
    }

    /* OP highlight: the [op] suffix is appended as a text node by
       user-render so the marker is grep-able in the DOM, and the
       .hn-op class colours the whole username (including the suffix)
       in HN orange. */
    .hn-op {
      color: var(--colour-hn-orange) !important;
    }

    /* The collapse-root link sits inline next to "parent | next" in the
       comhead. Match HN's existing comhead link size so it doesn't
       overpower the row. */
    a.hn-collapse-root,
    a.hn-collapse-root:link,
    a.hn-collapse-root:visited {
      color: var(--colour-hn-orange);
      margin-left: 4px;
    }
    a.hn-collapse-root:hover {
      text-decoration: underline;
    }

    /* Highlight-unread tints every cell of a new comment's row so the
       marker stays visible regardless of indent depth. (Painting only
       td.ind leaves root comments unmarked because their indent cell
       collapses to ~0 width.) */
    .hn-new-comment > td {
      background-color: rgba(255, 102, 0, 0.12);
    }

    /* "[toggle all]" sits next to the existing fatitem subtext links;
       "[toggle replies]" (when enabled) lives in each comment's comhead
       like "[collapse root]". Same orange/underline treatment as the
       collapse-root link for visual consistency. */
    a.hn-toggle-all,
    a.hn-toggle-all:link,
    a.hn-toggle-all:visited,
    a.hn-toggle-replies,
    a.hn-toggle-replies:link,
    a.hn-toggle-replies:visited {
      color: var(--colour-hn-orange);
      margin-left: 4px;
    }
    a.hn-toggle-all:hover,
    a.hn-toggle-replies:hover {
      text-decoration: underline;
    }

    /* PR-4: shared hover-popup primitive used by user-info-hover and
       item-info-hover. Fixed-position-via-absolute (anchored relative
       to scrollY/scrollX in the JS) so it floats above page content
       without joining the document flow. The .hidden rule is shared
       with the comment-box-toggle. */
    .hn-hover-popup {
      position: absolute;
      max-width: 360px;
      background: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: var(--border-radius);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      padding: 8px 10px;
      font-size: 0.85em;
      z-index: 10000;
      pointer-events: none;
    }
    .hn-hover-popup-title {
      font-size: 1em;
      margin-bottom: 4px;
    }
    .hn-hover-popup-domain {
      color: #888;
      font-weight: normal;
    }
    .hn-hover-popup-meta {
      color: #555;
      margin-bottom: 4px;
    }
    .hn-hover-popup-body {
      color: #333;
      margin-top: 4px;
      max-height: 8em;
      overflow: hidden;
    }

    /* PR-5: sort-stories dropdown sits above table.itemlist on listing
       pages. Match HN's subtext font size so it doesn't dominate the
       layout. */
    .hn-sort-bar {
      padding: 6px 10px;
      font-size: 0.8em;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .hn-sort-select {
      padding: 1px 4px;
      font-size: inherit;
    }
    a.hn-sort-reverse,
    a.hn-sort-reverse:link,
    a.hn-sort-reverse:visited {
      color: var(--colour-hn-orange);
      margin-left: 4px;
    }
    a.hn-sort-reverse:hover {
      text-decoration: underline;
    }

    /* reply-inline injects HN's own reply/edit/delete <form> into
       div.reply with this class so we can give it some top margin
       (otherwise it bumps right up against the parent comment). */
    .hn-injected-form {
      margin-top: 10px;
    }
    .hn-reply-loader {
      color: #888;
      font-size: 0.85em;
    }
  `;


// ===== src/api.js =====

// HN Firebase API access. Browser-side only - imports the GM_xmlhttpRequest
// global at call time so this module never references it at import time
// (so the build artifact, which inlines this, doesn't crash if loaded
// outside a userscript runtime).

// Factory over a store. Returns { fetchUser, fetchItem } where each
// resolves to a digest object or null. Both are protected by:
//   - A persistent cache (store.getCachedUser/getCachedItem) with a TTL
//     declared in config.
//   - An in-memory inflight Map that dedupes concurrent fetches for
//     the same key.
//   - A per-request timeout so a hung request can't leave a popup
//     stuck on "loading…" forever.
function createApi({ store }) {
	const userInflight = new Map();
	const itemInflight = new Map();

	function fetchUser(username) {
		const cached = store.getCachedUser(username, Date.now(), USER_CACHE_TTL_MS);
		if (cached) return Promise.resolve(cached);
		if (userInflight.has(username)) return userInflight.get(username);

		const promise = new Promise((resolve) => {
			GM_xmlhttpRequest({
				method: "GET",
				url: `https://hacker-news.firebaseio.com/v0/user/${username}.json`,
				timeout: USER_FETCH_TIMEOUT_MS,
				onload: (response) => {
					if (response.status !== 200 || !response.responseText) {
						resolve(null);
						return;
					}
					try {
						const data = JSON.parse(response.responseText);
						if (data && typeof data.created === "number") {
							store.setCachedUser(
								username,
								{
									created: data.created,
									karma: data.karma,
									about: data.about || "",
								},
								Date.now(),
							);
							resolve({
								created: data.created,
								karma: data.karma,
								about: data.about || "",
							});
						} else {
							resolve(null);
						}
					} catch (_err) {
						resolve(null);
					}
				},
				onerror: () => resolve(null),
				ontimeout: () => resolve(null),
			});
		}).finally(() => {
			userInflight.delete(username);
		});
		userInflight.set(username, promise);
		return promise;
	}

	function fetchItem(itemId) {
		const cached = store.getCachedItem(itemId, Date.now(), ITEM_CACHE_TTL_MS);
		if (cached) return Promise.resolve(cached);
		if (itemInflight.has(itemId)) return itemInflight.get(itemId);

		const promise = new Promise((resolve) => {
			GM_xmlhttpRequest({
				method: "GET",
				url: `https://hacker-news.firebaseio.com/v0/item/${itemId}.json`,
				timeout: ITEM_FETCH_TIMEOUT_MS,
				onload: (response) => {
					if (response.status !== 200 || !response.responseText) {
						resolve(null);
						return;
					}
					try {
						const data = JSON.parse(response.responseText);
						if (!data || typeof data.id !== "number") {
							resolve(null);
							return;
						}
						const digest = {
							title: data.title || "",
							url: data.url || "",
							by: data.by || "",
							score: typeof data.score === "number" ? data.score : 0,
							descendants:
								typeof data.descendants === "number" ? data.descendants : 0,
							time: typeof data.time === "number" ? data.time : 0,
							text: data.text || "",
							type: data.type || "story",
						};
						store.setCachedItem(itemId, digest, Date.now());
						resolve(digest);
					} catch (_err) {
						resolve(null);
					}
				},
				onerror: () => resolve(null),
				ontimeout: () => resolve(null),
			});
		}).finally(() => {
			itemInflight.delete(itemId);
		});
		itemInflight.set(itemId, promise);
		return promise;
	}

	return { fetchUser, fetchItem };
}


// ===== src/features/legibility.js =====

// Site-wide legibility passes. Run on every HN page: restyle downvoted
// comments and rewrite ">"-prefixed text into styled quote blocks.



// HN comment styling: any .commtext that lacks the .c00 class has been
// downvoted (HN drops the class to express grey-on-grey). We tag the
// surrounding .comment so our CSS can restore black text on a faint-grey
// background.
function applyDownvotedClass() {
	for (const el of document.querySelectorAll(".commtext")) {
		if (!el.classList.contains("c00")) {
			el.parentElement?.classList.add("downvoted");
		}
	}
}

// Find <i>/<p>/<span> whose first text-node child starts with ">" and
// re-render it as a styled <p class="quote"> block. Two shapes seen in
// HN markup:
//   1. The first text node contains both the marker and the quoted body
//      (e.g. <i>&gt; quoted text</i>) -> strip the marker, set the body
//      as text on the new <p>.
//   2. The first text node is just the marker, with the quoted content
//      sitting in the next sibling (e.g. <i>&gt; <a>link</a></i>) -> move
//      the sibling into the <p> so any nested elements survive.
function transformQuotes() {
	const candidates = document.querySelectorAll("i, p, span");
	for (const el of candidates) {
		if (el.classList.contains("quote")) continue;
		const textNode = Array.from(el.childNodes).find(
			(n) => n.nodeType === Node.TEXT_NODE,
		);
		if (!textNode?.data.trimStart().startsWith(">")) continue;

		const p = h("p", { class: "quote" });
		if (textNode.data.trim() === ">") {
			const next = textNode.nextSibling;
			if (next) p.appendChild(next);
		} else {
			p.textContent = stripLeadingQuoteMarker(textNode.data);
		}
		textNode.replaceWith(p);
	}
}


// ===== src/features/comment-box-toggle.js =====

// Item pages: hide the comment-submit form behind a "show comment box"
// link. Returning early on missing nodes covers locked threads and
// logged-out views, where the form (and possibly the row) isn't there.
function setupCommentBoxToggle() {
	const addComment = document.querySelector(".fatitem tr:last-of-type");
	const commentForm = document.querySelector("form[action='comment']");
	if (!addComment || !commentForm) return;

	addComment.classList.add("hidden");

	const showLink = h("a", {
		href: "#",
		text: "show comment box",
	});
	const showRow = h("tr", { class: "showComment" }, [
		h("td", { colSpan: 2 }),
		h("td", {}, [showLink]),
	]);
	const toggle = (e) => {
		e.preventDefault();
		showRow.classList.toggle("hidden");
		addComment.classList.toggle("hidden");
	};
	showLink.addEventListener("click", toggle);

	const hideLink = h("a", {
		href: "#",
		class: "hideComment",
		text: "hide comment box",
		onclick: toggle,
	});

	addComment.parentNode.insertBefore(showRow, addComment);
	commentForm.append(hideLink);
}


// ===== src/features/click-indent-toggle.js =====

// Make the empty indent column on each comment a click target that fires
// HN's native toggle (collapse/expand). Cheap to add, big quality-of-life
// win on long threads — there's a lot of indent gutter to click.
function setupClickIndentToggle() {
	for (const row of document.querySelectorAll("tr.comtr")) {
		const indentCell = row.querySelector("td.ind");
		const toggleBtn = row.querySelector("a.togg");
		if (!indentCell || !toggleBtn) continue;
		indentCell.classList.add("hn-clickable-indent");
		indentCell.addEventListener("click", () => {
			toggleBtn.click();
		});
	}
}


// ===== src/features/collapse-root-comment.js =====

// On each non-root comment, append a "[collapse root]" link to the
// comhead. Clicking it fires the root comment's native toggle and
// scrolls the page back to the (now-collapsed) root, so a reader who
// has descended deep into a thread can dismiss the whole subtree
// without losing their place in the page.
function setupCollapseRootComment() {
	const comments = Array.from(document.querySelectorAll("tr.comtr"));
	if (comments.length === 0) return;

	// HN renders indentation as an <img> in td.ind whose width is
	// `40 * level` pixels. We read that width once per comment to build
	// the level array, then hand it to the pure helper.
	const indentLevels = comments.map((row) => {
		const img = row.querySelector("td.ind img");
		if (!img) return 0;
		const width = Number(img.getAttribute("width")) || img.width || 0;
		return Math.round(width / 40);
	});

	const rootIndices = findCommentRootIndices(indentLevels);

	for (let i = 0; i < comments.length; i++) {
		const rootIdx = rootIndices[i];
		if (rootIdx === -1) continue;
		const root = comments[rootIdx];
		const head = comments[i].querySelector("span.comhead");
		if (!head) continue;

		const link = h("a", {
			class: "hn-collapse-root",
			href: "javascript:void(0)",
			text: "[collapse root]",
			onclick: (e) => {
				e.preventDefault();
				const rootToggle = root.querySelector("a.togg");
				if (!rootToggle) return;
				rootToggle.click();
				// Scroll the (now collapsed) root into view so the reader
				// doesn't lose their place after the subtree disappears.
				const rect = root.getBoundingClientRect();
				const top = rect.top + window.scrollY;
				window.scrollTo({ top, left: 0 });
			},
		});

		head.append(link);
	}
}


// ===== src/features/backticks-to-monospace.js =====

// Walk the text nodes inside every .commtext and replace `inline code`
// segments (delimited by backticks) with proper <code> elements. The
// pure helper splitBackticks(text) does the actual splitting; this
// module is the DOM glue.
//
// Skips text inside existing <code>, <pre>, and <a> elements so we
// don't mangle pre-formatted code blocks or rewrite link text.


const SKIP_TAGS = new Set(["code", "pre", "a"]);
function transformBackticksToMonospace() {
	for (const commtext of document.querySelectorAll(".commtext")) {
		// Two-pass: collect candidate text nodes first, then mutate. A
		// single pass that mutates while walking would have the walker
		// skip nodes that get inserted during replacement.
		const candidates = [];
		const walker = document.createTreeWalker(commtext, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const parent = node.parentNode;
				if (!parent) return NodeFilter.FILTER_REJECT;
				const tag = parent.tagName?.toLowerCase();
				if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
				// Quick prefilter: a text node with no backticks won't
				// match anything in splitBackticks, so don't bother.
				if (!node.data.includes("`")) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let n = walker.nextNode();
		while (n !== null) {
			candidates.push(n);
			n = walker.nextNode();
		}

		for (const node of candidates) {
			const segments = splitBackticks(node.data);
			if (!segments.some((s) => s.kind === "code")) continue;
			const fragment = document.createDocumentFragment();
			for (const seg of segments) {
				if (seg.kind === "text") {
					fragment.appendChild(document.createTextNode(seg.value));
				} else {
					const code = document.createElement("code");
					code.textContent = seg.value;
					fragment.appendChild(code);
				}
			}
			node.replaceWith(fragment);
		}
	}
}


// ===== src/features/toggle-all-comments.js =====

// "[toggle all]" link in the fatitem subtext that fires every
// top-level comment's a.togg in one click — useful on long threads
// where you've already drilled into one subtree and want to dismiss
// the rest, or want to expand a fully-collapsed page in one go.
//
// Optionally also adds a per-comment "[toggle replies]" link that
// fires every direct child's a.togg. Gated by TOGGLE_ALL_REPLIES_ENABLED
// in src/config.js because adding a link to every commentscales
// linearly with thread size; refined-hacker-news warns that it slows
// page render on items with hundreds of comments. Default off.



function indentLevel(row) {
	const img = row.querySelector("td.ind img");
	if (!img) return 0;
	const width = Number(img.getAttribute("width")) || img.width || 0;
	return Math.round(width / 40);
}

function fireToggle(row) {
	row.querySelector("a.togg")?.click();
}
function setupToggleAllComments() {
	const subtext = document.querySelector(".fatitem .subtext");
	const allRows = Array.from(document.querySelectorAll("tr.comtr"));
	if (!subtext || allRows.length === 0) return;

	const levels = allRows.map(indentLevel);

	// Fatitem-level toggle: collect all root rows up front so the click
	// handler doesn't re-query the DOM on every press.
	const rootRows = allRows.filter((_, i) => levels[i] === 0);
	if (rootRows.length > 0) {
		const link = h("a", {
			class: "hn-toggle-all",
			href: "javascript:void(0)",
			text: "toggle all",
			onclick: (e) => {
				e.preventDefault();
				for (const row of rootRows) fireToggle(row);
			},
		});
		// Match HN's subtext separator pattern: " | <link>".
		subtext.append(document.createTextNode(" | "));
		subtext.append(link);
	}

	if (!TOGGLE_ALL_REPLIES_ENABLED) return;

	// Per-comment "[toggle replies]" links. For each row, find its
	// immediate children (the contiguous run of following rows whose
	// indent is exactly +1 deeper, stopping when we hit one at <= the
	// parent's level). Skip rows that have no replies.
	for (let i = 0; i < allRows.length; i++) {
		const parent = allRows[i];
		const parentLevel = levels[i];
		const replies = [];
		for (let j = i + 1; j < allRows.length; j++) {
			if (levels[j] <= parentLevel) break;
			if (levels[j] === parentLevel + 1) replies.push(allRows[j]);
		}
		if (replies.length === 0) continue;

		const head = parent.querySelector("span.comhead");
		if (!head) continue;

		head.append(
			h("a", {
				class: "hn-toggle-replies",
				href: "javascript:void(0)",
				text: "[toggle replies]",
				onclick: (e) => {
					e.preventDefault();
					for (const row of replies) fireToggle(row);
				},
			}),
		);
	}
}


// ===== src/features/highlight-unread-comments.js =====

// Mark comment rows that weren't on the page the last time you visited
// this thread. Keeps a per-item ID list in the consolidated store under
// state.readComments[itemId] = { ids, fetchedAt }, with a 3-day TTL
// (READ_COMMENTS_TTL_MS in config). Stale entries are pruned on every
// item-page load so the slice can't grow unboundedly.
//
// First visit (no stored entry): nothing is highlighted, but every
// visible comment ID is recorded so the *next* visit knows which
// comments are new.
//
// Subsequent visits: ids in the current page that weren't in the
// stored entry get a .hn-new-comment class on their tr.comtr row.
// (The class lives on the row, not on td.ind, because the indent cell
// has ~0 width on root-level comments — anything painted on it would
// be invisible there.)



// Read the item id from the current page's URL. Distinct from
// item-info-hover's same-purpose helper, which reads from a hovered
// link's href. The build concatenates every module into one IIFE, so
// function names must be unique across src/features/*.js — same-name
// declarations would silently override each other.
function getCurrentItemIdFromUrl() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || null;
}

function getCurrentCommentIds() {
	return Array.from(document.querySelectorAll("tr.comtr"))
		.map((row) => row.id)
		.filter(Boolean);
}
function setupHighlightUnreadComments({ store }) {
	const itemId = getCurrentItemIdFromUrl();
	if (!itemId) return;

	const now = Date.now();

	// Drop expired entries first so a user who hasn't visited a thread
	// in months doesn't carry around its dead ID list forever.
	store.pruneReadComments(now, READ_COMMENTS_TTL_MS);

	const currentIds = getCurrentCommentIds();
	if (currentIds.length === 0) return;

	const stored = store.getReadComments(itemId);
	const isFreshSecondVisit =
		stored !== null && now - stored.fetchedAt <= READ_COMMENTS_TTL_MS;

	if (isFreshSecondVisit) {
		const newIds = findNewCommentIds(currentIds, stored.ids);
		for (const id of newIds) {
			const row = document.getElementById(id);
			if (row) row.classList.add("hn-new-comment");
		}
	}

	// Always update the stored snapshot to match what's currently on
	// the page — next visit's "new" set is derived from this.
	store.setReadComments(itemId, currentIds, now);
}


// ===== src/features/hover-popup.js =====

// Shared hover-popup primitive used by user-info-hover and item-info-hover.
// Builds a single fixed-position div appended to <body>, plus an
// attachDwell helper that wires the standard "cursor rests for N ms ->
// fetch -> render -> show" pattern. One popup per page; whichever
// hover wins last replaces the content.
function createHoverPopup() {
	const popup = h("div", { class: "hn-hover-popup hidden" });
	document.body.appendChild(popup);

	let currentToken = 0; // monotonic; bumped on every show/hide
	let visibleNear = null;

	function setContent(nodes) {
		popup.replaceChildren(...nodes);
	}

	function position(near) {
		const rect = near.getBoundingClientRect();
		// Anchor below the link, scrolled-position-aware. Clamp to the
		// viewport so the popup doesn't escape off the right or bottom
		// edge on long usernames near the screen edge.
		const top = rect.bottom + window.scrollY + 6;
		const proposedLeft = rect.left + window.scrollX;
		const maxLeft = window.scrollX + document.documentElement.clientWidth - 360;
		const left = Math.max(window.scrollX + 4, Math.min(proposedLeft, maxLeft));
		popup.style.top = `${top}px`;
		popup.style.left = `${left}px`;
	}

	function show(near, contentNodes) {
		setContent(contentNodes);
		position(near);
		popup.classList.remove("hidden");
		visibleNear = near;
	}

	function hide() {
		currentToken += 1;
		popup.classList.add("hidden");
		visibleNear = null;
		popup.replaceChildren();
	}

	// Wire mouseenter/mouseleave on `target` so that, after HOVER_DWELL_MS
	// of continuous hover, `loader()` is invoked. If it resolves and the
	// cursor is still on the target, `render(data)` is called and its
	// returned nodes are shown in the popup. Mouse leaving the target at
	// any time aborts the in-flight chain via a token bump.
	function attachDwell(target, loader, render) {
		let dwellTimer = null;
		let myToken = -1;

		target.addEventListener("mouseenter", () => {
			if (dwellTimer) clearTimeout(dwellTimer);
			currentToken += 1;
			myToken = currentToken;
			dwellTimer = setTimeout(() => {
				if (myToken !== currentToken) return;
				Promise.resolve(loader()).then((data) => {
					if (myToken !== currentToken) return;
					if (!data) {
						hide();
						return;
					}
					show(target, render(data));
				});
			}, HOVER_DWELL_MS);
		});

		target.addEventListener("mouseleave", () => {
			if (dwellTimer) {
				clearTimeout(dwellTimer);
				dwellTimer = null;
			}
			// Only hide if this target's hover is still the visible one;
			// avoids hiding the popup the user just moved into a second
			// candidate over.
			if (visibleNear === target) hide();
			currentToken += 1;
			myToken = -1;
		});
	}

	return { show, hide, attachDwell };
}


// ===== src/features/user-info-hover.js =====

// Hover any .hnuser link to see a popup with the user's account age,
// karma, and (if any) about-text snippet. Shares the popup primitive
// with item-info-hover, and the user-data cache with renderAllUsernames
// — repeat hovers cost zero requests.
//
// Skipped on the /user page itself (you're already looking at the
// profile).
//
// On item pages, renderAllUsernames hides each original .hnuser and
// inserts a visible clone inside .hn-main-row — so this pass must run
// after renderAllUsernames, and we attach to every .hnuser we find.
// Handlers on the hidden originals never fire (display:none = no mouse
// events); the visible clones do, and the popup adds the about-text
// snippet that the inline (age, karma) blurb doesn't show.



const ABOUT_PREVIEW_MAX = 280;

function isOnUserPage() {
	return window.location.pathname === "/user";
}

// HN serves `about` as HTML (links, paragraphs, italic). For the
// preview popup, we want a plain-text rendering — strips tags via the
// browser's HTML parser and trims to a fixed length so a long bio
// doesn't make the popup the size of a small monitor.
function aboutToText(html) {
	if (!html) return "";
	const doc = new DOMParser().parseFromString(html, "text/html");
	const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
	return truncateText(text, ABOUT_PREVIEW_MAX);
}

function renderUserPopup(username, data) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const lines = [
		h("div", { class: "hn-hover-popup-title" }, [
			h("strong", { text: username }),
		]),
		h("div", {
			class: "hn-hover-popup-meta",
			text: `${timeSince(data.created, nowSeconds)} old · ${data.karma} karma`,
		}),
	];
	const about = aboutToText(data.about);
	if (about) {
		lines.push(h("div", { class: "hn-hover-popup-body", text: about }));
	}
	return lines;
}
function setupUserInfoHover({ fetchUser, popup }) {
	if (isOnUserPage()) return;
	for (const link of document.querySelectorAll("a.hnuser")) {
		const username = link.textContent;
		if (!username) continue;
		popup.attachDwell(
			link,
			() => fetchUser(username),
			(data) => renderUserPopup(username, data),
		);
	}
}


// ===== src/features/item-info-hover.js =====

// Hover any link to /item?id=N inside a comment to see a preview of
// that item: title, domain, author, score, comment count, time, and
// (for Ask/Show items) a snippet of the body text. Useful when a
// commenter cites another submission and you want context without
// leaving the page.
//
// Scoped to `.commtext a[href*='/item?id=']` so we only enrich
// commenter-cited links, not navigation chrome (like the "parent" /
// "next" links that point to other items).



const TEXT_PREVIEW_MAX = 280;

// Distinct from highlight-unread's URL-based helper. The build flattens
// every module into one IIFE, so two same-name function declarations
// would silently override each other.
function getItemIdFromLinkHref(link) {
	try {
		const url = new URL(link.href);
		return url.searchParams.get("id") || null;
	} catch {
		return null;
	}
}

function textToPreview(html) {
	if (!html) return "";
	const doc = new DOMParser().parseFromString(html, "text/html");
	const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
	return truncateText(text, TEXT_PREVIEW_MAX);
}

function renderItemPopup(digest) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const titleNodes = [h("strong", { text: digest.title || "(untitled)" })];
	const domain = extractDomain(digest.url);
	if (domain) {
		titleNodes.push(
			h("span", { class: "hn-hover-popup-domain", text: ` (${domain})` }),
		);
	}

	const lines = [h("div", { class: "hn-hover-popup-title" }, titleNodes)];

	const metaParts = [];
	if (digest.score) metaParts.push(`${digest.score} points`);
	if (digest.by) metaParts.push(`by ${digest.by}`);
	if (digest.time) metaParts.push(`${timeSince(digest.time, nowSeconds)} ago`);
	if (typeof digest.descendants === "number") {
		metaParts.push(
			`${digest.descendants} comment${digest.descendants === 1 ? "" : "s"}`,
		);
	}
	if (metaParts.length > 0) {
		lines.push(
			h("div", { class: "hn-hover-popup-meta", text: metaParts.join(" · ") }),
		);
	}

	const body = textToPreview(digest.text);
	if (body) {
		lines.push(h("div", { class: "hn-hover-popup-body", text: body }));
	}
	return lines;
}
function setupItemInfoHover({ fetchItem, popup }) {
	const links = document.querySelectorAll(".commtext a[href*='/item?id=']");
	for (const link of links) {
		const id = getItemIdFromLinkHref(link);
		if (!id) continue;
		popup.attachDwell(
			link,
			() => fetchItem(id),
			(digest) => renderItemPopup(digest),
		);
	}
}


// ===== src/features/linkify-user-about.js =====

// On /user pages, walk the about-cell text nodes and replace plain-
// text URLs / email addresses with clickable <a> elements. The pure
// helper linkifySegments (in src/parsing.js) does the splitting; this
// module is the DOM glue.
//
// Skips text already inside an <a> so HN's own pre-existing links
// don't get wrapped a second time. Refined-hacker-news pulls in
// linkifyjs for this; we use a small in-house regex linker instead
// to avoid the npm dep.


function findAboutCell() {
	// HN's user page has a nested table inside #hnmain; the inner table
	// has rows for "user:", "created:", "karma:", "about:". The "about:"
	// label is in the first cell; the body is in the next sibling cell.
	const rows = document.querySelectorAll("#hnmain table table tr");
	for (const row of rows) {
		const labelCell = row.querySelector("td");
		if (!labelCell) continue;
		if (labelCell.textContent.trim() === "about:") {
			return labelCell.nextElementSibling;
		}
	}
	return null;
}

function isInsideAnchor(node) {
	let cursor = node.parentNode;
	while (cursor && cursor.nodeType === Node.ELEMENT_NODE) {
		if (cursor.tagName === "A") return true;
		cursor = cursor.parentNode;
	}
	return false;
}

function buildLinkifiedFragment(text) {
	const fragment = document.createDocumentFragment();
	for (const seg of linkifySegments(text)) {
		if (seg.kind === "text") {
			fragment.appendChild(document.createTextNode(seg.value));
		} else if (seg.kind === "url") {
			const a = document.createElement("a");
			a.href = seg.value;
			a.rel = "noopener noreferrer";
			a.textContent = seg.value;
			fragment.appendChild(a);
		} else if (seg.kind === "email") {
			const a = document.createElement("a");
			a.href = `mailto:${seg.value}`;
			a.rel = "noopener noreferrer";
			a.textContent = seg.value;
			fragment.appendChild(a);
		}
	}
	return fragment;
}
function setupLinkifyUserAbout() {
	if (window.location.pathname !== "/user") return;
	const cell = findAboutCell();
	if (!cell) return;

	// Two-pass walk to avoid the walker skipping over text nodes we
	// just inserted while replacing.
	const candidates = [];
	const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (isInsideAnchor(node)) return NodeFilter.FILTER_REJECT;
			const segs = linkifySegments(node.data);
			const hasLink = segs.some((s) => s.kind === "url" || s.kind === "email");
			return hasLink ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
		},
	});
	let n = walker.nextNode();
	while (n !== null) {
		candidates.push(n);
		n = walker.nextNode();
	}

	for (const node of candidates) {
		const fragment = buildLinkifiedFragment(node.data);
		node.replaceWith(fragment);
	}
}


// ===== src/features/sort-stories.js =====

// On listing pages (/news, /newest, /ask, /show, /best, /front, etc.)
// add a "sort: …" dropdown above table.itemlist. Selecting an option
// reorders the story rows in place; a "reverse" link flips the
// current order. Sort options:
//   - default: HN's server-supplied rank
//   - time:    newer items first (by id, which is monotonically
//              increasing)
//   - score:   highest first
//   - ratio:   comments/score descending — proxy for "most-discussed
//              given its score", surfaces controversial threads
//
// All three of these are non-persistent (per page load). The pure
// helper sortStoriesBy in src/parsing.js does the actual ordering.



const MODES = [
	{ value: "default", label: "default" },
	{ value: "time", label: "time" },
	{ value: "score", label: "score" },
	{ value: "ratio", label: "comments/score ratio" },
];

// Read each story's metadata + the 3 row group it occupies in
// table.itemlist > tbody. HN renders each story as exactly:
//   <tr class="athing">    -- title row, id=NNNN
//   <tr>...</tr>           -- subtext row (score, by, time, comments)
//   <tr style="height:5px">-- spacer row
function parseStoryRows(table) {
	const rows = Array.from(table.querySelectorAll("tbody > tr"));
	const stories = [];
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (!row.classList.contains("athing")) continue;
		const subtext = rows[i + 1];
		if (!subtext) continue;
		const spacer = rows[i + 2];

		const id = row.id;
		const rankText = row.querySelector(".rank")?.textContent || "";
		const defaultRank =
			Number(rankText.replace(/\.$/, "")) || stories.length + 1;
		const scoreText = subtext.querySelector(".score")?.textContent || "";
		const score = Number(scoreText.split(" ")[0]) || 0;
		// Comment count: the last "X comments" / "discuss" link in the
		// subtext. "discuss" means 0 comments; missing means it's a job
		// posting (no discussion).
		let commentsCount = 0;
		const commentLinks = subtext.querySelectorAll('a[href^="item?id="]');
		const lastLink = commentLinks[commentLinks.length - 1];
		if (lastLink) {
			const txt = lastLink.textContent.trim();
			const m = txt.match(/^(\d+)/);
			if (m) commentsCount = Number(m[1]);
		}

		const elements = [row, subtext];
		if (spacer && !spacer.classList.contains("athing")) {
			elements.push(spacer);
		}
		stories.push({ id, score, commentsCount, defaultRank, elements });
	}
	return stories;
}

function rerenderStories(tbody, stories) {
	// HN appends a "More" link as the last row of itemlist (and a
	// matching morespace row above it). Preserve those at the end so
	// pagination still works after reorder.
	const allRows = Array.from(tbody.children);
	const moreRow = allRows[allRows.length - 1];
	const moreSpace = allRows[allRows.length - 2];

	// Detach every story group's rows, then re-append in the requested
	// order. The DOM mutations are cheap because we're just moving
	// existing elements, not creating new ones.
	for (const story of stories) {
		for (const el of story.elements) {
			el.remove();
		}
	}

	// Find a stable insertion point: just before moreSpace (if present)
	// or at the end otherwise.
	const anchor =
		moreSpace && tbody.contains(moreSpace) ? moreSpace : moreRow || null;
	for (const story of stories) {
		for (const el of story.elements) {
			if (anchor && tbody.contains(anchor)) {
				tbody.insertBefore(el, anchor);
			} else {
				tbody.appendChild(el);
			}
		}
	}
}
function setupSortStories() {
	const table = document.querySelector("table.itemlist");
	if (!table) return;
	const tbody = table.querySelector("tbody");
	if (!tbody) return;

	// Capture the original story list (with default-rank metadata) once.
	// Subsequent sorts work from this snapshot so "default" really
	// restores the server-supplied ordering, not the most recent sort.
	const original = parseStoryRows(table);
	if (original.length === 0) return;

	const select = h("select", { class: "hn-sort-select" });
	for (const { value, label } of MODES) {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = label;
		select.appendChild(option);
	}
	const reverse = h("a", {
		class: "hn-sort-reverse",
		href: "javascript:void(0)",
		text: "reverse",
	});

	let currentMode = "default";
	let isReversed = false;

	function applyOrder() {
		let stories = sortStoriesBy(original, currentMode);
		if (isReversed) stories = stories.slice().reverse();
		rerenderStories(tbody, stories);
	}

	select.addEventListener("change", () => {
		currentMode = select.value;
		isReversed = false;
		applyOrder();
	});
	reverse.addEventListener("click", (e) => {
		e.preventDefault();
		isReversed = !isReversed;
		applyOrder();
	});

	const bar = h("div", { class: "hn-sort-bar" }, [
		h("label", { text: "sort: ", htmlFor: "hn-sort-select" }),
		select,
		reverse,
	]);
	table.parentNode.insertBefore(bar, table);
}


// ===== src/features/reply-inline.js =====

// Inline reply / edit / delete: instead of navigating away to
// /reply?id=N or /edit?id=N when the user clicks one of those links,
// fetch the page in the background and inject its <form> into the
// comment's div.reply. Click again to hide. If text is selected
// before the click, prepend it as a "> " quoted block to the
// textarea so users can quote-reply with the keyboard.
//
// Adapted from refined-hacker-news's reply-without-leaving-page,
// minus the italics-on-quote option (always plain "> "). Network
// fetches go through GM_xmlhttpRequest with a timeout — without it
// a hung request would silently strand the spinner forever.


const FETCH_TIMEOUT_MS = 8000;

function fetchPageDom(url) {
	return new Promise((resolve) => {
		GM_xmlhttpRequest({
			method: "GET",
			url,
			timeout: FETCH_TIMEOUT_MS,
			onload: (response) => {
				if (response.status !== 200 || !response.responseText) {
					resolve(null);
					return;
				}
				try {
					const doc = new DOMParser().parseFromString(
						response.responseText,
						"text/html",
					);
					resolve(doc);
				} catch (_err) {
					resolve(null);
				}
			},
			onerror: () => resolve(null),
			ontimeout: () => resolve(null),
		});
	});
}

// Wrap the user's current text selection (if any) into a "> "-prefixed
// block, suitable for prepending to a reply textarea.
function quoteSelection() {
	const text = window.getSelection().toString().trim();
	if (!text) return "";
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => `> ${line}`)
		.join("\n\n");
}

function isClickModified(event) {
	return (
		event.button !== 0 ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.altKey
	);
}

function attachActionLink(link, replyDiv, state) {
	const originalText = link.textContent;

	link.addEventListener("click", async (event) => {
		// Modified clicks (cmd/ctrl/middle/shift) keep their default
		// behaviour — opening in a new tab is still useful.
		if (isClickModified(event)) return;
		event.preventDefault();

		const quoted = quoteSelection();

		// If a form is currently open from any action on this comment,
		// remove it. If the same button was clicked, that's the toggle-
		// off path; if a different button, fall through after removal
		// to fetch the new form.
		if (state.activeForm) {
			state.activeForm.remove();
			state.activeForm = null;
			if (state.activeButton) {
				state.activeButton.textContent = state.activeButton.dataset.hnOriginal;
				state.activeButton.dataset.hnOriginal = "";
			}
			const wasSameButton = state.activeButton === link;
			state.activeButton = null;
			if (wasSameButton) return;
		}

		// Visual cue while the fetch is in flight.
		const loader = h("span", {
			class: "hn-reply-loader",
			text: " (loading…)",
		});
		link.after(loader);

		const dom = await fetchPageDom(link.href);
		loader.remove();
		if (!dom) {
			alert(
				"Couldn't load the form for that action. Try clicking the link directly to navigate to the page.",
			);
			return;
		}
		const form = dom.querySelector("form");
		if (!form) {
			alert(
				"The fetched page didn't contain a form. Try clicking the link directly.",
			);
			return;
		}
		form.classList.add("hn-injected-form");

		state.activeForm = form;
		state.activeButton = link;
		link.dataset.hnOriginal = originalText;
		link.textContent = `hide ${originalText}`;
		replyDiv.append(form);

		const textarea = form.querySelector("textarea");
		if (textarea) {
			if (quoted.length > 0) {
				textarea.value = `${textarea.value ? `${textarea.value}\n\n` : ""}${quoted}\n\n`;
			}
			textarea.focus();
		}
	});
}
function setupReplyInline() {
	for (const comment of document.querySelectorAll("tr.comtr")) {
		const replyDiv = comment.querySelector("div.reply");
		if (!replyDiv) continue;

		// Per-comment shared state across the action buttons so opening
		// one form auto-closes another on the same comment.
		const state = { activeForm: null, activeButton: null };

		for (const action of ["reply", "edit", "delete-confirm"]) {
			const link = comment.querySelector(`a[href^="${action}"]`);
			if (link) attachActionLink(link, replyDiv, state);
		}
	}
}


// ===== src/features/user-render.js =====

// Per-user inline UI on item pages: account info blurb, rating controls,
// editable tag list, plus the rerender-by-user fan-out used after any
// store write so all comments by the same author stay in sync.



// Pastel HSL. The lightness floor (75%) guarantees black text is always the
// high-contrast choice, so we don't need a luminance calculator.
function randomPastelColor() {
	const r = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1) + lo);
	return `hsl(${r(0, 359)}, ${r(30, 100)}%, ${r(75, 95)}%)`;
}

// Factory. Wiring done in main.js:
//   - `store` is the consolidated store from src/state.js
//   - `fetchUser` is from src/api.js
//   - `openTagManager` is the overlay opener from src/features/tag-manager.js
//     (passed as a getter so it can refer to a forward-declared variable).
function createUserRender({ store, fetchUser, openTagManager }) {
	function ensureTagColor(tagName) {
		const existing = store.getTagColor(tagName);
		if (existing?.bgColor) return existing;
		const color = { bgColor: randomPastelColor(), textColor: "black" };
		store.setTagColor(tagName, color);
		return color;
	}

	function renderRatingControls(username) {
		const display = h("span", {
			class: "hn-rating-display",
			text: String(store.getRating(username)),
		});
		display.dataset.hnUser = username;
		const mkBtn = (glyph, delta) =>
			h("button", {
				class: "hn-rating-btn",
				text: glyph,
				tabIndex: -1,
				onclick: (e) => {
					e.preventDefault();
					e.currentTarget.blur();
					const next = store.getRating(username) + delta;
					store.setRating(username, next);
					rerenderUserRatings(username);
				},
			});
		return h("span", { class: "hn-rating-container" }, [
			mkBtn("▲", 1),
			mkBtn("▼", -1),
			display,
		]);
	}

	// Renders the tag list for a user into `container` (clearing first). Called
	// on initial render and after any tag edit/remove so we don't need a full
	// page reload.
	function renderTagGroup(username, container) {
		container.replaceChildren();
		for (const tag of store.getUserTags(username)) {
			container.appendChild(renderTagSpan(username, tag));
		}
	}

	// Re-renders tag groups and updates tag inputs for every instance of a
	// user on the page. Called after any tag mutation so all comments by the
	// same author stay in sync.
	function rerenderUserTags(username) {
		const esc = CSS.escape(username);
		for (const group of document.querySelectorAll(
			`.hn-tag-group[data-hn-user="${esc}"]`,
		)) {
			renderTagGroup(username, group);
		}
		const names = store.getUserTags(username).map((t) => t.value);
		for (const input of document.querySelectorAll(
			`.hn-tag-input[data-hn-user="${esc}"]`,
		)) {
			input.value = names.join(", ");
		}
	}

	function rerenderUserRatings(username) {
		const esc = CSS.escape(username);
		const text = String(store.getRating(username));
		for (const rd of document.querySelectorAll(
			`.hn-rating-display[data-hn-user="${esc}"]`,
		)) {
			rd.textContent = text;
		}
	}

	function renderTagSpan(username, tag) {
		const editIcon = h("span", {
			class: "hn-tag-icon",
			title: "Edit tag",
			text: "✏️", // pencil
			onclick: (e) => {
				e.stopPropagation();
				const raw = prompt("Edit tag name:", tag.value);
				const newName = raw ? raw.trim() : "";
				if (!newName || newName === tag.value) return;
				const current = store.getUserTags(username);
				const color = ensureTagColor(newName);
				const updated = current.map((t) =>
					t.value === tag.value
						? {
								value: newName,
								bgColor: color.bgColor,
								textColor: color.textColor,
							}
						: t,
				);
				store.setUserTags(username, updated);
				rerenderUserTags(username);
			},
		});
		const removeIcon = h("span", {
			class: "hn-tag-icon",
			title: "Remove tag",
			text: "✖", // x
			onclick: (e) => {
				e.stopPropagation();
				if (!confirm(`Remove tag "${tag.value}"?`)) return;
				const current = store.getUserTags(username);
				store.setUserTags(
					username,
					current.filter((t) => t.value !== tag.value),
				);
				rerenderUserTags(username);
			},
		});

		const manageIcon = h("span", {
			class: "hn-tag-icon",
			title: "Manage all tags",
			text: "☰", // hamburger
			onclick: (e) => {
				e.stopPropagation();
				openTagManager();
			},
		});

		const span = h("div", { class: "hn-tag" }, [
			h("span", { class: "hn-tag-text", text: tag.value }),
			h("div", { class: "hn-tag-icons" }, [editIcon, manageIcon, removeIcon]),
		]);
		span.style.backgroundColor = tag.bgColor || "";
		span.style.color = tag.textColor || "black";
		return span;
	}

	function renderTagInput(username) {
		const currentNames = store.getUserTags(username).map((t) => t.value);
		const input = h("input", {
			type: "text",
			class: "hn-tag-input",
			value: currentNames.join(", "),
			placeholder: "Add tags (comma separated)",
		});
		input.dataset.hnUser = username;

		// Keystrokes update a live preview only; the store is written on blur
		// or Enter. Writing per-keystroke was persisting every partial string
		// the user typed (e.g. "Are" -> "Areg" -> "Argen" -> "Argentinian"
		// all ended up as distinct saved tags), which polluted both the
		// user's tag list and the shared colors map.
		const previewColors = new Map();
		const previewColorFor = (name) => {
			const real = store.getTagColor(name);
			if (real?.bgColor) return real;
			if (previewColors.has(name)) return previewColors.get(name);
			const color = { bgColor: randomPastelColor(), textColor: "black" };
			previewColors.set(name, color);
			return color;
		};

		const parseNames = () => parseTagInput(input.value);

		const renderPreview = () => {
			const esc = CSS.escape(username);
			const names = parseNames();
			for (const group of document.querySelectorAll(
				`.hn-tag-group[data-hn-user="${esc}"]`,
			)) {
				group.replaceChildren();
				for (const name of names) {
					const color = previewColorFor(name);
					group.appendChild(
						renderTagSpan(username, {
							value: name,
							bgColor: color.bgColor,
							textColor: color.textColor,
						}),
					);
				}
			}
		};

		const commit = () => {
			const names = parseNames();
			const updated = names.map((name) => {
				const color = ensureTagColor(name);
				return {
					value: name,
					bgColor: color.bgColor,
					textColor: color.textColor,
				};
			});
			store.setUserTags(username, updated);
			rerenderUserTags(username);
			previewColors.clear();
		};

		input.addEventListener("input", renderPreview);
		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			input.blur(); // triggers commit via the blur listener
		});
		return input;
	}

	function renderAccountInfo(created, karma) {
		const now = Math.floor(Date.now() / 1000);
		return h("span", {
			class: "hn-info",
			text: `(${timeSince(created, now)} old, ${karma} karma)`,
		});
	}

	// Skeleton-first: every row is built and inserted synchronously from the
	// store. The age/karma blurb gets filled in as each fetch resolves, so a
	// slow or hung request can't block the rest of the page.
	function renderAllUsernames() {
		const usernameElements = Array.from(document.querySelectorAll(".hnuser"));
		// The OP's username appears in .fatitem above the comments and again
		// on every comment they author within the thread. Reading it once
		// here lets us tag every comment-row authorship below as [op] without
		// also marking the fatitem's own hnuser (which is redundantly the OP
		// — we already know they posted the item).
		const itemAuthor =
			document.querySelector(".fatitem .hnuser")?.textContent || null;

		for (const usernameEl of usernameElements) {
			const username = usernameEl.textContent;
			const parent = findCommentParent(usernameEl);
			if (!parent) continue;

			const tagGroup = h("div", { class: "hn-tag-group" });
			tagGroup.dataset.hnUser = username;
			renderTagGroup(username, tagGroup);

			const usernameClone = usernameEl.cloneNode(true);
			usernameClone.className = `${usernameClone.className} hn-username`.trim();

			const isCommentAuthor = !!usernameEl.closest("tr.comtr");
			if (isCommentAuthor && itemAuthor && username === itemAuthor) {
				usernameClone.classList.add("hn-op");
				usernameClone.appendChild(document.createTextNode(" [op]"));
			}

			const infoSlot = h("span", {
				class: "hn-info hn-info-pending",
				text: "(loading…)",
			});

			const mainRow = h("div", { class: "hn-main-row" }, [
				usernameClone,
				infoSlot,
				renderRatingControls(username),
				renderTagInput(username),
			]);
			const tagContainer = h("div", { class: "hn-tag-container" }, [tagGroup]);
			const layout = h("div", { class: "hn-post-layout" }, [
				mainRow,
				tagContainer,
			]);

			parent.parentNode.insertBefore(layout, parent.nextSibling);
			usernameEl.style.display = "none";

			// Populate the info slot asynchronously. Cached users resolve on the
			// microtask queue (effectively synchronous). Failed or timed-out
			// fetches remove the slot rather than leaving a "loading…" ghost.
			fetchUser(username).then((data) => {
				if (data) {
					infoSlot.replaceWith(renderAccountInfo(data.created, data.karma));
				} else {
					infoSlot.remove();
				}
			});
		}
	}

	return {
		renderAllUsernames,
		rerenderUserTags,
		rerenderUserRatings,
	};
}


// ===== src/features/tag-manager.js =====

// Single-instance tag-management overlay. The overlay holds a draft
// snapshot of {tags, colors}; edits mutate the draft via pure helpers,
// and Save writes the draft back atomically.



function isDraftDirty(liveSnapshot, draft) {
	return (
		JSON.stringify(liveSnapshot.tags || {}) !== JSON.stringify(draft.tags) ||
		JSON.stringify(liveSnapshot.colors || {}) !== JSON.stringify(draft.colors)
	);
}

// Factory. `rerenderUserTags(username)` is invoked after a successful Save
// for every user visible on the page so their inline tag pills refresh.
//
// Returns:
//   open()       - opens the overlay (no-op if already open)
//   getActive()  - returns the active overlay handle (with markStale())
//                  while open, null otherwise. Used by the cross-tab
//                  listener in main.js to flag a remote write while the
//                  overlay is mid-edit.
function createTagManager({ store, rerenderUserTags }) {
	let tagManagerOpen = false;
	let activeTagManager = null;

	function open() {
		if (tagManagerOpen) return;
		tagManagerOpen = true;

		const live = store._snapshot();
		const draft = {
			tags: JSON.parse(JSON.stringify(live.tags || {})),
			colors: JSON.parse(JSON.stringify(live.colors || {})),
		};

		// Per-row state keyed by the tag name as it existed when the overlay
		// opened. Undo on a row reverts that row's changes only.
		const rows = new Map(); // originalName -> { currentName, pendingRemoval }
		const allNames = new Set([
			...Object.keys(live.colors || {}),
			...Object.values(live.tags || {}).flat(),
		]);
		for (const name of allNames) {
			rows.set(name, { currentName: name, pendingRemoval: false });
		}

		let filter = "";
		let sortMode = "name"; // "name" | "count"
		let isStale = false;

		const catcher = h("div", { class: "hn-tagmgr-catcher" });
		const overlay = h("div", { class: "hn-tagmgr-overlay" });
		document.body.appendChild(catcher);
		document.body.appendChild(overlay);

		activeTagManager = {
			markStale() {
				if (isStale) return;
				isStale = true;
				renderOverlay();
			},
		};

		function closeTagManager({ commit }) {
			if (commit) {
				if (isDraftDirty(live, draft)) {
					if (isStale) {
						alert(
							"Tags changed in another tab while this overlay was open. Close and reopen before saving so you do not overwrite newer data.",
						);
						return;
					}
					store.replaceTagsAndColors(draft.tags, draft.colors);
					store._invalidate();
					const visibleUsers = new Set();
					for (const el of document.querySelectorAll("[data-hn-user]")) {
						visibleUsers.add(el.dataset.hnUser);
					}
					for (const username of visibleUsers) rerenderUserTags(username);
				}
			}
			document.removeEventListener("keydown", onKeyDown);
			catcher.remove();
			overlay.remove();
			tagManagerOpen = false;
			activeTagManager = null;
		}

		function confirmDiscardIfDirty() {
			if (!isDraftDirty(live, draft)) return true;
			return confirm("Discard unsaved tag changes?");
		}

		function onKeyDown(e) {
			if (e.key !== "Escape") return;
			// If focus is inside a rename input, let the row handle its own
			// Escape (cancels the field, doesn't close the overlay).
			const active = document.activeElement;
			if (active?.classList.contains("hn-tagmgr-name-input")) return;
			e.preventDefault();
			if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
		}
		document.addEventListener("keydown", onKeyDown);

		catcher.addEventListener("click", () => {
			if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
		});

		// Footer (Save / Cancel) wired immediately; list + controls wired by
		// later tasks via renderOverlay().
		const saveBtn = h("button", {
			class: "hn-tagmgr-btn primary",
			text: "Save",
			onclick: () => closeTagManager({ commit: true }),
		});
		const cancelBtn = h("button", {
			class: "hn-tagmgr-btn",
			text: "Cancel",
			onclick: () => {
				if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
			},
		});
		const footer = h("div", { class: "hn-tagmgr-footer" }, [
			cancelBtn,
			saveBtn,
		]);

		const list = h("div", { class: "hn-tagmgr-list" });

		const filterInput = h("input", {
			type: "text",
			class: "hn-tagmgr-filter",
			placeholder: "Filter tags…",
		});
		filterInput.addEventListener("input", () => {
			filter = filterInput.value;
			renderOverlay();
		});

		const sortNameBtn = h("button", {
			class: "hn-tagmgr-sort-btn active",
			text: "Name (A→Z)",
			onclick: () => {
				sortMode = "name";
				renderOverlay();
			},
		});
		const sortCountBtn = h("button", {
			class: "hn-tagmgr-sort-btn",
			text: "Uses (0 first)",
			onclick: () => {
				sortMode = "count";
				renderOverlay();
			},
		});

		const controls = h("div", { class: "hn-tagmgr-controls" }, [
			filterInput,
			h("div", { class: "hn-tagmgr-sort" }, [sortNameBtn, sortCountBtn]),
		]);

		const headerCount = h("span", { class: "hn-tagmgr-header-count" });
		overlay.appendChild(
			h("div", { class: "hn-tagmgr-header" }, [
				h("span", { text: "Manage tags" }),
				headerCount,
			]),
		);
		overlay.appendChild(controls);
		overlay.appendChild(list);
		overlay.appendChild(footer);

		// Derive the draft from the rows map each time. Each row in `rows`
		// carries its originalName (the map key) and its current edited form;
		// pure helpers stitch the final shape together.
		function computeDraft() {
			let d = {
				tags: JSON.parse(JSON.stringify(live.tags || {})),
				colors: JSON.parse(JSON.stringify(live.colors || {})),
				schemaVersion: 1,
				ratings: live.ratings || {},
				cache: live.cache || {},
			};
			for (const [originalName, row] of rows) {
				if (row.pendingRemoval) {
					d = removeTagInState(d, originalName);
				} else if (row.currentName !== originalName) {
					d = renameTagInState(d, originalName, row.currentName);
				}
			}
			return d;
		}

		function renderOverlay() {
			const computed = computeDraft();
			draft.tags = computed.tags;
			draft.colors = computed.colors;

			const counts = countsFromState(computed);
			const needle = filter.trim().toLowerCase();

			const entries = [...rows.entries()]
				.map(([originalName, row]) => {
					const displayName = row.pendingRemoval
						? originalName
						: row.currentName;
					const count = row.pendingRemoval ? 0 : counts[row.currentName] || 0;
					const color =
						computed.colors[row.currentName] ||
						live.colors[originalName] ||
						null;
					return { originalName, row, displayName, count, color };
				})
				.filter(({ displayName }) =>
					needle === "" ? true : displayName.toLowerCase().includes(needle),
				);

			entries.sort((a, b) => {
				if (sortMode === "count") {
					if (a.count !== b.count) return a.count - b.count;
				}
				return a.displayName
					.toLowerCase()
					.localeCompare(b.displayName.toLowerCase());
			});

			sortNameBtn.classList.toggle("active", sortMode === "name");
			sortCountBtn.classList.toggle("active", sortMode === "count");
			headerCount.textContent = isStale
				? `${rows.size} tags • changed in another tab`
				: `${rows.size} tags`;
			saveBtn.disabled = isStale;
			saveBtn.title = isStale
				? "Close and reopen the tag manager before saving."
				: "";

			list.replaceChildren();
			for (const entry of entries) {
				list.appendChild(buildRow(entry));
			}
		}

		function buildRow({ originalName, row, displayName, count, color }) {
			const dirty = row.pendingRemoval || row.currentName !== originalName;
			const rowEl = h("div", {
				class: [
					"hn-tagmgr-row",
					dirty ? "dirty" : "",
					row.pendingRemoval ? "removed" : "",
				]
					.filter(Boolean)
					.join(" "),
			});

			const swatch = h("span", { class: "hn-tagmgr-swatch" });
			if (color?.bgColor) swatch.style.backgroundColor = color.bgColor;

			const nameEl = h("span", {
				class: "hn-tagmgr-name",
				text: displayName,
			});
			if (color?.bgColor) nameEl.style.backgroundColor = color.bgColor;
			if (color?.textColor) nameEl.style.color = color.textColor;

			const countEl = h("span", {
				class: `hn-tagmgr-count${count === 0 ? " zero" : ""}`,
				text: String(count),
			});

			const icons = h("div", { class: "hn-tagmgr-icons" });
			const editIcon = h("span", {
				class: "hn-tagmgr-icon",
				title: "Rename tag",
				text: "✏️", // pencil
				onclick: () => {
					// Swap name span for an input; Enter/blur commits, Escape
					// cancels the field (does not close the overlay).
					const input = h("input", {
						type: "text",
						class: "hn-tagmgr-name-input",
						value: row.currentName,
					});
					nameEl.replaceWith(input);
					input.focus();
					input.select();

					const commit = () => {
						const proposed = input.value.trim();
						if (!proposed || proposed === row.currentName) {
							renderOverlay();
							return;
						}
						// Collision check: does another row currently carry `proposed`?
						const collidesWith = [...rows.entries()].find(
							([orig, r]) =>
								orig !== originalName &&
								!r.pendingRemoval &&
								r.currentName === proposed,
						);
						if (collidesWith) {
							const srcCount =
								countsFromState(computeDraft())[row.currentName] || 0;
							if (
								!confirm(
									`Merge "${row.currentName}" into "${proposed}"? ${srcCount} user${srcCount === 1 ? "" : "s"} will be updated.`,
								)
							) {
								renderOverlay();
								return;
							}
							// Rename the source row into the destination so
							// computeDraft() applies renameTagInState on save
							// (which handles the merge). Drop the destination
							// row so the overlay doesn't show two identical
							// entries for the now-merged tag.
							row.currentName = proposed;
							rows.delete(collidesWith[0]);
						} else {
							row.currentName = proposed;
						}
						renderOverlay();
					};

					let cancelled = false;
					input.addEventListener("keydown", (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							cancelled = true;
							renderOverlay();
						}
					});
					input.addEventListener("blur", () => {
						if (cancelled) return;
						commit();
					});
				},
			});
			icons.appendChild(editIcon);

			if (dirty) {
				const undoIcon = h("span", {
					class: "hn-tagmgr-icon",
					title: "Undo changes to this row",
					text: "↩", // hook arrow
					onclick: () => {
						row.currentName = originalName;
						row.pendingRemoval = false;
						renderOverlay();
					},
				});
				icons.appendChild(undoIcon);
			}

			const removeIcon = h("span", {
				class: "hn-tagmgr-icon",
				title: row.pendingRemoval ? "Keep tag" : "Remove tag",
				text: "✖", // x
				onclick: () => {
					row.pendingRemoval = !row.pendingRemoval;
					renderOverlay();
				},
			});
			icons.appendChild(removeIcon);

			rowEl.appendChild(swatch);
			rowEl.appendChild(nameEl);
			rowEl.appendChild(countEl);
			rowEl.appendChild(icons);
			return rowEl;
		}

		renderOverlay();
		filterInput.focus();
	}

	return {
		open,
		getActive: () => activeTagManager,
	};
}


// ===== src/features/toolbar.js =====

// Floating toolbar with Save state / Restore state buttons. Mounted on
// item pages.
function createToolbar({ store, backend }) {
	function exportState() {
		const data = stateToExport(store._snapshot());
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = h("a", {
			href: url,
			download: `hn-user-data-${new Date().toISOString().split("T")[0]}.json`,
		});
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			a.remove();
			URL.revokeObjectURL(url);
		}, 100);
	}

	function importState() {
		const input = h("input", { type: "file", accept: ".json" });
		input.addEventListener("change", (event) => {
			const file = event.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const raw = JSON.parse(e.target.result);
					const parsed = parseImport(raw);
					// Write the consolidated blob directly and reload so the page
					// rebuilds from a fresh store.
					backend.set(STATE_KEY, JSON.stringify(parsed));
					alert("Data imported successfully! The page will now reload.");
					location.reload();
				} catch (error) {
					alert(`Error importing data: ${error.message}`);
					console.error("Error importing data:", error);
				}
			};
			reader.readAsText(file);
		});
		input.click();
	}

	function mount() {
		const dragHandle = h("div", { class: "hn-drag-handle" });
		const buttons = h("div", { class: "hn-toolbar-buttons" }, [
			h("button", {
				class: "hn-toolbar-btn",
				text: "Save state",
				onclick: exportState,
			}),
			h("button", {
				class: "hn-toolbar-btn",
				text: "Restore state",
				onclick: importState,
			}),
		]);
		const toolbar = h("div", { class: "hn-toolbar" }, [dragHandle, buttons]);
		document.body.appendChild(toolbar);

		// Drag listeners live only for the duration of a drag, rather than
		// sitting on document forever.
		dragHandle.addEventListener("mousedown", (e) => {
			const rect = toolbar.getBoundingClientRect();
			const offsetX = e.clientX - rect.left;
			const offsetY = e.clientY - rect.top;
			e.preventDefault();

			const onMove = (ev) => {
				toolbar.style.left = `${ev.clientX - offsetX}px`;
				toolbar.style.top = `${ev.clientY - offsetY}px`;
				toolbar.style.right = "auto";
			};
			const onUp = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
			};
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});
	}

	return { mount };
}


// ===== src/main.js =====

// Browser-side bootstrap. The build script wraps this (and every module
// imported above it) in a single IIFE inside the userscript bundle, so
// everything below runs once on load inside the userscript runtime.






















GM_addStyle(STYLES);

// Adapter from GM_* to the {get, set, list} interface the store and
// migration expect.
const backend = {
	get: (key) => GM_getValue(key, undefined),
	set: (key, value) => GM_setValue(key, value),
	list: () => (typeof GM_listValues === "function" ? GM_listValues() : []),
};

migrateLegacyKeys(backend);
const store = createStore(backend);
const { fetchUser, fetchItem } = createApi({ store });
const hoverPopup = createHoverPopup();

// Tag manager and user-render reference each other; both bindings exist by
// the time either's stored callback runs (on a click), so the closures
// resolve fine despite the forward reference.
const tagManager = createTagManager({
	store,
	rerenderUserTags: (username) => userRender.rerenderUserTags(username),
});
const userRender = createUserRender({
	store,
	fetchUser,
	openTagManager: () => tagManager.open(),
});
const toolbar = createToolbar({ store, backend });

// Sync state from other tabs. GM_addValueChangeListener fires whenever
// another tab writes to the same GM storage key. We invalidate the
// in-memory cache and re-render every user visible on this page.
if (typeof GM_addValueChangeListener === "function") {
	GM_addValueChangeListener(STATE_KEY, (_name, _oldVal, _newVal, remote) => {
		if (!remote) return;
		tagManager.getActive()?.markStale();
		store._invalidate();
		const usernames = new Set();
		for (const el of document.querySelectorAll("[data-hn-user]")) {
			usernames.add(el.dataset.hnUser);
		}
		for (const username of usernames) {
			userRender.rerenderUserTags(username);
			userRender.rerenderUserRatings(username);
		}
	});
}

applyDownvotedClass();
transformQuotes();
// Linkify and sort-stories are page-gated internally (linkify by
// pathname, sort by table.itemlist presence), so call unconditionally.
setupLinkifyUserAbout();
setupSortStories();

if (isItemPage()) {
	setupCommentBoxToggle();
	setupClickIndentToggle();
	setupCollapseRootComment();
	transformBackticksToMonospace();
	setupToggleAllComments();
	setupHighlightUnreadComments({ store });
	userRender.renderAllUsernames();
	setupItemInfoHover({ fetchItem, popup: hoverPopup });
	setupReplyInline();
	toolbar.mount();
}

// User-info hover wires every .hnuser on every page (except /user
// itself, which the feature checks internally). Must run AFTER
// renderAllUsernames on item pages: that pass hides each original
// .hnuser and inserts a visible clone, so the hover handler has to
// land on the clone.
setupUserInfoHover({ fetchUser, popup: hoverPopup });


})();
````
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

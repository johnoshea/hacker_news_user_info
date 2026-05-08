# Watch for Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-comment "watch for replies" toggle, with proactive HN-API checking, listing-page link highlighting when new replies arrive, and toolbar prev/next nav between watched comments.

**Architecture:** Pure-logic helpers (`parsing.js`, `state.js`) drive a per-comment `state.watchedComments` map keyed by comment id and storing `{ itemId, seenKids, latestKids, lastCheckedAt, addedAt }`. Three new browser-only feature modules — `watch-toggles`, `watched-comment-nav`, `watched-listing-highlights` — handle DOM and side-effects. The existing `fetchItem` is extended with a `{ fresh: true }` opt-in and a `kids` field on the cached digest so the 30-min recheck throttle isn't shadowed by the 6h item cache.

**Tech Stack:** Plain ES modules under `src/`, Node `node:test` for pure-logic tests, Biome for formatting/linting, `just` task runner, `scripts/build.js` concatenates source into `script.js` userscript bundle. No bundler.

**Spec:** `docs/superpowers/specs/2026-05-07-watch-for-replies-design.md`

---

## File Structure

### Create

| File | Responsibility |
|---|---|
| `src/features/watch-toggles.js` | Per-comment eye-icon, click handler, page-load mark + sync |
| `src/features/watched-comment-nav.js` | Toolbar `↑ watch` / `watch ↓` buttons, current-position state, scroll on click |
| `src/features/watched-listing-highlights.js` | Listing-page `n comments` link restyle when watched comments have new replies |
| `tests/parsingWatch.test.js` | Unit tests for the four pure helpers in `parsing.js` |
| `tests/stateWatch.test.js` | Unit tests for the new store methods in `state.js` |

### Modify

| File | What changes |
|---|---|
| `src/config.js` | Add `WATCH_TTL_MS`, `WATCH_RECHECK_THROTTLE_MS` |
| `src/parsing.js` | Add `watchHasNewReplies`, `pruneExpiredWatches`, `isWatchCheckStale`, `watchesByItemId` |
| `src/state.js` | Add `watchedComments: {}` to `emptyState()`; new store methods (`getWatchedComments`, `getWatchedComment`, `setWatchedComment`, `removeWatchedComment`, `markWatchSeen`, `updateWatchKids`, `pruneWatchedComments`); extend `stateToExport`/`parseImport` |
| `src/api.js` | Extend `fetchItem` with `{ fresh = false }` option; include `kids: [...]` in cached digest |
| `src/features/toolbar.js` | Expose buttons container (return `getButtonsContainer` from factory) |
| `src/styles.js` | Add `.hn-watch-icon`, `.hn-watched`, `.hn-watch-nav[disabled]`, `.hn-watched-link` rules |
| `src/main.js` | Wire `setupWatchedListingHighlights` (unconditionally), `setupWatchToggles` and `setupWatchedCommentNav` (item pages) |
| `scripts/build.js` | Append the three new feature modules to `SOURCES` (after `user-render.js`, before `tag-manager.js`) |
| `CLAUDE.md` | Document the new feature in "What this is" and "Repository layout" sections |

---

## Conventions used by this plan

- **TDD:** Pure-logic changes (config, parsing, state) are TDD'd. Browser-only changes (api, toolbar, styles, main, feature modules) are not unit-tested — convention in this repo. Each browser-only task ends with a manual smoke-test instruction.
- **Tests file naming:** Existing tests use camelCase (`readComments.test.js`, `itemCache.test.js`). New tests follow the same pattern: `parsingWatch.test.js`, `stateWatch.test.js`.
- **Commit messages:** Imperative subject ≤72 chars. Body explains *why* when not obvious.
- **Build artifact:** `script.js` is checked in. Run `just build` (or `just check`) before each commit that touches `src/` or `scripts/build.js`. CI verifies the bundle is up to date.
- **Formatting:** `just fmt` after every edit. Biome enforces tabs + double-quotes + semicolons.
- **Branch:** Work happens on the existing `feat/watch-for-replies` branch.

---

## Task 1: Add config constants

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Append the constants to `src/config.js`**

Append at the end of the file (after the existing `HOVER_DWELL_MS` declaration):

```js
// How long a watched comment persists before being silently pruned.
// HN threads rarely receive replies after two weeks, and the TTL stops
// the watch list growing forever on threads that have gone cold.
export const WATCH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Minimum interval between API rechecks of a single watched comment.
// 30 minutes balances freshness ("new reply just arrived") against
// load (each watched comment fires one tiny JSON request per session
// per throttle window, behind fetchItem's inflight-dedup map).
export const WATCH_RECHECK_THROTTLE_MS = 30 * 60 * 1000;
```

- [ ] **Step 2: Run `just fmt` and `just check`**

Run: `just fmt && just check`
Expected: PASS — no test changes yet, this is just lint/format.

- [ ] **Step 3: Commit**

```bash
git add src/config.js script.js
git commit -m "feat(watch): add WATCH_TTL_MS and WATCH_RECHECK_THROTTLE_MS"
```

(`script.js` will pick up the new constants on rebuild.)

---

## Task 2: Pure helper — `watchHasNewReplies`

**Files:**
- Modify: `src/parsing.js`
- Create: `tests/parsingWatch.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/parsingWatch.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { watchHasNewReplies } from "../src/parsing.js";

// The watch-for-replies feature stores `seenKids` (replies the user has
// acknowledged by visiting the comment page) and `latestKids` (replies
// from the most recent API check). A reply is "new" iff it appears in
// latestKids but not in seenKids — the user has not yet acknowledged it.

test("watchHasNewReplies: empty arrays mean no new replies", () => {
	assert.equal(watchHasNewReplies([], []), false);
});

test("watchHasNewReplies: identical arrays mean no new replies", () => {
	assert.equal(watchHasNewReplies(["a", "b"], ["a", "b"]), false);
});

test("watchHasNewReplies: latestKids subset of seenKids — no new replies", () => {
	// Defensive: if HN somehow returns fewer kids than we'd already seen
	// (a deletion, perhaps), there's nothing new.
	assert.equal(watchHasNewReplies(["a", "b", "c"], ["a", "b"]), false);
});

test("watchHasNewReplies: one id only in latestKids — has new", () => {
	assert.equal(watchHasNewReplies(["a"], ["a", "b"]), true);
});

test("watchHasNewReplies: multiple new ids — has new", () => {
	assert.equal(watchHasNewReplies([], ["a", "b", "c"]), true);
});

test("watchHasNewReplies: defensive against null/undefined", () => {
	assert.equal(watchHasNewReplies(null, null), false);
	assert.equal(watchHasNewReplies(undefined, undefined), false);
	assert.equal(watchHasNewReplies(null, ["a"]), true);
	assert.equal(watchHasNewReplies(["a"], null), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test`
Expected: FAIL — `watchHasNewReplies` is not exported from `src/parsing.js`.

- [ ] **Step 3: Implement the helper**

Append to `src/parsing.js` (after `pruneExpiredReadComments`):

```js
// True iff `latestKids` contains an id not present in `seenKids`. Used
// by the watch-for-replies feature to decide whether a watched comment
// has new replies that the user has not yet acknowledged. Both inputs
// may be null/undefined (treated as empty).
export function watchHasNewReplies(seenKids, latestKids) {
	const seen = new Set(seenKids || []);
	for (const id of latestKids || []) {
		if (!seen.has(id)) return true;
	}
	return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test`
Expected: PASS — all `watchHasNewReplies` cases green.

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add src/parsing.js tests/parsingWatch.test.js
git commit -m "feat(watch): add watchHasNewReplies pure helper"
```

---

## Task 3: Pure helper — `isWatchCheckStale`

**Files:**
- Modify: `src/parsing.js`
- Modify: `tests/parsingWatch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/parsingWatch.test.js`:

```js
import { isWatchCheckStale } from "../src/parsing.js";

const MIN_MS = 60 * 1000;
const THROTTLE_MS = 30 * MIN_MS;

test("isWatchCheckStale: just-checked entry is fresh", () => {
	const now = 1_000_000_000_000;
	assert.equal(
		isWatchCheckStale({ lastCheckedAt: now }, now, THROTTLE_MS),
		false,
	);
});

test("isWatchCheckStale: exactly throttle-old is fresh (boundary)", () => {
	const now = 1_000_000_000_000;
	assert.equal(
		isWatchCheckStale(
			{ lastCheckedAt: now - THROTTLE_MS },
			now,
			THROTTLE_MS,
		),
		false,
	);
});

test("isWatchCheckStale: well past throttle is stale", () => {
	const now = 1_000_000_000_000;
	assert.equal(
		isWatchCheckStale(
			{ lastCheckedAt: now - THROTTLE_MS - 1 },
			now,
			THROTTLE_MS,
		),
		true,
	);
});

test("isWatchCheckStale: missing entry / lastCheckedAt is stale", () => {
	const now = 1_000_000_000_000;
	assert.equal(isWatchCheckStale(null, now, THROTTLE_MS), true);
	assert.equal(isWatchCheckStale(undefined, now, THROTTLE_MS), true);
	assert.equal(isWatchCheckStale({}, now, THROTTLE_MS), true);
	assert.equal(
		isWatchCheckStale({ lastCheckedAt: "not a number" }, now, THROTTLE_MS),
		true,
	);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test`
Expected: FAIL — `isWatchCheckStale` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/parsing.js`:

```js
// True iff lastCheckedAt is older than nowMs - throttleMs (i.e. due
// for a fresh API recheck). A missing entry, missing lastCheckedAt,
// or non-numeric lastCheckedAt is treated as stale so the very first
// recheck always fires.
export function isWatchCheckStale(entry, nowMs, throttleMs) {
	if (!entry || typeof entry.lastCheckedAt !== "number") return true;
	return nowMs - entry.lastCheckedAt > throttleMs;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add src/parsing.js tests/parsingWatch.test.js
git commit -m "feat(watch): add isWatchCheckStale pure helper"
```

---

## Task 4: Pure helper — `pruneExpiredWatches`

**Files:**
- Modify: `src/parsing.js`
- Modify: `tests/parsingWatch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/parsingWatch.test.js`:

```js
import { pruneExpiredWatches } from "../src/parsing.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 14 * DAY_MS;

test("pruneExpiredWatches: empty/null input returns empty object", () => {
	assert.deepEqual(pruneExpiredWatches({}, 100, TTL_MS), {});
	assert.deepEqual(pruneExpiredWatches(null, 100, TTL_MS), {});
	assert.deepEqual(pruneExpiredWatches(undefined, 100, TTL_MS), {});
});

test("pruneExpiredWatches: keeps fresh entries, drops stale", () => {
	const now = 1_000_000_000_000;
	const map = {
		fresh: { addedAt: now - DAY_MS },
		stale: { addedAt: now - 15 * DAY_MS },
		brand_new: { addedAt: now },
	};
	const pruned = pruneExpiredWatches(map, now, TTL_MS);
	assert.deepEqual(Object.keys(pruned).sort(), ["brand_new", "fresh"]);
});

test("pruneExpiredWatches: missing addedAt is dropped (defensive)", () => {
	const now = 1_000_000_000_000;
	const map = {
		ok: { addedAt: now },
		broken: {},
		broken2: { addedAt: "nope" },
	};
	const pruned = pruneExpiredWatches(map, now, TTL_MS);
	assert.deepEqual(Object.keys(pruned), ["ok"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test`
Expected: FAIL — `pruneExpiredWatches` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/parsing.js`:

```js
// Return a new map containing only the watches that are still within
// the TTL (addedAt within ttlMs of now). A missing or non-numeric
// addedAt is treated as expired — defensive against malformed entries
// from a botched import or a forward-incompatible schema change.
export function pruneExpiredWatches(map, nowMs, ttlMs) {
	const out = {};
	for (const [commentId, entry] of Object.entries(map || {})) {
		if (!entry || typeof entry.addedAt !== "number") continue;
		if (nowMs - entry.addedAt <= ttlMs) {
			out[commentId] = entry;
		}
	}
	return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add src/parsing.js tests/parsingWatch.test.js
git commit -m "feat(watch): add pruneExpiredWatches pure helper"
```

---

## Task 5: Pure helper — `watchesByItemId`

**Files:**
- Modify: `src/parsing.js`
- Modify: `tests/parsingWatch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/parsingWatch.test.js`:

```js
import { watchesByItemId } from "../src/parsing.js";

test("watchesByItemId: empty input yields empty grouping", () => {
	assert.deepEqual(watchesByItemId({}), {});
	assert.deepEqual(watchesByItemId(null), {});
});

test("watchesByItemId: groups single watch under its itemId", () => {
	const grouped = watchesByItemId({
		c1: { itemId: "i1", seenKids: [], latestKids: ["r1"] },
	});
	assert.deepEqual(grouped, {
		i1: [{ commentId: "c1", hasNew: true }],
	});
});

test("watchesByItemId: groups multiple watches in one item", () => {
	const grouped = watchesByItemId({
		c1: { itemId: "i1", seenKids: ["r1"], latestKids: ["r1"] },
		c2: { itemId: "i1", seenKids: [], latestKids: ["r2"] },
	});
	// Order within an itemId is insertion order — fine for our use,
	// since callers iterate the whole array.
	assert.deepEqual(grouped, {
		i1: [
			{ commentId: "c1", hasNew: false },
			{ commentId: "c2", hasNew: true },
		],
	});
});

test("watchesByItemId: groups across multiple items", () => {
	const grouped = watchesByItemId({
		c1: { itemId: "i1", seenKids: [], latestKids: [] },
		c2: { itemId: "i2", seenKids: [], latestKids: ["r"] },
	});
	assert.deepEqual(grouped, {
		i1: [{ commentId: "c1", hasNew: false }],
		i2: [{ commentId: "c2", hasNew: true }],
	});
});

test("watchesByItemId: skips entries missing itemId (defensive)", () => {
	const grouped = watchesByItemId({
		c1: { seenKids: [], latestKids: [] },
		c2: { itemId: "i2", seenKids: [], latestKids: [] },
	});
	assert.deepEqual(grouped, {
		i2: [{ commentId: "c2", hasNew: false }],
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test`
Expected: FAIL — `watchesByItemId` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/parsing.js`:

```js
// Group a watchedComments map by itemId, attaching the derived
// `hasNew` flag to each entry. Used by the listing-page highlight
// pass to look up "are there any watched comments with new replies
// in this story's thread?" in one keyed lookup per row.
//
// Returns: { [itemId]: [{ commentId, hasNew }, ...] }
//
// Entries missing an itemId are skipped (a malformed entry shouldn't
// crash the listing-page pass).
export function watchesByItemId(map) {
	const out = {};
	for (const [commentId, entry] of Object.entries(map || {})) {
		if (!entry || typeof entry.itemId !== "string") continue;
		const hasNew = watchHasNewReplies(entry.seenKids, entry.latestKids);
		if (!out[entry.itemId]) out[entry.itemId] = [];
		out[entry.itemId].push({ commentId, hasNew });
	}
	return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add src/parsing.js tests/parsingWatch.test.js
git commit -m "feat(watch): add watchesByItemId pure helper"
```

---

## Task 6: State — read methods + `emptyState` extension

**Files:**
- Modify: `src/state.js`
- Create: `tests/stateWatch.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/stateWatch.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../src/state.js";

// The watch-for-replies feature stores its data alongside ratings,
// tags, etc. under the consolidated hn_state backend key. These tests
// exercise the new store methods through an in-memory backend that
// mirrors the GM_setValue/GM_getValue interface.

function makeFakeBackend(initial = {}) {
	const data = { ...initial };
	return {
		data,
		get: (key) => (key in data ? data[key] : undefined),
		set: (key, value) => {
			data[key] = value;
		},
	};
}

test("store: getWatchedComments returns empty object for fresh backend", () => {
	const store = createStore(makeFakeBackend());
	assert.deepEqual(store.getWatchedComments(), {});
});

test("store: getWatchedComment returns null when not set", () => {
	const store = createStore(makeFakeBackend());
	assert.equal(store.getWatchedComment("c1"), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test`
Expected: FAIL — `store.getWatchedComments` / `getWatchedComment` are not defined.

- [ ] **Step 3: Implement the methods**

In `src/state.js`, modify `emptyState()` to include the new slot. Replace the existing `emptyState` body:

```js
export function emptyState() {
	return {
		schemaVersion: STATE_SCHEMA_VERSION,
		ratings: {},
		tags: {}, // username -> [tagName, ...]
		colors: {}, // tagName  -> { bgColor, textColor }
		cache: {}, // username -> { created, karma, fetchedAt }
		readComments: {}, // itemId -> { ids: [...], fetchedAt }
		itemCache: {}, // itemId -> { title, url, by, score, descendants, time, text, type, kids, fetchedAt }
		watchedComments: {}, // commentId -> { itemId, seenKids, latestKids, lastCheckedAt, addedAt }
	};
}
```

In the `createStore` return object, add (after `pruneReadComments`):

```js
		// Watched-comments map for the watch-for-replies feature. Keyed
		// by HN comment id; each entry stores the parent itemId (so the
		// listing-page pass can look up "any watched comments in this
		// story?"), the `seenKids` snapshot of replies the user has
		// acknowledged, the `latestKids` from the most recent API check,
		// and timestamps driving the recheck throttle and TTL prune.
		getWatchedComments() {
			return load().watchedComments || {};
		},
		getWatchedComment(commentId) {
			const map = load().watchedComments || {};
			return map[commentId] || null;
		},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add src/state.js tests/stateWatch.test.js
git commit -m "feat(watch): add watchedComments slot and getter methods"
```

---

## Task 7: State — write methods (`set`, `remove`, `markSeen`, `updateKids`)

**Files:**
- Modify: `src/state.js`
- Modify: `tests/stateWatch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/stateWatch.test.js`:

```js
test("store: setWatchedComment persists and round-trips", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	const entry = {
		itemId: "i1",
		seenKids: ["r1"],
		latestKids: ["r1"],
		lastCheckedAt: 1_000,
		addedAt: 1_000,
	};
	store.setWatchedComment("c1", entry);
	assert.deepEqual(store.getWatchedComment("c1"), entry);

	// A fresh store reading the same backend sees the same value.
	const store2 = createStore(backend);
	assert.deepEqual(store2.getWatchedComment("c1"), entry);
});

test("store: removeWatchedComment deletes the entry", () => {
	const store = createStore(makeFakeBackend());
	store.setWatchedComment("c1", {
		itemId: "i1",
		seenKids: [],
		latestKids: [],
		lastCheckedAt: 0,
		addedAt: 0,
	});
	store.removeWatchedComment("c1");
	assert.equal(store.getWatchedComment("c1"), null);
	assert.deepEqual(store.getWatchedComments(), {});
});

test("store: removeWatchedComment is a no-op on missing entry", () => {
	const store = createStore(makeFakeBackend());
	store.removeWatchedComment("c1"); // does not throw
	assert.deepEqual(store.getWatchedComments(), {});
});

test("store: markWatchSeen syncs seenKids to latestKids only", () => {
	const store = createStore(makeFakeBackend());
	store.setWatchedComment("c1", {
		itemId: "i1",
		seenKids: ["r1"],
		latestKids: ["r1", "r2"],
		lastCheckedAt: 1_000,
		addedAt: 500,
	});
	store.markWatchSeen("c1", 9_999);
	const after = store.getWatchedComment("c1");
	assert.deepEqual(after.seenKids, ["r1", "r2"]);
	// latestKids, lastCheckedAt, addedAt all untouched.
	assert.deepEqual(after.latestKids, ["r1", "r2"]);
	assert.equal(after.lastCheckedAt, 1_000);
	assert.equal(after.addedAt, 500);
});

test("store: markWatchSeen is a no-op on missing entry", () => {
	const store = createStore(makeFakeBackend());
	store.markWatchSeen("c1", 9_999); // does not throw
	assert.equal(store.getWatchedComment("c1"), null);
});

test("store: updateWatchKids replaces latestKids and bumps lastCheckedAt", () => {
	const store = createStore(makeFakeBackend());
	store.setWatchedComment("c1", {
		itemId: "i1",
		seenKids: ["r1"],
		latestKids: ["r1"],
		lastCheckedAt: 1_000,
		addedAt: 500,
	});
	store.updateWatchKids("c1", ["r1", "r2"], 9_999);
	const after = store.getWatchedComment("c1");
	assert.deepEqual(after.latestKids, ["r1", "r2"]);
	assert.equal(after.lastCheckedAt, 9_999);
	// seenKids and addedAt untouched.
	assert.deepEqual(after.seenKids, ["r1"]);
	assert.equal(after.addedAt, 500);
});

test("store: updateWatchKids is a no-op on missing entry", () => {
	const store = createStore(makeFakeBackend());
	store.updateWatchKids("c1", ["r1"], 9_999); // does not throw
	assert.equal(store.getWatchedComment("c1"), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test`
Expected: FAIL — none of the new methods exist.

- [ ] **Step 3: Implement the methods**

In `src/state.js`, in the `createStore` return object, after the two getters added in Task 6:

```js
		setWatchedComment(commentId, entry) {
			mutate((s) => {
				s.watchedComments[commentId] = {
					itemId: entry.itemId,
					seenKids: (entry.seenKids || []).slice(),
					latestKids: (entry.latestKids || []).slice(),
					lastCheckedAt: entry.lastCheckedAt,
					addedAt: entry.addedAt,
				};
			});
		},
		removeWatchedComment(commentId) {
			mutate((s) => {
				if (!s.watchedComments?.[commentId]) return false;
				delete s.watchedComments[commentId];
			});
		},
		// Sync seenKids to latestKids — i.e. acknowledge every reply the
		// most recent API check returned. Called when the user lands on
		// the item page where a watched comment is rendered.
		markWatchSeen(commentId, _nowMs) {
			mutate((s) => {
				const e = s.watchedComments?.[commentId];
				if (!e) return false;
				e.seenKids = (e.latestKids || []).slice();
			});
		},
		// Replace latestKids with a fresh API result and stamp the check
		// timestamp. Doesn't touch seenKids — the watch retains its
				// "what's new since I last looked" notion until the user visits
		// the item page.
		updateWatchKids(commentId, kids, nowMs) {
			mutate((s) => {
				const e = s.watchedComments?.[commentId];
				if (!e) return false;
				e.latestKids = (kids || []).slice();
				e.lastCheckedAt = nowMs;
			});
		},
```

(The `_nowMs` argument on `markWatchSeen` is reserved for symmetry with `updateWatchKids` and to leave room for future "stamp visited at" needs without changing the signature.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add src/state.js tests/stateWatch.test.js
git commit -m "feat(watch): add set/remove/markSeen/updateKids store methods"
```

---

## Task 8: State — `pruneWatchedComments`

**Files:**
- Modify: `src/state.js`
- Modify: `tests/stateWatch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/stateWatch.test.js`:

```js
const DAY_MS = 24 * 60 * 60 * 1000;
const WATCH_TTL = 14 * DAY_MS;

test("store: pruneWatchedComments drops entries past the TTL", () => {
	const store = createStore(makeFakeBackend());
	const now = 1_000_000_000_000;
	store.setWatchedComment("fresh", {
		itemId: "i1",
		seenKids: [],
		latestKids: [],
		lastCheckedAt: now,
		addedAt: now - DAY_MS,
	});
	store.setWatchedComment("stale", {
		itemId: "i2",
		seenKids: [],
		latestKids: [],
		lastCheckedAt: now - 15 * DAY_MS,
		addedAt: now - 15 * DAY_MS,
	});
	store.pruneWatchedComments(now, WATCH_TTL);
	assert.equal(store.getWatchedComment("fresh") !== null, true);
	assert.equal(store.getWatchedComment("stale"), null);
});

test("store: pruneWatchedComments is a no-op when nothing is stale", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	const now = 1_000_000_000_000;
	store.setWatchedComment("c1", {
		itemId: "i1",
		seenKids: [],
		latestKids: [],
		lastCheckedAt: now,
		addedAt: now,
	});
	const before = backend.data;
	store.pruneWatchedComments(now, WATCH_TTL);
	// Method returns nothing observable when nothing is pruned;
	// confirm the entry is still there.
	assert.equal(store.getWatchedComment("c1") !== null, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test`
Expected: FAIL — `pruneWatchedComments` is not defined.

- [ ] **Step 3: Implement the method**

In `src/state.js`, add a new import at the top:

```js
import {
	pruneExpiredReadComments,
	pruneExpiredWatches,
} from "./parsing.js";
```

(Replace the existing `import { pruneExpiredReadComments } from "./parsing.js";`.)

In the `createStore` return object, add (after `updateWatchKids`):

```js
		pruneWatchedComments(nowMs, ttlMs) {
			mutate((s) => {
				const before = s.watchedComments || {};
				const after = pruneExpiredWatches(before, nowMs, ttlMs);
				if (Object.keys(after).length === Object.keys(before).length) {
					return false;
				}
				s.watchedComments = after;
			});
		},
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add src/state.js tests/stateWatch.test.js
git commit -m "feat(watch): add pruneWatchedComments store method"
```

---

## Task 9: State — export / import for `watches`

**Files:**
- Modify: `src/state.js`
- Modify: `tests/stateWatch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/stateWatch.test.js`:

```js
import { parseImport, stateToExport } from "../src/state.js";

test("stateToExport: includes a watches slot", () => {
	const state = {
		ratings: {},
		tags: {},
		colors: {},
		watchedComments: {
			c1: {
				itemId: "i1",
				seenKids: ["r1"],
				latestKids: ["r1", "r2"],
				lastCheckedAt: 1_000,
				addedAt: 500,
			},
		},
	};
	const exported = stateToExport(state);
	assert.deepEqual(exported.watches, {
		c1: {
			itemId: "i1",
			seenKids: ["r1"],
			latestKids: ["r1", "r2"],
			lastCheckedAt: 1_000,
			addedAt: 500,
		},
	});
});

test("stateToExport: empty watchedComments yields empty watches", () => {
	const state = { ratings: {}, tags: {}, colors: {} };
	const exported = stateToExport(state);
	assert.deepEqual(exported.watches, {});
});

test("parseImport: round-trips watches from normalized export", () => {
	const exported = {
		customTags: {},
		users: {},
		watches: {
			c1: {
				itemId: "i1",
				seenKids: ["r1"],
				latestKids: ["r1", "r2"],
				lastCheckedAt: 1_000,
				addedAt: 500,
			},
		},
	};
	const state = parseImport(exported);
	assert.deepEqual(state.watchedComments, {
		c1: {
			itemId: "i1",
			seenKids: ["r1"],
			latestKids: ["r1", "r2"],
			lastCheckedAt: 1_000,
			addedAt: 500,
		},
	});
});

test("parseImport: a normalized export without watches yields empty watchedComments", () => {
	const state = parseImport({ customTags: {}, users: {} });
	assert.deepEqual(state.watchedComments, {});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test`
Expected: FAIL — `stateToExport` does not yet emit `watches`; `parseImport` does not consume it.

- [ ] **Step 3: Implement the changes**

In `src/state.js`, modify `stateToExport`. Replace the existing function body so it constructs and returns `{ customTags, users, watches }`:

```js
// Normalized export shape. Stable across versions so old backups stay
// interoperable. Cache is intentionally dropped — it's perf scaffolding,
// not user data, and shouldn't bloat export files. `watches` is user
// data (a deliberate user choice), so it ships in exports.
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
	const watches = {};
	for (const [commentId, entry] of Object.entries(
		state.watchedComments || {},
	)) {
		if (!entry || typeof entry.itemId !== "string") continue;
		watches[commentId] = {
			itemId: entry.itemId,
			seenKids: (entry.seenKids || []).slice(),
			latestKids: (entry.latestKids || []).slice(),
			lastCheckedAt: entry.lastCheckedAt,
			addedAt: entry.addedAt,
		};
	}
	return { customTags, users, watches };
}
```

In the same file, modify `parseImport`. Inside the "Normalized format" branch (the `if (data.customTags || data.users)` block), add a third sub-branch handling `data.watches`. Replace the entire normalized-format block with:

```js
	// Normalized format.
	if (data.customTags || data.users || data.watches) {
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
		if (data.watches && typeof data.watches === "object") {
			for (const [commentId, entry] of Object.entries(data.watches)) {
				if (!entry || typeof entry.itemId !== "string") continue;
				state.watchedComments[commentId] = {
					itemId: entry.itemId,
					seenKids: Array.isArray(entry.seenKids) ? entry.seenKids.slice() : [],
					latestKids: Array.isArray(entry.latestKids)
						? entry.latestKids.slice()
						: [],
					lastCheckedAt:
						typeof entry.lastCheckedAt === "number" ? entry.lastCheckedAt : 0,
					addedAt: typeof entry.addedAt === "number" ? entry.addedAt : 0,
				};
			}
		}
		return state;
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test`
Expected: PASS — including the existing `importParser.test.js` (sanity-check that the legacy-format branch still works).

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add src/state.js tests/stateWatch.test.js
git commit -m "feat(watch): round-trip watches in stateToExport / parseImport"
```

---

## Task 10: API — extend `fetchItem` with `{ fresh }` and expose `kids`

**Files:**
- Modify: `src/api.js`

This is browser-only code. Convention in the repo: no unit tests for `api.js` (the existing tests cover `itemCache` indirectly via `tests/itemCache.test.js`, which exercises the store-level cache).

- [ ] **Step 1: Modify `fetchItem` in `src/api.js`**

Replace the entire `fetchItem` function with:

```js
	// `fresh: true` skips the persistent cache read but still participates
	// in inflight-dedup and still writes the cache on resolve. Used by
	// the watch-for-replies feature, where the 6h cache would otherwise
	// shadow the 30-min recheck throttle. Hover-popup callers leave the
	// default in place — title/score/karma drift slowly enough that the
	// 6h cache is fine for them.
	function fetchItem(itemId, { fresh = false } = {}) {
		if (!fresh) {
			const cached = store.getCachedItem(itemId, Date.now(), ITEM_CACHE_TTL_MS);
			if (cached) return Promise.resolve(cached);
		}
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
							// Direct replies. Used by the watch-for-replies feature
							// to detect new replies on a watched comment without
							// loading the full comment page. Hover popup ignores it.
							kids: Array.isArray(data.kids) ? data.kids.slice() : [],
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
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `just test`
Expected: PASS — `tests/itemCache.test.js` doesn't exercise `fetchItem` directly (it exercises `store.getCachedItem` / `store.setCachedItem`), so the digest extension is invisible to it.

- [ ] **Step 3: Format and commit**

```bash
just fmt
git add src/api.js
git commit -m "feat(api): expose kids and add { fresh } opt-in to fetchItem"
```

---

## Task 11: Toolbar — expose buttons container

**Files:**
- Modify: `src/features/toolbar.js`

The watched-comment-nav feature appends two buttons to the toolbar. The toolbar currently constructs its buttons container as a closure-local and never exposes it. We extend the factory's return value to include a getter so external callers can append buttons after `mount()` runs.

- [ ] **Step 1: Modify `src/features/toolbar.js`**

Replace the `mount()` function and the returned object:

```js
	let buttonsContainer = null;

	function mount() {
		const dragHandle = h("div", { class: "hn-drag-handle" });
		buttonsContainer = h("div", { class: "hn-toolbar-buttons" }, [
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
		const toolbar = h("div", { class: "hn-toolbar" }, [
			dragHandle,
			buttonsContainer,
		]);
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

	// Returns the buttons container after mount() runs, or null before.
	// External features (e.g. watched-comment-nav) use it to append
	// their own toolbar buttons without knowing the toolbar's internals.
	function getButtonsContainer() {
		return buttonsContainer;
	}

	return { mount, getButtonsContainer };
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `just test`
Expected: PASS — toolbar isn't covered by unit tests; this is just confirming we didn't break `state` or `parsing` tests.

- [ ] **Step 3: Build and smoke-test the existing toolbar**

Run: `just build`
Expected: build succeeds, no duplicate-function-name errors.

Manual smoke test (load `script.js` in Tampermonkey/Violentmonkey, visit any HN item page): the existing Save state / Restore state toolbar still renders top-right and is draggable.

- [ ] **Step 4: Format and commit**

```bash
just fmt
just build
git add src/features/toolbar.js script.js
git commit -m "refactor(toolbar): expose buttons container for external buttons"
```

---

## Task 12: Styles

**Files:**
- Modify: `src/styles.js`

- [ ] **Step 1: Append the new CSS to `src/styles.js`**

`STYLES` is a single tagged template literal at the top of the file. Find the end of the template (the closing backtick) and append the new rules just before it:

```css
    /* Watch-for-replies: per-comment toggle icon, sitting in
       .hn-main-row between the rating control and the tag input. */
    .hn-watch-icon {
      cursor: pointer;
      user-select: none;
      margin: 0 4px;
      opacity: 0.6;
    }
    .hn-watch-icon:hover { opacity: 1; }
    .hn-watch-icon.hn-watching { opacity: 1; }

    /* Watched-comment row: thick orange left border (in the indent
       gutter) plus a faint yellow background tint on every cell.
       Yellow is deliberately distinct from the orange tint that
       hn-new-comment uses, so a row that is somehow both still reads
       as both. */
    .hn-watched > td.ind {
      border-left: 5px solid var(--colour-hn-orange);
    }
    .hn-watched > td {
      background-color: rgba(255, 255, 0, 0.10);
    }

    /* Toolbar prev/next-watch buttons. Inherits .hn-toolbar-btn
       padding/border from the existing toolbar rule. */
    .hn-watch-nav[disabled] {
      opacity: 0.35;
      cursor: not-allowed;
    }

    /* Listing-page "n comments" link with new replies on a watched
       comment. The leading star is injected via ::before so the
       underlying anchor's textContent (used by HN's "n comments"
       counting) is undisturbed. */
    .hn-watched-link {
      font-weight: bold;
      color: var(--colour-hn-orange) !important;
    }
    .hn-watched-link::before {
      content: "★ ";
    }
```

- [ ] **Step 2: Build and confirm no syntax errors**

Run: `just build`
Expected: build succeeds.

- [ ] **Step 3: Format and commit**

```bash
just fmt
just build
git add src/styles.js script.js
git commit -m "feat(watch): add CSS for icon, row highlight, nav, listing link"
```

---

## Task 13: Feature module — `watch-toggles.js`

**Files:**
- Create: `src/features/watch-toggles.js`
- Modify: `scripts/build.js` (add to `SOURCES`)
- Modify: `src/main.js` (wire on item pages)

- [ ] **Step 1: Create `src/features/watch-toggles.js`**

```js
// Per-comment "watch for replies" toggle. Runs after
// userRender.renderAllUsernames() (which produces the .hn-main-row
// layout this pass inserts into).
//
// Click semantics:
//   off -> on : apply .hn-watched class + .hn-watching to the icon
//               immediately (visual response is synchronous), fire a
//               fresh fetchItem to capture the comment's current kids,
//               and persist the watch entry.
//   on  -> off: remove .hn-watched / .hn-watching, delete the store
//               entry. Any in-flight initial fetch is dropped on
//               resolve (we re-check before writing).
//
// Page-load semantics: for every watched comment whose id is present
// on this page, mark the row, fire a throttle-aware fresh fetchItem
// and on resolve sync both latestKids and seenKids to the response.
// This is the "visit clears new" step.

import { isItemPage } from "../dom.js";
import { isWatchCheckStale } from "../parsing.js";
import { WATCH_RECHECK_THROTTLE_MS } from "../config.js";

// Read the item id from the current page's URL. Same shape as
// highlight-unread-comments' helper (the build's
// checkForDuplicateTopLevelFunctions check forces unique names
// across feature modules, so this one is named for its caller).
function getItemIdFromWatchTogglesUrl() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || null;
}

const ICON_OFF = "👁";
const ICON_ON = "👁‍🗨";

function setIconState(iconEl, isOn) {
	iconEl.textContent = isOn ? ICON_ON : ICON_OFF;
	iconEl.title = isOn ? "Stop watching" : "Watch for replies";
	iconEl.classList.toggle("hn-watching", isOn);
}

export function setupWatchToggles({ store, fetchItem }) {
	if (!isItemPage()) return;
	const itemId = getItemIdFromWatchTogglesUrl();
	if (!itemId) return;

	const rows = Array.from(document.querySelectorAll("tr.comtr"));

	for (const row of rows) {
		const commentId = row.id;
		if (!commentId) continue;

		const mainRow = row.querySelector(".hn-main-row");
		if (!mainRow) continue;

		const ratingContainer = mainRow.querySelector(".hn-rating-container");
		const tagInput = mainRow.querySelector(".hn-tag-input");
		if (!ratingContainer || !tagInput) continue;

		const initiallyWatched = store.getWatchedComment(commentId) !== null;

		const icon = document.createElement("span");
		icon.className = "hn-watch-icon";
		icon.dataset.hnComment = commentId;
		setIconState(icon, initiallyWatched);

		icon.addEventListener("click", () => {
			// The icon's CSS class is the source of truth for "is this
			// currently watched", because the store-write on toggle-on
			// is async (it waits for fetchItem). Reading the store
			// directly here would let a fast double-click while the
			// initial fetch is in flight register two toggle-ON clicks.
			const wasWatched = icon.classList.contains("hn-watching");
			if (wasWatched) {
				store.removeWatchedComment(commentId);
				row.classList.remove("hn-watched");
				setIconState(icon, false);
				return;
			}
			// Toggle ON: visual response immediately, persist after fetch.
			row.classList.add("hn-watched");
			setIconState(icon, true);
			fetchItem(commentId, { fresh: true }).then((digest) => {
				// User may have toggled off before the fetch resolved.
				// The icon's class state is the user's latest intent;
				// only persist if they still want to be watching.
				if (!icon.classList.contains("hn-watching")) return;
				const kids = digest?.kids || [];
				const now = Date.now();
				store.setWatchedComment(commentId, {
					itemId,
					seenKids: kids.slice(),
					latestKids: kids.slice(),
					lastCheckedAt: now,
					addedAt: now,
				});
			});
		});

		// Insert between the rating container and the tag input.
		mainRow.insertBefore(icon, tagInput);

		// If watched, mark the row immediately on page load.
		if (initiallyWatched) {
			row.classList.add("hn-watched");
		}
	}

	// Page-load sync: for every watched comment present on this page,
	// fire a throttle-aware fresh fetchItem; on resolve, update
	// latestKids and seenKids in lockstep.
	const watches = store.getWatchedComments();
	const now = Date.now();
	for (const [commentId, entry] of Object.entries(watches)) {
		if (entry.itemId !== itemId) continue;
		if (!document.getElementById(commentId)) continue;
		if (!isWatchCheckStale(entry, now, WATCH_RECHECK_THROTTLE_MS)) {
			// Fresh enough — still acknowledge the current latestKids
			// (the user has visited the page).
			store.markWatchSeen(commentId, now);
			continue;
		}
		fetchItem(commentId, { fresh: true }).then((digest) => {
			if (store.getWatchedComment(commentId) === null) return; // toggled off mid-flight
			const kids = digest?.kids || [];
			const resolveNow = Date.now();
			store.updateWatchKids(commentId, kids, resolveNow);
			store.markWatchSeen(commentId, resolveNow);
		});
	}
}
```

- [ ] **Step 2: Add the module to the build's `SOURCES` array**

In `scripts/build.js`, in the `SOURCES` array, insert `"src/features/watch-toggles.js"` immediately after `"src/features/user-render.js"`:

```js
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
	"src/features/watch-toggles.js",
	"src/features/tag-manager.js",
	"src/features/toolbar.js",
	"src/main.js",
];
```

- [ ] **Step 3: Wire it in `src/main.js`**

Add an import alongside the other feature imports (alphabetical with the others is fine):

```js
import { setupWatchToggles } from "./features/watch-toggles.js";
```

In the `if (isItemPage())` block, immediately after `userRender.renderAllUsernames();`, add:

```js
	setupWatchToggles({ store, fetchItem });
```

- [ ] **Step 4: Build and confirm**

Run: `just build`
Expected: build succeeds, no duplicate-function-name errors. (`getItemIdFromWatchTogglesUrl` is intentionally distinct from `getCurrentItemIdFromUrl` in `highlight-unread-comments.js`.)

- [ ] **Step 5: Manual smoke test**

Reload `script.js` in Tampermonkey/Violentmonkey and visit any HN item page (e.g. `https://news.ycombinator.com/item?id=44XXXXXX`). Verify:
1. Each per-comment row shows a `👁` icon between the rating ▲▼ and the tag input.
2. Hover tooltip says "Watch for replies".
3. Click the icon: it changes to `👁‍🗨` (the "in speech bubble" variant), the row gains a thick orange left border and faint yellow tint, the tooltip changes to "Stop watching".
4. Reload the page: the watched state persists.
5. Click again: the icon, border and tint are removed.

- [ ] **Step 6: Commit**

```bash
just fmt
just build
git add src/features/watch-toggles.js scripts/build.js src/main.js script.js
git commit -m "feat(watch): add per-comment watch toggle with visual marker"
```

---

## Task 14: Feature module — `watched-comment-nav.js`

**Files:**
- Create: `src/features/watched-comment-nav.js`
- Modify: `scripts/build.js`
- Modify: `src/main.js`

- [ ] **Step 1: Create `src/features/watched-comment-nav.js`**

```js
// Toolbar prev/next-watched-comment navigation. Runs after
// toolbar.mount() on item pages. Adds two buttons to the toolbar's
// button container when at least one watched comment is present on
// this page; otherwise mounts nothing.
//
// "Current position" is tracked as a closure-local index into the
// list of watched-comment rows, in document order. Initial value -1
// means "before any" — the first click on `watch ↓` jumps to the
// first watched comment. Disabled state is recomputed after every
// click so a single-watch thread can never click `↑ watch`.

import { h, isItemPage } from "../dom.js";

function getItemIdFromCommentNavUrl() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || null;
}

export function setupWatchedCommentNav({ store, toolbar }) {
	if (!isItemPage()) return;
	const itemId = getItemIdFromCommentNavUrl();
	if (!itemId) return;

	// Resolve every on-page row for a watch in this thread, in DOM
	// order. Watches whose comment id isn't on this page (e.g. on a
	// later "more" page) are dropped.
	const watches = store.getWatchedComments();
	const rows = [];
	for (const [commentId, entry] of Object.entries(watches)) {
		if (entry.itemId !== itemId) continue;
		const row = document.getElementById(commentId);
		if (row) rows.push(row);
	}
	if (rows.length === 0) return;
	// Sort by document order. compareDocumentPosition returns a
	// bitmask; FOLLOWING (4) means `b` comes after `a`.
	rows.sort((a, b) =>
		a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
	);

	const buttons = toolbar.getButtonsContainer();
	if (!buttons) return;

	let currentIndex = -1;

	const prevBtn = h("button", {
		class: "hn-toolbar-btn hn-watch-nav hn-watch-nav-prev",
		text: "↑ watch",
	});
	const nextBtn = h("button", {
		class: "hn-toolbar-btn hn-watch-nav hn-watch-nav-next",
		text: "watch ↓",
	});

	function updateDisabled() {
		// prev disabled when at or before the first
		prevBtn.disabled = currentIndex <= 0;
		// next disabled when at the last
		nextBtn.disabled = currentIndex >= rows.length - 1;
	}

	prevBtn.addEventListener("click", () => {
		if (currentIndex <= 0) return;
		currentIndex -= 1;
		rows[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
		updateDisabled();
	});
	nextBtn.addEventListener("click", () => {
		if (currentIndex >= rows.length - 1) return;
		currentIndex += 1;
		rows[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
		updateDisabled();
	});

	buttons.appendChild(prevBtn);
	buttons.appendChild(nextBtn);
	updateDisabled();
}
```

- [ ] **Step 2: Add the module to the build's `SOURCES` array**

In `scripts/build.js`, insert `"src/features/watched-comment-nav.js"` immediately after `"src/features/watch-toggles.js"`.

- [ ] **Step 3: Wire it in `src/main.js`**

Add an import:

```js
import { setupWatchedCommentNav } from "./features/watched-comment-nav.js";
```

In the `if (isItemPage())` block, after `toolbar.mount();`, add:

```js
	setupWatchedCommentNav({ store, toolbar });
```

- [ ] **Step 4: Build and confirm**

Run: `just build`
Expected: build succeeds.

- [ ] **Step 5: Manual smoke test**

Reload in Tampermonkey/Violentmonkey. On an item page where you've watched at least one comment:

1. Floating toolbar (top-right) now shows two extra buttons: `↑ watch` and `watch ↓`.
2. With one watched comment on the page: `↑ watch` is greyed-out/disabled at all times; `watch ↓` is enabled until clicked once, then disabled.
3. With two+ watched comments: clicking `watch ↓` smooth-scrolls to the next watched comment; clicking `↑ watch` after that returns; disabled state on both buttons updates correctly at the ends of the list.
4. On an item page with no watched comments: the two buttons do not appear.

- [ ] **Step 6: Commit**

```bash
just fmt
just build
git add src/features/watched-comment-nav.js scripts/build.js src/main.js script.js
git commit -m "feat(watch): add toolbar prev/next watched-comment nav"
```

---

## Task 15: Feature module — `watched-listing-highlights.js`

**Files:**
- Create: `src/features/watched-listing-highlights.js`
- Modify: `scripts/build.js`
- Modify: `src/main.js`

- [ ] **Step 1: Create `src/features/watched-listing-highlights.js`**

```js
// Listing-page pass: for any story row in table.itemlist whose item
// has at least one watched comment, kick off a stale-aware fresh
// fetchItem recheck on each watch and, when any has new replies,
// restyle the story's "n comments" link with .hn-watched-link. The
// star ★ prefix is injected via the CSS ::before rule, not inline.
//
// Runs unconditionally; gates internally on table.itemlist (matches
// setupSortStories' approach so the call site in main.js stays simple).

import { isWatchCheckStale, watchesByItemId } from "../parsing.js";
import { WATCH_RECHECK_THROTTLE_MS } from "../config.js";

// Find the "n comments" link for a story row. HN renders each story
// as <tr class="athing"> followed by a subtext <tr> on the next
// sibling; the comments link is the last <a href="item?id=..."> in
// the subtext (ahead of it sits "by user", "n hours ago", "hide", "past").
function findCommentsLink(athingRow) {
	const subtext = athingRow.nextElementSibling;
	if (!subtext) return null;
	const links = subtext.querySelectorAll('a[href^="item?id="]');
	return links[links.length - 1] || null;
}

export function setupWatchedListingHighlights({ store, fetchItem }) {
	const table = document.querySelector("table.itemlist");
	if (!table) return;

	const grouped = watchesByItemId(store.getWatchedComments());
	if (Object.keys(grouped).length === 0) return;

	const now = Date.now();
	const watches = store.getWatchedComments();

	for (const athing of table.querySelectorAll("tr.athing")) {
		const itemId = athing.id;
		const group = grouped[itemId];
		if (!group) continue;
		const link = findCommentsLink(athing);
		if (!link) continue;

		// Synchronous: if any watch in this group already has hasNew
		// from a previous session's API check, mark immediately.
		if (group.some((g) => g.hasNew)) {
			link.classList.add("hn-watched-link");
		}

		// Stale-aware async recheck. Each fetch resolves independently;
		// after each, recompute hasNew across the group and either
		// add or remove the class.
		for (const { commentId } of group) {
			const entry = watches[commentId];
			if (!entry) continue;
			if (!isWatchCheckStale(entry, now, WATCH_RECHECK_THROTTLE_MS)) continue;
			fetchItem(commentId, { fresh: true }).then((digest) => {
				if (digest) {
					store.updateWatchKids(commentId, digest.kids || [], Date.now());
				}
				// Re-evaluate the group after each resolve so the
				// highlight reflects the latest server view.
				const updated = watchesByItemId(store.getWatchedComments())[itemId] || [];
				if (updated.some((g) => g.hasNew)) {
					link.classList.add("hn-watched-link");
				} else {
					link.classList.remove("hn-watched-link");
				}
			});
		}
	}
}
```

- [ ] **Step 2: Add the module to the build's `SOURCES` array**

In `scripts/build.js`, insert `"src/features/watched-listing-highlights.js"` immediately after `"src/features/watched-comment-nav.js"`.

- [ ] **Step 3: Wire it in `src/main.js`**

Add an import:

```js
import { setupWatchedListingHighlights } from "./features/watched-listing-highlights.js";
```

Outside the `if (isItemPage())` block, alongside the other unconditional listing-page passes (after `setupSortStories();`):

```js
setupWatchedListingHighlights({ store, fetchItem });
```

- [ ] **Step 4: Build and confirm**

Run: `just build`
Expected: build succeeds.

- [ ] **Step 5: Manual smoke test**

Reload in Tampermonkey/Violentmonkey:

1. Watch a comment on an active HN thread that's likely to receive new replies in the next half-hour.
2. Wait 30+ minutes.
3. Visit `https://news.ycombinator.com/news`.
4. If the thread you're watching is on the front page and has received new replies since you toggled the watch, its "n comments" link is bold orange with a `★ ` prefix. Browser devtools shows the `<a>` has class `hn-watched-link` and the kids list in `hn_state.watchedComments[<commentId>].latestKids` has grown beyond `seenKids`.
5. Click through to the item page: the `.hn-watched` row paints; markWatchSeen syncs seenKids = latestKids.
6. Return to `/news`: the link is no longer highlighted (no false alarm).

If you can't easily generate new replies on demand, the synchronous-mark path can be tested by hand-editing `hn_state` in Tampermonkey storage to add a `latestKids` entry that isn't in `seenKids`, then loading `/news`.

- [ ] **Step 6: Commit**

```bash
just fmt
just build
git add src/features/watched-listing-highlights.js scripts/build.js src/main.js script.js
git commit -m "feat(watch): highlight listing 'n comments' link when new replies"
```

---

## Task 16: Wire TTL prune on item-page load

**Files:**
- Modify: `src/features/watch-toggles.js`

The cleanup-on-load convention comes from `highlight-unread-comments`, which calls `store.pruneReadComments` early in its flow so the read-comments map can't grow without bound. Watches deserve the same treatment. `setupWatchToggles` is the natural home — it runs on every item page and already iterates the watches map further down.

- [ ] **Step 1: Update the config import in `src/features/watch-toggles.js`**

Replace the existing line:

```js
import { WATCH_RECHECK_THROTTLE_MS } from "../config.js";
```

with:

```js
import { WATCH_RECHECK_THROTTLE_MS, WATCH_TTL_MS } from "../config.js";
```

- [ ] **Step 2: Add the prune call inside `setupWatchToggles`**

Inside `setupWatchToggles`, immediately after the `if (!itemId) return;` line, add:

```js
	// Prune watches past the TTL on every item-page load — same
	// pattern that highlight-unread-comments uses for read-comment
	// entries, so the watch list can't grow without bound.
	store.pruneWatchedComments(Date.now(), WATCH_TTL_MS);
```

- [ ] **Step 3: Build and confirm**

Run: `just build && just test`
Expected: build succeeds; tests still pass.

- [ ] **Step 4: Commit**

```bash
just fmt
just build
git add src/features/watch-toggles.js script.js
git commit -m "feat(watch): prune expired watches on item-page load"
```

---

## Task 17: Update `CLAUDE.md` documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "What this is" section**

In `CLAUDE.md`, the "Comment-page enrichment layer" bullet (item 2 in the numbered list) currently ends with:

> ... a draggable toolbar for export/import, and a "show comment box" toggle that collapses the page-bottom comment-submit form.

Append, before the period:

> ..., and a per-comment "watch for replies" toggle (eye icon) with toolbar prev/next nav between watched comments.

Then add a new bullet at the end of that numbered section (after the current item 5):

```markdown
6. **Watch-for-replies cross-page layer**: `setupWatchedListingHighlights` runs on listing pages (anything with `table.itemlist`); for each story whose thread contains a watched comment, fires a throttle-aware Firebase API recheck and adds `.hn-watched-link` (bold HN orange + `★ ` prefix) to the "n comments" link when new direct replies have arrived since you started watching.
```

- [ ] **Step 2: Update the "Repository layout" tree**

Under the existing `src/features/` listing, add three new entries (alphabetical with the others) before `user-render.js`:

```
    watch-toggles.js         setupWatchToggles: per-comment 👁/👁‍🗨 toggle in the
                             user-render row; on click, persists a watch entry
                             keyed by comment id; on page load, marks watched
                             rows and syncs seenKids/latestKids
    watched-comment-nav.js   setupWatchedCommentNav: appends ↑ watch / watch ↓
                             buttons to the toolbar when at least one watched
                             comment is on the page; disabled state at ends
    watched-listing-highlights.js  setupWatchedListingHighlights: on listing
                             pages, restyles the "n comments" link of stories
                             whose thread contains a watched comment with new
                             replies (★ + bold HN orange)
```

- [ ] **Step 3: Update "Storage" section**

The current "Storage" section describes the `hn_state` shape. After the existing block, add `watchedComments`:

```
{ schemaVersion: 1,
  ratings: { <user>: int },
  tags:    { <user>: [<tagName>, ...] },
  colors:  { <tagName>: { bgColor, textColor } },
  cache:   { <user>: { created, karma, fetchedAt } },
  itemCache: { <itemId>: { title, ..., kids, fetchedAt } },
  watchedComments: { <commentId>: { itemId, seenKids, latestKids, lastCheckedAt, addedAt } } }
```

- [ ] **Step 4: Update "Architecture" with a Watch-for-replies subsection**

Append a new subsection before "Wiring (`src/main.js`)":

```markdown
### Watch-for-replies (`src/features/watch-toggles.js`, `watched-comment-nav.js`, `watched-listing-highlights.js`)

A per-comment "watch this for replies" toggle. On click, the eye icon between the rating control and the tag input persists `state.watchedComments[commentId] = { itemId, seenKids, latestKids, lastCheckedAt, addedAt }`. The watch is per-comment (not per-user) — a single user with three comments in a thread can be watched on one, two, or all three independently.

Reply detection is proactive: every HN page load (including listing pages) walks the watches map, fires a `fetchItem(commentId, { fresh: true })` for any watch whose `lastCheckedAt` is past the 30-minute throttle, and updates `latestKids` with the response. The `fresh` opt-in bypasses `fetchItem`'s 6-hour persistent cache; without it, the throttle would be a no-op for the first six hours after a watch is created.

`hasNew` is derived as `latestKids.some(id => !seenKids.includes(id))`. On listing pages, the "n comments" link gets `.hn-watched-link` (bold HN orange + a `★ ` prefix) when any watch in that thread has `hasNew`. On item pages, every watched-comment row on the page is given `.hn-watched` (orange left border + faint yellow tint), and `markWatchSeen` syncs `seenKids = latestKids` so the listing-page highlight is cleared by the act of visiting.

Lifecycle: watches persist until the user toggles off. A 14-day TTL (`WATCH_TTL_MS`) is enforced on every item-page load via `store.pruneWatchedComments` — HN threads rarely receive replies after that window, and the prune stops the list growing forever on cold threads.

The toolbar gains two extra buttons (`↑ watch`, `watch ↓`) when at least one watched comment is on the page, jumping between watched comments in document order. `watched-comment-nav` discovers the toolbar's button container via the new `toolbar.getButtonsContainer()` accessor — the toolbar itself doesn't know about watches.
```

- [ ] **Step 5: Update "Userscript metadata" / "Code style" / "Gotchas"**

No changes needed — no new `@grant`s (we reuse `GM_xmlhttpRequest`), no new style tokens, no new file-naming patterns.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): describe watch-for-replies feature"
```

---

## Task 18: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a bullet under "On comment pages"**

The README has an "On comment pages (`news.ycombinator.com/item?id=*`)" section with a per-commenter bulleted list (Account age and karma / Up/down rating buttons / Tag input / Tag list / Original-poster highlight). Add a new bullet at the end of that list:

```markdown
- **Watch for replies**: toggle the 👁 icon on any comment to start watching it. On the next visit to a listing page (`/news`, `/newest`, etc.), the story's "n comments" link is bold orange with a `★` prefix when new direct replies have arrived since you started watching. On the comment page itself, watched comments are marked with an orange left border and faint yellow tint, and the toolbar grows `↑ watch` / `watch ↓` buttons that jump between watched comments on the page. Watches persist until you toggle them off, with a 14-day TTL backstop on cold threads.
```

- [ ] **Step 2: Add a "Watching for replies" usage paragraph**

The README has a "Using it" section with paragraphs like "**Rating a commenter.**", "**Tagging a commenter.**", etc. Add a new paragraph after "**Removing a tag.**" and before "**Managing all tags.**":

```markdown
**Watching for replies.** Click the 👁 icon next to any commenter's username (between the rating ▲▼ and the tag input) to flag the comment as one you'd like to know about future replies to. The icon switches to 👁‍🗨 and the comment row is highlighted. The next time you load `/news` (or any listing page) where that thread appears, the "n comments" link is highlighted with a `★` prefix if new direct replies have arrived. Click the comment page to acknowledge them; the highlight clears until more replies arrive.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): describe watch-for-replies feature"
```

---

## Task 19: Final verification

**Files:** none modified

- [ ] **Step 1: Run the full check**

Run: `just check`
Expected: PASS — lint clean, format clean, all tests green, build artifact in sync.

- [ ] **Step 2: Confirm `script.js` is up-to-date**

Run: `git status`
Expected: working tree clean.

If there are uncommitted changes to `script.js`, the build picked them up just now — commit them with the feature commit they belong to (or a `chore: rebuild bundle` commit if it's truly a no-op).

- [ ] **Step 3: End-to-end smoke test**

Load `script.js` in Tampermonkey/Violentmonkey. Walk through the full flow:

1. Visit `https://news.ycombinator.com/`. No `★` markers (no watches yet).
2. Click into any active thread.
3. Click the 👁 icon on three different comments. Each row gets the orange-left-border + yellow tint immediately. Toolbar shows `↑ watch` / `watch ↓` buttons.
4. Click `watch ↓` three times — page scrolls to each watched comment in turn. After the third, `watch ↓` is disabled.
5. Click `↑ watch` twice — scrolls back. After two clicks `↑ watch` is disabled.
6. Reload the page. All three icons still in `👁‍🗨` state, all three rows still highlighted, all three nav buttons still present.
7. Open the export dialog (Save state). Confirm the downloaded JSON contains a `watches` block keyed by your three comment ids.
8. Toggle off one of the watches. Row highlight disappears, icon reverts to `👁`. Toolbar nav reduces to two-stop traversal.
9. Open Tampermonkey storage and hand-edit `hn_state.watchedComments.<commentId>.latestKids` to add an extra id not in `seenKids`. Visit the front page — the story's "n comments" link is bold orange with `★ ` prefix.
10. Click through to the item page. Watch row paints. Return to `/news`: link is no longer highlighted.
11. Wait 30+ minutes (or hand-edit `lastCheckedAt` to be older). Reload `/news`. Confirm the recheck fires (Network tab shows a Firebase API call) and behaviour is consistent.

- [ ] **Step 4: Final commit if needed**

Nothing should be uncommitted at this point. If anything is, commit it.

- [ ] **Step 5: Push branch and open PR**

When you're ready to land:

```bash
git push -u origin feat/watch-for-replies
gh pr create --title "feat: watch for replies" --body "$(cat <<'EOF'
## Summary

- Adds a per-comment "watch for replies" toggle (eye icon, between rating ▲▼ and tag input).
- Listing pages highlight the "n comments" link with bold orange + ★ prefix when any watched comment in that thread has new direct replies (proactive HN Firebase API check, 30-min throttle).
- Item pages mark watched comments with an orange left border and faint yellow tint, and the toolbar grows ↑ watch / watch ↓ buttons when ≥1 watch is on the page.
- 14-day TTL backstop; watches persist in exports.

Spec: `docs/superpowers/specs/2026-05-07-watch-for-replies-design.md`
Plan: `docs/superpowers/plans/2026-05-07-watch-for-replies.md`

## Test plan

- [ ] Pure-helper tests pass (`tests/parsingWatch.test.js`, `tests/stateWatch.test.js`)
- [ ] `just check` clean
- [ ] Manual: toggle on/off, row highlight, toolbar nav (single-watch and multi-watch), listing-page link highlight, visit-clears-highlight round trip, export/import round trip
- [ ] Manual: cross-tab sync (toggle in tab A, observe state in tab B)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope (per spec)

- Auto-scrolling to first watched comment on arrival.
- "n new replies" count in listing-link tooltip or toolbar.
- Wraparound for prev/next nav.
- Bulk watch / unwatch / list-all-watches UI.
- External notifications (push, desktop, email).
- Watching a story (as opposed to a comment).

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

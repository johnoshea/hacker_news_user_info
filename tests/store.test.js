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

// The cross-tab listener hands the store the old and new raw blobs that
// GM_addValueChangeListener reports. _applyRemoteChange refreshes the
// in-memory snapshot (so later reads see the other tab's write without a
// backend round-trip) and returns the set of users whose tag/rating UI
// must be re-rendered. A cache-only change returns an empty set, which is
// how the listener avoids the re-render storm.
test("store: _applyRemoteChange returns affected users and refreshes the cache", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setRating("alice", 1);

	const oldRaw = backend.data.hn_state;
	const next = JSON.parse(oldRaw);
	next.ratings.alice = 9;
	const newRaw = JSON.stringify(next);

	const affected = store._applyRemoteChange(oldRaw, newRaw);
	assert.deepEqual(affected, new Set(["alice"]));
	// In-memory snapshot now reflects the remote write without re-reading.
	assert.equal(store.getRating("alice"), 9);
});

test("store: _applyRemoteChange returns an empty set for a cache-only write", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setRating("alice", 1);

	const oldRaw = backend.data.hn_state;
	const next = JSON.parse(oldRaw);
	next.cache = { bob: { created: 1, karma: 2, fetchedAt: 100 } };
	const affected = store._applyRemoteChange(oldRaw, JSON.stringify(next));
	assert.equal(affected.size, 0);
});

// User data and the background caches live under separate keys so a cache
// write (the page-load fetch storm) can never rewrite the blob carrying
// ratings/tags and roll a freshly-clicked rating back in another tab.
test("store: user-data edits and cache writes use separate keys", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setRating("alice", 1);
	store.setUserTags("alice", [
		{ value: "t", bgColor: "hsl(1,50%,80%)", textColor: "black" },
	]);
	// User-data edits write only hn_state.
	assert.deepEqual(Object.keys(backend.data), ["hn_state"]);

	// A cache write lands in hn_cache and leaves hn_state byte-for-byte intact.
	const userBlob = backend.data.hn_state;
	store.setCachedUser("alice", { created: 1, karma: 2 }, 1000);
	assert.deepEqual(Object.keys(backend.data).sort(), ["hn_cache", "hn_state"]);
	assert.equal(
		backend.data.hn_state,
		userBlob,
		"a cache write must not touch hn_state",
	);
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

	const persisted = JSON.parse(backend.data.hn_seen);
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
	// The user cache lives in the separate hn_cache key, untouched.
	assert.equal(JSON.parse(backend.data.hn_cache).cache.alice.created, 1);
});

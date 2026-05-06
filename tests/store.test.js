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

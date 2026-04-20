const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createStore } = require("./_load");

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

test("store: setUserTags trims whitespace and de-dupes per-user tags", () => {
	const store = createStore(makeFakeBackend());
	store.setUserTags("alice", [
		{ value: " expert ", bgColor: "hsl(10,50%,80%)", textColor: "black" },
		{ value: "expert" },
		{ value: "  " },
		{ value: "helper", bgColor: "hsl(20,50%,80%)", textColor: "black" },
		{ value: "helper" },
	]);

	assert.deepEqual(store.getUserTags("alice"), [
		{ value: "expert", bgColor: "hsl(10,50%,80%)", textColor: "black" },
		{ value: "helper", bgColor: "hsl(20,50%,80%)", textColor: "black" },
	]);
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

test("store: loading persisted state normalizes whitespace variants and duplicates", () => {
	const backend = makeFakeBackend({
		hn_state: JSON.stringify({
			schemaVersion: 1,
			ratings: {},
			tags: { alice: [" expert ", "expert", "", "helper", "helper"] },
			colors: {
				expert: { bgColor: "hsl(10,50%,80%)", textColor: "black" },
				helper: { bgColor: "hsl(20,50%,80%)", textColor: "black" },
			},
			cache: {},
		}),
	});

	const store = createStore(backend);

	assert.deepEqual(store.getUserTags("alice"), [
		{ value: "expert", bgColor: "hsl(10,50%,80%)", textColor: "black" },
		{ value: "helper", bgColor: "hsl(20,50%,80%)", textColor: "black" },
	]);
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

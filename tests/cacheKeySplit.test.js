import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, migrateCacheKeySplit } from "../src/state.js";

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

// The bug this whole change exists to kill: ratings and the churny
// background caches used to share one whole-blob key, so a cache write
// (the page-load fetchUser storm) emitted a state broadcast that could
// roll a freshly-clicked rating back in other tabs. With the split, a
// cache write must never touch hn_state — so it can never be the source
// of a user-data cross-tab broadcast.
test("split: a cache write does not rewrite hn_state", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setRating("alice", 1);

	const hnStateBefore = backend.data.hn_state;
	store.setCachedUser("alice", { created: 1, karma: 2 }, 1000);

	assert.equal(
		backend.data.hn_state,
		hnStateBefore,
		"setCachedUser must not rewrite hn_state",
	);
	assert.equal(store.getRating("alice"), 1);
	assert.ok(
		JSON.parse(backend.data.hn_cache).cache.alice,
		"the cache entry should land in hn_cache",
	);
});

// Symmetric isolation: a user-data edit must not rewrite the cache key.
test("split: a user-data write does not rewrite hn_cache", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setCachedUser("alice", { created: 1, karma: 2 }, 1000);

	const hnCacheBefore = backend.data.hn_cache;
	store.setRating("alice", 5);

	assert.equal(
		backend.data.hn_cache,
		hnCacheBefore,
		"setRating must not rewrite hn_cache",
	);
	assert.equal(store.getRating("alice"), 5);
});

// Reads still see both slices through the one merged snapshot.
test("split: getters read both keys transparently", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setRating("alice", 2);
	store.setCachedUser("alice", { created: 7, karma: 8 }, 1000);
	store.setWatchedComment("99", {
		itemId: "1",
		seenKids: [],
		latestKids: ["c1"],
		lastCheckedAt: 0,
		addedAt: 0,
	});

	assert.equal(store.getRating("alice"), 2);
	assert.deepEqual(store.getCachedUser("alice", 1000, 60_000), {
		created: 7,
		karma: 8,
	});
	assert.ok(store.getWatchedComment("99"));
});

test("migrateCacheKeySplit: splits a monolithic blob into two keys", () => {
	const monolithic = {
		schemaVersion: 1,
		ratings: { a: 3 },
		tags: { a: ["x"] },
		colors: { x: { bgColor: "c", textColor: "black" } },
		cache: { u: { created: 1, karma: 2, fetchedAt: 5 } },
		itemCache: {},
		readComments: { 1: { ids: ["c1"], fetchedAt: 5 } },
		watchedComments: {
			99: {
				itemId: "1",
				seenKids: [],
				latestKids: [],
				lastCheckedAt: 0,
				addedAt: 0,
			},
		},
	};
	const backend = makeFakeBackend({ hn_state: JSON.stringify(monolithic) });

	migrateCacheKeySplit(backend);

	const cache = JSON.parse(backend.data.hn_cache);
	assert.deepEqual(cache.cache, { u: { created: 1, karma: 2, fetchedAt: 5 } });
	assert.deepEqual(cache.readComments, { 1: { ids: ["c1"], fetchedAt: 5 } });
	assert.ok(cache.watchedComments["99"]);

	// User data stays readable in hn_state (rollback-safe).
	const user = JSON.parse(backend.data.hn_state);
	assert.deepEqual(user.ratings, { a: 3 });
	assert.deepEqual(user.tags, { a: ["x"] });
	assert.deepEqual(user.colors, { x: { bgColor: "c", textColor: "black" } });

	// And a fresh store reads the migrated data back through both keys.
	const store = createStore(backend);
	assert.equal(store.getRating("a"), 3);
	assert.deepEqual(store.getCachedUser("u", 5, 60_000), {
		created: 1,
		karma: 2,
	});
	assert.ok(store.getWatchedComment("99"));
});

test("migrateCacheKeySplit: no-op when hn_cache already exists", () => {
	const backend = makeFakeBackend({
		hn_state: JSON.stringify({ ratings: { a: 3 } }),
		hn_cache: JSON.stringify({
			cache: {},
			itemCache: {},
			readComments: {},
			watchedComments: {
				99: {
					itemId: "1",
					seenKids: [],
					latestKids: [],
					lastCheckedAt: 0,
					addedAt: 0,
				},
			},
		}),
	});
	const before = backend.data.hn_cache;

	migrateCacheKeySplit(backend);

	assert.equal(
		backend.data.hn_cache,
		before,
		"hn_cache must be left untouched",
	);
});

test("migrateCacheKeySplit: no-op on a fresh install", () => {
	const backend = makeFakeBackend();
	migrateCacheKeySplit(backend);
	assert.equal(backend.data.hn_state, undefined);
	assert.equal(backend.data.hn_cache, undefined);
});

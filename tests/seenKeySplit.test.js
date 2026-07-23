import assert from "node:assert/strict";
import { test } from "node:test";
import { SEEN_KEY } from "../src/config.js";
import {
	createStore,
	migrateCacheKeySplit,
	migrateSeenKeySplit,
} from "../src/state.js";

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

// The bug this split exists to kill: watch/read state used to share the
// hn_cache key with the page-load fetch storm (hundreds of setCachedUser
// RMW writes over minutes). A storm write computed from a stale snapshot
// could roll back a listing tab's just-written watch recheck, silently
// consuming the "new replies" flag. With the split, a cache write must
// never touch the key carrying watches and read-comment baselines.
test("split: a cache write does not rewrite hn_seen", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setWatchedComment("99", {
		itemId: "1",
		seenKids: [],
		latestKids: ["k1"],
		lastCheckedAt: 0,
		addedAt: 0,
	});

	const seenBefore = backend.data[SEEN_KEY];
	store.setCachedUser("alice", { created: 1, karma: 2 }, 1000);

	assert.equal(
		backend.data[SEEN_KEY],
		seenBefore,
		"setCachedUser must not rewrite hn_seen",
	);
	assert.deepEqual(store.getWatchedComment("99").latestKids, ["k1"]);
});

test("split: seen-state writes land in hn_seen, not hn_cache", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setWatchedComment("99", {
		itemId: "1",
		seenKids: [],
		latestKids: [],
		lastCheckedAt: 0,
		addedAt: 0,
	});
	store.setReadComments("1", ["c1"], 1000);
	store.setStoryWatch("42", 5, 1000);

	const seen = JSON.parse(backend.data[SEEN_KEY]);
	assert.ok(seen.watchedComments["99"]);
	assert.deepEqual(seen.readComments, { 1: { ids: ["c1"], fetchedAt: 1000 } });
	assert.deepEqual(seen.watchedStories, {
		42: { seenCount: 5, fetchedAt: 1000 },
	});
	// No cache write has happened, so the cache key shouldn't even exist.
	assert.equal(backend.data.hn_cache, undefined);
});

// The observed failure, reproduced: tab A's listing recheck writes fresh
// latestKids; tab B — injected earlier, its GM value snapshot not yet
// updated by the async cross-tab delivery — then writes a user digest
// from that stale snapshot. Pre-split, tab B's whole-blob hn_cache write
// carried the stale watch entry back over tab A's recheck.
test("regression: a stale-tab cache write cannot roll back a watch recheck", () => {
	const shared = makeFakeBackend();
	const tabA = createStore(shared);
	tabA.setWatchedComment("99", {
		itemId: "1",
		seenKids: [],
		latestKids: [],
		lastCheckedAt: 0,
		addedAt: 0,
	});

	// Tab B injects now; freeze its view of every key to model delivery lag.
	const frozen = { ...shared.data };
	const tabB = createStore({
		get: (k) => (k in frozen ? frozen[k] : undefined),
		set: shared.set,
	});

	// Tab A's recheck discovers a new reply.
	tabA.updateWatchKids("99", ["k1"], 1000);

	// Tab B's fetch storm writes a user digest from its stale snapshot.
	tabB.setCachedUser("someone", { created: 1, karma: 2 }, 2000);

	// The recheck result must survive on disk.
	const fresh = createStore(shared);
	assert.deepEqual(fresh.getWatchedComment("99").latestKids, ["k1"]);
});

test("migrateSeenKeySplit: lifts the seen fields out of a 0.11 hn_cache", () => {
	const cacheBlob = {
		cache: { u: { created: 1, karma: 2, fetchedAt: 5 } },
		itemCache: {},
		readComments: { 1: { ids: ["c1"], fetchedAt: 5 } },
		watchedComments: {
			99: {
				itemId: "1",
				seenKids: [],
				latestKids: ["k1"],
				lastCheckedAt: 0,
				addedAt: 0,
			},
		},
		watchedStories: { 42: { seenCount: 5, fetchedAt: 5 } },
	};
	const backend = makeFakeBackend({ hn_cache: JSON.stringify(cacheBlob) });

	migrateSeenKeySplit(backend);

	const seen = JSON.parse(backend.data[SEEN_KEY]);
	assert.deepEqual(seen.readComments, { 1: { ids: ["c1"], fetchedAt: 5 } });
	assert.deepEqual(seen.watchedComments["99"].latestKids, ["k1"]);
	assert.deepEqual(seen.watchedStories, { 42: { seenCount: 5, fetchedAt: 5 } });

	// Additive: hn_cache is left in place for concurrent old-snapshot tabs.
	assert.equal(backend.data.hn_cache, JSON.stringify(cacheBlob));

	// A fresh store reads the migrated data through the new key...
	const store = createStore(backend);
	assert.deepEqual(store.getWatchedComment("99").latestKids, ["k1"]);
	assert.deepEqual(store.getReadComments("1").ids, ["c1"]);
	assert.equal(store.getWatchedStory("42").seenCount, 5);

	// ...and the next cache write rewrites hn_cache from its narrowed
	// slice, dropping the now-duplicated seen fields.
	store.setCachedUser("v", { created: 3, karma: 4 }, 6);
	const trimmed = JSON.parse(backend.data.hn_cache);
	assert.equal(trimmed.watchedComments, undefined);
	assert.equal(trimmed.readComments, undefined);
	assert.equal(trimmed.watchedStories, undefined);
	assert.ok(trimmed.cache.u);
});

test("migrateSeenKeySplit: no-op when hn_seen already exists", () => {
	const backend = makeFakeBackend({
		hn_cache: JSON.stringify({ watchedComments: { 1: { itemId: "9" } } }),
		[SEEN_KEY]: JSON.stringify({ watchedComments: {} }),
	});
	const before = backend.data[SEEN_KEY];

	migrateSeenKeySplit(backend);

	assert.equal(backend.data[SEEN_KEY], before, "hn_seen must be untouched");
});

test("migrateSeenKeySplit: no-op on a fresh install", () => {
	const backend = makeFakeBackend();
	migrateSeenKeySplit(backend);
	assert.equal(backend.data[SEEN_KEY], undefined);
	assert.equal(backend.data.hn_cache, undefined);
});

// A pre-0.11 install (everything monolithic in hn_state) upgrades through
// both migrations in sequence, same order main.js runs them.
test("migrateSeenKeySplit: chains after migrateCacheKeySplit", () => {
	const monolithic = {
		schemaVersion: 1,
		ratings: { a: 3 },
		tags: {},
		colors: {},
		cache: {},
		itemCache: {},
		readComments: {},
		watchedComments: {
			99: {
				itemId: "1",
				seenKids: [],
				latestKids: ["k1"],
				lastCheckedAt: 0,
				addedAt: 0,
			},
		},
		watchedStories: {},
	};
	const backend = makeFakeBackend({ hn_state: JSON.stringify(monolithic) });

	migrateCacheKeySplit(backend);
	migrateSeenKeySplit(backend);

	const store = createStore(backend);
	assert.equal(store.getRating("a"), 3);
	assert.deepEqual(store.getWatchedComment("99").latestKids, ["k1"]);
});

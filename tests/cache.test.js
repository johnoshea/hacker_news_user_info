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

test("pruneCaches: drops stale user and item entries, keeps fresh", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	const t0 = 1_000_000_000_000;
	store.setCachedUser("fresh", { created: 1, karma: 2 }, t0);
	store.setCachedUser("stale", { created: 1, karma: 2 }, t0 - 2 * HOUR_MS);
	store.setCachedItem("100", { title: "fresh item" }, t0);
	store.setCachedItem("200", { title: "stale item" }, t0 - 2 * HOUR_MS);

	store.pruneCaches(t0, HOUR_MS, HOUR_MS);

	const blob = JSON.parse(backend.data.hn_cache);
	assert.deepEqual(Object.keys(blob.cache), ["fresh"]);
	assert.deepEqual(Object.keys(blob.itemCache), ["100"]);
});

test("pruneCaches: no write when nothing is stale", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	const t0 = 1_000_000_000_000;
	store.setCachedUser("alice", { created: 1, karma: 2 }, t0);
	const before = backend.data.hn_cache;
	store.pruneCaches(t0, HOUR_MS, HOUR_MS);
	// mutateCache() skips the backend.set when the mutator returns false, so
	// the stored blob reference is untouched.
	assert.equal(backend.data.hn_cache, before);
});

test("setRating: a zero rating removes the entry rather than storing 0", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setRating("alice", 3);
	store.setRating("alice", 0);
	assert.equal(store.getRating("alice"), 0);
	assert.deepEqual(Object.keys(JSON.parse(backend.data.hn_state).ratings), []);
});

test("setUserTags: an empty list removes the user key rather than storing []", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setUserTags("alice", [{ value: "spammer" }]);
	store.setUserTags("alice", []);
	assert.deepEqual(store.getUserTags("alice"), []);
	assert.deepEqual(Object.keys(JSON.parse(backend.data.hn_state).tags), []);
});

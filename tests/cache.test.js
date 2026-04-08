const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createStore } = require("./_load");

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

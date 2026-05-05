import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../src/state.js";

// itemCache mirrors the user cache: digest in, fetchedAt stamped on
// write, TTL-checked on read. The hover-panel feature (PR-4) reads
// from it before falling back to the network so cursor passes over
// already-hovered links cost zero requests.

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
const SAMPLE_DIGEST = {
	title: "Show HN: Foo",
	url: "https://example.com/foo",
	by: "alice",
	score: 42,
	descendants: 7,
	time: 1_700_000_000,
	text: "",
	type: "story",
};

test("itemCache: miss on empty store", () => {
	const store = createStore(makeFakeBackend());
	assert.equal(store.getCachedItem("123", Date.now(), HOUR_MS), null);
});

test("itemCache: hit within TTL returns the digest (without fetchedAt)", () => {
	const store = createStore(makeFakeBackend());
	const t0 = 1_000_000_000_000;
	store.setCachedItem("123", SAMPLE_DIGEST, t0);
	const hit = store.getCachedItem("123", t0 + HOUR_MS - 1, HOUR_MS);
	assert.deepEqual(hit, SAMPLE_DIGEST);
	assert.equal(hit.fetchedAt, undefined);
});

test("itemCache: miss when past TTL", () => {
	const store = createStore(makeFakeBackend());
	const t0 = 1_000_000_000_000;
	store.setCachedItem("123", SAMPLE_DIGEST, t0);
	assert.equal(store.getCachedItem("123", t0 + HOUR_MS + 1, HOUR_MS), null);
});

test("itemCache: persists across store instances", () => {
	const backend = makeFakeBackend();
	const t0 = 1_000_000_000_000;
	createStore(backend).setCachedItem("123", SAMPLE_DIGEST, t0);
	const hit = createStore(backend).getCachedItem("123", t0, HOUR_MS);
	assert.deepEqual(hit, SAMPLE_DIGEST);
});

test("itemCache: setCachedItem overwrites the previous digest", () => {
	const store = createStore(makeFakeBackend());
	store.setCachedItem("123", SAMPLE_DIGEST, 1000);
	store.setCachedItem("123", { ...SAMPLE_DIGEST, score: 999 }, 2000);
	const hit = store.getCachedItem("123", 2000, HOUR_MS);
	assert.equal(hit.score, 999);
});

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

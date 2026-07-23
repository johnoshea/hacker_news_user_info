import assert from "node:assert/strict";
import { test } from "node:test";
import { SEEN_KEY, STATE_KEY } from "../src/config.js";
import { parseCommentCount } from "../src/parsing.js";
import { createStore, parseImport, stateToExport } from "../src/state.js";

// Story-level watches live in hn_seen alongside watchedComments. The
// listing flag is derived by comparing the count HN renders now against
// the `seenCount` captured on the last item-page visit — so the parse of
// HN's "N comments" link text is the one piece of real logic here.

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

test("parseCommentCount: reads the integer from HN's link text", () => {
	assert.equal(parseCommentCount("73 comments"), 73);
	assert.equal(parseCommentCount("1 comment"), 1);
	assert.equal(parseCommentCount("0 comments"), 0);
});

test("parseCommentCount: tolerates the &nbsp; separator HN renders", () => {
	// HN writes "73&nbsp;comments"; textContent yields a non-breaking space.
	assert.equal(parseCommentCount("73 comments"), 73);
});

test("parseCommentCount: strips thousands separators", () => {
	assert.equal(parseCommentCount("1,234 comments"), 1234);
});

test("parseCommentCount: no digits (e.g. 'discuss') is zero", () => {
	assert.equal(parseCommentCount("discuss"), 0);
	assert.equal(parseCommentCount(""), 0);
	assert.equal(parseCommentCount(null), 0);
	assert.equal(parseCommentCount(undefined), 0);
});

test("store: empty backend yields no story watches", () => {
	const store = createStore(makeFakeBackend());
	assert.deepEqual(store.getWatchedStories(), {});
	assert.equal(store.getWatchedStory("1"), null);
});

test("store: setStoryWatch persists seenCount + timestamp and round-trips", () => {
	const store = createStore(makeFakeBackend());
	store.setStoryWatch("42", 73, 1000);
	assert.deepEqual(store.getWatchedStory("42"), {
		seenCount: 73,
		fetchedAt: 1000,
	});
	assert.deepEqual(store.getWatchedStories(), {
		42: { seenCount: 73, fetchedAt: 1000 },
	});
});

test("store: story watches are written to hn_seen, not hn_state", () => {
	const backend = makeFakeBackend();
	const store = createStore(backend);
	store.setStoryWatch("42", 5, 1000);
	assert.ok(backend.data[SEEN_KEY].includes("watchedStories"));
	// hn_state, if written at all, must not carry the watch.
	assert.ok(!(backend.data[STATE_KEY] || "").includes("watchedStories"));
});

test("store: removeStoryWatch deletes the entry, no-op when absent", () => {
	const store = createStore(makeFakeBackend());
	store.setStoryWatch("42", 5, 1000);
	store.removeStoryWatch("42");
	assert.equal(store.getWatchedStory("42"), null);
	// Removing a watch that isn't there doesn't throw.
	store.removeStoryWatch("99");
	assert.equal(store.getWatchedStory("99"), null);
});

test("store: pruneWatchedStories drops entries past the TTL, keeps fresh ones", () => {
	const store = createStore(makeFakeBackend());
	store.setStoryWatch("old", 5, 0);
	store.setStoryWatch("new", 5, 10_000);
	store.pruneWatchedStories(11_000, 5_000); // TTL 5s; "old" is 11s stale
	assert.equal(store.getWatchedStory("old"), null);
	assert.deepEqual(store.getWatchedStory("new"), {
		seenCount: 5,
		fetchedAt: 10_000,
	});
});

test("store: replaceAll round-trips story watches", () => {
	const store = createStore(makeFakeBackend());
	store.replaceAll({
		watchedStories: { 42: { seenCount: 5, fetchedAt: 1000 } },
	});
	assert.deepEqual(store.getWatchedStory("42"), {
		seenCount: 5,
		fetchedAt: 1000,
	});
});

test("export/import: story watches survive a round-trip", () => {
	const exported = stateToExport({
		watchedStories: { 42: { seenCount: 73, fetchedAt: 1000 } },
	});
	assert.deepEqual(exported.storyWatches, {
		42: { seenCount: 73, fetchedAt: 1000 },
	});
	const parsed = parseImport(exported);
	assert.deepEqual(parsed.watchedStories, {
		42: { seenCount: 73, fetchedAt: 1000 },
	});
});

test("import: a backup without storyWatches yields an empty map", () => {
	const parsed = parseImport({ users: {}, customTags: {} });
	assert.deepEqual(parsed.watchedStories, {});
});

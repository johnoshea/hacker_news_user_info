import assert from "node:assert/strict";
import { test } from "node:test";
import {
	findNewCommentIds,
	isReadCommentEntryFresh,
	pruneExpiredReadComments,
} from "../src/parsing.js";

// Pure helpers behind the highlight-unread-comments feature. The DOM
// pass collects current comment IDs from tr.comtr[id], asks the store
// for the previously-stored IDs, hands both arrays here, and uses the
// result to mark new comments. The store is cleaned up on every item
// page load via pruneExpiredReadComments to keep the slice from growing
// unboundedly.

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 3 * DAY_MS;

test("findNewCommentIds: no stored ids means everything is new", () => {
	assert.deepEqual(findNewCommentIds(["a", "b", "c"], []), ["a", "b", "c"]);
});

test("findNewCommentIds: empty current list yields empty new list", () => {
	assert.deepEqual(findNewCommentIds([], ["a"]), []);
});

test("findNewCommentIds: returns only ids not present in stored", () => {
	assert.deepEqual(findNewCommentIds(["a", "b", "c", "d"], ["a", "c"]), [
		"b",
		"d",
	]);
});

test("findNewCommentIds: preserves the order from currentIds", () => {
	assert.deepEqual(findNewCommentIds(["c", "a", "b"], ["a"]), ["c", "b"]);
});

test("findNewCommentIds: defensive against null inputs", () => {
	assert.deepEqual(findNewCommentIds(null, null), []);
	assert.deepEqual(findNewCommentIds(undefined, undefined), []);
});

test("isReadCommentEntryFresh: fresh entry within TTL", () => {
	const now = 1_000_000_000_000;
	assert.equal(
		isReadCommentEntryFresh({ fetchedAt: now - DAY_MS, ids: [] }, now, TTL_MS),
		true,
	);
});

test("isReadCommentEntryFresh: stale entry past TTL", () => {
	const now = 1_000_000_000_000;
	assert.equal(
		isReadCommentEntryFresh(
			{ fetchedAt: now - 4 * DAY_MS, ids: [] },
			now,
			TTL_MS,
		),
		false,
	);
});

test("isReadCommentEntryFresh: missing entry / missing fetchedAt is stale", () => {
	const now = 1_000_000_000_000;
	assert.equal(isReadCommentEntryFresh(null, now, TTL_MS), false);
	assert.equal(isReadCommentEntryFresh(undefined, now, TTL_MS), false);
	assert.equal(isReadCommentEntryFresh({}, now, TTL_MS), false);
	assert.equal(
		isReadCommentEntryFresh(
			{ ids: [], fetchedAt: "not a number" },
			now,
			TTL_MS,
		),
		false,
	);
});

test("pruneExpiredReadComments: keeps fresh, drops stale", () => {
	const now = 1_000_000_000_000;
	const map = {
		fresh: { fetchedAt: now - DAY_MS, ids: ["x"] },
		stale: { fetchedAt: now - 5 * DAY_MS, ids: ["y"] },
		brand_new: { fetchedAt: now, ids: [] },
	};
	const pruned = pruneExpiredReadComments(map, now, TTL_MS);
	assert.deepEqual(Object.keys(pruned).sort(), ["brand_new", "fresh"]);
});

test("pruneExpiredReadComments: empty map is empty", () => {
	assert.deepEqual(pruneExpiredReadComments({}, 100, TTL_MS), {});
	assert.deepEqual(pruneExpiredReadComments(null, 100, TTL_MS), {});
});

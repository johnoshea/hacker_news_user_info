import assert from "node:assert/strict";
import { test } from "node:test";
import {
	watchHasNewReplies,
	isWatchCheckStale,
	pruneExpiredWatches,
	watchesByItemId,
} from "../src/parsing.js";

// The watch-for-replies feature stores `seenKids` (replies the user has
// acknowledged by visiting the comment page) and `latestKids` (replies
// from the most recent API check). A reply is "new" iff it appears in
// latestKids but not in seenKids — the user has not yet acknowledged it.

test("watchHasNewReplies: empty arrays mean no new replies", () => {
	assert.equal(watchHasNewReplies([], []), false);
});

test("watchHasNewReplies: identical arrays mean no new replies", () => {
	assert.equal(watchHasNewReplies(["a", "b"], ["a", "b"]), false);
});

test("watchHasNewReplies: latestKids subset of seenKids — no new replies", () => {
	// Defensive: if HN somehow returns fewer kids than we'd already seen
	// (a deletion, perhaps), there's nothing new.
	assert.equal(watchHasNewReplies(["a", "b", "c"], ["a", "b"]), false);
});

test("watchHasNewReplies: one id only in latestKids — has new", () => {
	assert.equal(watchHasNewReplies(["a"], ["a", "b"]), true);
});

test("watchHasNewReplies: multiple new ids — has new", () => {
	assert.equal(watchHasNewReplies([], ["a", "b", "c"]), true);
});

test("watchHasNewReplies: defensive against null/undefined", () => {
	assert.equal(watchHasNewReplies(null, null), false);
	assert.equal(watchHasNewReplies(undefined, undefined), false);
	assert.equal(watchHasNewReplies(null, ["a"]), true);
	assert.equal(watchHasNewReplies(["a"], null), false);
});

const MIN_MS = 60 * 1000;
const THROTTLE_MS = 30 * MIN_MS;

test("isWatchCheckStale: just-checked entry is fresh", () => {
	const now = 1_000_000_000_000;
	assert.equal(
		isWatchCheckStale({ lastCheckedAt: now }, now, THROTTLE_MS),
		false,
	);
});

test("isWatchCheckStale: exactly throttle-old is fresh (boundary)", () => {
	const now = 1_000_000_000_000;
	assert.equal(
		isWatchCheckStale({ lastCheckedAt: now - THROTTLE_MS }, now, THROTTLE_MS),
		false,
	);
});

test("isWatchCheckStale: well past throttle is stale", () => {
	const now = 1_000_000_000_000;
	assert.equal(
		isWatchCheckStale(
			{ lastCheckedAt: now - THROTTLE_MS - 1 },
			now,
			THROTTLE_MS,
		),
		true,
	);
});

test("isWatchCheckStale: missing entry / lastCheckedAt is stale", () => {
	const now = 1_000_000_000_000;
	assert.equal(isWatchCheckStale(null, now, THROTTLE_MS), true);
	assert.equal(isWatchCheckStale(undefined, now, THROTTLE_MS), true);
	assert.equal(isWatchCheckStale({}, now, THROTTLE_MS), true);
	assert.equal(
		isWatchCheckStale({ lastCheckedAt: "not a number" }, now, THROTTLE_MS),
		true,
	);
});

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 14 * DAY_MS;

test("pruneExpiredWatches: empty/null input returns empty object", () => {
	assert.deepEqual(pruneExpiredWatches({}, 100, TTL_MS), {});
	assert.deepEqual(pruneExpiredWatches(null, 100, TTL_MS), {});
	assert.deepEqual(pruneExpiredWatches(undefined, 100, TTL_MS), {});
});

test("pruneExpiredWatches: keeps fresh entries, drops stale", () => {
	const now = 1_000_000_000_000;
	const map = {
		fresh: { addedAt: now - DAY_MS },
		stale: { addedAt: now - 15 * DAY_MS },
		brand_new: { addedAt: now },
	};
	const pruned = pruneExpiredWatches(map, now, TTL_MS);
	assert.deepEqual(Object.keys(pruned).sort(), ["brand_new", "fresh"]);
});

test("pruneExpiredWatches: missing addedAt is dropped (defensive)", () => {
	const now = 1_000_000_000_000;
	const map = {
		ok: { addedAt: now },
		broken: {},
		broken2: { addedAt: "nope" },
	};
	const pruned = pruneExpiredWatches(map, now, TTL_MS);
	assert.deepEqual(Object.keys(pruned), ["ok"]);
});

test("watchesByItemId: empty input yields empty grouping", () => {
	assert.deepEqual(watchesByItemId({}), {});
	assert.deepEqual(watchesByItemId(null), {});
});

test("watchesByItemId: groups single watch under its itemId", () => {
	const grouped = watchesByItemId({
		c1: { itemId: "i1", seenKids: [], latestKids: ["r1"] },
	});
	assert.deepEqual(grouped, {
		i1: [{ commentId: "c1", hasNew: true }],
	});
});

test("watchesByItemId: groups multiple watches in one item", () => {
	const grouped = watchesByItemId({
		c1: { itemId: "i1", seenKids: ["r1"], latestKids: ["r1"] },
		c2: { itemId: "i1", seenKids: [], latestKids: ["r2"] },
	});
	// Order within an itemId is insertion order — fine for our use,
	// since callers iterate the whole array.
	assert.deepEqual(grouped, {
		i1: [
			{ commentId: "c1", hasNew: false },
			{ commentId: "c2", hasNew: true },
		],
	});
});

test("watchesByItemId: groups across multiple items", () => {
	const grouped = watchesByItemId({
		c1: { itemId: "i1", seenKids: [], latestKids: [] },
		c2: { itemId: "i2", seenKids: [], latestKids: ["r"] },
	});
	assert.deepEqual(grouped, {
		i1: [{ commentId: "c1", hasNew: false }],
		i2: [{ commentId: "c2", hasNew: true }],
	});
});

test("watchesByItemId: skips entries missing itemId (defensive)", () => {
	const grouped = watchesByItemId({
		c1: { seenKids: [], latestKids: [] },
		c2: { itemId: "i2", seenKids: [], latestKids: [] },
	});
	assert.deepEqual(grouped, {
		i2: [{ commentId: "c2", hasNew: false }],
	});
});

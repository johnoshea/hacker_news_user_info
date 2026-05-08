import assert from "node:assert/strict";
import { test } from "node:test";
import { watchHasNewReplies, isWatchCheckStale } from "../src/parsing.js";

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

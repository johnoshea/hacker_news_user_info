import assert from "node:assert/strict";
import { test } from "node:test";
import { affectedUsersByStateChange, emptyState } from "../src/state.js";

// affectedUsersByStateChange backs the cross-tab listener's decision about
// who to re-render when another tab writes the shared state blob. The whole
// point is that the blob carries both user-facing data (ratings, tags, tag
// colors) AND background caches (user/item digests, read-comment lists,
// watch entries); a write to the latter must NOT trigger any re-render. The
// function returns the set of usernames whose inline tag/rating UI would
// actually look different after the change.

function withRatings(ratings) {
	return { ...emptyState(), ratings };
}

test("affectedUsers: a cache-only change affects nobody", () => {
	// The storm we are fixing: another tab caches a freshly-fetched user or
	// item, bumping the blob. No rating/tag/color changed, so re-rendering
	// every visible user would be pure waste.
	const before = {
		...emptyState(),
		ratings: { alice: 3 },
		tags: { alice: ["spammer"] },
		colors: { spammer: { bgColor: "red", textColor: "black" } },
		cache: { bob: { created: 1, karma: 2, fetchedAt: 100 } },
	};
	const after = {
		...before,
		cache: {
			bob: { created: 1, karma: 2, fetchedAt: 100 },
			carol: { created: 5, karma: 9, fetchedAt: 200 },
		},
		itemCache: { 42: { title: "x", fetchedAt: 200 } },
		readComments: { 42: { ids: ["1"], fetchedAt: 200 } },
		watchedComments: {
			99: {
				itemId: "42",
				seenKids: [],
				latestKids: ["1"],
				lastCheckedAt: 1,
				addedAt: 1,
			},
		},
	};
	assert.equal(affectedUsersByStateChange(before, after).size, 0);
});

test("affectedUsers: a changed rating flags only that user", () => {
	const before = withRatings({ alice: 1, bob: 2 });
	const after = withRatings({ alice: 5, bob: 2 });
	assert.deepEqual(
		affectedUsersByStateChange(before, after),
		new Set(["alice"]),
	);
});

test("affectedUsers: an added rating flags that user", () => {
	const before = withRatings({});
	const after = withRatings({ alice: -3 });
	assert.deepEqual(
		affectedUsersByStateChange(before, after),
		new Set(["alice"]),
	);
});

test("affectedUsers: a removed rating flags that user", () => {
	const before = withRatings({ alice: 4 });
	const after = withRatings({});
	assert.deepEqual(
		affectedUsersByStateChange(before, after),
		new Set(["alice"]),
	);
});

test("affectedUsers: a changed tag list flags only that user", () => {
	const before = { ...emptyState(), tags: { alice: ["a"], bob: ["b"] } };
	const after = { ...emptyState(), tags: { alice: ["a", "c"], bob: ["b"] } };
	assert.deepEqual(
		affectedUsersByStateChange(before, after),
		new Set(["alice"]),
	);
});

test("affectedUsers: reordering a user's tags flags them (visible order changes)", () => {
	const before = { ...emptyState(), tags: { alice: ["a", "b"] } };
	const after = { ...emptyState(), tags: { alice: ["b", "a"] } };
	assert.deepEqual(
		affectedUsersByStateChange(before, after),
		new Set(["alice"]),
	);
});

test("affectedUsers: a tag color change flags every user carrying that tag", () => {
	// Recolouring a tag in the tag-manager overlay (no assignment change)
	// must repaint every comment by users who carry it.
	const before = {
		...emptyState(),
		tags: { alice: ["spammer"], bob: ["spammer", "expert"], carol: ["expert"] },
		colors: {
			spammer: { bgColor: "red", textColor: "black" },
			expert: { bgColor: "green", textColor: "black" },
		},
	};
	const after = {
		...before,
		colors: {
			spammer: { bgColor: "orange", textColor: "black" },
			expert: { bgColor: "green", textColor: "black" },
		},
	};
	assert.deepEqual(
		affectedUsersByStateChange(before, after),
		new Set(["alice", "bob"]),
	);
});

test("affectedUsers: identical states affect nobody", () => {
	const s = {
		...emptyState(),
		ratings: { alice: 1 },
		tags: { alice: ["a"] },
		colors: { a: { bgColor: "red", textColor: "black" } },
	};
	assert.equal(affectedUsersByStateChange(s, { ...s }).size, 0);
});

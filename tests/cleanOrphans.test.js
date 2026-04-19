const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cleanOrphans } = require("../scripts/clean-orphan-tags");

// Orphan color entries (tag names in `customTags` that no user carries)
// are dropped; in-use tags, their colors, ratings, and per-user tag
// lists are preserved. This mirrors the typing-artifact cleanup that
// motivated the script.
test("cleanOrphans drops unused color entries and preserves the rest", () => {
	const exported = {
		customTags: {
			used: { bgColor: "u", textColor: "black" },
			orphan: { bgColor: "o", textColor: "black" },
			also: { bgColor: "a", textColor: "black" },
		},
		users: {
			alice: { rating: 2, tags: ["used", "also"] },
			bob: { rating: 0, tags: ["used"] },
		},
	};

	const { cleaned, removed } = cleanOrphans(exported);

	assert.deepEqual(cleaned.customTags, {
		used: { bgColor: "u", textColor: "black" },
		also: { bgColor: "a", textColor: "black" },
	});
	assert.deepEqual(cleaned.users, {
		alice: { rating: 2, tags: ["used", "also"] },
		bob: { rating: 0, tags: ["used"] },
	});
	assert.deepEqual(removed, ["orphan"]);
});

// An export with no orphans round-trips through the cleaner unchanged.
// Guards against accidental filtering of in-use tags or users.
test("cleanOrphans is a no-op when every tag has a user", () => {
	const exported = {
		customTags: {
			foo: { bgColor: "f", textColor: "black" },
		},
		users: {
			alice: { rating: 1, tags: ["foo"] },
		},
	};

	const { cleaned, removed } = cleanOrphans(exported);

	assert.deepEqual(cleaned, exported);
	assert.deepEqual(removed, []);
});

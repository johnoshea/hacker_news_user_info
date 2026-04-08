const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseImport, stateToExport } = require("./_load");

// parseImport accepts either:
//   (A) the normalized export format: { customTags, users }
//   (B) the legacy flat-key dump: { hn_author_rating_<u>, hn_custom_tags_<u>, ... }
// and returns a consolidated state object matching the internal shape.

test("parseImport: normalized format produces expected state", () => {
	const imported = {
		customTags: {
			spammer: { bgColor: "hsl(10,50%,80%)", textColor: "black" },
			expert: { bgColor: "hsl(120,50%,80%)", textColor: "black" },
		},
		users: {
			alice: { rating: 3, tags: ["spammer", "expert"] },
			bob: { rating: -1, tags: [] },
		},
	};
	const state = parseImport(imported);
	assert.equal(state.ratings.alice, 3);
	assert.equal(state.ratings.bob, -1);
	assert.deepEqual(state.tags.alice, ["spammer", "expert"]);
	assert.deepEqual(state.tags.bob, []);
	assert.deepEqual(state.colors.spammer, {
		bgColor: "hsl(10,50%,80%)",
		textColor: "black",
	});
});

test("parseImport: legacy flat-key format produces expected state", () => {
	const imported = {
		hn_author_rating_alice: 5,
		hn_custom_tags_alice: JSON.stringify([
			{ value: "t", bgColor: "hsl(1,50%,80%)", textColor: "black" },
		]),
		hn_custom_tag_color_t: JSON.stringify({
			bgColor: "hsl(1,50%,80%)",
			textColor: "black",
		}),
	};
	const state = parseImport(imported);
	assert.equal(state.ratings.alice, 5);
	assert.deepEqual(state.tags.alice, ["t"]);
	assert.deepEqual(state.colors.t, {
		bgColor: "hsl(1,50%,80%)",
		textColor: "black",
	});
});

test("parseImport: normalized format with orphan tag color is preserved", () => {
	const imported = {
		customTags: { orphan: { bgColor: "hsl(1,50%,80%)", textColor: "black" } },
		users: {},
	};
	const state = parseImport(imported);
	assert.deepEqual(state.colors.orphan, {
		bgColor: "hsl(1,50%,80%)",
		textColor: "black",
	});
});

test("stateToExport: produces normalized format consumable by parseImport", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 2 },
		tags: { alice: ["spammer"] },
		colors: { spammer: { bgColor: "hsl(10,50%,80%)", textColor: "black" } },
		cache: { alice: { created: 1, karma: 2, fetchedAt: 3 } },
	};
	const exported = stateToExport(state);
	assert.deepEqual(exported, {
		customTags: {
			spammer: { bgColor: "hsl(10,50%,80%)", textColor: "black" },
		},
		users: {
			alice: { rating: 2, tags: ["spammer"] },
		},
	});
	// Round-trip.
	const parsed = parseImport(exported);
	assert.equal(parsed.ratings.alice, 2);
	assert.deepEqual(parsed.tags.alice, ["spammer"]);
	assert.deepEqual(parsed.colors.spammer, {
		bgColor: "hsl(10,50%,80%)",
		textColor: "black",
	});
});

test("stateToExport: excludes cache (it's an internal perf concern, not user data)", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: {},
		colors: {},
		cache: { alice: { created: 1, karma: 2, fetchedAt: 3 } },
	};
	const exported = stateToExport(state);
	assert.equal(exported.cache, undefined);
});

test("stateToExport: excludes users with no rating and no tags", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 0 },
		tags: { alice: [] },
		colors: {},
		cache: {},
	};
	const exported = stateToExport(state);
	assert.deepEqual(exported.users, {});
});

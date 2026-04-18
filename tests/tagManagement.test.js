const { test } = require("node:test");
const assert = require("node:assert/strict");
const { renameTagInState } = require("./_load");

// Pure rename: when the destination name does not exist, the tag's color
// entry moves to the new name and every user carrying the old name has it
// replaced at the same position.
test("renameTagInState: pure rename moves color and updates all users", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 3 },
		tags: {
			alice: ["engineer", "rustacean"],
			bob: ["engineer"],
		},
		colors: {
			engineer: { bgColor: "hsl(1,50%,80%)", textColor: "black" },
			rustacean: { bgColor: "hsl(2,50%,80%)", textColor: "black" },
		},
		cache: {},
	};

	const next = renameTagInState(state, "engineer", "Engineer");

	assert.deepEqual(next.tags, {
		alice: ["Engineer", "rustacean"],
		bob: ["Engineer"],
	});
	assert.deepEqual(next.colors, {
		Engineer: { bgColor: "hsl(1,50%,80%)", textColor: "black" },
		rustacean: { bgColor: "hsl(2,50%,80%)", textColor: "black" },
	});
	// Untouched slices.
	assert.deepEqual(next.ratings, { alice: 3 });
	assert.deepEqual(next.cache, {});
});

// Merge rename: when the destination already exists, the tag's users are
// folded into the destination. Users carrying both end up with one entry
// (first occurrence kept). The destination's color is preserved.
test("renameTagInState: merge folds users and keeps destination color", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: {
			alice: ["engineer", "rustacean"],
			bob: ["Engineer", "engineer"],
			carol: ["Engineer"],
		},
		colors: {
			engineer: { bgColor: "src", textColor: "black" },
			Engineer: { bgColor: "dest", textColor: "black" },
			rustacean: { bgColor: "rst", textColor: "black" },
		},
		cache: {},
	};

	const next = renameTagInState(state, "engineer", "Engineer");

	assert.deepEqual(next.tags, {
		alice: ["Engineer", "rustacean"],
		bob: ["Engineer"],
		carol: ["Engineer"],
	});
	assert.deepEqual(next.colors, {
		Engineer: { bgColor: "dest", textColor: "black" },
		rustacean: { bgColor: "rst", textColor: "black" },
	});
});

// A no-op rename (old === new, empty string, whitespace-only, or a tag
// that doesn't exist) returns the same reference so callers can cheap-
// compare draft against live.
test("renameTagInState: no-ops return the same reference", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: { alice: ["foo"] },
		colors: { foo: { bgColor: "x", textColor: "black" } },
		cache: {},
	};
	assert.equal(renameTagInState(state, "foo", "foo"), state);
	assert.equal(renameTagInState(state, "foo", ""), state);
	assert.equal(renameTagInState(state, "foo", "   "), state);
	assert.equal(renameTagInState(state, "missing", "x"), state);
});

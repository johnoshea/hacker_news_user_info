const { test } = require("node:test");
const assert = require("node:assert/strict");
const { renameTagInState, removeTagInState } = require("./_load");

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

// Removal strips the tag from every user's list and deletes the color
// entry. Ratings and cache slices are untouched.
test("removeTagInState: strips tag from all users and deletes color", () => {
	const state = {
		schemaVersion: 1,
		ratings: { alice: 2 },
		tags: {
			alice: ["foo", "bar"],
			bob: ["foo"],
		},
		colors: {
			foo: { bgColor: "fooc", textColor: "black" },
			bar: { bgColor: "barc", textColor: "black" },
		},
		cache: { alice: { created: 1, karma: 2, fetchedAt: 3 } },
	};

	const next = removeTagInState(state, "foo");

	assert.deepEqual(next.tags, { alice: ["bar"], bob: [] });
	assert.deepEqual(next.colors, {
		bar: { bgColor: "barc", textColor: "black" },
	});
	assert.deepEqual(next.ratings, { alice: 2 });
	assert.deepEqual(next.cache, { alice: { created: 1, karma: 2, fetchedAt: 3 } });
});

// Removal of a tag that isn't present anywhere is a no-op and returns
// the same reference.
test("removeTagInState: missing tag returns the same reference", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: { alice: ["foo"] },
		colors: { foo: { bgColor: "x", textColor: "black" } },
		cache: {},
	};
	assert.equal(removeTagInState(state, "notpresent"), state);
});

// Counts include every tag that has a color entry OR appears on any
// user. Orphan tags (color entry only, no users) show as count 0.
// Duplicates in a single user's list are counted once.
test("countsFromState: counts distinct users per tag, includes orphans", () => {
	const { countsFromState } = require("./_load");
	const state = {
		schemaVersion: 1,
		ratings: { alice: 99 },
		tags: {
			alice: ["foo", "bar"],
			bob: ["foo"],
			carol: ["foo", "foo"], // accidental duplicate — counted once
		},
		colors: {
			foo: { bgColor: "x", textColor: "black" },
			bar: { bgColor: "y", textColor: "black" },
			baz: { bgColor: "z", textColor: "black" }, // orphan
		},
		cache: {},
	};

	assert.deepEqual(countsFromState(state), { foo: 3, bar: 1, baz: 0 });
});

// Multi-step draft composition: rename + remove applied in sequence
// produces the expected shape. Verifies the helpers chain cleanly,
// which is how the overlay builds a draft.
test("renameTagInState + removeTagInState compose", () => {
	const state = {
		schemaVersion: 1,
		ratings: {},
		tags: {
			alice: ["engineer", "rustacean", "obsolete"],
			bob: ["Engineer", "obsolete"],
		},
		colors: {
			engineer: { bgColor: "src", textColor: "black" },
			Engineer: { bgColor: "dest", textColor: "black" },
			rustacean: { bgColor: "rst", textColor: "black" },
			obsolete: { bgColor: "old", textColor: "black" },
		},
		cache: {},
	};

	const afterRename = renameTagInState(state, "engineer", "Engineer");
	const afterRemove = removeTagInState(afterRename, "obsolete");

	assert.deepEqual(afterRemove.tags, {
		alice: ["Engineer", "rustacean"],
		bob: ["Engineer"],
	});
	assert.deepEqual(afterRemove.colors, {
		Engineer: { bgColor: "dest", textColor: "black" },
		rustacean: { bgColor: "rst", textColor: "black" },
	});
});

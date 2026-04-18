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

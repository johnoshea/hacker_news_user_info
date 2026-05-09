import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldAutoCollapseAuthor } from "../src/parsing.js";

// shouldAutoCollapseAuthor(rating, threshold) is the single decision
// the auto-collapse pass uses to decide whether a comment's author
// has earned the .hn-low-score class. Threshold is expected to be
// negative (typically -10); a default-rated user (rating === 0) must
// never collapse.

test("shouldAutoCollapseAuthor: default rating of 0 never collapses", () => {
	assert.equal(shouldAutoCollapseAuthor(0, -10), false);
});

test("shouldAutoCollapseAuthor: positive rating never collapses", () => {
	assert.equal(shouldAutoCollapseAuthor(5, -10), false);
});

test("shouldAutoCollapseAuthor: just above threshold does not collapse", () => {
	assert.equal(shouldAutoCollapseAuthor(-9, -10), false);
});

test("shouldAutoCollapseAuthor: at threshold collapses (boundary inclusive)", () => {
	assert.equal(shouldAutoCollapseAuthor(-10, -10), true);
});

test("shouldAutoCollapseAuthor: below threshold collapses", () => {
	assert.equal(shouldAutoCollapseAuthor(-100, -10), true);
});

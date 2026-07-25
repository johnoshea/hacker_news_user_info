import assert from "node:assert/strict";
import { test } from "node:test";
import { planSeenCollapse } from "../src/parsing.js";

// planSeenCollapse(indentLevels, isNew) decides, for a comment table in DOM
// order, which rows the collapse-seen mode should reduce to a header-only
// stub and which whole subtrees it should hide behind an "[N hidden]"
// expander. Rows named in neither list render untouched.

test("planSeenCollapse: empty input plans nothing", () => {
	assert.deepEqual(planSeenCollapse([], []), { stubs: [], collapsed: [] });
});

test("planSeenCollapse: a thread with nothing new collapses each root whole", () => {
	//   0: root A       1: reply       2: nested reply
	//   3: root B
	const levels = [0, 1, 2, 0];
	const isNew = [false, false, false, false];
	assert.deepEqual(planSeenCollapse(levels, isNew), {
		stubs: [3],
		collapsed: [{ root: 0, descendants: [1, 2] }],
	});
});

test("planSeenCollapse: an all-new thread is left entirely alone", () => {
	const levels = [0, 1, 0];
	const isNew = [true, true, true];
	assert.deepEqual(planSeenCollapse(levels, isNew), {
		stubs: [],
		collapsed: [],
	});
});

test("planSeenCollapse: the ancestor chain above a new comment is stubbed, not hidden", () => {
	//   0: old root
	//     1: old reply
	//       2: NEW reply
	//     3: old reply with an old child
	//       4: old nested reply
	//   5: old root, nothing new below it
	//     6: old reply
	const levels = [0, 1, 2, 1, 2, 0, 1];
	const isNew = [false, false, true, false, false, false, false];
	assert.deepEqual(planSeenCollapse(levels, isNew), {
		stubs: [0, 1],
		collapsed: [
			{ root: 3, descendants: [4] },
			{ root: 5, descendants: [6] },
		],
	});
});

test("planSeenCollapse: a new root's replies are left alone without being planned", () => {
	// A reply cannot predate its parent, so everything under a new comment is
	// new as well and needs no plan entry of its own.
	//   0: old root with an old reply
	//     1: old reply
	//   2: NEW root
	//     3: its reply
	const levels = [0, 1, 0, 1];
	const isNew = [false, false, true, true];
	assert.deepEqual(planSeenCollapse(levels, isNew), {
		stubs: [],
		collapsed: [{ root: 0, descendants: [1] }],
	});
});

test("planSeenCollapse: a childless old comment is stubbed rather than collapsed", () => {
	// Nothing to hide behind an expander, so "[0 hidden]" must not happen.
	//   0: old root
	//     1: NEW reply
	//   2: old childless root
	const levels = [0, 1, 0];
	const isNew = [false, true, false];
	assert.deepEqual(planSeenCollapse(levels, isNew), {
		stubs: [0, 2],
		collapsed: [],
	});
});

test("planSeenCollapse: a deep ancestor chain is stubbed all the way down", () => {
	const levels = [0, 1, 2, 3, 4];
	const isNew = [false, false, false, false, true];
	assert.deepEqual(planSeenCollapse(levels, isNew), {
		stubs: [0, 1, 2, 3],
		collapsed: [],
	});
});

test("planSeenCollapse: a collapsed subtree's own descendants are all hidden together", () => {
	//   0: old root
	//     1: NEW reply
	//   2: old root
	//     3: old reply
	//       4: old nested reply
	//     5: old reply
	const levels = [0, 1, 0, 1, 2, 1];
	const isNew = [false, true, false, false, false, false];
	assert.deepEqual(planSeenCollapse(levels, isNew), {
		stubs: [0],
		collapsed: [{ root: 2, descendants: [3, 4, 5] }],
	});
});

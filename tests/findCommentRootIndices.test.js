import assert from "node:assert/strict";
import { test } from "node:test";
import { findCommentRootIndices } from "../src/parsing.js";

// findCommentRootIndices(indentLevels) maps each comment in DOM order to
// the index of its containing root, or -1 if the comment is a root itself.
// The collapse-root-comment feature uses this to know which root's toggle
// to fire when a "[collapse root]" link on an indented comment is clicked.

test("findCommentRootIndices: empty input returns empty array", () => {
	assert.deepEqual(findCommentRootIndices([]), []);
});

test("findCommentRootIndices: a single root has no parent root", () => {
	assert.deepEqual(findCommentRootIndices([0]), [-1]);
});

test("findCommentRootIndices: every non-root comment points back to its root", () => {
	// Two top-level threads:
	//   index 0: root A
	//     index 1: reply (level 1)
	//       index 2: nested reply (level 2)
	//     index 3: another reply (level 1)
	//   index 4: root B
	//     index 5: reply (level 1)
	//       index 6: nested reply (level 2)
	const indents = [0, 1, 2, 1, 0, 1, 2];
	assert.deepEqual(findCommentRootIndices(indents), [-1, 0, 0, 0, -1, 4, 4]);
});

test("findCommentRootIndices: thread with no roots leaves leading entries with -1", () => {
	// Defensive: if the first comments are mid-thread (shouldn't happen on
	// HN, but the helper is pure so we make its output predictable),
	// `currentRoot` is -1 until a level-0 comment is seen.
	assert.deepEqual(findCommentRootIndices([1, 2, 0, 1]), [-1, -1, -1, 2]);
});

test("findCommentRootIndices: multiple consecutive roots each map to themselves", () => {
	assert.deepEqual(findCommentRootIndices([0, 0, 0]), [-1, -1, -1]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { splitBackticks } from "../src/parsing.js";

// splitBackticks(text) is the pure helper behind the
// backticks-to-monospace pass. The DOM walker collects text nodes
// inside .commtext, calls this, and replaces each text node with a
// DocumentFragment built from the segments.

test("splitBackticks: empty string returns empty array", () => {
	assert.deepEqual(splitBackticks(""), []);
});

test("splitBackticks: non-string input returns empty array", () => {
	assert.deepEqual(splitBackticks(null), []);
	assert.deepEqual(splitBackticks(undefined), []);
});

test("splitBackticks: text with no backticks returns one text segment", () => {
	assert.deepEqual(splitBackticks("plain prose"), [
		{ kind: "text", value: "plain prose" },
	]);
});

test("splitBackticks: a single backtick pair extracts the code", () => {
	assert.deepEqual(splitBackticks("before `foo` after"), [
		{ kind: "text", value: "before " },
		{ kind: "code", value: "foo" },
		{ kind: "text", value: " after" },
	]);
});

test("splitBackticks: code at the very start has no leading text segment", () => {
	assert.deepEqual(splitBackticks("`code` then text"), [
		{ kind: "code", value: "code" },
		{ kind: "text", value: " then text" },
	]);
});

test("splitBackticks: code at the very end has no trailing text segment", () => {
	assert.deepEqual(splitBackticks("text then `code`"), [
		{ kind: "text", value: "text then " },
		{ kind: "code", value: "code" },
	]);
});

test("splitBackticks: multiple pairs are all extracted", () => {
	assert.deepEqual(splitBackticks("a `b` c `d` e"), [
		{ kind: "text", value: "a " },
		{ kind: "code", value: "b" },
		{ kind: "text", value: " c " },
		{ kind: "code", value: "d" },
		{ kind: "text", value: " e" },
	]);
});

test("splitBackticks: adjacent pairs produce back-to-back code segments", () => {
	assert.deepEqual(splitBackticks("`a``b`"), [
		{ kind: "code", value: "a" },
		{ kind: "code", value: "b" },
	]);
});

test("splitBackticks: an unmatched backtick stays in the surrounding text", () => {
	// No closing backtick, so the whole thing is a single text segment.
	assert.deepEqual(splitBackticks("a `b without close"), [
		{ kind: "text", value: "a `b without close" },
	]);
});

test("splitBackticks: empty backtick pair survives as text (no code, no eat)", () => {
	// `` is two backticks with nothing between them. The /`([^`]+)`/
	// regex requires at least one non-backtick character between the
	// pair, so this stays as literal text rather than becoming an
	// empty <code> element.
	assert.deepEqual(splitBackticks("a `` b"), [
		{ kind: "text", value: "a `` b" },
	]);
});

test("splitBackticks: result re-joins to the original input", () => {
	// Sanity check: a round trip via the segments preserves the input
	// exactly (modulo backtick wrapping for code segments).
	const inputs = [
		"plain text",
		"a `b` c",
		"`code only`",
		"`a` `b` `c`",
		"`a``b`",
		"unmatched `tick",
		"",
	];
	for (const input of inputs) {
		const segs = splitBackticks(input);
		const joined = segs
			.map((s) => (s.kind === "code" ? `\`${s.value}\`` : s.value))
			.join("");
		assert.equal(
			joined,
			input,
			`round-trip mismatch for: ${JSON.stringify(input)}`,
		);
	}
});

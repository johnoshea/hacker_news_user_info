import assert from "node:assert/strict";
import { test } from "node:test";
import { linkifySegments, sortStoriesBy } from "../src/parsing.js";

// Pure helpers behind PR-5 features:
//   - linkifySegments: splits user about-text into text/url/email
//     segments for the linkify-user-about DOM glue
//   - sortStoriesBy: reorders a story list for the sort-stories
//     dropdown (default / time / score / ratio)

test("linkifySegments: empty string and non-string input", () => {
	assert.deepEqual(linkifySegments(""), []);
	assert.deepEqual(linkifySegments(null), []);
	assert.deepEqual(linkifySegments(undefined), []);
});

test("linkifySegments: plain text with no links yields one text segment", () => {
	assert.deepEqual(linkifySegments("just some prose"), [
		{ kind: "text", value: "just some prose" },
	]);
});

test("linkifySegments: a bare https URL is one url segment", () => {
	assert.deepEqual(linkifySegments("https://example.com"), [
		{ kind: "url", value: "https://example.com" },
	]);
});

test("linkifySegments: trailing punctuation is split out as a text segment", () => {
	assert.deepEqual(linkifySegments("see https://example.com."), [
		{ kind: "text", value: "see " },
		{ kind: "url", value: "https://example.com" },
		{ kind: "text", value: "." },
	]);
});

test("linkifySegments: closing parenthesis is split out", () => {
	assert.deepEqual(linkifySegments("(https://example.com)"), [
		{ kind: "text", value: "(" },
		{ kind: "url", value: "https://example.com" },
		{ kind: "text", value: ")" },
	]);
});

test("linkifySegments: email address is recognised", () => {
	assert.deepEqual(linkifySegments("contact: foo@example.com"), [
		{ kind: "text", value: "contact: " },
		{ kind: "email", value: "foo@example.com" },
	]);
});

test("linkifySegments: multiple URLs in one string", () => {
	assert.deepEqual(linkifySegments("first https://a.com then https://b.com"), [
		{ kind: "text", value: "first " },
		{ kind: "url", value: "https://a.com" },
		{ kind: "text", value: " then " },
		{ kind: "url", value: "https://b.com" },
	]);
});

test("linkifySegments: http (not https) is also matched", () => {
	const segs = linkifySegments("legacy http://example.org/path");
	assert.equal(segs.at(-1).kind, "url");
	assert.equal(segs.at(-1).value, "http://example.org/path");
});

test("linkifySegments: round-trips back to the original input", () => {
	const inputs = [
		"plain text",
		"see https://example.com.",
		"(https://example.com)",
		"foo@example.com is mine",
		"first https://a.com then https://b.com",
		"",
		"https://example.com",
	];
	for (const input of inputs) {
		const segs = linkifySegments(input);
		const joined = segs.map((s) => s.value).join("");
		assert.equal(
			joined,
			input,
			`round-trip mismatch: ${JSON.stringify(input)}`,
		);
	}
});

// --- sortStoriesBy ---

const STORIES = [
	{ id: "100", score: 10, commentsCount: 5, defaultRank: 3 },
	{ id: "200", score: 50, commentsCount: 200, defaultRank: 1 },
	{ id: "150", score: 30, commentsCount: 1, defaultRank: 2 },
];

test("sortStoriesBy: default uses defaultRank ascending", () => {
	const sorted = sortStoriesBy(STORIES, "default");
	assert.deepEqual(
		sorted.map((s) => s.id),
		["200", "150", "100"], // ranks 1, 2, 3
	);
});

test("sortStoriesBy: time uses id descending (newer first)", () => {
	const sorted = sortStoriesBy(STORIES, "time");
	assert.deepEqual(
		sorted.map((s) => s.id),
		["200", "150", "100"],
	);
});

test("sortStoriesBy: score is descending", () => {
	const sorted = sortStoriesBy(STORIES, "score");
	assert.deepEqual(
		sorted.map((s) => s.id),
		["200", "150", "100"], // 50, 30, 10
	);
});

test("sortStoriesBy: ratio is comments/score descending (high discussion first)", () => {
	const sorted = sortStoriesBy(STORIES, "ratio");
	// Ratios: 100 → 0.5, 200 → 4.0, 150 → 0.033 → 200, 100, 150
	assert.deepEqual(
		sorted.map((s) => s.id),
		["200", "100", "150"],
	);
});

test("sortStoriesBy: unknown mode falls back to default", () => {
	const sorted = sortStoriesBy(STORIES, "totally-bogus");
	assert.deepEqual(
		sorted.map((s) => s.id),
		["200", "150", "100"],
	);
});

test("sortStoriesBy: does not mutate the input array", () => {
	const original = STORIES.slice();
	const _sorted = sortStoriesBy(STORIES, "score");
	assert.deepEqual(STORIES, original);
});

test("sortStoriesBy: empty / nullish input returns an empty array", () => {
	assert.deepEqual(sortStoriesBy([], "score"), []);
	assert.deepEqual(sortStoriesBy(null, "score"), []);
});

test("sortStoriesBy: zero or missing score doesn't divide-by-zero in ratio", () => {
	const stories = [
		{ id: "1", score: 0, commentsCount: 5, defaultRank: 1 },
		{ id: "2", score: 10, commentsCount: 5, defaultRank: 2 },
	];
	const sorted = sortStoriesBy(stories, "ratio");
	// Score 0 → divisor clamped to 1 → ratio 5; score 10 → ratio 0.5
	assert.deepEqual(
		sorted.map((s) => s.id),
		["1", "2"],
	);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDomain, truncateText } from "../src/parsing.js";

// Two small pure helpers behind the hover-panel features (PR-4):
//   - truncateText: trims long previews so the popup doesn't grow huge
//   - extractDomain: pulls "github.com" out of a story URL for the
//     item-info popup, matching the "(domain)" badge HN uses on
//     listing pages.

test("truncateText: short input is returned unchanged", () => {
	assert.equal(truncateText("hi", 10), "hi");
});

test("truncateText: exactly-at-limit input is unchanged (no ellipsis)", () => {
	assert.equal(truncateText("abcde", 5), "abcde");
});

test("truncateText: longer-than-limit input is sliced and ellipsised", () => {
	assert.equal(truncateText("abcdefghij", 4), "abcd…");
});

test("truncateText: defensive against non-string / bad maxLen", () => {
	assert.equal(truncateText(null, 10), "");
	assert.equal(truncateText(undefined, 10), "");
	assert.equal(truncateText("hi", -1), "hi");
	assert.equal(truncateText("hi", "not a number"), "hi");
});

test("extractDomain: pulls hostname from a normal URL", () => {
	assert.equal(extractDomain("https://example.com/path"), "example.com");
	assert.equal(extractDomain("http://example.com/"), "example.com");
});

test("extractDomain: strips a leading www.", () => {
	assert.equal(extractDomain("https://www.github.com/foo"), "github.com");
});

test("extractDomain: handles ports and subdomains", () => {
	assert.equal(
		extractDomain("https://blog.example.com:8080/x"),
		"blog.example.com",
	);
});

test("extractDomain: returns null for non-URL input", () => {
	assert.equal(extractDomain(""), null);
	assert.equal(extractDomain("not a url"), null);
	assert.equal(extractDomain(null), null);
	assert.equal(extractDomain(undefined), null);
});

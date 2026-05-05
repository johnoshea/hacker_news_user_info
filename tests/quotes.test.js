const { test } = require("node:test");
const assert = require("node:assert/strict");
const { stripLeadingQuoteMarker } = require("./_load");

// stripLeadingQuoteMarker(text) is the helper used by the inline-quote
// renderer to extract the body of a "> quoted text" string. It removes the
// leading `>` (with surrounding whitespace) and trims the result so the body
// can be set directly on a `<p class="quote">` text node.

test("stripLeadingQuoteMarker: with a single space after the marker", () => {
	assert.equal(stripLeadingQuoteMarker("> hello"), "hello");
});

test("stripLeadingQuoteMarker: with no space after the marker", () => {
	assert.equal(stripLeadingQuoteMarker(">hello"), "hello");
});

test("stripLeadingQuoteMarker: with leading whitespace before the marker", () => {
	assert.equal(stripLeadingQuoteMarker("   > hello"), "hello");
});

test("stripLeadingQuoteMarker: with multiple spaces around the marker", () => {
	assert.equal(stripLeadingQuoteMarker("  >   hello world"), "hello world");
});

test("stripLeadingQuoteMarker: marker only", () => {
	assert.equal(stripLeadingQuoteMarker(">"), "");
	assert.equal(stripLeadingQuoteMarker("> "), "");
});

test("stripLeadingQuoteMarker: trailing whitespace is trimmed", () => {
	assert.equal(stripLeadingQuoteMarker("> hello   "), "hello");
});

test("stripLeadingQuoteMarker: empty / non-string returns empty string", () => {
	assert.equal(stripLeadingQuoteMarker(""), "");
	assert.equal(stripLeadingQuoteMarker(null), "");
	assert.equal(stripLeadingQuoteMarker(undefined), "");
});

test("stripLeadingQuoteMarker: leaves non-quote text unchanged (defensive)", () => {
	assert.equal(stripLeadingQuoteMarker("hello"), "hello");
});

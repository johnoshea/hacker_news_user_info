import assert from "node:assert/strict";
import { test } from "node:test";
import { parseParentIdFromHref } from "../src/parsing.js";

// parseParentIdFromHref(href) extracts the comment id from a "parent"
// link's href, which on HN takes the form "item?id=12345" (relative)
// or the absolute equivalent. The result is fed to
// document.getElementById and to fetchItem; both expect a string.

test("parseParentIdFromHref: relative href returns the id", () => {
	assert.equal(parseParentIdFromHref("item?id=12345"), "12345");
});

test("parseParentIdFromHref: absolute href returns the id", () => {
	assert.equal(
		parseParentIdFromHref("https://news.ycombinator.com/item?id=12345"),
		"12345",
	);
});

test("parseParentIdFromHref: trailing fragment is ignored", () => {
	assert.equal(parseParentIdFromHref("item?id=12345#12345"), "12345");
});

test("parseParentIdFromHref: id with extra params still resolves", () => {
	assert.equal(parseParentIdFromHref("item?id=12345&p=1"), "12345");
});

test("parseParentIdFromHref: missing id returns null", () => {
	assert.equal(parseParentIdFromHref("item"), null);
});

test("parseParentIdFromHref: unparseable input returns null", () => {
	assert.equal(parseParentIdFromHref("::::not a url::::"), null);
});

test("parseParentIdFromHref: empty / null / non-string returns null", () => {
	assert.equal(parseParentIdFromHref(""), null);
	assert.equal(parseParentIdFromHref(null), null);
	assert.equal(parseParentIdFromHref(undefined), null);
	assert.equal(parseParentIdFromHref(42), null);
});

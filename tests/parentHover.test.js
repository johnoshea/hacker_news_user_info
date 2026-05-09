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

import { splitHtmlIntoParagraphs } from "../src/parsing.js";

// HN comment HTML uses <p> as a paragraph SEPARATOR (not a wrapper):
// the first paragraph is everything before the first <p>, subsequent
// paragraphs follow each <p> until the next or end. This helper
// returns each paragraph as an HTML string with leading/trailing
// whitespace trimmed; empty entries are dropped so a leading or
// trailing <p> doesn't produce phantom paragraphs.

test("splitHtmlIntoParagraphs: empty / nullish returns []", () => {
	assert.deepEqual(splitHtmlIntoParagraphs(""), []);
	assert.deepEqual(splitHtmlIntoParagraphs(null), []);
	assert.deepEqual(splitHtmlIntoParagraphs(undefined), []);
});

test("splitHtmlIntoParagraphs: whitespace-only returns []", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("   \n  "), []);
});

test("splitHtmlIntoParagraphs: single paragraph returns one entry", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("hello world"), ["hello world"]);
});

test("splitHtmlIntoParagraphs: two paragraphs separated by <p>", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("first<p>second"), [
		"first",
		"second",
	]);
});

test("splitHtmlIntoParagraphs: three paragraphs", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("a<p>b<p>c"), ["a", "b", "c"]);
});

test("splitHtmlIntoParagraphs: inline markup is preserved within entries", () => {
	assert.deepEqual(
		splitHtmlIntoParagraphs(
			'first <a href="x">link</a> end<p>second <i>italic</i>',
		),
		['first <a href="x">link</a> end', "second <i>italic</i>"],
	);
});

test("splitHtmlIntoParagraphs: trailing <p> with nothing after it is dropped", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("first<p>"), ["first"]);
});

test("splitHtmlIntoParagraphs: leading <p> drops the empty first chunk", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("<p>only second"), ["only second"]);
});

test("splitHtmlIntoParagraphs: <p> with attributes is treated as a separator", () => {
	assert.deepEqual(splitHtmlIntoParagraphs('first<p class="x">second'), [
		"first",
		"second",
	]);
});

test("splitHtmlIntoParagraphs: case-insensitive on the tag name", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("first<P>second"), [
		"first",
		"second",
	]);
});

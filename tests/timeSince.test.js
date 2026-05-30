import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewAccount, timeSince } from "../src/parsing.js";

// timeSince(createdUnixSeconds, nowUnixSeconds) -> human-readable duration.
// Keeping the existing format: "N days" / "N months" / "N years", singular for 1.

const DAY = 86400;
const MONTH = 2592000; // matches legacy (30-day) definition
const YEAR = 31536000; // matches legacy (365-day) definition

test("timeSince: under a month returns days", () => {
	const now = 1_000_000_000;
	assert.equal(timeSince(now - 1 * DAY, now), "1 day");
	assert.equal(timeSince(now - 5 * DAY, now), "5 days");
	assert.equal(timeSince(now - 29 * DAY, now), "29 days");
});

test("timeSince: under a year returns months", () => {
	const now = 1_000_000_000;
	assert.equal(timeSince(now - 1 * MONTH, now), "1 month");
	assert.equal(timeSince(now - 11 * MONTH, now), "11 months");
});

test("timeSince: a year or more returns years", () => {
	const now = 1_000_000_000;
	assert.equal(timeSince(now - 1 * YEAR, now), "1 year");
	assert.equal(timeSince(now - 7 * YEAR, now), "7 years");
});

test("timeSince: zero elapsed returns 0 days", () => {
	const now = 1_000_000_000;
	assert.equal(timeSince(now, now), "0 days");
});

// isNewAccount(createdUnixSeconds, nowUnixSeconds, maxAgeMs) -> boolean.
// created/now are unix seconds (as HN's API gives them and the caller
// computes "now"); the threshold is milliseconds to match config's idiom.
const SIX_MONTHS_MS = 6 * 30 * DAY * 1000;

test("isNewAccount: at or under the threshold is new", () => {
	const now = 1_000_000_000;
	assert.equal(isNewAccount(now, now, SIX_MONTHS_MS), true); // 0 days
	assert.equal(isNewAccount(now - 5 * DAY, now, SIX_MONTHS_MS), true);
	assert.equal(isNewAccount(now - 6 * MONTH, now, SIX_MONTHS_MS), true); // boundary
});

test("isNewAccount: past the threshold is not new", () => {
	const now = 1_000_000_000;
	assert.equal(isNewAccount(now - 6 * MONTH - DAY, now, SIX_MONTHS_MS), false);
	assert.equal(isNewAccount(now - 2 * YEAR, now, SIX_MONTHS_MS), false);
});

test("isNewAccount: non-numeric created is not new", () => {
	const now = 1_000_000_000;
	assert.equal(isNewAccount(undefined, now, SIX_MONTHS_MS), false);
	assert.equal(isNewAccount(null, now, SIX_MONTHS_MS), false);
});

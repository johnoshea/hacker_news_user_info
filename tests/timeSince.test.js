const { test } = require("node:test");
const assert = require("node:assert/strict");
const { timeSince } = require("./_load");

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

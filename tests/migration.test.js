const { test } = require("node:test");
const assert = require("node:assert/strict");
const { migrateLegacyKeys, createStore } = require("./_load");

// Legacy layout: one backend key per user-rating, per user-tags, per tag-color.
// The migration walks a listing backend, collects everything into the single
// consolidated key, and leaves the legacy keys alone (one-version safety net).
function makeListingBackend(initial = {}) {
	const store = { ...initial };
	return {
		data: store,
		get: (key) => (key in store ? store[key] : undefined),
		set: (key, value) => {
			store[key] = value;
		},
		list: () => Object.keys(store),
	};
}

test("migration: no legacy keys is a no-op", () => {
	const backend = makeListingBackend();
	migrateLegacyKeys(backend);
	assert.equal(backend.data.hn_state, undefined);
});

test("migration: collects ratings", () => {
	const backend = makeListingBackend({
		hn_author_rating_alice: 3,
		hn_author_rating_bob: -1,
	});
	migrateLegacyKeys(backend);
	const store = createStore(backend);
	assert.equal(store.getRating("alice"), 3);
	assert.equal(store.getRating("bob"), -1);
});

test("migration: collects tags and tag colors", () => {
	const backend = makeListingBackend({
		hn_custom_tags_alice: JSON.stringify([
			{ value: "spammer", bgColor: "hsl(10,50%,80%)", textColor: "black" },
		]),
		hn_custom_tag_color_spammer: JSON.stringify({
			bgColor: "hsl(10,50%,80%)",
			textColor: "black",
		}),
	});
	migrateLegacyKeys(backend);
	const store = createStore(backend);
	const tags = store.getUserTags("alice");
	assert.equal(tags.length, 1);
	assert.equal(tags[0].value, "spammer");
	assert.equal(tags[0].bgColor, "hsl(10,50%,80%)");
	assert.equal(tags[0].textColor, "black");
});

test("migration: color-only legacy entries are preserved", () => {
	// A user may have deleted all tags using 'orphan' but the global color is
	// still in storage. We want to preserve it so rehydrating the tag later
	// reuses the same color.
	const backend = makeListingBackend({
		hn_custom_tag_color_orphan: JSON.stringify({
			bgColor: "hsl(200,50%,80%)",
			textColor: "black",
		}),
	});
	migrateLegacyKeys(backend);
	const store = createStore(backend);
	assert.deepEqual(store.getTagColor("orphan"), {
		bgColor: "hsl(200,50%,80%)",
		textColor: "black",
	});
});

test("migration: leaves legacy keys in place (safety net)", () => {
	const backend = makeListingBackend({
		hn_author_rating_alice: 5,
	});
	migrateLegacyKeys(backend);
	assert.equal(backend.data.hn_author_rating_alice, 5);
});

test("migration: is idempotent (running twice changes nothing)", () => {
	const backend = makeListingBackend({
		hn_author_rating_alice: 5,
		hn_custom_tags_alice: JSON.stringify([
			{ value: "t", bgColor: "hsl(1,50%,80%)", textColor: "black" },
		]),
	});
	migrateLegacyKeys(backend);
	const snapshot1 = backend.data.hn_state;
	migrateLegacyKeys(backend);
	assert.equal(backend.data.hn_state, snapshot1);
});

test("migration: skips when new state already exists", () => {
	// User has already migrated; don't clobber their current state with stale
	// legacy data.
	const existingState = JSON.stringify({
		schemaVersion: 1,
		ratings: { alice: 99 },
		tags: {},
		colors: {},
		cache: {},
	});
	const backend = makeListingBackend({
		hn_state: existingState,
		hn_author_rating_alice: 3, // stale legacy value
	});
	migrateLegacyKeys(backend);
	assert.equal(backend.data.hn_state, existingState);
});

test("migration: malformed legacy JSON is skipped, not fatal", () => {
	const backend = makeListingBackend({
		hn_custom_tags_alice: "not json{",
		hn_author_rating_alice: 2,
	});
	migrateLegacyKeys(backend); // must not throw
	const store = createStore(backend);
	assert.equal(store.getRating("alice"), 2);
	assert.deepEqual(store.getUserTags("alice"), []);
});

test("migration: trims and de-dupes legacy tag names", () => {
	const backend = makeListingBackend({
		hn_custom_tags_alice: JSON.stringify([
			{ value: " expert ", bgColor: "hsl(10,50%,80%)", textColor: "black" },
			{ value: "expert" },
			{ value: "" },
			{ value: "helper", bgColor: "hsl(20,50%,80%)", textColor: "black" },
			{ value: "helper" },
		]),
	});

	migrateLegacyKeys(backend);
	const store = createStore(backend);

	assert.deepEqual(store.getUserTags("alice"), [
		{ value: "expert", bgColor: "hsl(10,50%,80%)", textColor: "black" },
		{ value: "helper", bgColor: "hsl(20,50%,80%)", textColor: "black" },
	]);
});

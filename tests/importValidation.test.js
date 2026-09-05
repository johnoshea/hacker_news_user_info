import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, parseImport } from "../src/state.js";

const backup = () => ({ customTags: {}, users: {} });
const watch = () => ({
	itemId: "123",
	seenKids: [456],
	latestKids: [456, 789],
	lastCheckedAt: 0,
	addedAt: 1,
});
const invalid = [
	["null", null],
	["array", []],
	["string", "backup"],
	["number", 1],
	["empty object", {}],
	["unrelated", { unrelated: "valid JSON" }],
	["missing colors", { users: {} }],
	["missing users", { customTags: {} }],
	["array map", { ...backup(), users: [] }],
	["null map", { ...backup(), watches: null }],
	["mixed formats", { ...backup(), hn_author_rating_alice: 2 }],
	["null user", { ...backup(), users: { alice: null } }],
	["missing rating", { ...backup(), users: { alice: { tags: [] } } }],
	[
		"string rating",
		{ ...backup(), users: { alice: { rating: "2", tags: [] } } },
	],
	[
		"infinite rating",
		{ ...backup(), users: { alice: { rating: Infinity, tags: [] } } },
	],
	[
		"invalid tags",
		{ ...backup(), users: { alice: { rating: 2, tags: "tag" } } },
	],
	["empty tag", { ...backup(), users: { alice: { rating: 2, tags: [" "] } } }],
	["bad color", { ...backup(), customTags: { tag: { bgColor: 12 } } }],
	[
		"empty text color",
		{ ...backup(), customTags: { tag: { bgColor: "pink", textColor: "" } } },
	],
	["invalid watch id", { ...backup(), watches: { abc: watch() } }],
	[
		"invalid story id",
		{ ...backup(), watches: { 123: { ...watch(), itemId: "abc" } } },
	],
	[
		"bad reply id",
		{ ...backup(), watches: { 123: { ...watch(), seenKids: ["456"] } } },
	],
	[
		"missing replies",
		{
			...backup(),
			watches: { 123: { itemId: "123", addedAt: 1, lastCheckedAt: 0 } },
		},
	],
	[
		"negative time",
		{ ...backup(), watches: { 123: { ...watch(), addedAt: -1 } } },
	],
	[
		"fractional count",
		{ ...backup(), storyWatches: { 123: { seenCount: 1.5, fetchedAt: 1 } } },
	],
	[
		"missing timestamp",
		{ ...backup(), storyWatches: { 123: { seenCount: 1 } } },
	],
	["legacy empty suffix", { hn_author_rating_: 2 }],
	["legacy blank rating", { hn_author_rating_alice: " " }],
	["legacy boolean rating", { hn_author_rating_alice: true }],
	["legacy invalid number", { hn_author_rating_alice: "NaN" }],
	["legacy broken JSON", { hn_custom_tags_alice: "[" }],
	["legacy wrong shape", { hn_custom_tags_alice: "{}" }],
	["legacy malformed tag", { hn_custom_tags_alice: '[{"value":3}]' }],
	[
		"legacy malformed color",
		{ hn_custom_tag_color_tag: '{"textColor":"black"}' },
	],
];
for (const [name, data] of invalid) {
	test(`parseImport rejects ${name}`, () =>
		assert.throws(() => parseImport(data), Error));
}

test("validation error identifies the field", () => {
	assert.throws(
		() =>
			parseImport({
				...backup(),
				users: { alice: { rating: 1, tags: "oops" } },
			}),
		/users\.alice\.tags/,
	);
});

test("accepts empty backups, optional watches, extra metadata and uncolored tags", () => {
	assert.deepEqual(parseImport(backup()).ratings, {});
	const parsed = parseImport({
		...backup(),
		note: "backup",
		users: { alice: { rating: -2, tags: ["uncolored"] } },
		customTags: { orphan: { bgColor: "pink" } },
		watches: { 321: watch() },
		storyWatches: { 123: { seenCount: 0, fetchedAt: 0 } },
	});
	assert.equal(parsed.ratings.alice, -2);
	assert.equal(parsed.colors.orphan.textColor, "black");
	assert.deepEqual(parsed.tags.alice, ["uncolored"]);
	assert.deepEqual(parsed.watchedComments[321].latestKids, [456, 789]);
});

test("accepts legacy numeric strings, decoded values, embedded JSON and metadata", () => {
	const parsed = parseImport({
		hn_author_rating_alice: "-2",
		hn_custom_tags_alice: [{ value: "tag" }],
		hn_custom_tag_color_tag: '{"bgColor":"pink"}',
		metadata: "extra",
	});
	assert.equal(parsed.ratings.alice, -2);
	assert.deepEqual(parsed.tags.alice, ["tag"]);
	assert.equal(parsed.colors.tag.textColor, "black");
});

test("restore rejects invalid files without storage writes or reload", async () => {
	const { createToolbar } = await import("../src/features/toolbar.js");
	const values = new Map();
	let writes = 0;
	const store = createStore({
		get: (key) => values.get(key),
		set: (key, value) => {
			writes++;
			values.set(key, value);
		},
	});
	store.setRating("alice", 7);
	store.setStoryWatch("123", 5, 1);
	const original = [...values];
	const nodes = [];
	const alerts = [];
	let fileText;
	let reloads = 0;
	const globals = {
		document: globalThis.document,
		window: globalThis.window,
		FileReader: globalThis.FileReader,
		alert: globalThis.alert,
		location: globalThis.location,
	};
	const makeNode = () => {
		const handlers = {};
		const node = {
			appendChild() {},
			addEventListener(type, callback) {
				handlers[type] = callback;
			},
			click() {
				if (node.type === "file")
					handlers.change({ target: { files: [fileText] } });
				else handlers.click?.();
			},
		};
		nodes.push(node);
		return node;
	};
	try {
		globalThis.document = { createElement: makeNode, body: makeNode() };
		globalThis.window = { addEventListener() {} };
		globalThis.FileReader = class {
			readAsText(text) {
				this.onload({ target: { result: text } });
			}
		};
		globalThis.alert = (message) => alerts.push(message);
		globalThis.location = {
			reload() {
				reloads++;
			},
		};
		const toolbar = createToolbar({ store });
		toolbar.mount();
		const restore = nodes.find((node) => node.textContent === "Restore state");
		const oldError = console.error;
		console.error = () => {};
		try {
			for (const [name, data] of [...invalid, ["invalid JSON", undefined]]) {
				fileText = data === undefined ? "{" : JSON.stringify(data);
				writes = 0;
				restore.click();
				assert.equal(writes, 0, name);
				assert.deepEqual([...values], original, name);
				assert.match(
					alerts.at(-1),
					/existing data has not been changed/i,
					name,
				);
			}
			assert.equal(reloads, 0);
			// A valid restore still reaches storage and reloads normally.
			fileText = JSON.stringify({
				...backup(),
				users: { bob: { rating: -3, tags: ["helpful"] } },
			});
			restore.click();
			assert.equal(writes, 3);
			assert.equal(reloads, 1);
			assert.equal(store.getRating("bob"), -3);
			assert.equal(store.getRating("alice"), 0);
		} finally {
			console.error = oldError;
		}
	} finally {
		for (const [key, value] of Object.entries(globals)) {
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
		}
	}
});

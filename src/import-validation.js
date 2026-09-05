// Pure validation of supported backup formats. Called before conversion so
// malformed entries cannot be silently skipped during a destructive restore.
import {
	LEGACY_COLOR_PREFIX,
	LEGACY_RATING_PREFIX,
	LEGACY_TAGS_PREFIX,
} from "./config.js";

export function validateImport(data) {
	const fail = (path, expected) => {
		throw new Error(`${path} must be ${expected}.`);
	};
	const object = (value, path) => {
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			fail(path, "an object");
		}
	};
	const string = (value, path) => {
		if (typeof value !== "string" || !value.trim())
			fail(path, "a nonempty string");
	};
	const number = (value, path) => {
		if (typeof value !== "number" || !Number.isFinite(value))
			fail(path, "a finite number");
	};
	const timestamp = (value, path) => {
		number(value, path);
		if (value < 0) fail(path, "a nonnegative timestamp");
	};
	const id = (value, path) => {
		if (
			typeof value !== "string" ||
			!/^[1-9]\d*$/.test(value) ||
			!Number.isSafeInteger(Number(value))
		) {
			fail(path, "a positive numeric ID string");
		}
	};
	const array = (value, path, check) => {
		if (!Array.isArray(value)) fail(path, "an array");
		value.forEach((entry, i) => {
			check(entry, `${path}[${i}]`);
		});
	};
	const map = (value, path, check, keyCheck = string) => {
		object(value, path);
		for (const [key, entry] of Object.entries(value)) {
			keyCheck(key, `${path} key`);
			check(entry, `${path}.${key}`);
		}
	};
	const color = (value, path) => {
		object(value, path);
		string(value.bgColor, `${path}.bgColor`);
		if (Object.hasOwn(value, "textColor"))
			string(value.textColor, `${path}.textColor`);
	};
	const decode = (value, path) => {
		if (typeof value !== "string") return value;
		try {
			return JSON.parse(value);
		} catch {
			fail(path, "valid embedded JSON");
		}
	};

	object(data, "Backup");
	const prefixes = [
		LEGACY_RATING_PREFIX,
		LEGACY_TAGS_PREFIX,
		LEGACY_COLOR_PREFIX,
	];
	const legacyKeys = Object.keys(data).filter((key) =>
		prefixes.some((prefix) => key.startsWith(prefix)),
	);
	const normalized = ["customTags", "users", "watches", "storyWatches"].some(
		(key) => Object.hasOwn(data, key),
	);
	if (normalized && legacyKeys.length) {
		throw new Error("Backup mixes current and legacy formats.");
	}
	if (normalized) {
		map(data.customTags, "customTags", color);
		map(data.users, "users", (user, path) => {
			object(user, path);
			number(user.rating, `${path}.rating`);
			array(user.tags, `${path}.tags`, string);
		});
		if (Object.hasOwn(data, "watches")) {
			map(
				data.watches,
				"watches",
				(watch, path) => {
					object(watch, path);
					id(watch.itemId, `${path}.itemId`);
					const replyId = (value, field) => {
						if (!Number.isSafeInteger(value) || value <= 0)
							fail(field, "a positive integer reply ID");
					};
					array(watch.seenKids, `${path}.seenKids`, replyId);
					array(watch.latestKids, `${path}.latestKids`, replyId);
					timestamp(watch.lastCheckedAt, `${path}.lastCheckedAt`);
					timestamp(watch.addedAt, `${path}.addedAt`);
				},
				id,
			);
		}
		if (Object.hasOwn(data, "storyWatches")) {
			map(
				data.storyWatches,
				"storyWatches",
				(watch, path) => {
					object(watch, path);
					if (!Number.isSafeInteger(watch.seenCount) || watch.seenCount < 0) {
						fail(`${path}.seenCount`, "a nonnegative integer");
					}
					timestamp(watch.fetchedAt, `${path}.fetchedAt`);
				},
				id,
			);
		}
		return;
	}
	if (!legacyKeys.length)
		throw new Error("File is not a supported Hacker News user-data backup.");
	for (const key of legacyKeys) {
		const prefix = prefixes.find((candidate) => key.startsWith(candidate));
		string(key.slice(prefix.length), `${key} suffix`);
		const value = data[key];
		if (prefix === LEGACY_RATING_PREFIX) {
			if (typeof value === "string") string(value, key);
			else number(value, key);
			number(Number(value), key);
		} else if (prefix === LEGACY_COLOR_PREFIX) {
			color(decode(value, key), key);
		} else {
			array(decode(value, key), key, (tag, path) => {
				object(tag, path);
				string(tag.value, `${path}.value`);
				if (Object.hasOwn(tag, "bgColor"))
					string(tag.bgColor, `${path}.bgColor`);
				if (Object.hasOwn(tag, "textColor"))
					string(tag.textColor, `${path}.textColor`);
			});
		}
	}
}

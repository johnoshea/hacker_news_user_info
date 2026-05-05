// Storage and pure state mutators. No DOM, no GM_* APIs - safe to import
// under Node. The browser bootstrap (main.js) wraps the GM_* APIs into the
// {get, set, list} backend that createStore expects.

import {
	LEGACY_COLOR_PREFIX,
	LEGACY_RATING_PREFIX,
	LEGACY_TAGS_PREFIX,
	STATE_KEY,
	STATE_SCHEMA_VERSION,
} from "./config.js";

export function emptyState() {
	return {
		schemaVersion: STATE_SCHEMA_VERSION,
		ratings: {},
		tags: {}, // username -> [tagName, ...]
		colors: {}, // tagName  -> { bgColor, textColor }
		cache: {}, // username -> { created, karma, fetchedAt }
	};
}

// Factory over a { get(key), set(key, value) } backend. Loads the consolidated
// state on first access and writes the whole blob back on each mutation.
// Writes are cheap because the blob is small (a few KB even for heavy users).
export function createStore(backend) {
	let state = null;

	const load = () => {
		if (state !== null) return state;
		const raw = backend.get(STATE_KEY);
		if (raw === undefined || raw === null || raw === "") {
			state = emptyState();
		} else {
			try {
				const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
				state = { ...emptyState(), ...parsed };
			} catch (_err) {
				state = emptyState();
			}
		}
		return state;
	};

	const save = () => {
		backend.set(STATE_KEY, JSON.stringify(state));
	};

	const hydrateTag = (tagName) => {
		const color = load().colors[tagName] || {
			bgColor: undefined,
			textColor: undefined,
		};
		return {
			value: tagName,
			bgColor: color.bgColor,
			textColor: color.textColor,
		};
	};

	return {
		getRating(username) {
			return load().ratings[username] || 0;
		},
		setRating(username, rating) {
			load().ratings[username] = rating;
			save();
		},
		getUserTags(username) {
			const names = load().tags[username] || [];
			return names.map(hydrateTag);
		},
		setUserTags(username, tags) {
			const s = load();
			s.tags[username] = tags.map((t) => t.value);
			// Record any color info that came along with the tag. If a tag already
			// has a color, a caller-supplied color overrides it (setTagColor is the
			// explicit "update the shared color" operation; passing a color here
			// is how new tags get their initial color).
			for (const t of tags) {
				if (t.bgColor && t.textColor) {
					s.colors[t.value] = { bgColor: t.bgColor, textColor: t.textColor };
				}
			}
			save();
		},
		getTagColor(tagName) {
			return load().colors[tagName] || null;
		},
		setTagColor(tagName, { bgColor, textColor }) {
			load().colors[tagName] = { bgColor, textColor };
			save();
		},
		// User-data cache. The `now` and `ttlMs` arguments are injected so tests
		// can control time without mocking the clock. The browser call site
		// passes Date.now() and a hardcoded TTL (USER_CACHE_TTL_MS in config).
		getCachedUser(username, nowMs, ttlMs) {
			const entry = load().cache[username];
			if (!entry) return null;
			if (nowMs - entry.fetchedAt > ttlMs) return null;
			return { created: entry.created, karma: entry.karma };
		},
		setCachedUser(username, { created, karma }, nowMs) {
			load().cache[username] = { created, karma, fetchedAt: nowMs };
			save();
		},
		replaceTagsAndColors(tagsByUser, colorsByTag) {
			const s = load();
			s.tags = tagsByUser;
			s.colors = colorsByTag;
			save();
		},
		// Expose raw state for export and for callers that need to iterate.
		_snapshot() {
			return load();
		},
		// Drop the in-memory cache so the next read reloads from the backend.
		// Used when another tab writes to the same key.
		_invalidate() {
			state = null;
		},
	};
}

// One-shot migration from the pre-rework key layout:
//   hn_author_rating_<user>   -> int
//   hn_custom_tags_<user>     -> JSON array of {value, bgColor, textColor}
//   hn_custom_tag_color_<tag> -> JSON {bgColor, textColor}
// to the single consolidated `hn_state` key. Legacy keys are left in place for
// one version so a rollback of the script doesn't lose data. The migration is
// idempotent and a no-op when hn_state already exists.
//
// Backend must additionally support list(): string[].
export function migrateLegacyKeys(backend) {
	if (backend.get(STATE_KEY) !== undefined) return;
	if (typeof backend.list !== "function") return;

	const keys = backend.list();
	const hasLegacy = keys.some(
		(k) =>
			k.startsWith(LEGACY_RATING_PREFIX) ||
			k.startsWith(LEGACY_TAGS_PREFIX) ||
			k.startsWith(LEGACY_COLOR_PREFIX),
	);
	if (!hasLegacy) return;

	const state = emptyState();

	const parseJSON = (raw, fallback) => {
		try {
			return typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch (_err) {
			return fallback;
		}
	};

	for (const key of keys) {
		if (key.startsWith(LEGACY_RATING_PREFIX)) {
			const username = key.slice(LEGACY_RATING_PREFIX.length);
			const value = backend.get(key);
			const rating = typeof value === "number" ? value : Number(value);
			if (!Number.isNaN(rating)) state.ratings[username] = rating;
		} else if (key.startsWith(LEGACY_COLOR_PREFIX)) {
			const tagName = key.slice(LEGACY_COLOR_PREFIX.length);
			const color = parseJSON(backend.get(key), null);
			if (color?.bgColor) {
				state.colors[tagName] = {
					bgColor: color.bgColor,
					textColor: color.textColor || "black",
				};
			}
		}
	}

	// Tags are processed after colors so legacy tag entries can contribute
	// their embedded color info without overwriting the explicit color key.
	for (const key of keys) {
		if (!key.startsWith(LEGACY_TAGS_PREFIX)) continue;
		const username = key.slice(LEGACY_TAGS_PREFIX.length);
		const legacyTags = parseJSON(backend.get(key), []);
		if (!Array.isArray(legacyTags)) continue;
		const tagNames = [];
		for (const t of legacyTags) {
			if (!t || typeof t.value !== "string") continue;
			tagNames.push(t.value);
			if (!state.colors[t.value] && t.bgColor) {
				state.colors[t.value] = {
					bgColor: t.bgColor,
					textColor: t.textColor || "black",
				};
			}
		}
		state.tags[username] = tagNames;
	}

	backend.set(STATE_KEY, JSON.stringify(state));
}

// Accepts either the normalized export shape ({customTags, users}) or the
// legacy flat-key dump ({hn_author_rating_<u>: N, hn_custom_tags_<u>: "...", ...})
// and produces a consolidated state object. The cache slot is left empty -
// import is a user-data operation, not a cache restore.
export function parseImport(data) {
	const state = emptyState();
	if (!data || typeof data !== "object") return state;

	// Normalized format.
	if (data.customTags || data.users) {
		if (data.customTags && typeof data.customTags === "object") {
			for (const [tagName, info] of Object.entries(data.customTags)) {
				if (info?.bgColor) {
					state.colors[tagName] = {
						bgColor: info.bgColor,
						textColor: info.textColor || "black",
					};
				}
			}
		}
		if (data.users && typeof data.users === "object") {
			for (const [username, userData] of Object.entries(data.users)) {
				if (!userData) continue;
				if (typeof userData.rating === "number" && userData.rating !== 0) {
					state.ratings[username] = userData.rating;
				}
				if (Array.isArray(userData.tags)) {
					state.tags[username] = userData.tags.slice();
				}
			}
		}
		return state;
	}

	// Legacy flat-key format - mirrors migrateLegacyKeys but reads from a plain
	// object instead of a backend.
	const parseJSON = (raw, fallback) => {
		try {
			return typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch (_err) {
			return fallback;
		}
	};
	for (const [key, value] of Object.entries(data)) {
		if (key.startsWith(LEGACY_RATING_PREFIX)) {
			const username = key.slice(LEGACY_RATING_PREFIX.length);
			const rating = typeof value === "number" ? value : Number(value);
			if (!Number.isNaN(rating)) state.ratings[username] = rating;
		} else if (key.startsWith(LEGACY_COLOR_PREFIX)) {
			const tagName = key.slice(LEGACY_COLOR_PREFIX.length);
			const color = parseJSON(value, null);
			if (color?.bgColor) {
				state.colors[tagName] = {
					bgColor: color.bgColor,
					textColor: color.textColor || "black",
				};
			}
		}
	}
	for (const [key, value] of Object.entries(data)) {
		if (!key.startsWith(LEGACY_TAGS_PREFIX)) continue;
		const username = key.slice(LEGACY_TAGS_PREFIX.length);
		const legacyTags = parseJSON(value, []);
		if (!Array.isArray(legacyTags)) continue;
		const names = [];
		for (const t of legacyTags) {
			if (!t || typeof t.value !== "string") continue;
			names.push(t.value);
			if (!state.colors[t.value] && t.bgColor) {
				state.colors[t.value] = {
					bgColor: t.bgColor,
					textColor: t.textColor || "black",
				};
			}
		}
		state.tags[username] = names;
	}
	return state;
}

// Normalized export shape. Stable across versions so old backups stay
// interoperable. Cache is intentionally dropped - it's perf scaffolding,
// not user data, and shouldn't bloat export files.
export function stateToExport(state) {
	const customTags = {};
	for (const [tagName, info] of Object.entries(state.colors || {})) {
		customTags[tagName] = {
			bgColor: info.bgColor,
			textColor: info.textColor,
		};
	}
	const users = {};
	const allUsernames = new Set([
		...Object.keys(state.ratings || {}),
		...Object.keys(state.tags || {}),
	]);
	for (const username of allUsernames) {
		const rating = state.ratings[username] || 0;
		const tags = state.tags[username] || [];
		if (rating === 0 && tags.length === 0) continue;
		users[username] = { rating, tags: tags.slice() };
	}
	return { customTags, users };
}

// Returns a new state with every user's `oldName` tag replaced by `newName`
// and the color entry moved accordingly. If `newName` already exists as a
// tag (in colors or any user's tag list), this becomes a merge: the
// destination's color is kept, the source color is dropped, and any user
// carrying both ends up with one entry (first-occurrence wins, so the
// relative order of other tags is preserved). Empty / whitespace-only
// `newName`, a no-op rename, or a rename of a tag that isn't present
// anywhere returns the same reference.
export function renameTagInState(state, oldName, newName) {
	const trimmed = typeof newName === "string" ? newName.trim() : "";
	if (!trimmed || trimmed === oldName) return state;

	const tags = state.tags || {};
	const colors = state.colors || {};
	const inColors = Object.hasOwn(colors, oldName);
	const inTags = Object.values(tags).some((list) => list.includes(oldName));
	if (!inColors && !inTags) return state;

	const destExists = Object.hasOwn(colors, trimmed);

	const newTags = {};
	for (const [user, list] of Object.entries(tags)) {
		if (!list.includes(oldName)) {
			newTags[user] = list.slice();
			continue;
		}
		const renamed = list.map((t) => (t === oldName ? trimmed : t));
		const seen = new Set();
		newTags[user] = renamed.filter((t) => {
			if (seen.has(t)) return false;
			seen.add(t);
			return true;
		});
	}

	const newColors = { ...colors };
	delete newColors[oldName];
	if (!destExists && inColors) {
		newColors[trimmed] = colors[oldName];
	}

	return { ...state, tags: newTags, colors: newColors };
}

// Returns a new state with `tagName` removed from every user's tag list
// and from the colors map. No-op (same reference) if the tag isn't
// present anywhere.
export function removeTagInState(state, tagName) {
	const tags = state.tags || {};
	const colors = state.colors || {};
	const inColors = Object.hasOwn(colors, tagName);
	const inTags = Object.values(tags).some((list) => list.includes(tagName));
	if (!inColors && !inTags) return state;

	const newTags = {};
	for (const [user, list] of Object.entries(tags)) {
		newTags[user] = list.includes(tagName)
			? list.filter((t) => t !== tagName)
			: list.slice();
	}

	const newColors = { ...colors };
	delete newColors[tagName];

	return { ...state, tags: newTags, colors: newColors };
}

// Distinct-users-per-tag count. Includes tags that appear only in the
// colors map (orphans) with a count of 0.
export function countsFromState(state) {
	const tags = state.tags || {};
	const colors = state.colors || {};
	const counts = {};
	for (const tagName of Object.keys(colors)) counts[tagName] = 0;
	for (const list of Object.values(tags)) {
		const seen = new Set();
		for (const t of list) {
			if (seen.has(t)) continue;
			seen.add(t);
			counts[t] = (counts[t] || 0) + 1;
		}
	}
	return counts;
}

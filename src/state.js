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
import {
	pruneExpiredByFetchedAt,
	pruneExpiredReadComments,
	pruneExpiredWatches,
} from "./parsing.js";

export function emptyState() {
	return {
		schemaVersion: STATE_SCHEMA_VERSION,
		ratings: {},
		tags: {}, // username -> [tagName, ...]
		colors: {}, // tagName  -> { bgColor, textColor }
		cache: {}, // username -> { created, karma, fetchedAt }
		readComments: {}, // itemId -> { ids: [...], fetchedAt }
		itemCache: {}, // itemId -> { title, url, by, score, descendants, time, text, type, kids, fetchedAt }
		watchedComments: {}, // commentId -> { itemId, seenKids, latestKids, lastCheckedAt, addedAt }
	};
}

// Factory over a { get(key), set(key, value) } backend. Loads the consolidated
// state on first access; mutations are read-modify-write (re-read disk, apply
// the mutation, write back) so writes from other tabs that landed since the
// last read are absorbed instead of clobbered. The pre-RMW design was racy:
// at page load every tab the user had cmd-clicked open from the front page
// would call setReadComments synchronously with a stale in-memory snapshot,
// and the last writer's snapshot wiped everyone else's entry. The cross-tab
// listener can't fix that after the fact — it only invalidates the in-memory
// cache, it doesn't merge in-flight writes.
export function createStore(backend) {
	let state = null;

	const parseState = (raw) => {
		if (raw === undefined || raw === null || raw === "") {
			return emptyState();
		}
		try {
			const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
			return { ...emptyState(), ...parsed };
		} catch (_err) {
			return emptyState();
		}
	};

	const readDisk = () => parseState(backend.get(STATE_KEY));

	const load = () => {
		if (state !== null) return state;
		state = readDisk();
		return state;
	};

	// Apply a mutation against the latest disk state. The mutator runs on
	// a fresh read of the blob, then we write the whole thing back; this
	// absorbs concurrent writes from other tabs as long as our get-then-set
	// pair isn't preempted (GM_getValue and GM_setValue are synchronous in
	// Tampermonkey/Violentmonkey, so the race window is essentially zero
	// per call site). The mutator may return `false` to signal "no change,
	// don't write" — used by pruneReadComments when nothing's stale.
	const mutate = (mutator) => {
		const fresh = readDisk();
		const result = mutator(fresh);
		if (result !== false) {
			backend.set(STATE_KEY, JSON.stringify(fresh));
		}
		state = fresh;
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
			mutate((s) => {
				// A zero rating is the absence of a rating — store nothing
				// rather than a 0 entry that would accumulate for every user
				// the reader ever nudged and reset.
				if (rating) {
					s.ratings[username] = rating;
				} else {
					delete s.ratings[username];
				}
			});
		},
		getUserTags(username) {
			const names = load().tags[username] || [];
			return names.map(hydrateTag);
		},
		setUserTags(username, tags) {
			mutate((s) => {
				// An empty tag list is the absence of tags — drop the key so
				// users whose tags were all removed don't leave empty arrays
				// behind. (Shared tag colours are intentionally left in place:
				// another user may still carry the tag; orphan colours are
				// swept by the tag-manager / clean-orphan-tags path.)
				if (tags.length === 0) {
					delete s.tags[username];
				} else {
					s.tags[username] = tags.map((t) => t.value);
				}
				// Record any color info that came along with the tag. If a tag
				// already has a color, a caller-supplied color overrides it
				// (setTagColor is the explicit "update the shared color"
				// operation; passing a color here is how new tags get their
				// initial color).
				for (const t of tags) {
					if (t.bgColor && t.textColor) {
						s.colors[t.value] = {
							bgColor: t.bgColor,
							textColor: t.textColor,
						};
					}
				}
			});
		},
		getTagColor(tagName) {
			return load().colors[tagName] || null;
		},
		setTagColor(tagName, { bgColor, textColor }) {
			mutate((s) => {
				s.colors[tagName] = { bgColor, textColor };
			});
		},
		// User-data cache. The `now` and `ttlMs` arguments are injected so tests
		// can control time without mocking the clock. The browser call site
		// passes Date.now() and a hardcoded TTL (USER_CACHE_TTL_MS in config).
		// `data` is treated as opaque so future call sites (e.g. the hover
		// panel adding `about`) don't need to extend this method's signature.
		getCachedUser(username, nowMs, ttlMs) {
			const entry = load().cache[username];
			if (!entry) return null;
			if (nowMs - entry.fetchedAt > ttlMs) return null;
			const { fetchedAt: _f, ...rest } = entry;
			return rest;
		},
		setCachedUser(username, data, nowMs) {
			mutate((s) => {
				s.cache[username] = { ...data, fetchedAt: nowMs };
			});
		},
		// Item-info cache for the hover-panel feature. Stores a digest
		// (title/url/by/score/descendants/time/text/type) of items the
		// user has hovered, so subsequent hovers resolve from local
		// state without re-hitting the Firebase API.
		getCachedItem(itemId, nowMs, ttlMs) {
			const entry = load().itemCache?.[itemId];
			if (!entry) return null;
			if (nowMs - entry.fetchedAt > ttlMs) return null;
			const { fetchedAt: _f, ...digest } = entry;
			return digest;
		},
		setCachedItem(itemId, digest, nowMs) {
			mutate((s) => {
				s.itemCache[itemId] = { ...digest, fetchedAt: nowMs };
			});
		},
		// Drop expired entries from the user- and item-digest caches. Both
		// are TTL-checked on read but otherwise never swept, so without this
		// a key fetched once stayed in storage forever and was re-parsed on
		// every load. Run once per page load; one RMW write covers both maps.
		pruneCaches(nowMs, userTtlMs, itemTtlMs) {
			mutate((s) => {
				const oldCache = s.cache || {};
				const oldItemCache = s.itemCache || {};
				const newCache = pruneExpiredByFetchedAt(oldCache, nowMs, userTtlMs);
				const newItemCache = pruneExpiredByFetchedAt(
					oldItemCache,
					nowMs,
					itemTtlMs,
				);
				const unchanged =
					Object.keys(newCache).length === Object.keys(oldCache).length &&
					Object.keys(newItemCache).length === Object.keys(oldItemCache).length;
				if (unchanged) return false;
				s.cache = newCache;
				s.itemCache = newItemCache;
			});
		},

		// Read-comments cache for highlight-unread. Returns the stored
		// entry { ids, fetchedAt } if it exists, else null. The browser
		// caller decides what to do with a missing entry (highlight
		// nothing, since this is a first visit) vs a stale one (treat as
		// missing — pruneReadComments below drops stale entries on every
		// item-page load so this is mostly a belt-and-braces check).
		getReadComments(itemId) {
			const entry = load().readComments?.[itemId];
			if (!entry) return null;
			return { ids: entry.ids || [], fetchedAt: entry.fetchedAt || 0 };
		},
		// Replace the stored ID list for an item. Always overwrites — the
		// caller decides whether to merge with previous ids or replace them.
		// (We replace, since a comment that's no longer on the page must
		// have been deleted/flagged, and there's no value in tracking it.)
		setReadComments(itemId, ids, nowMs) {
			mutate((s) => {
				s.readComments[itemId] = { ids: ids.slice(), fetchedAt: nowMs };
			});
		},
		// Drop expired entries from the readComments map. Run on every
		// item-page load so a user who reads-then-never-revisits doesn't
		// accumulate dead entries forever.
		pruneReadComments(nowMs, ttlMs) {
			mutate((s) => {
				const before = s.readComments;
				const after = pruneExpiredReadComments(before, nowMs, ttlMs);
				if (Object.keys(after).length === Object.keys(before).length) {
					return false;
				}
				s.readComments = after;
			});
		},
		// Watched-comments map for the watch-for-replies feature. Keyed
		// by HN comment id; each entry stores the parent itemId (so the
		// listing-page pass can look up "any watched comments in this
		// story?"), the `seenKids` snapshot of replies the user has
		// acknowledged, the `latestKids` from the most recent API check,
		// and timestamps driving the recheck throttle and TTL prune.
		getWatchedComments() {
			return load().watchedComments || {};
		},
		getWatchedComment(commentId) {
			const map = load().watchedComments || {};
			return map[commentId] || null;
		},
		setWatchedComment(commentId, entry) {
			mutate((s) => {
				s.watchedComments[commentId] = {
					itemId: entry.itemId,
					seenKids: (entry.seenKids || []).slice(),
					latestKids: (entry.latestKids || []).slice(),
					lastCheckedAt: entry.lastCheckedAt,
					addedAt: entry.addedAt,
				};
			});
		},
		removeWatchedComment(commentId) {
			mutate((s) => {
				if (!s.watchedComments?.[commentId]) return false;
				delete s.watchedComments[commentId];
			});
		},
		// Sync seenKids to latestKids — i.e. acknowledge every reply the
		// most recent API check returned. Called when the user lands on
		// the item page where a watched comment is rendered.
		markWatchSeen(commentId, _nowMs) {
			mutate((s) => {
				const e = s.watchedComments?.[commentId];
				if (!e) return false;
				e.seenKids = (e.latestKids || []).slice();
			});
		},
		// Replace latestKids with a fresh API result and stamp the check
		// timestamp. Doesn't touch seenKids — the watch retains its
		// "what's new since I last looked" notion until the user visits
		// the item page.
		updateWatchKids(commentId, kids, nowMs) {
			mutate((s) => {
				const e = s.watchedComments?.[commentId];
				if (!e) return false;
				e.latestKids = (kids || []).slice();
				e.lastCheckedAt = nowMs;
			});
		},
		// Drop expired entries from the watchedComments map. Run periodically
		// so a watch that hasn't been checked in >14 days is cleaned up.
		pruneWatchedComments(nowMs, ttlMs) {
			mutate((s) => {
				const before = s.watchedComments || {};
				const after = pruneExpiredWatches(before, nowMs, ttlMs);
				if (Object.keys(after).length === Object.keys(before).length) {
					return false;
				}
				s.watchedComments = after;
			});
		},
		replaceTagsAndColors(tagsByUser, colorsByTag) {
			mutate((s) => {
				s.tags = tagsByUser;
				s.colors = colorsByTag;
			});
		},
		// Expose raw state for export and for callers that need to iterate.
		_snapshot() {
			return load();
		},
		// Drop the in-memory cache so the next read reloads from the backend.
		// Used by the tag-manager save path. Mutations don't need this
		// because they always re-read disk before writing.
		_invalidate() {
			state = null;
		},
		// Cross-tab handler. Given the old and new raw blobs that
		// GM_addValueChangeListener reports for another tab's write, refresh
		// the in-memory snapshot (so subsequent reads see the write without a
		// backend round-trip) and return the set of users whose tag/rating UI
		// must be re-rendered. An empty set means the write touched only
		// caches, so the listener can skip the re-render entirely.
		_applyRemoteChange(oldRaw, newRaw) {
			const oldState = parseState(oldRaw);
			const newState = parseState(newRaw);
			state = newState;
			return affectedUsersByStateChange(oldState, newState);
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
	if (data.customTags || data.users || data.watches) {
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
		if (data.watches && typeof data.watches === "object") {
			for (const [commentId, entry] of Object.entries(data.watches)) {
				if (!entry || typeof entry.itemId !== "string") continue;
				state.watchedComments[commentId] = {
					itemId: entry.itemId,
					seenKids: Array.isArray(entry.seenKids) ? entry.seenKids.slice() : [],
					latestKids: Array.isArray(entry.latestKids)
						? entry.latestKids.slice()
						: [],
					lastCheckedAt:
						typeof entry.lastCheckedAt === "number" ? entry.lastCheckedAt : 0,
					addedAt: typeof entry.addedAt === "number" ? entry.addedAt : 0,
				};
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
// interoperable. Cache is intentionally dropped — it's perf scaffolding,
// not user data, and shouldn't bloat export files. `watches` is user
// data (a deliberate user choice), so it ships in exports.
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
	const watches = {};
	for (const [commentId, entry] of Object.entries(
		state.watchedComments || {},
	)) {
		if (!entry || typeof entry.itemId !== "string") continue;
		watches[commentId] = {
			itemId: entry.itemId,
			seenKids: (entry.seenKids || []).slice(),
			latestKids: (entry.latestKids || []).slice(),
			lastCheckedAt: entry.lastCheckedAt,
			addedAt: entry.addedAt,
		};
	}
	return { customTags, users, watches };
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

// Returns the set of usernames whose inline tag/rating UI would look
// different after the state changed from `oldState` to `newState`. The
// cross-tab listener uses this to scope its re-render: the shared blob
// carries background caches (user/item digests, read-comment lists, watch
// entries) alongside user data, and a write to any of those must affect
// nobody. A user is affected when their rating changed, their tag list
// changed (including order, which is the visible order), or a tag they
// carry was recoloured.
export function affectedUsersByStateChange(oldState, newState) {
	const affected = new Set();
	const oldRatings = oldState.ratings || {};
	const newRatings = newState.ratings || {};
	const oldTags = oldState.tags || {};
	const newTags = newState.tags || {};
	const oldColors = oldState.colors || {};
	const newColors = newState.colors || {};

	for (const user of new Set([
		...Object.keys(oldRatings),
		...Object.keys(newRatings),
	])) {
		if (oldRatings[user] !== newRatings[user]) affected.add(user);
	}

	for (const user of new Set([
		...Object.keys(oldTags),
		...Object.keys(newTags),
	])) {
		if (!sameTagList(oldTags[user], newTags[user])) affected.add(user);
	}

	const recoloured = new Set();
	for (const tag of new Set([
		...Object.keys(oldColors),
		...Object.keys(newColors),
	])) {
		if (!sameColor(oldColors[tag], newColors[tag])) recoloured.add(tag);
	}
	if (recoloured.size > 0) {
		for (const [user, list] of Object.entries(newTags)) {
			if (list.some((t) => recoloured.has(t))) affected.add(user);
		}
	}

	return affected;
}

function sameTagList(a, b) {
	const x = a || [];
	const y = b || [];
	if (x.length !== y.length) return false;
	return x.every((v, i) => v === y[i]);
}

function sameColor(a, b) {
	if (!a && !b) return true;
	if (!a || !b) return false;
	return a.bgColor === b.bgColor && a.textColor === b.textColor;
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

// HN Firebase API access. Browser-side only - imports the GM_xmlhttpRequest
// global at call time so this module never references it at import time
// (so the build artifact, which inlines this, doesn't crash if loaded
// outside a userscript runtime).
import {
	ITEM_CACHE_TTL_MS,
	ITEM_FETCH_TIMEOUT_MS,
	USER_CACHE_TTL_MS,
	USER_FETCH_TIMEOUT_MS,
} from "./config.js";

// Factory over a store. Returns { fetchUser, fetchItem } where each
// resolves to a digest object or null. Both are protected by:
//   - A persistent cache (store.getCachedUser/getCachedItem) with a TTL
//     declared in config.
//   - An in-memory inflight Map that dedupes concurrent fetches for
//     the same key.
//   - A per-request timeout so a hung request can't leave a popup
//     stuck on "loading…" forever.
export function createApi({ store }) {
	const userInflight = new Map();
	const itemInflight = new Map();

	function fetchUser(username) {
		const cached = store.getCachedUser(username, Date.now(), USER_CACHE_TTL_MS);
		if (cached) return Promise.resolve(cached);
		if (userInflight.has(username)) return userInflight.get(username);

		const promise = new Promise((resolve) => {
			GM_xmlhttpRequest({
				method: "GET",
				url: `https://hacker-news.firebaseio.com/v0/user/${username}.json`,
				timeout: USER_FETCH_TIMEOUT_MS,
				onload: (response) => {
					if (response.status !== 200 || !response.responseText) {
						resolve(null);
						return;
					}
					try {
						const data = JSON.parse(response.responseText);
						if (data && typeof data.created === "number") {
							store.setCachedUser(
								username,
								{
									created: data.created,
									karma: data.karma,
									about: data.about || "",
								},
								Date.now(),
							);
							resolve({
								created: data.created,
								karma: data.karma,
								about: data.about || "",
							});
						} else {
							resolve(null);
						}
					} catch (_err) {
						resolve(null);
					}
				},
				onerror: () => resolve(null),
				ontimeout: () => resolve(null),
			});
		}).finally(() => {
			userInflight.delete(username);
		});
		userInflight.set(username, promise);
		return promise;
	}

	// `fresh: true` skips the persistent cache read but still participates
	// in inflight-dedup and still writes the cache on resolve. Used by
	// the watch-for-replies feature, where the 6h cache would otherwise
	// shadow the 30-min recheck throttle. Hover-popup callers leave the
	// default in place — title/score/karma drift slowly enough that the
	// 6h cache is fine for them.
	function fetchItem(itemId, { fresh = false } = {}) {
		if (!fresh) {
			const cached = store.getCachedItem(itemId, Date.now(), ITEM_CACHE_TTL_MS);
			if (cached) return Promise.resolve(cached);
		}
		if (itemInflight.has(itemId)) return itemInflight.get(itemId);

		const promise = new Promise((resolve) => {
			GM_xmlhttpRequest({
				method: "GET",
				url: `https://hacker-news.firebaseio.com/v0/item/${itemId}.json`,
				timeout: ITEM_FETCH_TIMEOUT_MS,
				onload: (response) => {
					if (response.status !== 200 || !response.responseText) {
						resolve(null);
						return;
					}
					try {
						const data = JSON.parse(response.responseText);
						if (!data || typeof data.id !== "number") {
							resolve(null);
							return;
						}
						const digest = {
							title: data.title || "",
							url: data.url || "",
							by: data.by || "",
							score: typeof data.score === "number" ? data.score : 0,
							descendants:
								typeof data.descendants === "number" ? data.descendants : 0,
							time: typeof data.time === "number" ? data.time : 0,
							text: data.text || "",
							type: data.type || "story",
							// Direct replies. Used by the watch-for-replies feature
							// to detect new replies on a watched comment without
							// loading the full comment page. Hover popup ignores it.
							kids: Array.isArray(data.kids) ? data.kids.slice() : [],
						};
						store.setCachedItem(itemId, digest, Date.now());
						resolve(digest);
					} catch (_err) {
						resolve(null);
					}
				},
				onerror: () => resolve(null),
				ontimeout: () => resolve(null),
			});
		}).finally(() => {
			itemInflight.delete(itemId);
		});
		itemInflight.set(itemId, promise);
		return promise;
	}

	return { fetchUser, fetchItem };
}

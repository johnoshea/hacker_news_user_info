// HN Firebase API access. Browser-side only - imports the GM_xmlhttpRequest
// global at call time so this module never references it at import time
// (so the build artifact, which inlines this, doesn't crash if loaded
// outside a userscript runtime).
import { USER_CACHE_TTL_MS, USER_FETCH_TIMEOUT_MS } from "./config.js";

// Factory over a store. Returns { fetchUser } where fetchUser(username)
// resolves to {created, karma} or null. Guards:
//   - Persistent cache via store.getCachedUser / setCachedUser (TTL in config).
//   - In-memory inflight Map dedupes concurrent fetches for the same user.
//   - Per-request timeout so a hung request can't block page render forever.
export function createApi({ store }) {
	const inflight = new Map();

	function fetchUser(username) {
		const cached = store.getCachedUser(username, Date.now(), USER_CACHE_TTL_MS);
		if (cached) return Promise.resolve(cached);
		if (inflight.has(username)) return inflight.get(username);

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
								{ created: data.created, karma: data.karma },
								Date.now(),
							);
							resolve({ created: data.created, karma: data.karma });
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
			inflight.delete(username);
		});
		inflight.set(username, promise);
		return promise;
	}

	return { fetchUser };
}

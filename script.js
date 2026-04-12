// ==UserScript==
// @name         Hacker News - Inline Account Info, Legible Custom Tags and Rating
// @namespace    Violent Monkey
// @version      0.4
// @description  Show account age, karma, custom tags, and author rating next to the username in Hacker News comment pages
// @author       You
// @match        https://news.ycombinator.com/item?id=*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// ==/UserScript==

// =============================================================================
// Pure logic (Node-testable). Everything above the browser-bootstrap guard
// below must be free of DOM and GM_* references so it can be required from
// tests under Node without a userscript runtime.
// =============================================================================

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_MONTH = 2592000; // 30-day month, matches legacy behavior
const SECONDS_PER_YEAR = 31536000; // 365-day year, matches legacy behavior

function timeSince(createdUnixSeconds, nowUnixSeconds) {
	const seconds = Math.floor(nowUnixSeconds - createdUnixSeconds);
	const years = Math.floor(seconds / SECONDS_PER_YEAR);
	if (years >= 1) return `${years} year${years === 1 ? "" : "s"}`;
	const months = Math.floor(seconds / SECONDS_PER_MONTH);
	if (months >= 1) return `${months} month${months === 1 ? "" : "s"}`;
	const days = Math.floor(seconds / SECONDS_PER_DAY);
	return `${days} day${days === 1 ? "" : "s"}`;
}

// Single backend key holding all user-visible state. Consolidating everything
// here means exports are one JSON.stringify and imports are one assignment,
// and it eliminates the legacy prefix-scan over GM_listValues.
const STATE_KEY = "hn_state";
const STATE_SCHEMA_VERSION = 1;

function emptyState() {
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
function createStore(backend) {
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
		// passes Date.now() and a hardcoded TTL (see USER_CACHE_TTL_MS below).
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
const LEGACY_RATING_PREFIX = "hn_author_rating_";
const LEGACY_TAGS_PREFIX = "hn_custom_tags_";
const LEGACY_COLOR_PREFIX = "hn_custom_tag_color_";

function migrateLegacyKeys(backend) {
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
// and produces a consolidated state object. The cache slot is left empty —
// import is a user-data operation, not a cache restore.
function parseImport(data) {
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

	// Legacy flat-key format — mirrors migrateLegacyKeys but reads from a plain
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
// not user data, and shouldn't bloat export files.
function stateToExport(state) {
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

// Node test export. In the userscript environment `module` is undefined and
// this block is a no-op.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		timeSince,
		createStore,
		migrateLegacyKeys,
		parseImport,
		stateToExport,
	};
}

// =============================================================================
// Browser bootstrap. Only runs inside a userscript runtime that exposes the
// GM_* APIs. Everything below here is free to touch the DOM.
// =============================================================================

if (typeof GM_addStyle !== "undefined") {
	GM_addStyle(`
    .hn-post-layout {
      display: grid;
      grid-template-columns: 1fr auto;
      margin: 5px 0;
      width: 100%;
    }
    .comment { padding-top: 10px; }
    /* Hide the stray <br>s HN puts above comment bodies.
       :has() is supported in all current evergreen browsers. */
    br:has(+ div.comment) { display: none; }
    .hn-username {
      font-weight: 700;
      font-size: 1.15em;
      margin-right: 5px;
    }
    .hn-main-row {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      padding-bottom: 2px;
      grid-column: 1;
    }
    .hn-info {
      font-size: 0.8em;
      margin-left: 4px;
      white-space: nowrap;
    }
    .hn-info-pending { opacity: 0.4; }
    .hn-tag-container {
      display: flex;
      flex-direction: column;
      grid-column: 2;
      padding-left: 10px;
      margin-left: 10px;
    }
    .hn-tag-group {
      display: flex;
      flex-direction: column;
    }
    .hn-tag {
      padding: 3px 6px;
      margin-bottom: 3px;
      margin-right: 5px;
      border-radius: 5px;
      font-size: 0.9em;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: fit-content;
    }
    .hn-tag-text { margin-right: 5px; }
    .hn-tag-icons {
      display: flex;
      align-items: center;
    }
    .hn-tag-icon {
      cursor: pointer;
      margin-left: 3px;
      font-size: 0.8em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.3);
    }
    .hn-tag-icon:hover { background-color: rgba(255, 255, 255, 0.6); }
    .hn-tag-input {
      font-size: 0.8em;
      margin-left: 4px;
      width: 250px;
      height: 30px;
      line-height: 30px;
      display: inline-block;
      vertical-align: middle;
    }
    .hn-rating-container {
      margin-left: 4px;
      white-space: nowrap;
      display: flex;
      align-items: center;
    }
    .hn-rating-btn {
      font-size: 0.6em;
      padding: 1px 2px;
      margin-right: 2px;
    }
    .hn-rating-display {
      font-size: 1.3em;
      padding: 0 4px 0 2px;
      color: #575F94;
      font-weight: 700;
    }
    .hn-toolbar {
      position: fixed;
      top: 10px;
      right: 10px;
      background-color: white;
      border: 1px solid #ff6600;
      border-radius: 4px;
      padding: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      z-index: 9999;
      display: flex;
      align-items: center;
    }
    .hn-drag-handle {
      width: 12.5px;
      height: 100%;
      background-color: rgba(255, 102, 0, 0.5);
      cursor: move;
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      border-top-left-radius: 3px;
      border-bottom-left-radius: 3px;
    }
    .hn-toolbar-buttons {
      display: flex;
      padding-left: 8px;
    }
    .hn-toolbar-btn {
      background-color: #ff6600;
      color: white;
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      margin: 0 5px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-toolbar-btn:hover { background-color: #ff8533; }
  `);

	// How long a cached {created, karma} pair is considered fresh. Karma drifts
	// slowly; 6h means a repeat-visitor sees a fully-rendered page with zero
	// network requests for users they've already seen today.
	const USER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
	// Per-request ceiling. Without this, GM_xmlhttpRequest can hang forever and
	// the page never finishes rendering. Firebase's HN endpoint is fast in the
	// common case; 8s is generous.
	const USER_FETCH_TIMEOUT_MS = 8000;

	// Adapter from GM_* to the {get, set, list} interface the store and
	// migration expect.
	const backend = {
		get: (key) => GM_getValue(key, undefined),
		set: (key, value) => GM_setValue(key, value),
		list: () => (typeof GM_listValues === "function" ? GM_listValues() : []),
	};

	migrateLegacyKeys(backend);
	const store = createStore(backend);

	// Dedupe concurrent fetches for the same username (common: someone comments
	// 10 times in a thread). Separate from the persistent cache because these
	// are in-flight promises, not values.
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

	// Pastel HSL. The lightness floor (75%) guarantees black text is always the
	// high-contrast choice, so we don't need a luminance calculator.
	function randomPastelColor() {
		const r = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1) + lo);
		return `hsl(${r(0, 359)}, ${r(30, 100)}%, ${r(75, 95)}%)`;
	}

	function ensureTagColor(tagName) {
		const existing = store.getTagColor(tagName);
		if (existing?.bgColor) return existing;
		const color = { bgColor: randomPastelColor(), textColor: "black" };
		store.setTagColor(tagName, color);
		return color;
	}

	// Tiny element factory. Accepts text content and event handlers but
	// intentionally does NOT accept innerHTML — all text goes through
	// textContent so it can't become an XSS foothold even if we later pass a
	// username or tag name through it.
	function h(tag, props = {}, children = []) {
		const node = document.createElement(tag);
		for (const [k, v] of Object.entries(props)) {
			if (k === "class") node.className = v;
			else if (k === "text") node.textContent = v;
			else if (k.startsWith("on") && typeof v === "function") {
				node.addEventListener(k.slice(2).toLowerCase(), v);
			} else {
				node[k] = v;
			}
		}
		for (const child of children) {
			if (child) node.appendChild(child);
		}
		return node;
	}

	function renderRatingControls(username) {
		const display = h("span", {
			class: "hn-rating-display",
			text: String(store.getRating(username)),
		});
		display.dataset.hnUser = username;
		const mkBtn = (glyph, delta) =>
			h("button", {
				class: "hn-rating-btn",
				text: glyph,
				tabIndex: -1,
				onclick: (e) => {
					e.preventDefault();
					e.currentTarget.blur();
					const next = store.getRating(username) + delta;
					store.setRating(username, next);
					display.textContent = String(next);
				},
			});
		return h("span", { class: "hn-rating-container" }, [
			mkBtn("▲", 1),
			mkBtn("▼", -1),
			display,
		]);
	}

	// Renders the tag list for a user into `container` (clearing first). Called
	// on initial render and after any tag edit/remove so we don't need a full
	// page reload.
	function renderTagGroup(username, container) {
		container.replaceChildren();
		for (const tag of store.getUserTags(username)) {
			container.appendChild(renderTagSpan(username, tag));
		}
	}

	// Re-renders tag groups and updates tag inputs for every instance of a
	// user on the page. Called after any tag mutation so all comments by the
	// same author stay in sync.
	function rerenderUserTags(username) {
		const esc = CSS.escape(username);
		for (const group of document.querySelectorAll(
			`.hn-tag-group[data-hn-user="${esc}"]`,
		)) {
			renderTagGroup(username, group);
		}
		const names = store.getUserTags(username).map((t) => t.value);
		for (const input of document.querySelectorAll(
			`.hn-tag-input[data-hn-user="${esc}"]`,
		)) {
			input.value = names.join(", ");
		}
	}

	function renderTagSpan(username, tag) {
		const editIcon = h("span", {
			class: "hn-tag-icon",
			title: "Edit tag",
			text: "\u270F\uFE0F", // ✏️
			onclick: (e) => {
				e.stopPropagation();
				const newName = prompt("Edit tag name:", tag.value);
				if (!newName || newName === tag.value) return;
				const current = store.getUserTags(username);
				const color = ensureTagColor(newName);
				const updated = current.map((t) =>
					t.value === tag.value
						? {
								value: newName,
								bgColor: color.bgColor,
								textColor: color.textColor,
							}
						: t,
				);
				store.setUserTags(username, updated);
				rerenderUserTags(username);
			},
		});
		const removeIcon = h("span", {
			class: "hn-tag-icon",
			title: "Remove tag",
			text: "\u2716", // ✖
			onclick: (e) => {
				e.stopPropagation();
				if (!confirm(`Remove tag "${tag.value}"?`)) return;
				const current = store.getUserTags(username);
				store.setUserTags(
					username,
					current.filter((t) => t.value !== tag.value),
				);
				rerenderUserTags(username);
			},
		});

		const span = h("div", { class: "hn-tag" }, [
			h("span", { class: "hn-tag-text", text: tag.value }),
			h("div", { class: "hn-tag-icons" }, [editIcon, removeIcon]),
		]);
		span.style.backgroundColor = tag.bgColor || "";
		span.style.color = tag.textColor || "black";
		return span;
	}

	function renderTagInput(username) {
		const currentNames = store.getUserTags(username).map((t) => t.value);
		const input = h("input", {
			type: "text",
			class: "hn-tag-input",
			value: currentNames.join(", "),
			placeholder: "Add tags (comma separated)",
		});
		input.dataset.hnUser = username;

		let debounce;
		input.addEventListener("input", () => {
			clearTimeout(debounce);
			debounce = setTimeout(() => {
				const names = input.value
					.split(",")
					.map((t) => t.trim())
					.filter((t) => t.length > 0);
				const updated = names.map((name) => {
					const color = ensureTagColor(name);
					return {
						value: name,
						bgColor: color.bgColor,
						textColor: color.textColor,
					};
				});
				store.setUserTags(username, updated);
				rerenderUserTags(username);
			}, 500);
		});
		return input;
	}

	function renderAccountInfo(created, karma) {
		const now = Math.floor(Date.now() / 1000);
		return h("span", {
			class: "hn-info",
			text: `(${timeSince(created, now)} old, ${karma} karma)`,
		});
	}

	function findCommentParent(usernameEl) {
		return usernameEl.closest(".comhead") || usernameEl.parentElement;
	}

	// Skeleton-first: every row is built and inserted synchronously from the
	// store. The age/karma blurb gets filled in as each fetch resolves, so a
	// slow or hung request can't block the rest of the page.
	function renderAllUsernames() {
		const usernameElements = Array.from(document.querySelectorAll(".hnuser"));

		for (const usernameEl of usernameElements) {
			const username = usernameEl.textContent;
			const parent = findCommentParent(usernameEl);
			if (!parent) continue;

			const tagGroup = h("div", { class: "hn-tag-group" });
			tagGroup.dataset.hnUser = username;
			renderTagGroup(username, tagGroup);

			const usernameClone = usernameEl.cloneNode(true);
			usernameClone.className = `${usernameClone.className} hn-username`.trim();

			const infoSlot = h("span", {
				class: "hn-info hn-info-pending",
				text: "(loading…)",
			});

			const mainRow = h("div", { class: "hn-main-row" }, [
				usernameClone,
				infoSlot,
				renderRatingControls(username),
				renderTagInput(username),
			]);
			const tagContainer = h("div", { class: "hn-tag-container" }, [tagGroup]);
			const layout = h("div", { class: "hn-post-layout" }, [
				mainRow,
				tagContainer,
			]);

			parent.parentNode.insertBefore(layout, parent.nextSibling);
			usernameEl.style.display = "none";

			// Populate the info slot asynchronously. Cached users resolve on the
			// microtask queue (effectively synchronous). Failed or timed-out
			// fetches remove the slot rather than leaving a "loading…" ghost.
			fetchUser(username).then((data) => {
				if (data) {
					infoSlot.replaceWith(renderAccountInfo(data.created, data.karma));
				} else {
					infoSlot.remove();
				}
			});
		}
	}

	function exportState() {
		const data = stateToExport(store._snapshot());
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = h("a", {
			href: url,
			download: `hn-user-data-${new Date().toISOString().split("T")[0]}.json`,
		});
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			a.remove();
			URL.revokeObjectURL(url);
		}, 100);
	}

	function importState() {
		const input = h("input", { type: "file", accept: ".json" });
		input.addEventListener("change", (event) => {
			const file = event.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const raw = JSON.parse(e.target.result);
					const parsed = parseImport(raw);
					// Write the consolidated blob directly and reload so the page
					// rebuilds from a fresh store.
					backend.set(STATE_KEY, JSON.stringify(parsed));
					alert("Data imported successfully! The page will now reload.");
					location.reload();
				} catch (error) {
					alert(`Error importing data: ${error.message}`);
					console.error("Error importing data:", error);
				}
			};
			reader.readAsText(file);
		});
		input.click();
	}

	function createToolbar() {
		const dragHandle = h("div", { class: "hn-drag-handle" });
		const buttons = h("div", { class: "hn-toolbar-buttons" }, [
			h("button", {
				class: "hn-toolbar-btn",
				text: "Save state",
				onclick: exportState,
			}),
			h("button", {
				class: "hn-toolbar-btn",
				text: "Restore state",
				onclick: importState,
			}),
		]);
		const toolbar = h("div", { class: "hn-toolbar" }, [dragHandle, buttons]);
		document.body.appendChild(toolbar);

		// Drag listeners live only for the duration of a drag, rather than
		// sitting on document forever.
		dragHandle.addEventListener("mousedown", (e) => {
			const rect = toolbar.getBoundingClientRect();
			const offsetX = e.clientX - rect.left;
			const offsetY = e.clientY - rect.top;
			e.preventDefault();

			const onMove = (ev) => {
				toolbar.style.left = `${ev.clientX - offsetX}px`;
				toolbar.style.top = `${ev.clientY - offsetY}px`;
				toolbar.style.right = "auto";
			};
			const onUp = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
			};
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});
	}

	// Sync state from other tabs. GM_addValueChangeListener fires whenever
	// another tab writes to the same GM storage key. We invalidate the
	// in-memory cache and re-render every user visible on this page.
	if (typeof GM_addValueChangeListener === "function") {
		GM_addValueChangeListener(STATE_KEY, (_name, _oldVal, _newVal, remote) => {
			if (!remote) return;
			store._invalidate();
			const usernames = new Set();
			for (const el of document.querySelectorAll("[data-hn-user]")) {
				usernames.add(el.dataset.hnUser);
			}
			for (const username of usernames) {
				rerenderUserTags(username);
				const esc = CSS.escape(username);
				for (const rd of document.querySelectorAll(
					`.hn-rating-display[data-hn-user="${esc}"]`,
				)) {
					rd.textContent = String(store.getRating(username));
				}
			}
		});
	}

	renderAllUsernames();
	createToolbar();
}

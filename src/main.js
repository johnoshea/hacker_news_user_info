// Browser-side bootstrap. The build script wraps this (and every module
// imported above it) in a single IIFE inside the userscript bundle, so
// everything below runs once on load inside the userscript runtime.

import { createApi } from "./api.js";
import { STATE_KEY } from "./config.js";
import { isItemPage } from "./dom.js";
import { setupClickIndentToggle } from "./features/click-indent-toggle.js";
import { setupCollapseRootComment } from "./features/collapse-root-comment.js";
import { setupCommentBoxToggle } from "./features/comment-box-toggle.js";
import { applyDownvotedClass, transformQuotes } from "./features/legibility.js";
import { createTagManager } from "./features/tag-manager.js";
import { createToolbar } from "./features/toolbar.js";
import { createUserRender } from "./features/user-render.js";
import { createStore, migrateLegacyKeys } from "./state.js";
import { STYLES } from "./styles.js";

GM_addStyle(STYLES);

// Adapter from GM_* to the {get, set, list} interface the store and
// migration expect.
const backend = {
	get: (key) => GM_getValue(key, undefined),
	set: (key, value) => GM_setValue(key, value),
	list: () => (typeof GM_listValues === "function" ? GM_listValues() : []),
};

migrateLegacyKeys(backend);
const store = createStore(backend);
const { fetchUser } = createApi({ store });

// Tag manager and user-render reference each other; both bindings exist by
// the time either's stored callback runs (on a click), so the closures
// resolve fine despite the forward reference.
const tagManager = createTagManager({
	store,
	rerenderUserTags: (username) => userRender.rerenderUserTags(username),
});
const userRender = createUserRender({
	store,
	fetchUser,
	openTagManager: () => tagManager.open(),
});
const toolbar = createToolbar({ store, backend });

// Sync state from other tabs. GM_addValueChangeListener fires whenever
// another tab writes to the same GM storage key. We invalidate the
// in-memory cache and re-render every user visible on this page.
if (typeof GM_addValueChangeListener === "function") {
	GM_addValueChangeListener(STATE_KEY, (_name, _oldVal, _newVal, remote) => {
		if (!remote) return;
		tagManager.getActive()?.markStale();
		store._invalidate();
		const usernames = new Set();
		for (const el of document.querySelectorAll("[data-hn-user]")) {
			usernames.add(el.dataset.hnUser);
		}
		for (const username of usernames) {
			userRender.rerenderUserTags(username);
			userRender.rerenderUserRatings(username);
		}
	});
}

applyDownvotedClass();
transformQuotes();

if (isItemPage()) {
	setupCommentBoxToggle();
	setupClickIndentToggle();
	setupCollapseRootComment();
	userRender.renderAllUsernames();
	toolbar.mount();
}

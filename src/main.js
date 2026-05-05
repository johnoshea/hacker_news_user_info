// Browser-side bootstrap. The build script wraps this (and every module
// imported above it) in a single IIFE inside the userscript bundle, so
// everything below runs once on load inside the userscript runtime.

import { createApi } from "./api.js";
import { STATE_KEY } from "./config.js";
import { isItemPage } from "./dom.js";
import { transformBackticksToMonospace } from "./features/backticks-to-monospace.js";
import { setupClickIndentToggle } from "./features/click-indent-toggle.js";
import { setupCollapseRootComment } from "./features/collapse-root-comment.js";
import { setupCommentBoxToggle } from "./features/comment-box-toggle.js";
import { setupHighlightUnreadComments } from "./features/highlight-unread-comments.js";
import { createHoverPopup } from "./features/hover-popup.js";
import { setupItemInfoHover } from "./features/item-info-hover.js";
import { applyDownvotedClass, transformQuotes } from "./features/legibility.js";
import { setupLinkifyUserAbout } from "./features/linkify-user-about.js";
import { setupReplyInline } from "./features/reply-inline.js";
import { setupSortStories } from "./features/sort-stories.js";
import { createTagManager } from "./features/tag-manager.js";
import { setupToggleAllComments } from "./features/toggle-all-comments.js";
import { createToolbar } from "./features/toolbar.js";
import { setupUserInfoHover } from "./features/user-info-hover.js";
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
const { fetchUser, fetchItem } = createApi({ store });
const hoverPopup = createHoverPopup();

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
// User-info hover wires every .hnuser on every page (except /user
// itself, which the feature checks internally).
setupUserInfoHover({ fetchUser, popup: hoverPopup });
// Linkify and sort-stories are page-gated internally (linkify by
// pathname, sort by table.itemlist presence), so call unconditionally.
setupLinkifyUserAbout();
setupSortStories();

if (isItemPage()) {
	setupCommentBoxToggle();
	setupClickIndentToggle();
	setupCollapseRootComment();
	transformBackticksToMonospace();
	setupToggleAllComments();
	setupHighlightUnreadComments({ store });
	userRender.renderAllUsernames();
	setupItemInfoHover({ fetchItem, popup: hoverPopup });
	setupReplyInline();
	toolbar.mount();
}

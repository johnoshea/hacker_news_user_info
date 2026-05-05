// Mark comment rows that weren't on the page the last time you visited
// this thread. Keeps a per-item ID list in the consolidated store under
// state.readComments[itemId] = { ids, fetchedAt }, with a 3-day TTL
// (READ_COMMENTS_TTL_MS in config). Stale entries are pruned on every
// item-page load so the slice can't grow unboundedly.
//
// First visit (no stored entry): nothing is highlighted, but every
// visible comment ID is recorded so the *next* visit knows which
// comments are new.
//
// Subsequent visits: ids in the current page that weren't in the
// stored entry get a .hn-new-comment class on their td.ind cell.

import { READ_COMMENTS_TTL_MS } from "../config.js";
import { findNewCommentIds } from "../parsing.js";

function getItemId() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || null;
}

function getCurrentCommentIds() {
	return Array.from(document.querySelectorAll("tr.comtr"))
		.map((row) => row.id)
		.filter(Boolean);
}

export function setupHighlightUnreadComments({ store }) {
	const itemId = getItemId();
	if (!itemId) return;

	const now = Date.now();

	// Drop expired entries first so a user who hasn't visited a thread
	// in months doesn't carry around its dead ID list forever.
	store.pruneReadComments(now, READ_COMMENTS_TTL_MS);

	const currentIds = getCurrentCommentIds();
	if (currentIds.length === 0) return;

	const stored = store.getReadComments(itemId);
	const isFreshSecondVisit =
		stored !== null && now - stored.fetchedAt <= READ_COMMENTS_TTL_MS;

	if (isFreshSecondVisit) {
		const newIds = findNewCommentIds(currentIds, stored.ids);
		for (const id of newIds) {
			const indent = document.getElementById(id)?.querySelector("td.ind");
			if (indent) indent.classList.add("hn-new-comment");
		}
	}

	// Always update the stored snapshot to match what's currently on
	// the page — next visit's "new" set is derived from this.
	store.setReadComments(itemId, currentIds, now);
}

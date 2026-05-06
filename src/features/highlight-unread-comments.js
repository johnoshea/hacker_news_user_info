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
// stored entry get a .hn-new-comment class on their tr.comtr row.
// (The class lives on the row, not on td.ind, because the indent cell
// has ~0 width on root-level comments — anything painted on it would
// be invisible there.)

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
	console.log("[hn-debug] highlight-unread: entry", { itemId });
	if (!itemId) return;

	const now = Date.now();

	// Drop expired entries first so a user who hasn't visited a thread
	// in months doesn't carry around its dead ID list forever.
	store.pruneReadComments(now, READ_COMMENTS_TTL_MS);

	const currentIds = getCurrentCommentIds();
	console.log("[hn-debug] highlight-unread: currentIds", currentIds.length);
	if (currentIds.length === 0) return;

	const stored = store.getReadComments(itemId);
	const isFreshSecondVisit =
		stored !== null && now - stored.fetchedAt <= READ_COMMENTS_TTL_MS;
	console.log("[hn-debug] highlight-unread: stored", {
		hasStored: stored !== null,
		storedCount: stored?.ids?.length,
		isFreshSecondVisit,
	});

	if (isFreshSecondVisit) {
		const newIds = findNewCommentIds(currentIds, stored.ids);
		for (const id of newIds) {
			const row = document.getElementById(id);
			if (row) row.classList.add("hn-new-comment");
		}
	}

	// Always update the stored snapshot to match what's currently on
	// the page — next visit's "new" set is derived from this.
	console.log("[hn-debug] highlight-unread: about to setReadComments", {
		itemId,
		count: currentIds.length,
	});
	try {
		store.setReadComments(itemId, currentIds, now);
		console.log("[hn-debug] highlight-unread: setReadComments returned");
		const verify = store.getReadComments(itemId);
		console.log("[hn-debug] highlight-unread: verify post-write", {
			hasEntry: verify !== null,
			count: verify?.ids?.length,
		});
	} catch (err) {
		console.error("[hn-debug] highlight-unread: setReadComments threw", err);
	}
}

// Listing-page pass for whole-story watches. For each story row that the
// user is watching, compare the count HN renders now against the seenCount
// captured on the last item-page visit; when it has grown, restyle the
// "n comments" link (★ + bold orange, via the shared .hn-watched-link
// rule) and append a "(+N)" delta so the amount of new activity is visible
// at a glance. No API: the listing already shows the live count.
//
// Runs unconditionally; gates internally on getStoryListTable() (mirrors
// setupWatchedListingHighlights so the main.js call site stays simple). It
// composes with that per-comment pass — both just add the same idempotent
// class to the same link, and only this pass appends the count.

import { WATCH_TTL_MS } from "../config.js";
import { findCommentsLink, getStoryListTable, h } from "../dom.js";
import { parseCommentCount } from "../parsing.js";

export function setupWatchedStoryHighlights({ store }) {
	const table = getStoryListTable();
	if (!table) return;

	// A listing-only browser never hits the item-page prune, so sweep here
	// too — same reasoning as the watched-comment listing pass.
	store.pruneWatchedStories(Date.now(), WATCH_TTL_MS);

	const watched = store.getWatchedStories();
	if (Object.keys(watched).length === 0) return;

	for (const athing of table.querySelectorAll("tr.athing")) {
		const entry = watched[athing.id];
		if (!entry) continue;
		const link = findCommentsLink(athing);
		if (!link) continue;
		const delta = parseCommentCount(link.textContent) - entry.seenCount;
		if (delta <= 0) continue;
		link.classList.add("hn-watched-link");
		link.after(h("span", { class: "hn-new-count", text: ` (+${delta})` }));
	}
}

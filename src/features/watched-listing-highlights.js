// Listing-page pass: for any story row in the listing table whose
// item has at least one watched comment, kick off a stale-aware fresh
// fetchItem recheck on each watch and, when any has new replies,
// restyle the story's "n comments" link with .hn-watched-link. The
// star ★ prefix is injected via the CSS ::before rule, not inline.
//
// Runs unconditionally; gates internally on getStoryListTable()
// (matches setupSortStories' approach so the call site in main.js
// stays simple).

import { WATCH_RECHECK_THROTTLE_MS } from "../config.js";
import { getStoryListTable } from "../dom.js";
import { isWatchCheckStale, watchesByItemId } from "../parsing.js";

// Find the "n comments" link for a story row. HN renders each story
// as <tr class="athing"> followed by a subtext <tr> on the next
// sibling; the comments link is the last <a href="item?id=..."> in
// the subtext (ahead of it sits "by user", "n hours ago", "hide", "past").
function findCommentsLink(athingRow) {
	const subtext = athingRow.nextElementSibling;
	if (!subtext) return null;
	const links = subtext.querySelectorAll('a[href^="item?id="]');
	return links[links.length - 1] || null;
}

export function setupWatchedListingHighlights({ store, fetchItem }) {
	const table = getStoryListTable();
	if (!table) return;

	const grouped = watchesByItemId(store.getWatchedComments());
	if (Object.keys(grouped).length === 0) return;

	const now = Date.now();
	const watches = store.getWatchedComments();

	for (const athing of table.querySelectorAll("tr.athing")) {
		const itemId = athing.id;
		const group = grouped[itemId];
		if (!group) continue;
		const link = findCommentsLink(athing);
		if (!link) continue;

		// Synchronous: if any watch in this group already has hasNew
		// from a previous session's API check, mark immediately.
		if (group.some((g) => g.hasNew)) {
			link.classList.add("hn-watched-link");
		}

		// Stale-aware async recheck. Each fetch resolves independently;
		// after each, recompute hasNew across the group and either
		// add or remove the class.
		for (const { commentId } of group) {
			const entry = watches[commentId];
			if (!entry) continue;
			if (!isWatchCheckStale(entry, now, WATCH_RECHECK_THROTTLE_MS)) continue;
			fetchItem(commentId, { fresh: true }).then((digest) => {
				if (digest) {
					store.updateWatchKids(commentId, digest.kids || [], Date.now());
				}
				// Re-evaluate the group after each resolve so the
				// highlight reflects the latest server view.
				const updated =
					watchesByItemId(store.getWatchedComments())[itemId] || [];
				if (updated.some((g) => g.hasNew)) {
					link.classList.add("hn-watched-link");
				} else {
					link.classList.remove("hn-watched-link");
				}
			});
		}
	}
}

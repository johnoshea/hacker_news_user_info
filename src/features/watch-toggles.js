// Per-comment "watch for replies" toggle. Runs after
// userRender.renderAllUsernames() (which produces the .hn-main-row
// layout this pass inserts into).
//
// Click semantics:
//   off -> on : apply .hn-watched class + .hn-watching to the icon
//               immediately (visual response is synchronous), fire a
//               fresh fetchItem to capture the comment's current kids,
//               and persist the watch entry.
//   on  -> off: remove .hn-watched / .hn-watching, delete the store
//               entry. Any in-flight initial fetch is dropped on
//               resolve (we re-check before writing).
//
// Page-load semantics: for every watched comment whose id is present
// on this page, mark the row, fire a throttle-aware fresh fetchItem
// and on resolve sync both latestKids and seenKids to the response.
// This is the "visit clears new" step.

import { WATCH_RECHECK_THROTTLE_MS, WATCH_TTL_MS } from "../config.js";
import { getItemPageId, h, isItemPage } from "../dom.js";
import { isWatchCheckStale } from "../parsing.js";

const ICON_OFF = "👁";
const ICON_ON = "👁‍🗨";

function setIconState(iconEl, isOn) {
	iconEl.textContent = isOn ? ICON_ON : ICON_OFF;
	iconEl.title = isOn ? "Stop watching" : "Watch for replies";
	iconEl.classList.toggle("hn-watching", isOn);
}

export function setupWatchToggles({ store, fetchItem }) {
	if (!isItemPage()) return;
	const itemId = getItemPageId();
	if (!itemId) return;

	// Prune watches past the TTL on every item-page load — same
	// pattern that highlight-unread-comments uses for read-comment
	// entries, so the watch list can't grow without bound.
	store.pruneWatchedComments(Date.now(), WATCH_TTL_MS);

	const rows = Array.from(document.querySelectorAll("tr.comtr"));

	for (const row of rows) {
		const commentId = row.id;
		if (!commentId) continue;

		const mainRow = row.querySelector(".hn-main-row");
		if (!mainRow) continue;

		const tagInput = mainRow.querySelector(".hn-tag-input");
		// Skip any .hn-main-row that user-render didn't fully populate.
		if (!tagInput || !mainRow.querySelector(".hn-rating-container")) continue;

		const initiallyWatched = store.getWatchedComment(commentId) !== null;

		const icon = h("span", { class: "hn-watch-icon" });
		icon.dataset.hnComment = commentId;
		setIconState(icon, initiallyWatched);

		icon.addEventListener("click", () => {
			// The icon's CSS class is the source of truth for "is this
			// currently watched", because the store-write on toggle-on
			// is async (it waits for fetchItem). Reading the store
			// directly here would let a fast double-click while the
			// initial fetch is in flight register two toggle-ON clicks.
			const wasWatched = icon.classList.contains("hn-watching");
			if (wasWatched) {
				store.removeWatchedComment(commentId);
				row.classList.remove("hn-watched");
				setIconState(icon, false);
				return;
			}
			// Toggle ON: visual response immediately, persist after fetch.
			row.classList.add("hn-watched");
			setIconState(icon, true);
			fetchItem(commentId, { fresh: true }).then((digest) => {
				// User may have toggled off before the fetch resolved.
				// The icon's class state is the user's latest intent;
				// only persist if they still want to be watching.
				if (!icon.classList.contains("hn-watching")) return;
				const kids = digest?.kids || [];
				const now = Date.now();
				store.setWatchedComment(commentId, {
					itemId,
					seenKids: kids.slice(),
					latestKids: kids.slice(),
					lastCheckedAt: now,
					addedAt: now,
				});
			});
		});

		// Insert between the rating container and the tag input.
		mainRow.insertBefore(icon, tagInput);

		// If watched, mark the row immediately on page load.
		if (initiallyWatched) {
			row.classList.add("hn-watched");
		}
	}

	// Page-load sync: for every watched comment present on this page,
	// fire a throttle-aware fresh fetchItem; on resolve, update
	// latestKids and seenKids in lockstep.
	const watches = store.getWatchedComments();
	const now = Date.now();
	for (const [commentId, entry] of Object.entries(watches)) {
		if (entry.itemId !== itemId) continue;
		if (!document.getElementById(commentId)) continue;
		if (!isWatchCheckStale(entry, now, WATCH_RECHECK_THROTTLE_MS)) {
			// Fresh enough — still acknowledge the current latestKids
			// (the user has visited the page).
			store.markWatchSeen(commentId, now);
			continue;
		}
		fetchItem(commentId, { fresh: true }).then((digest) => {
			if (store.getWatchedComment(commentId) === null) return; // toggled off mid-flight
			const kids = digest?.kids || [];
			const resolveNow = Date.now();
			store.updateWatchKids(commentId, kids, resolveNow);
			store.markWatchSeen(commentId, resolveNow);
		});
	}
}

// Toolbar prev/next-watched-comment navigation. Runs after
// toolbar.mount() and BEFORE setupWatchToggles on item pages. The
// ordering matters: setupWatchToggles' page-load sync calls
// markWatchSeen synchronously on the "not stale" path, which sets
// seenKids = latestKids and zeroes the hasNew predicate this pass
// reads. Capture targets first, then let the sync acknowledge.
//
// Returns { refresh }. The initial pass reads whatever the store holds
// at page load; `refresh` is wired (in main.js) to setupWatchToggles'
// page-load sync, whose fresh fetch may discover replies the persisted
// state didn't know about yet — either because this page is the first
// to check since the reply arrived, or because a cross-tab race stalled
// the last recheck write. Targets accumulate across calls (a union,
// never recomputed from scratch) so a watch acknowledged between calls
// keeps its buttons — same capture-then-acknowledge semantics as the
// initial pass.
//
// Adds two buttons to the toolbar's button container when at least
// one watched comment WITH new replies is present on this page;
// otherwise mounts nothing — the nav exists to surface activity, so a
// watched comment with no new replies is not a useful target.
//
// "Current position" is tracked as the last row navigated to; null
// means "before any" — the first click on `watch ↓` jumps to the
// first watched comment. Disabled state is recomputed after every
// click and refresh so a single-watch thread can never click `↑ watch`.

import { getItemPageId, h, isItemPage } from "../dom.js";
import { watchNavCommentIds } from "../parsing.js";

export function setupWatchedCommentNav({ store, toolbar }) {
	const inert = { refresh() {} };
	if (!isItemPage()) return inert;
	const itemId = getItemPageId();
	if (!itemId) return inert;

	// Union of every on-page row for a watch in this thread that has (or
	// had, at some point this page-lifetime) new replies. Watches whose
	// comment id isn't on this page (e.g. on a later "more" page) are
	// dropped.
	const targetRows = new Set();
	let rows = [];
	let currentRow = null;
	let prevBtn = null;
	let nextBtn = null;

	// Add newly-qualifying rows; returns true when the set grew.
	function collectTargets() {
		let grew = false;
		for (const commentId of watchNavCommentIds(
			store.getWatchedComments(),
			itemId,
		)) {
			const row = document.getElementById(commentId);
			if (row && !targetRows.has(row)) {
				targetRows.add(row);
				grew = true;
			}
		}
		return grew;
	}

	// Sort by document order. compareDocumentPosition returns a
	// bitmask; FOLLOWING (4) means `b` comes after `a`.
	function rebuildRows() {
		rows = Array.from(targetRows).sort((a, b) =>
			a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
		);
	}

	function currentIndex() {
		return currentRow ? rows.indexOf(currentRow) : -1;
	}

	function updateDisabled() {
		const i = currentIndex();
		// prev disabled when at or before the first
		prevBtn.disabled = i <= 0;
		// next disabled when at the last
		nextBtn.disabled = i >= rows.length - 1;
	}

	function goTo(i) {
		currentRow = rows[i];
		currentRow.scrollIntoView({ behavior: "smooth", block: "center" });
		updateDisabled();
	}

	function mountButtons() {
		const buttons = toolbar.getButtonsContainer();
		if (!buttons) return;
		prevBtn = h("button", {
			class: "hn-toolbar-btn hn-watch-nav hn-watch-nav-prev",
			text: "↑ watch",
		});
		nextBtn = h("button", {
			class: "hn-toolbar-btn hn-watch-nav hn-watch-nav-next",
			text: "watch ↓",
		});
		prevBtn.addEventListener("click", () => {
			const i = currentIndex();
			if (i <= 0) return;
			goTo(i - 1);
		});
		nextBtn.addEventListener("click", () => {
			const i = currentIndex();
			if (i >= rows.length - 1) return;
			goTo(i + 1);
		});
		buttons.appendChild(prevBtn);
		buttons.appendChild(nextBtn);
		updateDisabled();
	}

	function refresh() {
		if (!collectTargets()) return;
		rebuildRows();
		if (prevBtn) {
			updateDisabled();
		} else {
			mountButtons();
		}
	}

	refresh();
	return { refresh };
}

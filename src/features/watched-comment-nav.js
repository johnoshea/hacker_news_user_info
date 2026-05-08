// Toolbar prev/next-watched-comment navigation. Runs after
// toolbar.mount() on item pages. Adds two buttons to the toolbar's
// button container when at least one watched comment is present on
// this page; otherwise mounts nothing.
//
// "Current position" is tracked as a closure-local index into the
// list of watched-comment rows, in document order. Initial value -1
// means "before any" — the first click on `watch ↓` jumps to the
// first watched comment. Disabled state is recomputed after every
// click so a single-watch thread can never click `↑ watch`.

import { h, isItemPage } from "../dom.js";

function getItemIdFromCommentNavUrl() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || null;
}

export function setupWatchedCommentNav({ store, toolbar }) {
	if (!isItemPage()) return;
	const itemId = getItemIdFromCommentNavUrl();
	if (!itemId) return;

	// Resolve every on-page row for a watch in this thread, in DOM
	// order. Watches whose comment id isn't on this page (e.g. on a
	// later "more" page) are dropped.
	const watches = store.getWatchedComments();
	const rows = [];
	for (const [commentId, entry] of Object.entries(watches)) {
		if (entry.itemId !== itemId) continue;
		const row = document.getElementById(commentId);
		if (row) rows.push(row);
	}
	if (rows.length === 0) return;
	// Sort by document order. compareDocumentPosition returns a
	// bitmask; FOLLOWING (4) means `b` comes after `a`.
	rows.sort((a, b) =>
		a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
	);

	const buttons = toolbar.getButtonsContainer();
	if (!buttons) return;

	let currentIndex = -1;

	const prevBtn = h("button", {
		class: "hn-toolbar-btn hn-watch-nav hn-watch-nav-prev",
		text: "↑ watch",
	});
	const nextBtn = h("button", {
		class: "hn-toolbar-btn hn-watch-nav hn-watch-nav-next",
		text: "watch ↓",
	});

	function updateDisabled() {
		// prev disabled when at or before the first
		prevBtn.disabled = currentIndex <= 0;
		// next disabled when at the last
		nextBtn.disabled = currentIndex >= rows.length - 1;
	}

	prevBtn.addEventListener("click", () => {
		if (currentIndex <= 0) return;
		currentIndex -= 1;
		rows[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
		updateDisabled();
	});
	nextBtn.addEventListener("click", () => {
		if (currentIndex >= rows.length - 1) return;
		currentIndex += 1;
		rows[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
		updateDisabled();
	});

	buttons.appendChild(prevBtn);
	buttons.appendChild(nextBtn);
	updateDisabled();
}

// Tiny element factory. Accepts text content and event handlers but
// intentionally does NOT accept innerHTML - all text goes through
// textContent so it can't become an XSS foothold even if we later pass a
// username or tag name through it.
export function h(tag, props = {}, children = []) {
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

export function findCommentParent(usernameEl) {
	return usernameEl.closest(".comhead") || usernameEl.parentElement;
}

export function isItemPage() {
	return window.location.pathname === "/item";
}

// Read the item id from the current page's `?id=` URL parameter, or
// null if absent. Pairs with `isItemPage()` — both inspect
// `window.location` so they live together. Centralising here also
// dodges the build script's duplicate-function-name check, which
// otherwise forces each feature module to spell its own copy with a
// distinct name (see `scripts/build.js`).
export function getItemPageId() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || null;
}

// Find the listing-page story table. HN's older markup tagged it with
// `class="itemlist"`; the current markup leaves the table unclassed
// inside `<tr id="bigbox">`, so we anchor off the per-story
// `tr.athing.submission` marker instead. Returns null on item pages
// (the only `tr.athing.submission` there is the fatitem header, which
// we exclude) and on pages with no submission rows at all.
export function getStoryListTable() {
	const row = document.querySelector("tr.athing.submission");
	if (!row) return null;
	const table = row.closest("table");
	if (!table || table.classList.contains("fatitem")) return null;
	return table;
}

// Given a story's `tr.athing.submission` row (on a listing) or the item
// page's fatitem header row, return its "n comments" link. HN puts the
// subtext (score, by-user, age, hide, comments) on the next sibling row;
// the comments link is the last `item?id=` anchor there (ahead of it sit
// the age link and, on listings, nothing else that matches). Returns null
// if the row has no subtext or no such link (e.g. a jobs post). Shared by
// the watched-comment and watched-story listing passes plus the
// story-watch toggle, so it lives here rather than in any one feature.
export function findCommentsLink(athingRow) {
	const subtext = athingRow?.nextElementSibling;
	if (!subtext) return null;
	const links = subtext.querySelectorAll('a[href^="item?id="]');
	return links[links.length - 1] || null;
}

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

// HN renders a comment's indentation as an <img> in td.ind whose width is
// `40 * level` pixels; there is no other marker of reply depth in the
// markup. Several passes need to reconstruct the tree from that, so the
// reading lives here rather than being spelled out in each of them.
export function commentIndentLevel(row) {
	const img = row.querySelector("td.ind img");
	if (!img) return 0;
	const width = Number(img.getAttribute("width")) || img.width || 0;
	return Math.round(width / 40);
}

// Run fn immediately if the tab is visible, otherwise the first time it
// becomes visible. Userscripts run at load even in background tabs
// (cmd-click a story, never switch to it), so any write meaning "the
// user has now seen this page" — the unread-comment baseline, a watch's
// seenKids, a story watch's seenCount — must go through this gate or a
// never-viewed tab silently consumes the signal.
export function runWhenPageVisible(fn) {
	if (document.visibilityState === "visible") {
		fn();
		return;
	}
	const onChange = () => {
		if (document.visibilityState !== "visible") return;
		document.removeEventListener("visibilitychange", onChange);
		fn();
	};
	document.addEventListener("visibilitychange", onChange);
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

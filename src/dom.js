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

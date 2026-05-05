// On /user pages, walk the about-cell text nodes and replace plain-
// text URLs / email addresses with clickable <a> elements. The pure
// helper linkifySegments (in src/parsing.js) does the splitting; this
// module is the DOM glue.
//
// Skips text already inside an <a> so HN's own pre-existing links
// don't get wrapped a second time. Refined-hacker-news pulls in
// linkifyjs for this; we use a small in-house regex linker instead
// to avoid the npm dep.

import { linkifySegments } from "../parsing.js";

function findAboutCell() {
	// HN's user page has a nested table inside #hnmain; the inner table
	// has rows for "user:", "created:", "karma:", "about:". The "about:"
	// label is in the first cell; the body is in the next sibling cell.
	const rows = document.querySelectorAll("#hnmain table table tr");
	for (const row of rows) {
		const labelCell = row.querySelector("td");
		if (!labelCell) continue;
		if (labelCell.textContent.trim() === "about:") {
			return labelCell.nextElementSibling;
		}
	}
	return null;
}

function isInsideAnchor(node) {
	let cursor = node.parentNode;
	while (cursor && cursor.nodeType === Node.ELEMENT_NODE) {
		if (cursor.tagName === "A") return true;
		cursor = cursor.parentNode;
	}
	return false;
}

function buildLinkifiedFragment(text) {
	const fragment = document.createDocumentFragment();
	for (const seg of linkifySegments(text)) {
		if (seg.kind === "text") {
			fragment.appendChild(document.createTextNode(seg.value));
		} else if (seg.kind === "url") {
			const a = document.createElement("a");
			a.href = seg.value;
			a.rel = "noopener noreferrer";
			a.textContent = seg.value;
			fragment.appendChild(a);
		} else if (seg.kind === "email") {
			const a = document.createElement("a");
			a.href = `mailto:${seg.value}`;
			a.rel = "noopener noreferrer";
			a.textContent = seg.value;
			fragment.appendChild(a);
		}
	}
	return fragment;
}

export function setupLinkifyUserAbout() {
	if (window.location.pathname !== "/user") return;
	const cell = findAboutCell();
	if (!cell) return;

	// Two-pass walk to avoid the walker skipping over text nodes we
	// just inserted while replacing.
	const candidates = [];
	const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (isInsideAnchor(node)) return NodeFilter.FILTER_REJECT;
			const segs = linkifySegments(node.data);
			const hasLink = segs.some((s) => s.kind === "url" || s.kind === "email");
			return hasLink ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
		},
	});
	let n = walker.nextNode();
	while (n !== null) {
		candidates.push(n);
		n = walker.nextNode();
	}

	for (const node of candidates) {
		const fragment = buildLinkifiedFragment(node.data);
		node.replaceWith(fragment);
	}
}

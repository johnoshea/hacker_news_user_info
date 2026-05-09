// Hover the "parent" link in any comment's comhead for HOVER_DWELL_MS
// to see the parent comment's body inline — saves a navigation
// round-trip in deep or wide threads. Resolves the parent first via
// the on-page DOM (the common case: parent is somewhere above the
// hovered comment in the same item page) and falls back to the
// existing fetchItem cache when the parent isn't on the page (e.g.
// you're viewing a deep subtree at /item?id=DEEP_COMMENT, or the
// parent is the story itself for a top-level comment).
//
// The popup shows up to two paragraphs of body, plus an ellipsis if
// more were dropped. For a story parent (top-level comments), the
// title is rendered as a bold first line above the body. Author,
// timestamp and score are deliberately omitted — the goal is to
// remind the reader of what the comment-being-replied-to said, not
// to re-show metadata.

import { h } from "../dom.js";
import { parseParentIdFromHref, splitHtmlIntoParagraphs } from "../parsing.js";

const MAX_PARAGRAPHS = 2;

// Parse a paragraph HTML string into a fragment of DOM nodes,
// preserving inline markup (anchors, italics, code) without trusting
// the string as live HTML. DOMParser delivers a sandboxed Document;
// we only adopt the parsed children.
function paragraphToNodes(htmlChunk) {
	const doc = new DOMParser().parseFromString(
		`<div>${htmlChunk}</div>`,
		"text/html",
	);
	const wrapper = doc.body.firstChild;
	if (!wrapper) return [];
	return Array.from(wrapper.childNodes).map((n) =>
		document.importNode(n, true),
	);
}

function renderParagraphs(paragraphs, hasMore) {
	const nodes = [];
	for (const para of paragraphs) {
		nodes.push(
			h("p", { class: "hn-hover-popup-body" }, paragraphToNodes(para)),
		);
	}
	if (hasMore) {
		nodes.push(h("p", { class: "hn-hover-popup-body", text: "…" }));
	}
	return nodes;
}

// Try the on-page DOM first. Returns null if the parent isn't on the
// page or has no body content (deleted comments fall through to the
// API path, which can return a [deleted] placeholder or null).
function loadFromDom(parentId) {
	const row = document.getElementById(parentId);
	if (!row || row.tagName !== "TR") return null;
	const commtext = row.querySelector(".commtext");
	if (!commtext) return null;
	const paragraphs = splitHtmlIntoParagraphs(commtext.innerHTML);
	if (paragraphs.length === 0) return null;
	return {
		title: null,
		paragraphs: paragraphs.slice(0, MAX_PARAGRAPHS),
		hasMore: paragraphs.length > MAX_PARAGRAPHS,
	};
}

async function loadFromApi(parentId, fetchItem) {
	const digest = await fetchItem(parentId);
	if (!digest) return null;
	const paragraphs = splitHtmlIntoParagraphs(digest.text || "");
	if (paragraphs.length === 0 && !digest.title) return null;
	return {
		title: digest.title || null,
		paragraphs: paragraphs.slice(0, MAX_PARAGRAPHS),
		hasMore: paragraphs.length > MAX_PARAGRAPHS,
	};
}

function renderPopup(data) {
	const lines = [];
	if (data.title) {
		lines.push(
			h("div", { class: "hn-hover-popup-title" }, [
				h("strong", { text: data.title }),
			]),
		);
	}
	for (const node of renderParagraphs(data.paragraphs, data.hasMore)) {
		lines.push(node);
	}
	return lines;
}

export function setupParentHover({ fetchItem, popup }) {
	const links = document.querySelectorAll("span.comhead a[href^='item?id=']");
	for (const link of links) {
		// The comhead has multiple "item?id=" anchors (parent, prev, next,
		// root, context); only the "parent" link is the use case here.
		if (link.textContent.trim() !== "parent") continue;
		const id = parseParentIdFromHref(link.getAttribute("href") || link.href);
		if (!id) continue;
		popup.attachDwell(
			link,
			() => loadFromDom(id) ?? loadFromApi(id, fetchItem),
			(data) => renderPopup(data),
		);
	}
}

// Hover any link to /item?id=N inside a comment to see a preview of
// that item: title, domain, author, score, comment count, time, and
// (for Ask/Show items) a snippet of the body text. Useful when a
// commenter cites another submission and you want context without
// leaving the page.
//
// Scoped to `.commtext a[href*='/item?id=']` so we only enrich
// commenter-cited links, not navigation chrome (like the "parent" /
// "next" links that point to other items).

import { h } from "../dom.js";
import { extractDomain, timeSince, truncateText } from "../parsing.js";

const TEXT_PREVIEW_MAX = 280;

function getItemId(link) {
	try {
		const url = new URL(link.href);
		return url.searchParams.get("id") || null;
	} catch {
		return null;
	}
}

function textToPreview(html) {
	if (!html) return "";
	const doc = new DOMParser().parseFromString(html, "text/html");
	const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
	return truncateText(text, TEXT_PREVIEW_MAX);
}

function renderItemPopup(digest) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const titleNodes = [h("strong", { text: digest.title || "(untitled)" })];
	const domain = extractDomain(digest.url);
	if (domain) {
		titleNodes.push(
			h("span", { class: "hn-hover-popup-domain", text: ` (${domain})` }),
		);
	}

	const lines = [h("div", { class: "hn-hover-popup-title" }, titleNodes)];

	const metaParts = [];
	if (digest.score) metaParts.push(`${digest.score} points`);
	if (digest.by) metaParts.push(`by ${digest.by}`);
	if (digest.time) metaParts.push(`${timeSince(digest.time, nowSeconds)} ago`);
	if (typeof digest.descendants === "number") {
		metaParts.push(
			`${digest.descendants} comment${digest.descendants === 1 ? "" : "s"}`,
		);
	}
	if (metaParts.length > 0) {
		lines.push(
			h("div", { class: "hn-hover-popup-meta", text: metaParts.join(" · ") }),
		);
	}

	const body = textToPreview(digest.text);
	if (body) {
		lines.push(h("div", { class: "hn-hover-popup-body", text: body }));
	}
	return lines;
}

export function setupItemInfoHover({ fetchItem, popup }) {
	const links = document.querySelectorAll(".commtext a[href*='/item?id=']");
	for (const link of links) {
		const id = getItemId(link);
		if (!id) continue;
		popup.attachDwell(
			link,
			() => fetchItem(id),
			(digest) => renderItemPopup(digest),
		);
	}
}

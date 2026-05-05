// "[toggle all]" link in the fatitem subtext that fires every
// top-level comment's a.togg in one click — useful on long threads
// where you've already drilled into one subtree and want to dismiss
// the rest, or want to expand a fully-collapsed page in one go.
//
// Optionally also adds a per-comment "[toggle replies]" link that
// fires every direct child's a.togg. Gated by TOGGLE_ALL_REPLIES_ENABLED
// in src/config.js because adding a link to every commentscales
// linearly with thread size; refined-hacker-news warns that it slows
// page render on items with hundreds of comments. Default off.

import { TOGGLE_ALL_REPLIES_ENABLED } from "../config.js";
import { h } from "../dom.js";

function indentLevel(row) {
	const img = row.querySelector("td.ind img");
	if (!img) return 0;
	const width = Number(img.getAttribute("width")) || img.width || 0;
	return Math.round(width / 40);
}

function fireToggle(row) {
	row.querySelector("a.togg")?.click();
}

export function setupToggleAllComments() {
	const subtext = document.querySelector(".fatitem .subtext");
	const allRows = Array.from(document.querySelectorAll("tr.comtr"));
	if (!subtext || allRows.length === 0) return;

	const levels = allRows.map(indentLevel);

	// Fatitem-level toggle: collect all root rows up front so the click
	// handler doesn't re-query the DOM on every press.
	const rootRows = allRows.filter((_, i) => levels[i] === 0);
	if (rootRows.length > 0) {
		const link = h("a", {
			class: "hn-toggle-all",
			href: "javascript:void(0)",
			text: "toggle all",
			onclick: (e) => {
				e.preventDefault();
				for (const row of rootRows) fireToggle(row);
			},
		});
		// Match HN's subtext separator pattern: " | <link>".
		subtext.append(document.createTextNode(" | "));
		subtext.append(link);
	}

	if (!TOGGLE_ALL_REPLIES_ENABLED) return;

	// Per-comment "[toggle replies]" links. For each row, find its
	// immediate children (the contiguous run of following rows whose
	// indent is exactly +1 deeper, stopping when we hit one at <= the
	// parent's level). Skip rows that have no replies.
	for (let i = 0; i < allRows.length; i++) {
		const parent = allRows[i];
		const parentLevel = levels[i];
		const replies = [];
		for (let j = i + 1; j < allRows.length; j++) {
			if (levels[j] <= parentLevel) break;
			if (levels[j] === parentLevel + 1) replies.push(allRows[j]);
		}
		if (replies.length === 0) continue;

		const head = parent.querySelector("span.comhead");
		if (!head) continue;

		head.append(
			h("a", {
				class: "hn-toggle-replies",
				href: "javascript:void(0)",
				text: "[toggle replies]",
				onclick: (e) => {
					e.preventDefault();
					for (const row of replies) fireToggle(row);
				},
			}),
		);
	}
}

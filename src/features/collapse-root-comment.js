// On each non-root comment, append a "[collapse root]" link to the
// comhead. Clicking it fires the root comment's native toggle and
// scrolls the page back to the (now-collapsed) root, so a reader who
// has descended deep into a thread can dismiss the whole subtree
// without losing their place in the page.

import { h } from "../dom.js";
import { findCommentRootIndices } from "../parsing.js";

export function setupCollapseRootComment() {
	const comments = Array.from(document.querySelectorAll("tr.comtr"));
	if (comments.length === 0) return;

	// HN renders indentation as an <img> in td.ind whose width is
	// `40 * level` pixels. We read that width once per comment to build
	// the level array, then hand it to the pure helper.
	const indentLevels = comments.map((row) => {
		const img = row.querySelector("td.ind img");
		if (!img) return 0;
		const width = Number(img.getAttribute("width")) || img.width || 0;
		return Math.round(width / 40);
	});

	const rootIndices = findCommentRootIndices(indentLevels);

	for (let i = 0; i < comments.length; i++) {
		const rootIdx = rootIndices[i];
		if (rootIdx === -1) continue;
		const root = comments[rootIdx];
		const head = comments[i].querySelector("span.comhead");
		if (!head) continue;

		const link = h("a", {
			class: "hn-collapse-root",
			href: "javascript:void(0)",
			text: "[collapse root]",
			onclick: (e) => {
				e.preventDefault();
				const rootToggle = root.querySelector("a.togg");
				if (!rootToggle) return;
				rootToggle.click();
				// Scroll the (now collapsed) root into view so the reader
				// doesn't lose their place after the subtree disappears.
				const rect = root.getBoundingClientRect();
				const top = rect.top + window.scrollY;
				window.scrollTo({ top, left: 0 });
			},
		});

		head.append(link);
	}
}

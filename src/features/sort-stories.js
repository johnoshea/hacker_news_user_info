// On listing pages (/news, /newest, /ask, /show, /best, /front, etc.)
// add a "sort: …" dropdown above table.itemlist. Selecting an option
// reorders the story rows in place; a "reverse" link flips the
// current order. Sort options:
//   - default: HN's server-supplied rank
//   - time:    newer items first (by id, which is monotonically
//              increasing)
//   - score:   highest first
//   - ratio:   comments/score descending — proxy for "most-discussed
//              given its score", surfaces controversial threads
//
// All three of these are non-persistent (per page load). The pure
// helper sortStoriesBy in src/parsing.js does the actual ordering.

import { h } from "../dom.js";
import { sortStoriesBy } from "../parsing.js";

const MODES = [
	{ value: "default", label: "default" },
	{ value: "time", label: "time" },
	{ value: "score", label: "score" },
	{ value: "ratio", label: "comments/score ratio" },
];

// Read each story's metadata + the 3 row group it occupies in
// table.itemlist > tbody. HN renders each story as exactly:
//   <tr class="athing">    -- title row, id=NNNN
//   <tr>...</tr>           -- subtext row (score, by, time, comments)
//   <tr style="height:5px">-- spacer row
function parseStoryRows(table) {
	const rows = Array.from(table.querySelectorAll("tbody > tr"));
	const stories = [];
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (!row.classList.contains("athing")) continue;
		const subtext = rows[i + 1];
		if (!subtext) continue;
		const spacer = rows[i + 2];

		const id = row.id;
		const rankText = row.querySelector(".rank")?.textContent || "";
		const defaultRank =
			Number(rankText.replace(/\.$/, "")) || stories.length + 1;
		const scoreText = subtext.querySelector(".score")?.textContent || "";
		const score = Number(scoreText.split(" ")[0]) || 0;
		// Comment count: the last "X comments" / "discuss" link in the
		// subtext. "discuss" means 0 comments; missing means it's a job
		// posting (no discussion).
		let commentsCount = 0;
		const commentLinks = subtext.querySelectorAll('a[href^="item?id="]');
		const lastLink = commentLinks[commentLinks.length - 1];
		if (lastLink) {
			const txt = lastLink.textContent.trim();
			const m = txt.match(/^(\d+)/);
			if (m) commentsCount = Number(m[1]);
		}

		const elements = [row, subtext];
		if (spacer && !spacer.classList.contains("athing")) {
			elements.push(spacer);
		}
		stories.push({ id, score, commentsCount, defaultRank, elements });
	}
	return stories;
}

function rerenderStories(tbody, stories) {
	// HN appends a "More" link as the last row of itemlist (and a
	// matching morespace row above it). Preserve those at the end so
	// pagination still works after reorder.
	const allRows = Array.from(tbody.children);
	const moreRow = allRows[allRows.length - 1];
	const moreSpace = allRows[allRows.length - 2];

	// Detach every story group's rows, then re-append in the requested
	// order. The DOM mutations are cheap because we're just moving
	// existing elements, not creating new ones.
	for (const story of stories) {
		for (const el of story.elements) {
			el.remove();
		}
	}

	// Find a stable insertion point: just before moreSpace (if present)
	// or at the end otherwise.
	const anchor =
		moreSpace && tbody.contains(moreSpace) ? moreSpace : moreRow || null;
	for (const story of stories) {
		for (const el of story.elements) {
			if (anchor && tbody.contains(anchor)) {
				tbody.insertBefore(el, anchor);
			} else {
				tbody.appendChild(el);
			}
		}
	}
}

export function setupSortStories() {
	const table = document.querySelector("table.itemlist");
	if (!table) return;
	const tbody = table.querySelector("tbody");
	if (!tbody) return;

	// Capture the original story list (with default-rank metadata) once.
	// Subsequent sorts work from this snapshot so "default" really
	// restores the server-supplied ordering, not the most recent sort.
	const original = parseStoryRows(table);
	if (original.length === 0) return;

	const select = h("select", { class: "hn-sort-select" });
	for (const { value, label } of MODES) {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = label;
		select.appendChild(option);
	}
	const reverse = h("a", {
		class: "hn-sort-reverse",
		href: "javascript:void(0)",
		text: "reverse",
	});

	let currentMode = "default";
	let isReversed = false;

	function applyOrder() {
		let stories = sortStoriesBy(original, currentMode);
		if (isReversed) stories = stories.slice().reverse();
		rerenderStories(tbody, stories);
	}

	select.addEventListener("change", () => {
		currentMode = select.value;
		isReversed = false;
		applyOrder();
	});
	reverse.addEventListener("click", (e) => {
		e.preventDefault();
		isReversed = !isReversed;
		applyOrder();
	});

	const bar = h("div", { class: "hn-sort-bar" }, [
		h("label", { text: "sort: ", htmlFor: "hn-sort-select" }),
		select,
		reverse,
	]);
	table.parentNode.insertBefore(bar, table);
}

// Auto-collapse comments whose author's stored rating is at or
// below LOW_SCORE_COLLAPSE_THRESHOLD. This pass walks every
// tr.comtr on the page once, tags each row with
// data-hn-author=<username> (so rerenderUserRatings can find rows
// by author later), and applies the .hn-low-score class to rows
// whose author crosses the threshold. CSS in styles.js does the
// actual hiding.
//
// The [low score] marker is appended to the comhead — same
// position as the existing [collapse root] link — so the reader
// has a visible reason for the empty body.

import { LOW_SCORE_COLLAPSE_THRESHOLD } from "../config.js";
import { h } from "../dom.js";
import { shouldAutoCollapseAuthor } from "../parsing.js";

export function setupAutoCollapseLowScore({ store }) {
	for (const row of document.querySelectorAll("tr.comtr")) {
		const userEl = row.querySelector(".hnuser");
		const username = userEl?.textContent || "";
		if (!username) continue;
		row.dataset.hnAuthor = username;

		const rating = store.getRating(username);
		if (!shouldAutoCollapseAuthor(rating, LOW_SCORE_COLLAPSE_THRESHOLD)) {
			continue;
		}
		row.classList.add("hn-low-score");

		const head = row.querySelector("span.comhead");
		if (head) {
			head.append(
				h("span", { class: "hn-low-score-tag", text: "[low score]" }),
			);
		}
	}
}

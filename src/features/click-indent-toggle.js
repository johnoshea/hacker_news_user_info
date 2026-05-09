// Make the empty indent column on each comment a click target.
// Default behaviour: fire HN's native toggle (collapse/expand the
// whole subtree). Overridden behaviour: on rows tagged
// .hn-low-score (auto-collapsed because the author's rating is at
// or below the configured threshold), toggle .hn-low-score-expanded
// instead — score-collapse hides only this comment's body, not its
// replies, so HN's native subtree toggle would do the wrong thing.

export function setupClickIndentToggle() {
	for (const row of document.querySelectorAll("tr.comtr")) {
		const indentCell = row.querySelector("td.ind");
		const toggleBtn = row.querySelector("a.togg");
		if (!indentCell || !toggleBtn) continue;
		indentCell.classList.add("hn-clickable-indent");
		indentCell.addEventListener("click", () => {
			if (row.classList.contains("hn-low-score")) {
				row.classList.toggle("hn-low-score-expanded");
				return;
			}
			toggleBtn.click();
		});
	}
}

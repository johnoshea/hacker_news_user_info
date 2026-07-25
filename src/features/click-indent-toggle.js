// Make the empty indent column on each comment a click target. This is
// the one router for gutter clicks, so it dispatches on whichever of our
// own collapse states the row is in before falling back to HN's native
// toggle:
//
//   .hn-seen-collapsed  the row stands in for a hidden subtree, so the
//                       click goes to its "[N hidden]" expander and the
//                       reveal logic stays in collapse-seen-comments.
//   .hn-low-score /     only this comment's body is hidden, not its
//   .hn-seen-stub       replies, so firing HN's subtree toggle would do
//                       the wrong thing — reveal the body instead.
//   anything else       HN's native a.togg, unchanged.

export function setupClickIndentToggle() {
	for (const row of document.querySelectorAll("tr.comtr")) {
		const indentCell = row.querySelector("td.ind");
		const toggleBtn = row.querySelector("a.togg");
		if (!indentCell || !toggleBtn) continue;
		indentCell.classList.add("hn-clickable-indent");
		indentCell.addEventListener("click", () => {
			if (row.classList.contains("hn-seen-collapsed")) {
				row.querySelector(".hn-seen-expander")?.click();
				return;
			}
			if (
				row.classList.contains("hn-low-score") ||
				row.classList.contains("hn-seen-stub")
			) {
				row.classList.toggle("hn-body-expanded");
				return;
			}
			toggleBtn.click();
		});
	}
}

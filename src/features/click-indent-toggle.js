// Make the empty indent column on each comment a click target that fires
// HN's native toggle (collapse/expand). Cheap to add, big quality-of-life
// win on long threads — there's a lot of indent gutter to click.

export function setupClickIndentToggle() {
	for (const row of document.querySelectorAll("tr.comtr")) {
		const indentCell = row.querySelector("td.ind");
		const toggleBtn = row.querySelector("a.togg");
		if (!indentCell || !toggleBtn) continue;
		indentCell.classList.add("hn-clickable-indent");
		indentCell.addEventListener("click", () => {
			toggleBtn.click();
		});
	}
}

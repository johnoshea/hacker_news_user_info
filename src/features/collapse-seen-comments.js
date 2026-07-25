// "collapse seen" toggle in the fatitem subtext, offered on any thread
// that has both new comments and old ones to get out of their way.
//
// Turning it on reduces every comment you have already read to a
// header-only stub, and hides whole subtrees that contain nothing new
// behind an "[N hidden]" expander. What survives at full size is the new
// comments plus the chain of ancestors leading down to each of them, so a
// reply still reads in context. Turning it off puts the page back.
//
// The mode is off on every load and is not persisted anywhere.
//
// Note what this does NOT do: fire HN's own a.togg. HN's toggleCollapse
// posts collapse?id=... to the server for logged-in users, so bulk-firing
// it would rewrite your account's collapse state. Rows are hidden with our
// own classes instead, which also means a comment you collapsed on HN
// stays collapsed through both halves of this toggle.

import { commentIndentLevel, h } from "../dom.js";
import { planSeenCollapse } from "../parsing.js";

export function setupCollapseSeenComments({ newIds }) {
	const subtext = document.querySelector(".fatitem .subtext");
	const rows = Array.from(document.querySelectorAll("tr.comtr"));
	if (!subtext || rows.length === 0 || newIds.length === 0) return;

	const newIdSet = new Set(newIds);
	const plan = planSeenCollapse(
		rows.map(commentIndentLevel),
		rows.map((row) => newIdSet.has(row.id)),
	);
	// Every comment on the page is new (or the thread is a single new
	// comment): there is nothing to collapse, so don't offer the link.
	if (plan.stubs.length === 0 && plan.collapsed.length === 0) return;

	const stubRows = plan.stubs.map((i) => rows[i]);

	// Resolve each collapsed subtree to live rows once, and give its root
	// the expander now — CSS keeps that out of sight until the mode is on.
	const subtrees = plan.collapsed.map(({ root, descendants }) => {
		const rootRow = rows[root];
		const hidden = descendants.map((i) => rows[i]);
		const expander = h("a", {
			class: "hn-seen-expander",
			href: "javascript:void(0)",
			text: `[${hidden.length} hidden]`,
			onclick: (event) => {
				event.preventDefault();
				// A one-way reveal: the subtree rejoins the page in full and
				// this root stops being managed until the mode is re-applied.
				rootRow.classList.remove("hn-seen-stub", "hn-seen-collapsed");
				for (const row of hidden) row.classList.remove("hn-seen-hidden");
			},
		});
		rootRow.querySelector("span.comhead")?.append(expander);
		return { rootRow, hidden };
	});

	const label = `collapse seen (${newIds.length} new)`;
	let active = false;

	const link = h("a", {
		class: "hn-collapse-seen",
		href: "javascript:void(0)",
		text: label,
		onclick: (event) => {
			event.preventDefault();
			active = !active;
			for (const row of stubRows) row.classList.toggle("hn-seen-stub", active);
			for (const { rootRow, hidden } of subtrees) {
				rootRow.classList.toggle("hn-seen-stub", active);
				rootRow.classList.toggle("hn-seen-collapsed", active);
				for (const row of hidden)
					row.classList.toggle("hn-seen-hidden", active);
			}
			link.textContent = active ? "show all" : label;
		},
	});

	// Match HN's subtext separator pattern: " | <link>".
	subtext.append(document.createTextNode(" | "));
	subtext.append(link);
}

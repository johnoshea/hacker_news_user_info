// Walk the text nodes inside every .commtext and replace `inline code`
// segments (delimited by backticks) with proper <code> elements. The
// pure helper splitBackticks(text) does the actual splitting; this
// module is the DOM glue.
//
// Skips text inside existing <code>, <pre>, and <a> elements so we
// don't mangle pre-formatted code blocks or rewrite link text.

import { splitBackticks } from "../parsing.js";

const SKIP_TAGS = new Set(["code", "pre", "a"]);

export function transformBackticksToMonospace() {
	for (const commtext of document.querySelectorAll(".commtext")) {
		// Two-pass: collect candidate text nodes first, then mutate. A
		// single pass that mutates while walking would have the walker
		// skip nodes that get inserted during replacement.
		const candidates = [];
		const walker = document.createTreeWalker(commtext, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const parent = node.parentNode;
				if (!parent) return NodeFilter.FILTER_REJECT;
				const tag = parent.tagName?.toLowerCase();
				if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
				// Quick prefilter: a text node with no backticks won't
				// match anything in splitBackticks, so don't bother.
				if (!node.data.includes("`")) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let n = walker.nextNode();
		while (n !== null) {
			candidates.push(n);
			n = walker.nextNode();
		}

		for (const node of candidates) {
			const segments = splitBackticks(node.data);
			if (!segments.some((s) => s.kind === "code")) continue;
			const fragment = document.createDocumentFragment();
			for (const seg of segments) {
				if (seg.kind === "text") {
					fragment.appendChild(document.createTextNode(seg.value));
				} else {
					const code = document.createElement("code");
					code.textContent = seg.value;
					fragment.appendChild(code);
				}
			}
			node.replaceWith(fragment);
		}
	}
}

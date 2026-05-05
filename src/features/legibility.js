// Site-wide legibility passes. Run on every HN page: restyle downvoted
// comments and rewrite ">"-prefixed text into styled quote blocks.

import { h } from "../dom.js";
import { stripLeadingQuoteMarker } from "../parsing.js";

// HN comment styling: any .commtext that lacks the .c00 class has been
// downvoted (HN drops the class to express grey-on-grey). We tag the
// surrounding .comment so our CSS can restore black text on a faint-grey
// background.
export function applyDownvotedClass() {
	for (const el of document.querySelectorAll(".commtext")) {
		if (!el.classList.contains("c00")) {
			el.parentElement?.classList.add("downvoted");
		}
	}
}

// Find <i>/<p>/<span> whose first text-node child starts with ">" and
// re-render it as a styled <p class="quote"> block. Two shapes seen in
// HN markup:
//   1. The first text node contains both the marker and the quoted body
//      (e.g. <i>&gt; quoted text</i>) -> strip the marker, set the body
//      as text on the new <p>.
//   2. The first text node is just the marker, with the quoted content
//      sitting in the next sibling (e.g. <i>&gt; <a>link</a></i>) -> move
//      the sibling into the <p> so any nested elements survive.
export function transformQuotes() {
	const candidates = document.querySelectorAll("i, p, span");
	for (const el of candidates) {
		if (el.classList.contains("quote")) continue;
		const textNode = Array.from(el.childNodes).find(
			(n) => n.nodeType === Node.TEXT_NODE,
		);
		if (!textNode?.data.trimStart().startsWith(">")) continue;

		const p = h("p", { class: "quote" });
		if (textNode.data.trim() === ">") {
			const next = textNode.nextSibling;
			if (next) p.appendChild(next);
		} else {
			p.textContent = stripLeadingQuoteMarker(textNode.data);
		}
		textNode.replaceWith(p);
	}
}

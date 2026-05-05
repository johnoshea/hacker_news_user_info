// Shared hover-popup primitive used by user-info-hover and item-info-hover.
// Builds a single fixed-position div appended to <body>, plus an
// attachDwell helper that wires the standard "cursor rests for N ms ->
// fetch -> render -> show" pattern. One popup per page; whichever
// hover wins last replaces the content.

import { HOVER_DWELL_MS } from "../config.js";
import { h } from "../dom.js";

export function createHoverPopup() {
	const popup = h("div", { class: "hn-hover-popup hidden" });
	document.body.appendChild(popup);

	let currentToken = 0; // monotonic; bumped on every show/hide
	let visibleNear = null;

	function setContent(nodes) {
		popup.replaceChildren(...nodes);
	}

	function position(near) {
		const rect = near.getBoundingClientRect();
		// Anchor below the link, scrolled-position-aware. Clamp to the
		// viewport so the popup doesn't escape off the right or bottom
		// edge on long usernames near the screen edge.
		const top = rect.bottom + window.scrollY + 6;
		const proposedLeft = rect.left + window.scrollX;
		const maxLeft = window.scrollX + document.documentElement.clientWidth - 360;
		const left = Math.max(window.scrollX + 4, Math.min(proposedLeft, maxLeft));
		popup.style.top = `${top}px`;
		popup.style.left = `${left}px`;
	}

	function show(near, contentNodes) {
		setContent(contentNodes);
		position(near);
		popup.classList.remove("hidden");
		visibleNear = near;
	}

	function hide() {
		currentToken += 1;
		popup.classList.add("hidden");
		visibleNear = null;
		popup.replaceChildren();
	}

	// Wire mouseenter/mouseleave on `target` so that, after HOVER_DWELL_MS
	// of continuous hover, `loader()` is invoked. If it resolves and the
	// cursor is still on the target, `render(data)` is called and its
	// returned nodes are shown in the popup. Mouse leaving the target at
	// any time aborts the in-flight chain via a token bump.
	function attachDwell(target, loader, render) {
		let dwellTimer = null;
		let myToken = -1;

		target.addEventListener("mouseenter", () => {
			if (dwellTimer) clearTimeout(dwellTimer);
			currentToken += 1;
			myToken = currentToken;
			dwellTimer = setTimeout(() => {
				if (myToken !== currentToken) return;
				Promise.resolve(loader()).then((data) => {
					if (myToken !== currentToken) return;
					if (!data) {
						hide();
						return;
					}
					show(target, render(data));
				});
			}, HOVER_DWELL_MS);
		});

		target.addEventListener("mouseleave", () => {
			if (dwellTimer) {
				clearTimeout(dwellTimer);
				dwellTimer = null;
			}
			// Only hide if this target's hover is still the visible one;
			// avoids hiding the popup the user just moved into a second
			// candidate over.
			if (visibleNear === target) hide();
			currentToken += 1;
			myToken = -1;
		});
	}

	return { show, hide, attachDwell };
}

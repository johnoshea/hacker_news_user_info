// Hover any .hnuser link to see a popup with the user's account age,
// karma, and (if any) about-text snippet. Shares the popup primitive
// with item-info-hover, and the user-data cache with renderAllUsernames
// — repeat hovers cost zero requests.
//
// Skips:
//   - The /user page itself (you're already looking at the profile)
//   - The .hnuser inside .hn-main-row (our own injected username clone
//     in renderAllUsernames; hovering that would create a duplicate
//     "(N years old, KKK karma)" experience next to the inline blurb)

import { h } from "../dom.js";
import { timeSince, truncateText } from "../parsing.js";

const ABOUT_PREVIEW_MAX = 280;

function isOnUserPage() {
	return window.location.pathname === "/user";
}

// HN serves `about` as HTML (links, paragraphs, italic). For the
// preview popup, we want a plain-text rendering — strips tags via the
// browser's HTML parser and trims to a fixed length so a long bio
// doesn't make the popup the size of a small monitor.
function aboutToText(html) {
	if (!html) return "";
	const doc = new DOMParser().parseFromString(html, "text/html");
	const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
	return truncateText(text, ABOUT_PREVIEW_MAX);
}

function renderUserPopup(username, data) {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const lines = [
		h("div", { class: "hn-hover-popup-title" }, [
			h("strong", { text: username }),
		]),
		h("div", {
			class: "hn-hover-popup-meta",
			text: `${timeSince(data.created, nowSeconds)} old · ${data.karma} karma`,
		}),
	];
	const about = aboutToText(data.about);
	if (about) {
		lines.push(h("div", { class: "hn-hover-popup-body", text: about }));
	}
	return lines;
}

export function setupUserInfoHover({ fetchUser, popup }) {
	if (isOnUserPage()) return;
	for (const link of document.querySelectorAll("a.hnuser")) {
		// Skip our own injected clone inside .hn-main-row — it lives next
		// to the inline (age, karma) blurb so the popup would be redundant.
		if (link.closest(".hn-main-row")) continue;
		const username = link.textContent;
		if (!username) continue;
		popup.attachDwell(
			link,
			() => fetchUser(username),
			(data) => renderUserPopup(username, data),
		);
	}
}

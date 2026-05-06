// Hover any .hnuser link to see a popup with the user's account age,
// karma, and (if any) about-text snippet. Shares the popup primitive
// with item-info-hover, and the user-data cache with renderAllUsernames
// — repeat hovers cost zero requests.
//
// Skipped on the /user page itself (you're already looking at the
// profile).
//
// On item pages, renderAllUsernames hides each original .hnuser and
// inserts a visible clone inside .hn-main-row — so this pass must run
// after renderAllUsernames, and we attach to every .hnuser we find.
// Handlers on the hidden originals never fire (display:none = no mouse
// events); the visible clones do, and the popup adds the about-text
// snippet that the inline (age, karma) blurb doesn't show.

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
		const username = link.textContent;
		if (!username) continue;
		popup.attachDwell(
			link,
			() => fetchUser(username),
			(data) => renderUserPopup(username, data),
		);
	}
}

// Inline reply / edit / delete: instead of navigating away to
// /reply?id=N or /edit?id=N when the user clicks one of those links,
// fetch the page in the background and inject its <form> into the
// comment's div.reply. Click again to hide. If text is selected
// before the click, prepend it as a "> " quoted block to the
// textarea so users can quote-reply with the keyboard.
//
// Adapted from refined-hacker-news's reply-without-leaving-page,
// minus the italics-on-quote option (always plain "> "). Network
// fetches go through GM_xmlhttpRequest with a timeout — without it
// a hung request would silently strand the spinner forever.

import { h } from "../dom.js";

const FETCH_TIMEOUT_MS = 8000;

function fetchPageDom(url) {
	return new Promise((resolve) => {
		GM_xmlhttpRequest({
			method: "GET",
			url,
			timeout: FETCH_TIMEOUT_MS,
			onload: (response) => {
				if (response.status !== 200 || !response.responseText) {
					resolve(null);
					return;
				}
				try {
					const doc = new DOMParser().parseFromString(
						response.responseText,
						"text/html",
					);
					resolve(doc);
				} catch (_err) {
					resolve(null);
				}
			},
			onerror: () => resolve(null),
			ontimeout: () => resolve(null),
		});
	});
}

// Wrap the user's current text selection (if any) into a "> "-prefixed
// block, suitable for prepending to a reply textarea.
function quoteSelection() {
	const text = window.getSelection().toString().trim();
	if (!text) return "";
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => `> ${line}`)
		.join("\n\n");
}

function isClickModified(event) {
	return (
		event.button !== 0 ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.altKey
	);
}

function attachActionLink(link, replyDiv, state) {
	const originalText = link.textContent;

	link.addEventListener("click", async (event) => {
		// Modified clicks (cmd/ctrl/middle/shift) keep their default
		// behaviour — opening in a new tab is still useful.
		if (isClickModified(event)) return;
		event.preventDefault();

		const quoted = quoteSelection();

		// If a form is currently open from any action on this comment,
		// remove it. If the same button was clicked, that's the toggle-
		// off path; if a different button, fall through after removal
		// to fetch the new form.
		if (state.activeForm) {
			state.activeForm.remove();
			state.activeForm = null;
			if (state.activeButton) {
				state.activeButton.textContent = state.activeButton.dataset.hnOriginal;
				state.activeButton.dataset.hnOriginal = "";
			}
			const wasSameButton = state.activeButton === link;
			state.activeButton = null;
			if (wasSameButton) return;
		}

		// Visual cue while the fetch is in flight.
		const loader = h("span", {
			class: "hn-reply-loader",
			text: " (loading…)",
		});
		link.after(loader);

		const dom = await fetchPageDom(link.href);
		loader.remove();
		if (!dom) {
			alert(
				"Couldn't load the form for that action. Try clicking the link directly to navigate to the page.",
			);
			return;
		}
		const form = dom.querySelector("form");
		if (!form) {
			alert(
				"The fetched page didn't contain a form. Try clicking the link directly.",
			);
			return;
		}
		form.classList.add("hn-injected-form");

		state.activeForm = form;
		state.activeButton = link;
		link.dataset.hnOriginal = originalText;
		link.textContent = `hide ${originalText}`;
		replyDiv.append(form);

		const textarea = form.querySelector("textarea");
		if (textarea) {
			if (quoted.length > 0) {
				textarea.value = `${textarea.value ? `${textarea.value}\n\n` : ""}${quoted}\n\n`;
			}
			textarea.focus();
		}
	});
}

export function setupReplyInline() {
	for (const comment of document.querySelectorAll("tr.comtr")) {
		const replyDiv = comment.querySelector("div.reply");
		if (!replyDiv) continue;

		// Per-comment shared state across the action buttons so opening
		// one form auto-closes another on the same comment.
		const state = { activeForm: null, activeButton: null };

		for (const action of ["reply", "edit", "delete-confirm"]) {
			const link = comment.querySelector(`a[href^="${action}"]`);
			if (link) attachActionLink(link, replyDiv, state);
		}
	}
}

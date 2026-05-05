// Per-user inline UI on item pages: account info blurb, rating controls,
// editable tag list, plus the rerender-by-user fan-out used after any
// store write so all comments by the same author stay in sync.

import { findCommentParent, h } from "../dom.js";
import { parseTagInput, timeSince } from "../parsing.js";

// Pastel HSL. The lightness floor (75%) guarantees black text is always the
// high-contrast choice, so we don't need a luminance calculator.
function randomPastelColor() {
	const r = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1) + lo);
	return `hsl(${r(0, 359)}, ${r(30, 100)}%, ${r(75, 95)}%)`;
}

// Factory. Wiring done in main.js:
//   - `store` is the consolidated store from src/state.js
//   - `fetchUser` is from src/api.js
//   - `openTagManager` is the overlay opener from src/features/tag-manager.js
//     (passed as a getter so it can refer to a forward-declared variable).
export function createUserRender({ store, fetchUser, openTagManager }) {
	function ensureTagColor(tagName) {
		const existing = store.getTagColor(tagName);
		if (existing?.bgColor) return existing;
		const color = { bgColor: randomPastelColor(), textColor: "black" };
		store.setTagColor(tagName, color);
		return color;
	}

	function renderRatingControls(username) {
		const display = h("span", {
			class: "hn-rating-display",
			text: String(store.getRating(username)),
		});
		display.dataset.hnUser = username;
		const mkBtn = (glyph, delta) =>
			h("button", {
				class: "hn-rating-btn",
				text: glyph,
				tabIndex: -1,
				onclick: (e) => {
					e.preventDefault();
					e.currentTarget.blur();
					const next = store.getRating(username) + delta;
					store.setRating(username, next);
					rerenderUserRatings(username);
				},
			});
		return h("span", { class: "hn-rating-container" }, [
			mkBtn("▲", 1),
			mkBtn("▼", -1),
			display,
		]);
	}

	// Renders the tag list for a user into `container` (clearing first). Called
	// on initial render and after any tag edit/remove so we don't need a full
	// page reload.
	function renderTagGroup(username, container) {
		container.replaceChildren();
		for (const tag of store.getUserTags(username)) {
			container.appendChild(renderTagSpan(username, tag));
		}
	}

	// Re-renders tag groups and updates tag inputs for every instance of a
	// user on the page. Called after any tag mutation so all comments by the
	// same author stay in sync.
	function rerenderUserTags(username) {
		const esc = CSS.escape(username);
		for (const group of document.querySelectorAll(
			`.hn-tag-group[data-hn-user="${esc}"]`,
		)) {
			renderTagGroup(username, group);
		}
		const names = store.getUserTags(username).map((t) => t.value);
		for (const input of document.querySelectorAll(
			`.hn-tag-input[data-hn-user="${esc}"]`,
		)) {
			input.value = names.join(", ");
		}
	}

	function rerenderUserRatings(username) {
		const esc = CSS.escape(username);
		const text = String(store.getRating(username));
		for (const rd of document.querySelectorAll(
			`.hn-rating-display[data-hn-user="${esc}"]`,
		)) {
			rd.textContent = text;
		}
	}

	function renderTagSpan(username, tag) {
		const editIcon = h("span", {
			class: "hn-tag-icon",
			title: "Edit tag",
			text: "✏️", // pencil
			onclick: (e) => {
				e.stopPropagation();
				const raw = prompt("Edit tag name:", tag.value);
				const newName = raw ? raw.trim() : "";
				if (!newName || newName === tag.value) return;
				const current = store.getUserTags(username);
				const color = ensureTagColor(newName);
				const updated = current.map((t) =>
					t.value === tag.value
						? {
								value: newName,
								bgColor: color.bgColor,
								textColor: color.textColor,
							}
						: t,
				);
				store.setUserTags(username, updated);
				rerenderUserTags(username);
			},
		});
		const removeIcon = h("span", {
			class: "hn-tag-icon",
			title: "Remove tag",
			text: "✖", // x
			onclick: (e) => {
				e.stopPropagation();
				if (!confirm(`Remove tag "${tag.value}"?`)) return;
				const current = store.getUserTags(username);
				store.setUserTags(
					username,
					current.filter((t) => t.value !== tag.value),
				);
				rerenderUserTags(username);
			},
		});

		const manageIcon = h("span", {
			class: "hn-tag-icon",
			title: "Manage all tags",
			text: "☰", // hamburger
			onclick: (e) => {
				e.stopPropagation();
				openTagManager();
			},
		});

		const span = h("div", { class: "hn-tag" }, [
			h("span", { class: "hn-tag-text", text: tag.value }),
			h("div", { class: "hn-tag-icons" }, [editIcon, manageIcon, removeIcon]),
		]);
		span.style.backgroundColor = tag.bgColor || "";
		span.style.color = tag.textColor || "black";
		return span;
	}

	function renderTagInput(username) {
		const currentNames = store.getUserTags(username).map((t) => t.value);
		const input = h("input", {
			type: "text",
			class: "hn-tag-input",
			value: currentNames.join(", "),
			placeholder: "Add tags (comma separated)",
		});
		input.dataset.hnUser = username;

		// Keystrokes update a live preview only; the store is written on blur
		// or Enter. Writing per-keystroke was persisting every partial string
		// the user typed (e.g. "Are" -> "Areg" -> "Argen" -> "Argentinian"
		// all ended up as distinct saved tags), which polluted both the
		// user's tag list and the shared colors map.
		const previewColors = new Map();
		const previewColorFor = (name) => {
			const real = store.getTagColor(name);
			if (real?.bgColor) return real;
			if (previewColors.has(name)) return previewColors.get(name);
			const color = { bgColor: randomPastelColor(), textColor: "black" };
			previewColors.set(name, color);
			return color;
		};

		const parseNames = () => parseTagInput(input.value);

		const renderPreview = () => {
			const esc = CSS.escape(username);
			const names = parseNames();
			for (const group of document.querySelectorAll(
				`.hn-tag-group[data-hn-user="${esc}"]`,
			)) {
				group.replaceChildren();
				for (const name of names) {
					const color = previewColorFor(name);
					group.appendChild(
						renderTagSpan(username, {
							value: name,
							bgColor: color.bgColor,
							textColor: color.textColor,
						}),
					);
				}
			}
		};

		const commit = () => {
			const names = parseNames();
			const updated = names.map((name) => {
				const color = ensureTagColor(name);
				return {
					value: name,
					bgColor: color.bgColor,
					textColor: color.textColor,
				};
			});
			store.setUserTags(username, updated);
			rerenderUserTags(username);
			previewColors.clear();
		};

		input.addEventListener("input", renderPreview);
		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			input.blur(); // triggers commit via the blur listener
		});
		return input;
	}

	function renderAccountInfo(created, karma) {
		const now = Math.floor(Date.now() / 1000);
		return h("span", {
			class: "hn-info",
			text: `(${timeSince(created, now)} old, ${karma} karma)`,
		});
	}

	// Skeleton-first: every row is built and inserted synchronously from the
	// store. The age/karma blurb gets filled in as each fetch resolves, so a
	// slow or hung request can't block the rest of the page.
	function renderAllUsernames() {
		const usernameElements = Array.from(document.querySelectorAll(".hnuser"));
		// The OP's username appears in .fatitem above the comments and again
		// on every comment they author within the thread. Reading it once
		// here lets us tag every comment-row authorship below as [op] without
		// also marking the fatitem's own hnuser (which is redundantly the OP
		// — we already know they posted the item).
		const itemAuthor =
			document.querySelector(".fatitem .hnuser")?.textContent || null;

		for (const usernameEl of usernameElements) {
			const username = usernameEl.textContent;
			const parent = findCommentParent(usernameEl);
			if (!parent) continue;

			const tagGroup = h("div", { class: "hn-tag-group" });
			tagGroup.dataset.hnUser = username;
			renderTagGroup(username, tagGroup);

			const usernameClone = usernameEl.cloneNode(true);
			usernameClone.className = `${usernameClone.className} hn-username`.trim();

			const isCommentAuthor = !!usernameEl.closest("tr.comtr");
			if (isCommentAuthor && itemAuthor && username === itemAuthor) {
				usernameClone.classList.add("hn-op");
				usernameClone.appendChild(document.createTextNode(" [op]"));
			}

			const infoSlot = h("span", {
				class: "hn-info hn-info-pending",
				text: "(loading…)",
			});

			const mainRow = h("div", { class: "hn-main-row" }, [
				usernameClone,
				infoSlot,
				renderRatingControls(username),
				renderTagInput(username),
			]);
			const tagContainer = h("div", { class: "hn-tag-container" }, [tagGroup]);
			const layout = h("div", { class: "hn-post-layout" }, [
				mainRow,
				tagContainer,
			]);

			parent.parentNode.insertBefore(layout, parent.nextSibling);
			usernameEl.style.display = "none";

			// Populate the info slot asynchronously. Cached users resolve on the
			// microtask queue (effectively synchronous). Failed or timed-out
			// fetches remove the slot rather than leaving a "loading…" ghost.
			fetchUser(username).then((data) => {
				if (data) {
					infoSlot.replaceWith(renderAccountInfo(data.created, data.karma));
				} else {
					infoSlot.remove();
				}
			});
		}
	}

	return {
		renderAllUsernames,
		rerenderUserTags,
		rerenderUserRatings,
	};
}

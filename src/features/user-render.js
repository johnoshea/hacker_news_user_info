// Per-user inline UI on item pages: account info blurb, rating controls,
// editable tag list, plus the rerender-by-user fan-out used after any
// store write so all comments by the same author stay in sync.

import {
	LOW_SCORE_COLLAPSE_THRESHOLD,
	NEW_ACCOUNT_MAX_AGE_MS,
} from "../config.js";
import { findCommentParent, h } from "../dom.js";
import {
	isNewAccount,
	parseTagInput,
	shouldAutoCollapseAuthor,
	timeSince,
} from "../parsing.js";

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
	//
	// Skips any instance whose tag input currently has focus: that input is
	// the one the user is actively typing into, and the rerender path runs
	// on every cross-tab state write (including unrelated cache writes like
	// setCachedUser/setCachedItem from other open HN tabs), which would
	// otherwise clobber in-progress typing. The tag-group preview next to
	// that input is also left alone so the renderPreview keystroke handler
	// stays the source of truth for what the user sees while typing.
	function rerenderUserTags(username) {
		// A user who has just gained a tag (locally on one comment, or from
		// another tab) may still be showing the compact "+" trigger on their
		// other comments. Promote those to full controls so every comment by
		// the user reflects the new tag.
		materializeLazyTriggers(username);
		const esc = CSS.escape(username);
		const focusedInput = document.querySelector(
			`.hn-tag-input[data-hn-user="${esc}"]:focus`,
		);
		for (const group of document.querySelectorAll(
			`.hn-tag-group[data-hn-user="${esc}"]`,
		)) {
			if (focusedInput) continue;
			renderTagGroup(username, group);
		}
		const names = store.getUserTags(username).map((t) => t.value);
		for (const input of document.querySelectorAll(
			`.hn-tag-input[data-hn-user="${esc}"]`,
		)) {
			if (input === focusedInput) continue;
			input.value = names.join(", ");
		}
	}

	function rerenderUserRatings(username) {
		// Same promotion as rerenderUserTags: a freshly-rated user whose other
		// comments still show the "+" trigger gets those promoted to full
		// controls so the rating is visible and adjustable everywhere.
		materializeLazyTriggers(username);
		const esc = CSS.escape(username);
		const rating = store.getRating(username);
		const text = String(rating);
		for (const rd of document.querySelectorAll(
			`.hn-rating-display[data-hn-user="${esc}"]`,
		)) {
			rd.textContent = text;
		}
		const collapse = shouldAutoCollapseAuthor(
			rating,
			LOW_SCORE_COLLAPSE_THRESHOLD,
		);
		for (const row of document.querySelectorAll(
			`tr.comtr[data-hn-author="${esc}"]`,
		)) {
			row.classList.toggle("hn-low-score", collapse);
			// Any rating change resets the manual-expand state so the row
			// snaps back to the canonical collapsed/expanded shape derived
			// from the new rating. The marker is shared with the
			// collapse-seen mode, so this also re-hides a seen-stub you had
			// opened on one of this user's comments — same intent, the row
			// goes back to the shape its collapse reasons dictate.
			row.classList.remove("hn-body-expanded");
			// Keep the [low score] marker in sync with the collapse class —
			// a comhead with a "[low score]" tag but a fully-visible body
			// would be misleading, and a freshly-collapsed row that never
			// had the marker (because it was added to the rating below the
			// threshold mid-session) needs one now.
			const head = row.querySelector("span.comhead");
			if (!head) continue;
			const existing = head.querySelector(".hn-low-score-tag");
			if (collapse && !existing) {
				head.append(
					h("span", { class: "hn-low-score-tag", text: "[low score]" }),
				);
			} else if (!collapse && existing) {
				existing.remove();
			}
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
		const isNew = isNewAccount(created, now, NEW_ACCOUNT_MAX_AGE_MS);
		return h("span", {
			class: isNew ? "hn-info hn-new-account" : "hn-info",
			text: `(${timeSince(created, now)} old, ${karma} karma)`,
		});
	}

	// True when the user already carries data worth showing inline. These
	// users get their full controls built up front; everyone else gets the
	// compact "+" trigger and their controls are built only when clicked.
	function hasUserState(username) {
		return (
			store.getRating(username) !== 0 || store.getUserTags(username).length > 0
		);
	}

	// Builds the rating controls, tag input, and tag group and inserts them
	// into an already-rendered row. Used both for the eager path (users who
	// already have state) and lazily when a "+" trigger is clicked or a user
	// gains state. The watch eye (inserted later by watch-toggles) is the
	// pivot: rating goes before it, tag input after it, so eager and
	// lazily-materialized rows end up with the same left-to-right order.
	// Idempotent — returns early if the row already has controls.
	function materializeControls(username, mainRow, layout) {
		if (mainRow.querySelector(".hn-rating-container")) return null;

		const ratingControls = renderRatingControls(username);
		const tagInput = renderTagInput(username);
		const tagGroup = h("div", { class: "hn-tag-group" });
		tagGroup.dataset.hnUser = username;
		renderTagGroup(username, tagGroup);
		const tagContainer = h("div", { class: "hn-tag-container" }, [tagGroup]);

		const trigger = mainRow.querySelector(".hn-controls-trigger");
		const eye = mainRow.querySelector(".hn-watch-icon");
		const ratingAnchor = eye || trigger;
		if (ratingAnchor) mainRow.insertBefore(ratingControls, ratingAnchor);
		else mainRow.appendChild(ratingControls);
		if (trigger) {
			mainRow.insertBefore(tagInput, trigger);
			trigger.remove();
		} else {
			mainRow.appendChild(tagInput);
		}
		layout.appendChild(tagContainer);
		return tagInput;
	}

	function renderControlsTrigger(username, mainRow, layout) {
		const trigger = h("span", {
			class: "hn-controls-trigger",
			title: "Rate or tag this user",
			text: "+",
			onclick: () => {
				const input = materializeControls(username, mainRow, layout);
				input?.focus();
			},
		});
		trigger.dataset.hnUser = username;
		return trigger;
	}

	// Promote every "+" trigger for a user to full controls — but only once
	// the user actually has a rating or tag. Called from the rerender paths
	// so a user who gains state on one comment (or in another tab) has their
	// other comments promoted too. A genuinely stateless user (e.g. touched
	// by a tag-manager save that didn't involve them) is left as a trigger.
	function materializeLazyTriggers(username) {
		if (!hasUserState(username)) return;
		const esc = CSS.escape(username);
		for (const trigger of document.querySelectorAll(
			`.hn-controls-trigger[data-hn-user="${esc}"]`,
		)) {
			const mainRow = trigger.closest(".hn-main-row");
			const layout = trigger.closest(".hn-post-layout");
			if (mainRow && layout) materializeControls(username, mainRow, layout);
		}
	}

	// Skeleton-first: every row is built and inserted synchronously. The
	// age/karma blurb gets filled in as each fetch resolves, so a slow or
	// hung request can't block the rest of the page. Rating/tag controls are
	// built up front only for users who already have a rating or tag; for the
	// rest a compact "+" trigger defers that work until the user wants it,
	// which keeps construction cheap on large threads where most users are
	// never tagged or rated.
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
			]);
			const layout = h("div", { class: "hn-post-layout" }, [mainRow]);

			if (hasUserState(username)) {
				materializeControls(username, mainRow, layout);
			} else {
				mainRow.appendChild(renderControlsTrigger(username, mainRow, layout));
			}

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

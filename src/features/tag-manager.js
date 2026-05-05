// Single-instance tag-management overlay. The overlay holds a draft
// snapshot of {tags, colors}; edits mutate the draft via pure helpers,
// and Save writes the draft back atomically.

import { h } from "../dom.js";
import {
	countsFromState,
	removeTagInState,
	renameTagInState,
} from "../state.js";

function isDraftDirty(liveSnapshot, draft) {
	return (
		JSON.stringify(liveSnapshot.tags || {}) !== JSON.stringify(draft.tags) ||
		JSON.stringify(liveSnapshot.colors || {}) !== JSON.stringify(draft.colors)
	);
}

// Factory. `rerenderUserTags(username)` is invoked after a successful Save
// for every user visible on the page so their inline tag pills refresh.
//
// Returns:
//   open()       - opens the overlay (no-op if already open)
//   getActive()  - returns the active overlay handle (with markStale())
//                  while open, null otherwise. Used by the cross-tab
//                  listener in main.js to flag a remote write while the
//                  overlay is mid-edit.
export function createTagManager({ store, rerenderUserTags }) {
	let tagManagerOpen = false;
	let activeTagManager = null;

	function open() {
		if (tagManagerOpen) return;
		tagManagerOpen = true;

		const live = store._snapshot();
		const draft = {
			tags: JSON.parse(JSON.stringify(live.tags || {})),
			colors: JSON.parse(JSON.stringify(live.colors || {})),
		};

		// Per-row state keyed by the tag name as it existed when the overlay
		// opened. Undo on a row reverts that row's changes only.
		const rows = new Map(); // originalName -> { currentName, pendingRemoval }
		const allNames = new Set([
			...Object.keys(live.colors || {}),
			...Object.values(live.tags || {}).flat(),
		]);
		for (const name of allNames) {
			rows.set(name, { currentName: name, pendingRemoval: false });
		}

		let filter = "";
		let sortMode = "name"; // "name" | "count"
		let isStale = false;

		const catcher = h("div", { class: "hn-tagmgr-catcher" });
		const overlay = h("div", { class: "hn-tagmgr-overlay" });
		document.body.appendChild(catcher);
		document.body.appendChild(overlay);

		activeTagManager = {
			markStale() {
				if (isStale) return;
				isStale = true;
				renderOverlay();
			},
		};

		function closeTagManager({ commit }) {
			if (commit) {
				if (isDraftDirty(live, draft)) {
					if (isStale) {
						alert(
							"Tags changed in another tab while this overlay was open. Close and reopen before saving so you do not overwrite newer data.",
						);
						return;
					}
					store.replaceTagsAndColors(draft.tags, draft.colors);
					store._invalidate();
					const visibleUsers = new Set();
					for (const el of document.querySelectorAll("[data-hn-user]")) {
						visibleUsers.add(el.dataset.hnUser);
					}
					for (const username of visibleUsers) rerenderUserTags(username);
				}
			}
			document.removeEventListener("keydown", onKeyDown);
			catcher.remove();
			overlay.remove();
			tagManagerOpen = false;
			activeTagManager = null;
		}

		function confirmDiscardIfDirty() {
			if (!isDraftDirty(live, draft)) return true;
			return confirm("Discard unsaved tag changes?");
		}

		function onKeyDown(e) {
			if (e.key !== "Escape") return;
			// If focus is inside a rename input, let the row handle its own
			// Escape (cancels the field, doesn't close the overlay).
			const active = document.activeElement;
			if (active?.classList.contains("hn-tagmgr-name-input")) return;
			e.preventDefault();
			if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
		}
		document.addEventListener("keydown", onKeyDown);

		catcher.addEventListener("click", () => {
			if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
		});

		// Footer (Save / Cancel) wired immediately; list + controls wired by
		// later tasks via renderOverlay().
		const saveBtn = h("button", {
			class: "hn-tagmgr-btn primary",
			text: "Save",
			onclick: () => closeTagManager({ commit: true }),
		});
		const cancelBtn = h("button", {
			class: "hn-tagmgr-btn",
			text: "Cancel",
			onclick: () => {
				if (confirmDiscardIfDirty()) closeTagManager({ commit: false });
			},
		});
		const footer = h("div", { class: "hn-tagmgr-footer" }, [
			cancelBtn,
			saveBtn,
		]);

		const list = h("div", { class: "hn-tagmgr-list" });

		const filterInput = h("input", {
			type: "text",
			class: "hn-tagmgr-filter",
			placeholder: "Filter tags…",
		});
		filterInput.addEventListener("input", () => {
			filter = filterInput.value;
			renderOverlay();
		});

		const sortNameBtn = h("button", {
			class: "hn-tagmgr-sort-btn active",
			text: "Name (A→Z)",
			onclick: () => {
				sortMode = "name";
				renderOverlay();
			},
		});
		const sortCountBtn = h("button", {
			class: "hn-tagmgr-sort-btn",
			text: "Uses (0 first)",
			onclick: () => {
				sortMode = "count";
				renderOverlay();
			},
		});

		const controls = h("div", { class: "hn-tagmgr-controls" }, [
			filterInput,
			h("div", { class: "hn-tagmgr-sort" }, [sortNameBtn, sortCountBtn]),
		]);

		const headerCount = h("span", { class: "hn-tagmgr-header-count" });
		overlay.appendChild(
			h("div", { class: "hn-tagmgr-header" }, [
				h("span", { text: "Manage tags" }),
				headerCount,
			]),
		);
		overlay.appendChild(controls);
		overlay.appendChild(list);
		overlay.appendChild(footer);

		// Derive the draft from the rows map each time. Each row in `rows`
		// carries its originalName (the map key) and its current edited form;
		// pure helpers stitch the final shape together.
		function computeDraft() {
			let d = {
				tags: JSON.parse(JSON.stringify(live.tags || {})),
				colors: JSON.parse(JSON.stringify(live.colors || {})),
				schemaVersion: 1,
				ratings: live.ratings || {},
				cache: live.cache || {},
			};
			for (const [originalName, row] of rows) {
				if (row.pendingRemoval) {
					d = removeTagInState(d, originalName);
				} else if (row.currentName !== originalName) {
					d = renameTagInState(d, originalName, row.currentName);
				}
			}
			return d;
		}

		function renderOverlay() {
			const computed = computeDraft();
			draft.tags = computed.tags;
			draft.colors = computed.colors;

			const counts = countsFromState(computed);
			const needle = filter.trim().toLowerCase();

			const entries = [...rows.entries()]
				.map(([originalName, row]) => {
					const displayName = row.pendingRemoval
						? originalName
						: row.currentName;
					const count = row.pendingRemoval ? 0 : counts[row.currentName] || 0;
					const color =
						computed.colors[row.currentName] ||
						live.colors[originalName] ||
						null;
					return { originalName, row, displayName, count, color };
				})
				.filter(({ displayName }) =>
					needle === "" ? true : displayName.toLowerCase().includes(needle),
				);

			entries.sort((a, b) => {
				if (sortMode === "count") {
					if (a.count !== b.count) return a.count - b.count;
				}
				return a.displayName
					.toLowerCase()
					.localeCompare(b.displayName.toLowerCase());
			});

			sortNameBtn.classList.toggle("active", sortMode === "name");
			sortCountBtn.classList.toggle("active", sortMode === "count");
			headerCount.textContent = isStale
				? `${rows.size} tags • changed in another tab`
				: `${rows.size} tags`;
			saveBtn.disabled = isStale;
			saveBtn.title = isStale
				? "Close and reopen the tag manager before saving."
				: "";

			list.replaceChildren();
			for (const entry of entries) {
				list.appendChild(buildRow(entry));
			}
		}

		function buildRow({ originalName, row, displayName, count, color }) {
			const dirty = row.pendingRemoval || row.currentName !== originalName;
			const rowEl = h("div", {
				class: [
					"hn-tagmgr-row",
					dirty ? "dirty" : "",
					row.pendingRemoval ? "removed" : "",
				]
					.filter(Boolean)
					.join(" "),
			});

			const swatch = h("span", { class: "hn-tagmgr-swatch" });
			if (color?.bgColor) swatch.style.backgroundColor = color.bgColor;

			const nameEl = h("span", {
				class: "hn-tagmgr-name",
				text: displayName,
			});
			if (color?.bgColor) nameEl.style.backgroundColor = color.bgColor;
			if (color?.textColor) nameEl.style.color = color.textColor;

			const countEl = h("span", {
				class: `hn-tagmgr-count${count === 0 ? " zero" : ""}`,
				text: String(count),
			});

			const icons = h("div", { class: "hn-tagmgr-icons" });
			const editIcon = h("span", {
				class: "hn-tagmgr-icon",
				title: "Rename tag",
				text: "✏️", // pencil
				onclick: () => {
					// Swap name span for an input; Enter/blur commits, Escape
					// cancels the field (does not close the overlay).
					const input = h("input", {
						type: "text",
						class: "hn-tagmgr-name-input",
						value: row.currentName,
					});
					nameEl.replaceWith(input);
					input.focus();
					input.select();

					const commit = () => {
						const proposed = input.value.trim();
						if (!proposed || proposed === row.currentName) {
							renderOverlay();
							return;
						}
						// Collision check: does another row currently carry `proposed`?
						const collidesWith = [...rows.entries()].find(
							([orig, r]) =>
								orig !== originalName &&
								!r.pendingRemoval &&
								r.currentName === proposed,
						);
						if (collidesWith) {
							const srcCount =
								countsFromState(computeDraft())[row.currentName] || 0;
							if (
								!confirm(
									`Merge "${row.currentName}" into "${proposed}"? ${srcCount} user${srcCount === 1 ? "" : "s"} will be updated.`,
								)
							) {
								renderOverlay();
								return;
							}
							// Rename the source row into the destination so
							// computeDraft() applies renameTagInState on save
							// (which handles the merge). Drop the destination
							// row so the overlay doesn't show two identical
							// entries for the now-merged tag.
							row.currentName = proposed;
							rows.delete(collidesWith[0]);
						} else {
							row.currentName = proposed;
						}
						renderOverlay();
					};

					let cancelled = false;
					input.addEventListener("keydown", (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							cancelled = true;
							renderOverlay();
						}
					});
					input.addEventListener("blur", () => {
						if (cancelled) return;
						commit();
					});
				},
			});
			icons.appendChild(editIcon);

			if (dirty) {
				const undoIcon = h("span", {
					class: "hn-tagmgr-icon",
					title: "Undo changes to this row",
					text: "↩", // hook arrow
					onclick: () => {
						row.currentName = originalName;
						row.pendingRemoval = false;
						renderOverlay();
					},
				});
				icons.appendChild(undoIcon);
			}

			const removeIcon = h("span", {
				class: "hn-tagmgr-icon",
				title: row.pendingRemoval ? "Keep tag" : "Remove tag",
				text: "✖", // x
				onclick: () => {
					row.pendingRemoval = !row.pendingRemoval;
					renderOverlay();
				},
			});
			icons.appendChild(removeIcon);

			rowEl.appendChild(swatch);
			rowEl.appendChild(nameEl);
			rowEl.appendChild(countEl);
			rowEl.appendChild(icons);
			return rowEl;
		}

		renderOverlay();
		filterInput.focus();
	}

	return {
		open,
		getActive: () => activeTagManager,
	};
}

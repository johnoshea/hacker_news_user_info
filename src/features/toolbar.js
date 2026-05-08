// Floating toolbar with Save state / Restore state buttons. Mounted on
// item pages.

import { STATE_KEY } from "../config.js";
import { h } from "../dom.js";
import { parseImport, stateToExport } from "../state.js";

export function createToolbar({ store, backend }) {
	let buttonsContainer = null;

	function exportState() {
		const data = stateToExport(store._snapshot());
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = h("a", {
			href: url,
			download: `hn-user-data-${new Date().toISOString().split("T")[0]}.json`,
		});
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			a.remove();
			URL.revokeObjectURL(url);
		}, 100);
	}

	function importState() {
		const input = h("input", { type: "file", accept: ".json" });
		input.addEventListener("change", (event) => {
			const file = event.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const raw = JSON.parse(e.target.result);
					const parsed = parseImport(raw);
					// Write the consolidated blob directly and reload so the page
					// rebuilds from a fresh store.
					backend.set(STATE_KEY, JSON.stringify(parsed));
					alert("Data imported successfully! The page will now reload.");
					location.reload();
				} catch (error) {
					alert(`Error importing data: ${error.message}`);
					console.error("Error importing data:", error);
				}
			};
			reader.readAsText(file);
		});
		input.click();
	}

	function mount() {
		const dragHandle = h("div", { class: "hn-drag-handle" });
		buttonsContainer = h("div", { class: "hn-toolbar-buttons" }, [
			h("button", {
				class: "hn-toolbar-btn",
				text: "Save state",
				onclick: exportState,
			}),
			h("button", {
				class: "hn-toolbar-btn",
				text: "Restore state",
				onclick: importState,
			}),
		]);
		const toolbar = h("div", { class: "hn-toolbar" }, [
			dragHandle,
			buttonsContainer,
		]);
		document.body.appendChild(toolbar);

		// Drag listeners live only for the duration of a drag, rather than
		// sitting on document forever.
		dragHandle.addEventListener("mousedown", (e) => {
			const rect = toolbar.getBoundingClientRect();
			const offsetX = e.clientX - rect.left;
			const offsetY = e.clientY - rect.top;
			e.preventDefault();

			const onMove = (ev) => {
				toolbar.style.left = `${ev.clientX - offsetX}px`;
				toolbar.style.top = `${ev.clientY - offsetY}px`;
				toolbar.style.right = "auto";
			};
			const onUp = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
			};
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});
	}

	// Returns the buttons container after mount() runs, or null before.
	// External features (e.g. watched-comment-nav) use it to append
	// their own toolbar buttons without knowing the toolbar's internals.
	function getButtonsContainer() {
		return buttonsContainer;
	}

	return { mount, getButtonsContainer };
}

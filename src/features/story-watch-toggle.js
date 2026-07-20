// Whole-story "watch for new comments" toggle. Item pages only. Adds an
// eye to the fatitem subtext; the listing pass (watched-story-highlights)
// then flags the story's "n comments" link when the total comment count
// grows past what the user last saw here. Unlike the per-comment watch,
// there is no background API recheck — the listing row already renders the
// live count, so the two surfaces just compare integers.
//
// Click semantics mirror the per-comment eye:
//   off -> on : persist a watch keyed by item id, seeded with the count
//               currently shown in the fatitem (everything visible now is
//               "seen").
//   on  -> off: delete the watch entry.
//
// Page-load semantics: if the story is already watched, refresh seenCount
// to the current count and stamp the visit — the story analogue of
// markWatchSeen, i.e. the "visiting the thread clears the flag" step.

import { WATCH_TTL_MS } from "../config.js";
import {
	findCommentsLink,
	getItemPageId,
	h,
	isItemPage,
	runWhenPageVisible,
} from "../dom.js";
import { parseCommentCount } from "../parsing.js";

// Distinct top-level names from watch-toggles.js: the build fuses every
// module into one IIFE scope, so a second `const ICON_OFF` / `function
// setIconState` would be a redeclaration in the bundle.
const STORY_EYE_OFF = "👁";
const STORY_EYE_ON = "👁‍🗨";

function setStoryEyeState(iconEl, isOn) {
	iconEl.textContent = isOn ? STORY_EYE_ON : STORY_EYE_OFF;
	iconEl.title = isOn
		? "Stop watching this story"
		: "Watch this story for new comments";
	iconEl.classList.toggle("hn-watching", isOn);
}

export function setupStoryWatchToggle({ store }) {
	if (!isItemPage()) return;
	const itemId = getItemPageId();
	if (!itemId) return;

	// Sweep story watches not visited within the TTL — same cadence and
	// rationale as the per-comment watch prune.
	store.pruneWatchedStories(Date.now(), WATCH_TTL_MS);

	const athing = document.querySelector("table.fatitem tr.athing.submission");
	if (!athing) return;
	const link = findCommentsLink(athing);
	if (!link) return;

	const currentCount = parseCommentCount(link.textContent);
	const initiallyWatched = store.getWatchedStory(itemId) !== null;

	// Visiting a watched story acknowledges its current count: refresh
	// seenCount (clears the listing flag) and stamp the visit (refreshes
	// the TTL). Deferred until the tab is shown — a background-tab load
	// isn't a visit and must not clear the flag.
	if (initiallyWatched) {
		runWhenPageVisible(() => {
			store.setStoryWatch(itemId, currentCount, Date.now());
		});
	}

	const icon = h("span", { class: "hn-watch-icon" });
	setStoryEyeState(icon, initiallyWatched);

	icon.addEventListener("click", () => {
		if (icon.classList.contains("hn-watching")) {
			store.removeStoryWatch(itemId);
			setStoryEyeState(icon, false);
		} else {
			store.setStoryWatch(itemId, currentCount, Date.now());
			setStoryEyeState(icon, true);
		}
	});

	// Append to the subline (the "| hide | past | favorite | n comments"
	// span) so the eye reads as one more subtext action.
	const subline = link.parentElement;
	subline.appendChild(document.createTextNode(" | "));
	subline.appendChild(icon);
}

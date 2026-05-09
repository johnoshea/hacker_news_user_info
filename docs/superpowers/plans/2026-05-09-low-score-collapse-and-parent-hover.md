# Low-score collapse and parent-hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two independent comment-page features. (1) Auto-collapse comments authored by users rated `<= -10`, hiding only the body and reply link of the offending comment so its replies stay visible. (2) Hover-popup on the `parent` link in each comhead, reusing the shared hover primitive and the existing item cache.

**Architecture:** Three new pure helpers in `src/parsing.js` (`shouldAutoCollapseAuthor`, `parseParentIdFromHref`, `splitHtmlIntoParagraphs`), two new browser-only feature modules (`auto-collapse-low-score`, `parent-hover`), small extensions to two existing browser modules (`click-indent-toggle` becomes class-aware, `user-render`'s `rerenderUserRatings` applies/removes the collapse classes), and an `Escape` keydown handler added to the shared `createHoverPopup` primitive so all three hover features get keyboard dismissal at no extra cost.

**Tech Stack:** Plain ES modules under `src/`, Node `node:test` for pure-logic tests, Biome for formatting/linting, `just` task runner, `scripts/build.js` concatenates source into `script.js` userscript bundle. No bundler.

**Spec:** `docs/superpowers/specs/2026-05-09-low-score-collapse-and-parent-hover-design.md`

---

## File Structure

### Create

| File | Responsibility |
|---|---|
| `src/features/auto-collapse-low-score.js` | Page-load pass that tags every comment row with `data-hn-author` and adds `.hn-low-score` if the author's rating crosses the threshold. Appends a faint `[low score]` marker to the comhead. |
| `src/features/parent-hover.js` | Wires hover-with-dwell on every `parent` link in the comhead. DOM-first source resolution with `fetchItem` fallback; popup shows up to two paragraphs of body text. |
| `tests/autoCollapseLowScore.test.js` | Unit test for `shouldAutoCollapseAuthor`. |
| `tests/parentHover.test.js` | Unit tests for `parseParentIdFromHref` and `splitHtmlIntoParagraphs`. |

### Modify

| File | What changes |
|---|---|
| `src/config.js` | Add `LOW_SCORE_COLLAPSE_THRESHOLD = -10`. |
| `src/parsing.js` | Add `shouldAutoCollapseAuthor`, `parseParentIdFromHref`, `splitHtmlIntoParagraphs`. |
| `src/features/click-indent-toggle.js` | Click handler grows a class check: on `.hn-low-score` rows, toggle `.hn-low-score-expanded` instead of firing the row's native `a.togg`. |
| `src/features/user-render.js` | `rerenderUserRatings` also applies/removes `.hn-low-score` (and clears `.hn-low-score-expanded`) on every `tr.comtr[data-hn-author=USER]`. Imports the threshold and helper from config/parsing. |
| `src/features/hover-popup.js` | `createHoverPopup` adds a `document` `keydown` listener for `Escape` while a popup is visible; pressing `Escape` calls the existing `hide()`. |
| `src/styles.js` | Append rules for `.hn-low-score`, `.hn-low-score.hn-low-score-expanded`, `.hn-low-score-tag`, and the `[low score]` text styling. |
| `src/main.js` | Import and wire `setupAutoCollapseLowScore` (item pages, after `renderAllUsernames`) and `setupParentHover` (item pages, alongside the other hover wires). |
| `scripts/build.js` | Append `src/features/auto-collapse-low-score.js` and `src/features/parent-hover.js` to `SOURCES`. |
| `CLAUDE.md` | Add the two features to "What this is" and "Repository layout" / "Architecture" sections. |

---

## Conventions used by this plan

- **TDD:** Pure-logic changes (`config.js`, `parsing.js`) are TDD'd. Browser-only changes (feature modules, styles, main wiring) are not unit-tested — repo convention. Each browser-only task ends with a manual smoke-test instruction.
- **Test file naming:** Existing tests use camelCase (`parsingWatch.test.js`, `itemCache.test.js`). New tests follow the same pattern: `autoCollapseLowScore.test.js`, `parentHover.test.js`.
- **Commit messages:** Imperative subject ≤72 chars. Body explains *why* when not obvious.
- **Build artifact:** `script.js` is checked in. Run `just build` (or `just check`) before each commit that touches `src/` or `scripts/build.js`. CI verifies the bundle is up to date.
- **Formatting:** Run `just fmt` after every edit. Biome enforces tabs + double-quotes + semicolons.
- **Branch:** Work happens on the existing `feat/low-score-collapse-and-parent-hover` branch.

---

## Task 1: Add `LOW_SCORE_COLLAPSE_THRESHOLD` to config

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Append the constant to `src/config.js`**

Append at the end of the file (after `WATCH_RECHECK_THROTTLE_MS`):

```js
// Authors whose stored rating sits at or below this value have their
// comments auto-collapsed on render. Rating defaults to 0, so the
// threshold must be negative (otherwise every unrated user would
// collapse). The value is intentionally a constant rather than a
// toolbar-configurable setting — it's a single edit if it ever needs
// to change, and the simplicity is worth more than the flexibility.
export const LOW_SCORE_COLLAPSE_THRESHOLD = -10;
```

- [ ] **Step 2: Run `just fmt && just check`**

Run: `just fmt && just check`
Expected: PASS — no test changes yet, this is just lint/format/build.

- [ ] **Step 3: Commit**

```bash
git add src/config.js script.js
git commit -m "$(cat <<'EOF'
feat(low-score): add LOW_SCORE_COLLAPSE_THRESHOLD constant

Threshold below which an author's comments are auto-collapsed on
render. Used by the upcoming auto-collapse-low-score feature module.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure helper — `shouldAutoCollapseAuthor`

**Files:**
- Modify: `src/parsing.js`
- Create: `tests/autoCollapseLowScore.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/autoCollapseLowScore.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldAutoCollapseAuthor } from "../src/parsing.js";

// shouldAutoCollapseAuthor(rating, threshold) is the single decision
// the auto-collapse pass uses to decide whether a comment's author
// has earned the .hn-low-score class. Threshold is expected to be
// negative (typically -10); a default-rated user (rating === 0) must
// never collapse.

test("shouldAutoCollapseAuthor: default rating of 0 never collapses", () => {
	assert.equal(shouldAutoCollapseAuthor(0, -10), false);
});

test("shouldAutoCollapseAuthor: positive rating never collapses", () => {
	assert.equal(shouldAutoCollapseAuthor(5, -10), false);
});

test("shouldAutoCollapseAuthor: just above threshold does not collapse", () => {
	assert.equal(shouldAutoCollapseAuthor(-9, -10), false);
});

test("shouldAutoCollapseAuthor: at threshold collapses (boundary inclusive)", () => {
	assert.equal(shouldAutoCollapseAuthor(-10, -10), true);
});

test("shouldAutoCollapseAuthor: below threshold collapses", () => {
	assert.equal(shouldAutoCollapseAuthor(-100, -10), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/autoCollapseLowScore.test.js`
Expected: FAIL — `shouldAutoCollapseAuthor is not a function` (or similar import error).

- [ ] **Step 3: Implement the helper in `src/parsing.js`**

Append at the end of `src/parsing.js`:

```js
// True iff this author's rating crosses the auto-collapse threshold.
// Threshold is expected to be negative; a rating of 0 (the default
// for an unrated user) must never collapse. Boundary is inclusive —
// a rating equal to the threshold counts as "low score".
export function shouldAutoCollapseAuthor(rating, threshold) {
	return rating <= threshold;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/autoCollapseLowScore.test.js`
Expected: PASS — all five tests green.

- [ ] **Step 5: Run the full check**

Run: `just check`
Expected: PASS — lint, format, all tests, build.

- [ ] **Step 6: Commit**

```bash
git add src/parsing.js tests/autoCollapseLowScore.test.js script.js
git commit -m "$(cat <<'EOF'
feat(low-score): add shouldAutoCollapseAuthor pure helper

One-line decision wrapper documenting the intent of the threshold
check (boundary inclusive; default rating 0 never collapses). Lets
the upcoming feature module key off a named domain helper rather
than an inline expression, and gives the unit test a concrete
entry point.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Pure helper — `parseParentIdFromHref`

**Files:**
- Modify: `src/parsing.js`
- Create: `tests/parentHover.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/parentHover.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseParentIdFromHref } from "../src/parsing.js";

// parseParentIdFromHref(href) extracts the comment id from a "parent"
// link's href, which on HN takes the form "item?id=12345" (relative)
// or the absolute equivalent. The result is fed to
// document.getElementById and to fetchItem; both expect a string.

test("parseParentIdFromHref: relative href returns the id", () => {
	assert.equal(parseParentIdFromHref("item?id=12345"), "12345");
});

test("parseParentIdFromHref: absolute href returns the id", () => {
	assert.equal(
		parseParentIdFromHref("https://news.ycombinator.com/item?id=12345"),
		"12345",
	);
});

test("parseParentIdFromHref: trailing fragment is ignored", () => {
	assert.equal(parseParentIdFromHref("item?id=12345#12345"), "12345");
});

test("parseParentIdFromHref: id with extra params still resolves", () => {
	assert.equal(parseParentIdFromHref("item?id=12345&p=1"), "12345");
});

test("parseParentIdFromHref: missing id returns null", () => {
	assert.equal(parseParentIdFromHref("item"), null);
});

test("parseParentIdFromHref: unparseable input returns null", () => {
	assert.equal(parseParentIdFromHref("::::not a url::::"), null);
});

test("parseParentIdFromHref: empty / null / non-string returns null", () => {
	assert.equal(parseParentIdFromHref(""), null);
	assert.equal(parseParentIdFromHref(null), null);
	assert.equal(parseParentIdFromHref(undefined), null);
	assert.equal(parseParentIdFromHref(42), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/parentHover.test.js`
Expected: FAIL — `parseParentIdFromHref is not a function`.

- [ ] **Step 3: Implement the helper in `src/parsing.js`**

Append at the end of `src/parsing.js`:

```js
// Pull the comment id from a "parent" link's href. HN serves these
// as `item?id=12345` (relative); a base URL is supplied so the
// pure-Node URL parser can resolve relative inputs. Returns null on
// any parse failure or missing `id` param so the caller can decide
// (typically: skip the popup).
export function parseParentIdFromHref(href) {
	if (typeof href !== "string" || href === "") return null;
	try {
		const url = new URL(href, "https://news.ycombinator.com/");
		return url.searchParams.get("id") || null;
	} catch {
		return null;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/parentHover.test.js`
Expected: PASS — all eight tests green.

- [ ] **Step 5: Run the full check**

Run: `just check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parsing.js tests/parentHover.test.js script.js
git commit -m "$(cat <<'EOF'
feat(parent-hover): add parseParentIdFromHref pure helper

Resolves both relative ("item?id=N") and absolute hrefs, since the
DOM .href getter would normalize for us in the browser but the
pure helper takes a string. Returns null on parse failure so the
caller can fall through to a skip-popup branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Pure helper — `splitHtmlIntoParagraphs`

**Files:**
- Modify: `src/parsing.js`
- Modify: `tests/parentHover.test.js`

- [ ] **Step 1: Append the failing tests to `tests/parentHover.test.js`**

Append to `tests/parentHover.test.js`:

```js
import { splitHtmlIntoParagraphs } from "../src/parsing.js";

// HN comment HTML uses <p> as a paragraph SEPARATOR (not a wrapper):
// the first paragraph is everything before the first <p>, subsequent
// paragraphs follow each <p> until the next or end. This helper
// returns each paragraph as an HTML string with leading/trailing
// whitespace trimmed; empty entries are dropped so a leading or
// trailing <p> doesn't produce phantom paragraphs.

test("splitHtmlIntoParagraphs: empty / nullish returns []", () => {
	assert.deepEqual(splitHtmlIntoParagraphs(""), []);
	assert.deepEqual(splitHtmlIntoParagraphs(null), []);
	assert.deepEqual(splitHtmlIntoParagraphs(undefined), []);
});

test("splitHtmlIntoParagraphs: whitespace-only returns []", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("   \n  "), []);
});

test("splitHtmlIntoParagraphs: single paragraph returns one entry", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("hello world"), ["hello world"]);
});

test("splitHtmlIntoParagraphs: two paragraphs separated by <p>", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("first<p>second"), [
		"first",
		"second",
	]);
});

test("splitHtmlIntoParagraphs: three paragraphs", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("a<p>b<p>c"), ["a", "b", "c"]);
});

test("splitHtmlIntoParagraphs: inline markup is preserved within entries", () => {
	assert.deepEqual(
		splitHtmlIntoParagraphs(
			'first <a href="x">link</a> end<p>second <i>italic</i>',
		),
		['first <a href="x">link</a> end', "second <i>italic</i>"],
	);
});

test("splitHtmlIntoParagraphs: trailing <p> with nothing after it is dropped", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("first<p>"), ["first"]);
});

test("splitHtmlIntoParagraphs: leading <p> drops the empty first chunk", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("<p>only second"), ["only second"]);
});

test("splitHtmlIntoParagraphs: <p> with attributes is treated as a separator", () => {
	assert.deepEqual(splitHtmlIntoParagraphs('first<p class="x">second'), [
		"first",
		"second",
	]);
});

test("splitHtmlIntoParagraphs: case-insensitive on the tag name", () => {
	assert.deepEqual(splitHtmlIntoParagraphs("first<P>second"), [
		"first",
		"second",
	]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/parentHover.test.js`
Expected: FAIL — `splitHtmlIntoParagraphs is not a function` for the new tests; the old `parseParentIdFromHref` tests still pass.

- [ ] **Step 3: Implement the helper in `src/parsing.js`**

Append at the end of `src/parsing.js`:

```js
// Split a comment-body HTML string into paragraph-equivalent chunks.
// HN uses <p> as a separator (not a wrapper), so we split on any
// <p ...> tag and return the trimmed non-empty pieces. Inline markup
// (<a>, <i>, <code>, <pre>) inside each chunk is preserved as-is —
// the caller decides whether to render via DOMParser or treat as
// plain text.
export function splitHtmlIntoParagraphs(html) {
	if (typeof html !== "string" || html === "") return [];
	return html
		.split(/<p\b[^>]*>/i)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/parentHover.test.js`
Expected: PASS — all eighteen tests green (eight from Task 3 plus ten new).

- [ ] **Step 5: Run the full check**

Run: `just check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parsing.js tests/parentHover.test.js script.js
git commit -m "$(cat <<'EOF'
feat(parent-hover): add splitHtmlIntoParagraphs pure helper

HN comment bodies use <p> as a paragraph separator (not a wrapper).
This helper splits raw comment HTML into trimmed non-empty chunks,
preserving inline markup. The parent-hover popup uses this for
both the on-page DOM source (innerHTML of .commtext) and the
fetchItem fallback (digest.text), so both paths feed the same
"first N paragraphs" rendering.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CSS rules

**Files:**
- Modify: `src/styles.js`

- [ ] **Step 1: Append the new rules to the bottom of the styles template**

In `src/styles.js`, find the closing backtick of the `STYLES` template literal (the line containing the bare backtick after the final `.hn-watched-link::before { content: "★ "; }` rule). Append the following CSS just before the closing backtick (and the `;`):

```css
/* Auto-collapse: when an author's stored rating is <= the
   LOW_SCORE_COLLAPSE_THRESHOLD, the row is tagged .hn-low-score and
   the body + reply link are hidden. The comhead and the
   user-render main row stay visible (so the rating buttons remain
   reachable), and replies — which are separate tr.comtr rows —
   are unaffected. Clicking the indent gutter toggles
   .hn-low-score-expanded, which uses display: revert to undo the
   hide on this single row. */
tr.comtr.hn-low-score .commtext,
tr.comtr.hn-low-score .reply {
  display: none;
}

tr.comtr.hn-low-score.hn-low-score-expanded .commtext,
tr.comtr.hn-low-score.hn-low-score-expanded .reply {
  display: revert;
}

/* "[low score]" marker appended to the comhead next to the existing
   "[collapse root]" link. Faint grey so it reads as metadata rather
   than as another action link. */
.hn-low-score-tag {
  color: #999;
  margin-left: 4px;
  font-size: 0.9em;
}
```

- [ ] **Step 2: Run `just fmt && just check`**

Run: `just fmt && just check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/styles.js script.js
git commit -m "$(cat <<'EOF'
feat(low-score): CSS for .hn-low-score row hide + [low score] tag

Hide .commtext and .reply on .hn-low-score rows; let
.hn-low-score-expanded undo it via display: revert. Faint-grey
[low score] inline tag for the comhead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: New module — `auto-collapse-low-score.js`

**Files:**
- Create: `src/features/auto-collapse-low-score.js`
- Modify: `scripts/build.js`

- [ ] **Step 1: Create the module**

Create `src/features/auto-collapse-low-score.js`:

```js
// Auto-collapse comments whose author's stored rating is at or
// below LOW_SCORE_COLLAPSE_THRESHOLD. This pass walks every
// tr.comtr on the page once, tags each row with
// data-hn-author=<username> (so rerenderUserRatings can find rows
// by author later), and applies the .hn-low-score class to rows
// whose author crosses the threshold. CSS in styles.js does the
// actual hiding.
//
// The [low score] marker is appended to the comhead — same
// position as the existing [collapse root] link — so the reader
// has a visible reason for the empty body.

import { LOW_SCORE_COLLAPSE_THRESHOLD } from "../config.js";
import { h } from "../dom.js";
import { shouldAutoCollapseAuthor } from "../parsing.js";

export function setupAutoCollapseLowScore({ store }) {
	for (const row of document.querySelectorAll("tr.comtr")) {
		const userEl = row.querySelector(".hnuser");
		const username = userEl?.textContent || "";
		if (!username) continue;
		row.dataset.hnAuthor = username;

		const rating = store.getRating(username);
		if (!shouldAutoCollapseAuthor(rating, LOW_SCORE_COLLAPSE_THRESHOLD)) {
			continue;
		}
		row.classList.add("hn-low-score");

		const head = row.querySelector("span.comhead");
		if (head) {
			head.append(h("span", { class: "hn-low-score-tag", text: "[low score]" }));
		}
	}
}
```

- [ ] **Step 2: Register the module in `scripts/build.js`**

In `scripts/build.js`, add the new module to the `SOURCES` array. Insert it after `src/features/highlight-unread-comments.js` and before `src/features/hover-popup.js` (it depends on no other feature module):

```js
// Order matters: dependencies first.
const SOURCES = [
	"src/config.js",
	"src/parsing.js",
	"src/state.js",
	"src/dom.js",
	"src/styles.js",
	"src/api.js",
	"src/features/legibility.js",
	"src/features/comment-box-toggle.js",
	"src/features/click-indent-toggle.js",
	"src/features/collapse-root-comment.js",
	"src/features/backticks-to-monospace.js",
	"src/features/toggle-all-comments.js",
	"src/features/highlight-unread-comments.js",
	"src/features/auto-collapse-low-score.js",
	"src/features/hover-popup.js",
	// ... rest unchanged
```

- [ ] **Step 3: Run `just fmt && just check`**

Run: `just fmt && just check`
Expected: PASS — including the duplicate-function-name guard in build.js, since we haven't introduced a name collision.

- [ ] **Step 4: Commit**

```bash
git add src/features/auto-collapse-low-score.js scripts/build.js script.js
git commit -m "$(cat <<'EOF'
feat(low-score): add setupAutoCollapseLowScore feature module

Tags every tr.comtr with data-hn-author so rerenderUserRatings can
later target rows by author, and applies .hn-low-score to rows
whose author's stored rating is <= LOW_SCORE_COLLAPSE_THRESHOLD.
Appends a faint [low score] marker to the comhead so the reader
has a visible reason for the empty body.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Make `setupClickIndentToggle` class-aware

**Files:**
- Modify: `src/features/click-indent-toggle.js`

- [ ] **Step 1: Update the click handler**

Replace the body of `src/features/click-indent-toggle.js` so the click handler routes by class:

```js
// Make the empty indent column on each comment a click target.
// Default behaviour: fire HN's native toggle (collapse/expand the
// whole subtree). Overridden behaviour: on rows tagged
// .hn-low-score (auto-collapsed because the author's rating is at
// or below the configured threshold), toggle .hn-low-score-expanded
// instead — score-collapse hides only this comment's body, not its
// replies, so HN's native subtree toggle would do the wrong thing.

export function setupClickIndentToggle() {
	for (const row of document.querySelectorAll("tr.comtr")) {
		const indentCell = row.querySelector("td.ind");
		const toggleBtn = row.querySelector("a.togg");
		if (!indentCell || !toggleBtn) continue;
		indentCell.classList.add("hn-clickable-indent");
		indentCell.addEventListener("click", () => {
			if (row.classList.contains("hn-low-score")) {
				row.classList.toggle("hn-low-score-expanded");
				return;
			}
			toggleBtn.click();
		});
	}
}
```

- [ ] **Step 2: Run `just fmt && just check`**

Run: `just fmt && just check`
Expected: PASS — no test changes; this is a behaviour change in a browser-only module.

- [ ] **Step 3: Commit**

```bash
git add src/features/click-indent-toggle.js script.js
git commit -m "$(cat <<'EOF'
feat(low-score): make click-indent-toggle class-aware

On .hn-low-score rows, clicking the indent gutter toggles
.hn-low-score-expanded (showing/hiding just the body of this one
comment). On every other row, behaviour is unchanged — fire HN's
native subtree-collapse toggle. Routing the click in the same
handler keeps a single click target with one decision point.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Extend `rerenderUserRatings` to live-update the collapse

**Files:**
- Modify: `src/features/user-render.js`

- [ ] **Step 1: Update the imports and the function body**

In `src/features/user-render.js`, update the imports to include the new threshold and helper:

```js
import { LOW_SCORE_COLLAPSE_THRESHOLD } from "../config.js";
import { findCommentParent, h } from "../dom.js";
import { parseTagInput, shouldAutoCollapseAuthor, timeSince } from "../parsing.js";
```

Then replace the body of `rerenderUserRatings` so it also applies/removes the score-collapse classes AND the `[low score]` comhead marker on every row by the user:

```js
function rerenderUserRatings(username) {
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
		// from the new rating.
		row.classList.remove("hn-low-score-expanded");
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
```

- [ ] **Step 2: Run `just fmt && just check`**

Run: `just fmt && just check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/user-render.js script.js
git commit -m "$(cat <<'EOF'
feat(low-score): live-update collapse on rating change

rerenderUserRatings now also applies/removes .hn-low-score (and
clears .hn-low-score-expanded) on every tr.comtr by the user, so
clicking the rating buttons collapses or expands their visible
comments without a page reload. Uses the data-hn-author attribute
that setupAutoCollapseLowScore tags on each row at page load.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire `setupAutoCollapseLowScore` into `main.js` and smoke-test feature 1

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Import and call the new setup**

In `src/main.js`, add the import alongside the other feature imports (alphabetical-ish, near the existing `setupCollapseRootComment` import):

```js
import { setupAutoCollapseLowScore } from "./features/auto-collapse-low-score.js";
```

Inside the `if (isItemPage()) { ... }` block, call the new setup AFTER `userRender.renderAllUsernames()` (so the original `.hnuser` text is what we read) and BEFORE `setupClickIndentToggle()` would be called. Actual position: between the existing `setupHighlightUnreadComments({ store });` and `userRender.renderAllUsernames();` lines, place it AFTER `renderAllUsernames`. Updated block:

```js
if (isItemPage()) {
	setupCommentBoxToggle();
	setupClickIndentToggle();
	setupCollapseRootComment();
	transformBackticksToMonospace();
	setupToggleAllComments();
	setupHighlightUnreadComments({ store });
	userRender.renderAllUsernames();
	setupAutoCollapseLowScore({ store });
	setupWatchToggles({ store, fetchItem });
	setupItemInfoHover({ fetchItem, popup: hoverPopup });
	setupReplyInline();
	toolbar.mount();
	setupWatchedCommentNav({ store, toolbar });
}
```

The order doesn't affect correctness (the click-indent handler reads the class at click time, not at setup time), but placing the auto-collapse pass right after `renderAllUsernames` keeps the visible-on-load shape of low-score rows correct from the first paint.

- [ ] **Step 2: Run `just check`**

Run: `just check`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Reload `script.js` in your userscript manager. On `https://news.ycombinator.com/`:

1. Pick any active comment thread and open it.
2. Pick a commenter and click `▼` on their rating until the displayed score reads `-10`. Confirm:
   - All of their visible comments collapse to the two-line shape (comhead + main-row).
   - The `[low score]` marker appears next to `[collapse root]` in each affected comhead.
   - Replies to those comments remain visible.
3. Click the indent gutter on a collapsed comment. Confirm the body and reply link reappear.
4. Click the indent gutter again. Confirm they re-hide.
5. Click `▲` on the rating until it reads `-9`. Confirm all of their comments expand to full and the `[low score]` marker disappears from each comhead.
6. Click `▼` back to `-10`. Confirm the comments re-collapse and the `[low score]` marker reappears (live, no reload).
7. Reload the page. Confirm the persisted state matches what's on screen.

If any of these fail, investigate before proceeding to Task 10.

- [ ] **Step 4: Commit**

```bash
git add src/main.js script.js
git commit -m "$(cat <<'EOF'
feat(low-score): wire setupAutoCollapseLowScore on item pages

Runs after renderAllUsernames so the visible-on-load shape of
low-score rows is correct from the first paint. Placement
relative to setupClickIndentToggle is order-independent — the
click handler reads the class at click time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Add `Escape` keydown handler to `createHoverPopup`

**Files:**
- Modify: `src/features/hover-popup.js`

- [ ] **Step 1: Update the factory**

In `src/features/hover-popup.js`, register a single `document` `keydown` listener on construction. The listener calls `hide()` only when the popup is currently visible (i.e. `popup` does not carry the `hidden` class), so the handler is a no-op when nothing is shown. Updated body of `createHoverPopup`:

```js
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

	// Escape dismisses whichever hover popup is currently visible.
	// Single document-level listener means user/item/parent hovers all
	// inherit keyboard dismissal automatically.
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Escape") return;
		if (popup.classList.contains("hidden")) return;
		hide();
	});

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
```

- [ ] **Step 2: Run `just check`**

Run: `just check`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Reload the userscript. On any HN comment page:

1. Hover a username for >250ms; confirm the user popup appears.
2. Press `Escape`; confirm the popup hides.
3. Hover an `/item?id=` link inside a `.commtext`; confirm the item popup appears.
4. Press `Escape`; confirm the popup hides.
5. Press `Escape` with no popup visible; confirm nothing else on the page changes.

- [ ] **Step 4: Commit**

```bash
git add src/features/hover-popup.js script.js
git commit -m "$(cat <<'EOF'
feat(hover): Escape dismisses any visible hover popup

Single document-level keydown listener inside createHoverPopup
means user/item/parent hovers all inherit keyboard dismissal.
The handler is a no-op when no popup is visible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: New module — `parent-hover.js`

**Files:**
- Create: `src/features/parent-hover.js`
- Modify: `scripts/build.js`

- [ ] **Step 1: Create the module**

Create `src/features/parent-hover.js`:

```js
// Hover the "parent" link in any comment's comhead for HOVER_DWELL_MS
// to see the parent comment's body inline — saves a navigation
// round-trip in deep or wide threads. Resolves the parent first via
// the on-page DOM (the common case: parent is somewhere above the
// hovered comment in the same item page) and falls back to the
// existing fetchItem cache when the parent isn't on the page (e.g.
// you're viewing a deep subtree at /item?id=DEEP_COMMENT, or the
// parent is the story itself for a top-level comment).
//
// The popup shows up to two paragraphs of body, plus an ellipsis if
// more were dropped. For a story parent (top-level comments), the
// title is rendered as a bold first line above the body. Author,
// timestamp and score are deliberately omitted — the goal is to
// remind the reader of what the comment-being-replied-to said, not
// to re-show metadata.

import { h } from "../dom.js";
import { parseParentIdFromHref, splitHtmlIntoParagraphs } from "../parsing.js";

const MAX_PARAGRAPHS = 2;

// Parse a paragraph HTML string into a fragment of DOM nodes,
// preserving inline markup (anchors, italics, code) without trusting
// the string as live HTML. DOMParser delivers a sandboxed Document;
// we only adopt the parsed children.
function paragraphToNodes(htmlChunk) {
	const doc = new DOMParser().parseFromString(
		`<div>${htmlChunk}</div>`,
		"text/html",
	);
	const wrapper = doc.body.firstChild;
	if (!wrapper) return [];
	return Array.from(wrapper.childNodes).map((n) => document.importNode(n, true));
}

function renderParagraphs(paragraphs, hasMore) {
	const nodes = [];
	for (const para of paragraphs) {
		nodes.push(h("p", { class: "hn-hover-popup-body" }, paragraphToNodes(para)));
	}
	if (hasMore) {
		nodes.push(h("p", { class: "hn-hover-popup-body", text: "…" }));
	}
	return nodes;
}

// Try the on-page DOM first. Returns null if the parent isn't on the
// page or has no body content (deleted comments fall through to the
// API path, which can return a [deleted] placeholder or null).
function loadFromDom(parentId) {
	const row = document.getElementById(parentId);
	if (!row || row.tagName !== "TR") return null;
	const commtext = row.querySelector(".commtext");
	if (!commtext) return null;
	const paragraphs = splitHtmlIntoParagraphs(commtext.innerHTML);
	if (paragraphs.length === 0) return null;
	return {
		title: null,
		paragraphs: paragraphs.slice(0, MAX_PARAGRAPHS),
		hasMore: paragraphs.length > MAX_PARAGRAPHS,
	};
}

async function loadFromApi(parentId, fetchItem) {
	const digest = await fetchItem(parentId);
	if (!digest) return null;
	const paragraphs = splitHtmlIntoParagraphs(digest.text || "");
	if (paragraphs.length === 0 && !digest.title) return null;
	return {
		title: digest.title || null,
		paragraphs: paragraphs.slice(0, MAX_PARAGRAPHS),
		hasMore: paragraphs.length > MAX_PARAGRAPHS,
	};
}

function renderPopup(data) {
	const lines = [];
	if (data.title) {
		lines.push(
			h("div", { class: "hn-hover-popup-title" }, [
				h("strong", { text: data.title }),
			]),
		);
	}
	for (const node of renderParagraphs(data.paragraphs, data.hasMore)) {
		lines.push(node);
	}
	return lines;
}

export function setupParentHover({ fetchItem, popup }) {
	const links = document.querySelectorAll("span.comhead a[href^='item?id=']");
	for (const link of links) {
		// The comhead has multiple "item?id=" anchors (parent, prev, next,
		// root, context); only the "parent" link is the use case here.
		if (link.textContent.trim() !== "parent") continue;
		const id = parseParentIdFromHref(link.getAttribute("href") || link.href);
		if (!id) continue;
		popup.attachDwell(
			link,
			() => loadFromDom(id) ?? loadFromApi(id, fetchItem),
			(data) => renderPopup(data),
		);
	}
}
```

- [ ] **Step 2: Register the module in `scripts/build.js`**

Add `src/features/parent-hover.js` to the `SOURCES` array. Insert after `src/features/item-info-hover.js` (it depends on the same primitive and on `fetchItem`):

```js
"src/features/hover-popup.js",
"src/features/user-info-hover.js",
"src/features/item-info-hover.js",
"src/features/parent-hover.js",
"src/features/linkify-user-about.js",
// ... rest unchanged
```

- [ ] **Step 3: Run `just fmt && just check`**

Run: `just fmt && just check`
Expected: PASS, including the duplicate-function-name guard. (We don't reuse names from item-info-hover; `paragraphToNodes`, `renderParagraphs`, `loadFromDom`, `loadFromApi`, `renderPopup` are unique.)

- [ ] **Step 4: Commit**

```bash
git add src/features/parent-hover.js scripts/build.js script.js
git commit -m "$(cat <<'EOF'
feat(parent-hover): add setupParentHover feature module

Hover "parent" link in comhead -> popup with up to two paragraphs
of the parent comment body. DOM-first source resolution (parent is
usually on the page) with fetchItem fallback for off-page parents
(deep subtrees, or top-level comments whose "parent" is the story).
Inline markup is preserved via DOMParser-adopted nodes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Wire `setupParentHover` into `main.js` and smoke-test feature 2

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Import and call the new setup**

In `src/main.js`, add the import:

```js
import { setupParentHover } from "./features/parent-hover.js";
```

Inside the `if (isItemPage())` block, call `setupParentHover` next to the other hover wires:

```js
if (isItemPage()) {
	setupCommentBoxToggle();
	setupClickIndentToggle();
	setupCollapseRootComment();
	transformBackticksToMonospace();
	setupToggleAllComments();
	setupHighlightUnreadComments({ store });
	userRender.renderAllUsernames();
	setupAutoCollapseLowScore({ store });
	setupWatchToggles({ store, fetchItem });
	setupItemInfoHover({ fetchItem, popup: hoverPopup });
	setupParentHover({ fetchItem, popup: hoverPopup });
	setupReplyInline();
	toolbar.mount();
	setupWatchedCommentNav({ store, toolbar });
}
```

- [ ] **Step 2: Run `just check`**

Run: `just check`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Reload the userscript. On a deep comment thread (e.g. `https://news.ycombinator.com/item?id=<some-active-thread>`):

1. Find a comment that is at least 2-3 levels deep. Hover its `parent` link for >250ms. Confirm:
   - A popup appears below the link.
   - It contains up to two paragraphs of the parent comment's body.
   - If the parent's body has more than two paragraphs, an `…` line follows.
   - No author / timestamp / score is shown.
2. Move the cursor away. Confirm the popup hides.
3. Press `Escape` while the popup is showing on a re-hover. Confirm dismissal.
4. Hover the `parent` link of a top-level comment (whose "parent" is the story). Confirm the popup shows the story title (bold) and, for Ask/Show items, a body snippet. For regular link items, only the title is shown.
5. (If you can find one) Visit a deep subtree at `/item?id=DEEP_COMMENT` and hover the `parent` link of the top comment on that page. The DOM lookup should miss; the API fallback should populate the popup after a brief delay.

If any of these fail, investigate before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/main.js script.js
git commit -m "$(cat <<'EOF'
feat(parent-hover): wire setupParentHover on item pages

Shares the hoverPopup instance with the existing user-info and
item-info hovers — there's still only one popup div on the page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the two features to "What this is"**

In `CLAUDE.md`'s "What this is" section, expand the comment-page enrichment bullet (#2) to mention the new behaviours. Add to the comma-separated feature list inside that bullet:

> ..., per-comment auto-collapse for users rated `<= -10` (with a `[low score]` marker in the comhead and click-the-gutter to expand), parent-link hover popup that previews the parent comment's body, ...

Place these next to the existing "watch for replies" / "show comment box" / etc. items so the list reads naturally.

- [ ] **Step 2: Add an Architecture subsection — "Auto-collapse low-score authors"**

Inside the "Architecture" section, between the "Comment-tree tweaks" subsection and the "User rendering" subsection, add a new subsection:

```markdown
### Auto-collapse low-score authors (`src/features/auto-collapse-low-score.js`)

`setupAutoCollapseLowScore({ store })` runs once per item-page load. It walks every `tr.comtr`, tags each with `data-hn-author=<username>` (so `rerenderUserRatings` can later target rows by author via the same `[data-hn-...]` selector pattern that the rest of the code uses), and adds the `.hn-low-score` class to rows whose author's stored rating is `<= LOW_SCORE_COLLAPSE_THRESHOLD` (`-10`, in `src/config.js`). A faint `[low score]` marker is appended to the comhead next to the existing `[collapse root]` link so the empty body has a visible reason.

The CSS in `src/styles.js` hides `.commtext` and `.reply` for `.hn-low-score` rows; the toggle marker `.hn-low-score-expanded` (added by `setupClickIndentToggle`'s click handler) reverts the hide on a single row at a time. Replies — which are separate `tr.comtr` rows at greater indent — are unaffected, which is the whole point of using a custom collapse rather than HN's native subtree toggle.

`rerenderUserRatings` (in `user-render.js`) is extended to apply or remove `.hn-low-score` (and clear `.hn-low-score-expanded`) on every row by the user when their rating changes. Cross-tab rating writes flow through the same `rerenderUserRatings` call site that the existing per-user fan-out uses, so there's no second sync mechanism.

### Parent-link hover popup (`src/features/parent-hover.js`)

`setupParentHover({ fetchItem, popup })` finds every `parent` link in `span.comhead` and wires `popup.attachDwell` so a hover beyond `HOVER_DWELL_MS` opens the shared popup with the parent's body. Source resolution is DOM-first: `document.getElementById(parentId)` against the on-page comment table, falling back to `fetchItem(parentId)` (the same cache the cited-item hover uses) when the parent isn't rendered on the current page. The body is split into paragraphs by `splitHtmlIntoParagraphs` (in `src/parsing.js`), the first two are rendered, and an ellipsis line is appended when more were dropped. Author, timestamp, and score are deliberately omitted — the popup is a body-text reminder, not a metadata view.

Story parents (the case for top-level comments, whose `parent` link points back to the item itself) take the API path. The digest's `title` is rendered as a bold first line; the body — only present for Ask/Show — follows.

The shared `createHoverPopup` primitive grows a single document-level `Escape` `keydown` listener that calls its existing `hide()` when a popup is visible, so user/item/parent hovers all inherit keyboard dismissal at no extra cost.
```

- [ ] **Step 3: Add the two new modules to "Repository layout"**

In the "Repository layout" tree, add the two new files alongside the existing feature modules. Insert in the right alphabetical/dependency position:

```
    auto-collapse-low-score.js  setupAutoCollapseLowScore: tags every tr.comtr with
                             data-hn-author and applies .hn-low-score on rows whose
                             author's rating is <= LOW_SCORE_COLLAPSE_THRESHOLD;
                             appends "[low score]" tag to the comhead
    ...
    parent-hover.js          setupParentHover: hovers on the "parent" link in each
                             comhead show the parent comment's body in the shared
                             popup; DOM-first with fetchItem fallback for off-page
                             parents (deep subtrees, story parents)
```

- [ ] **Step 4: Add the threshold constant to the config description**

In the "Repository layout" line for `src/config.js`, add `LOW_SCORE_COLLAPSE_THRESHOLD` to the list of constants:

```
  config.js                  Storage key, schema version, TTL/timeout/threshold constants
```

- [ ] **Step 5: Note the new pure helpers in the parsing.js description**

In the "Repository layout" line for `src/parsing.js`, append the new helper names to the existing list:

```
  parsing.js                 Pure helpers: timeSince, stripLeadingQuoteMarker, parseTagInput,
                             findCommentRootIndices, splitBackticks,
                             findNewCommentIds, isReadCommentEntryFresh,
                             pruneExpiredReadComments, truncateText, extractDomain,
                             linkifySegments, sortStoriesBy,
                             shouldAutoCollapseAuthor, parseParentIdFromHref,
                             splitHtmlIntoParagraphs
```

- [ ] **Step 6: Run `just fmt && just check`**

Run: `just fmt && just check`
Expected: PASS — `CLAUDE.md` is documentation-only, no test impact.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md script.js
git commit -m "$(cat <<'EOF'
docs(claude-md): document low-score collapse and parent-hover

Adds the two new features to the What-this-is bullet, two new
Architecture subsections, the new feature modules to the
Repository layout tree, and the new constants/helpers to the
relevant module descriptions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Open the pull request

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/low-score-collapse-and-parent-hover
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: low-score auto-collapse and parent-link hover popup" --body "$(cat <<'EOF'
## Summary

- Auto-collapse comments by users rated `<= -10` (configurable via `LOW_SCORE_COLLAPSE_THRESHOLD` in `src/config.js`). Hides only the body and reply link; replies stay visible. Click the indent gutter to manually expand or re-collapse. Live-updates on rating change via the existing `rerenderUserRatings` path.
- New `parent` link hover popup. Reuses the shared `createHoverPopup` primitive and the existing `fetchItem` cache. DOM-first source resolution with API fallback for off-page parents (top-level comments' story parent, deep subtree pages).
- `Escape` now dismisses any visible hover popup (user / item / parent).

Spec: `docs/superpowers/specs/2026-05-09-low-score-collapse-and-parent-hover-design.md`
Plan: `docs/superpowers/plans/2026-05-09-low-score-collapse-and-parent-hover.md`

## Test plan

- [x] Pure helpers (`shouldAutoCollapseAuthor`, `parseParentIdFromHref`, `splitHtmlIntoParagraphs`) unit-tested under `tests/`.
- [x] `just check` (lint + format + tests + build) green.
- [ ] Smoke: rate a user to `-10`; their comments collapse with `[low score]` tag.
- [ ] Smoke: click the indent gutter on a collapsed comment; body shows. Click again; hides.
- [ ] Smoke: rate the same user to `-9`; comments expand without reload.
- [ ] Smoke: hover a `parent` link; popup shows up to 2 paragraphs of the parent.
- [ ] Smoke: top-level comment's `parent` link hover shows story title (and body for Ask/Show).
- [ ] Smoke: `Escape` dismisses any visible hover popup.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report the PR URL back to the user**

---

## Self-review notes

Coverage check against the spec, in order:

- [x] `LOW_SCORE_COLLAPSE_THRESHOLD = -10` in `src/config.js` — Task 1.
- [x] Author tagging via `data-hn-author` and `.hn-low-score` on row — Task 6.
- [x] `[low score]` marker in comhead — Task 6.
- [x] CSS hides `.commtext` and `.reply`; `.hn-low-score-expanded` reverts via `display: revert` — Task 5.
- [x] Click-indent toggle is class-aware: toggle `.hn-low-score-expanded` on `.hn-low-score` rows; otherwise fire `a.togg` — Task 7.
- [x] Live update via extended `rerenderUserRatings` — Task 8.
- [x] Cross-tab — implicit; existing cross-tab listener already calls `rerenderUserRatings` per visible user, so the live-update extension covers cross-tab too. Mentioned explicitly in the CLAUDE.md update.
- [x] `parseParentIdFromHref` pure helper — Task 3.
- [x] `splitHtmlIntoParagraphs` pure helper — Task 4.
- [x] Parent-hover module: filters comhead anchors by text "parent"; DOM-first; API fallback; first-2-paragraph render — Task 11.
- [x] `Escape` keydown on the shared primitive — Task 10.
- [x] Wiring on item pages — Tasks 9 and 12.
- [x] CLAUDE.md updated — Task 13.

No placeholders, no TBD/TODO. No type/method-name drift between tasks (e.g. `setupAutoCollapseLowScore` is consistent end-to-end). Each task ends with a concrete commit; the PR is opened in Task 14.

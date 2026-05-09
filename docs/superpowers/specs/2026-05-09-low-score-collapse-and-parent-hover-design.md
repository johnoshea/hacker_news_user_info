# Low-score collapse and parent-hover — design

## Purpose

Two independent comment-page enhancements that share no implementation surface but ship together.

1. **Auto-collapse low-score authors.** A user whose rating sits at -10 or below has, by definition, demonstrated a sustained pattern of low-value-to-John commentary. The script already lets you score authors; it does not yet act on those scores. This feature collapses such authors' comments to a two-line header automatically, while leaving any replies to those comments fully visible — the replies often carry useful pushback the original author no longer earns the screen space for.

2. **Parent-link hover popup.** HN comment threads are deep, broad, or both, and the existing `parent` link forces a navigation round-trip to read the comment one level up. Hovering it should pop the parent's body inline, the same way username and cited-item hovers already do.

## Feature 1 — Auto-collapse low-score authors

### User-facing behaviour

When the page loads, every `tr.comtr` whose author's stored rating is `<= -10` (the constant `LOW_SCORE_COLLAPSE_THRESHOLD` in `src/config.js`) renders as collapsed:

- The comhead row is unchanged, with one addition: a faint grey `[low score]` text marker appended next to the existing `[collapse root]` link, so the reason for the empty body is obvious to the reader.
- The `.hn-main-row` (username, account info, rating buttons, eye icon, tag input) remains visible — the rating buttons need to stay reachable so the score is one click away from being raised.
- The `.commtext` body and the per-comment `reply` link are hidden.
- The indent gutter (`td.ind`) remains visible so the visual continuity of the thread is preserved (the row is shorter, but the gutter is still there).
- Replies to the collapsed comment, which are separate `tr.comtr` rows at greater indent, are unaffected.

The result is the shape shown in the reference screenshot: two visible lines per low-score comment (comhead + main-row), with the rest of the thread reading normally.

### Manual expand and re-collapse

Clicking the indent gutter on a score-collapsed comment toggles the body visibility for that one comment, mirroring the existing "click the gutter to toggle" interaction that `setupClickIndentToggle` provides for HN's native subtree collapse. A second gutter click on the same row re-collapses it.

This means a single click target (`td.ind`) has two distinct behaviours depending on the row:

- Score-managed row → toggle our score-collapse state. HN's native `a.togg` is **not** fired, since that would also hide the replies we want to keep visible.
- Any other row → fire HN's native `a.togg` (existing behaviour, unchanged).

### Live update on score change

Rating a user up via the `▲`/`▼` buttons re-evaluates the collapse for every visible comment by that user, with no page reload:

- Rating drops to or stays at `<= -10` → all comments by the user become score-collapsed (and any prior manual expansion is reset).
- Rating moves to `> -10` → the collapse is fully removed from all comments by the user.

Cross-tab score changes are picked up by the existing `GM_addValueChangeListener` path, which already calls `rerenderUserRatings` on remote writes.

### Score-aware data flow

| Event | What runs | What changes on the page |
|---|---|---|
| Page load | `setupAutoCollapseLowScore` reads `state.ratings`, walks every comment, applies marker classes for low-score authors. | Affected rows render collapsed with the `[low score]` tag. |
| User clicks `▲`/`▼` on a comment | `rerenderUserRatings(username)` (extended) recomputes the collapse for every row by that user. | Affected rows collapse or expand to match the new rating. |
| User clicks the indent gutter on a score-managed row | `setupClickIndentToggle`'s handler (extended) toggles the score-expand state. | That single row toggles between collapsed and expanded. |
| Cross-tab rating write | Cross-tab listener calls `rerenderUserRatings(username)`. | Same as the local rating click. |

### DOM and CSS

Two CSS class markers, applied to `tr.comtr`:

- `.hn-low-score` — author's rating is `<= -10`. Applied or removed in `rerenderUserRatings` and on initial page load. The marker is what the indent-toggle handler keys off of to decide whether to use score-collapse semantics or HN-native semantics.
- `.hn-low-score-expanded` — the user has manually clicked the gutter on a score-managed row to reveal the body. Toggled by the indent-toggle handler. Removed by `rerenderUserRatings` whenever the rating changes (so a fresh rating change cleanly resets state).

CSS:

```css
tr.comtr.hn-low-score .commtext,
tr.comtr.hn-low-score .reply {
    display: none;
}

tr.comtr.hn-low-score.hn-low-score-expanded .commtext,
tr.comtr.hn-low-score.hn-low-score-expanded .reply {
    display: revert;
}

.hn-low-score-tag {
    color: #999;
    margin-left: 4px;
    font-size: 0.9em;
}
```

The `[low score]` marker is appended in JS as a `<span class="hn-low-score-tag">[low score]</span>` inside the comhead, alongside the existing `[collapse root]` link.

### Module layout

New module: `src/features/auto-collapse-low-score.js`. Exports `setupAutoCollapseLowScore({ store })`, which:

1. Reads `state.ratings` once.
2. Walks `tr.comtr` on the page; for each, finds the author by reading the original `.hnuser` element's text (still in the DOM after `renderAllUsernames` hides it via `display: none`), looks up the rating, and applies `.hn-low-score` if `<= LOW_SCORE_COLLAPSE_THRESHOLD`.
3. For each row receiving the marker, appends the `[low score]` span to its `span.comhead`.

Touched module: `src/features/user-render.js`. `rerenderUserRatings(username)` is extended to also apply or remove `.hn-low-score` (and clear `.hn-low-score-expanded`) on every `tr.comtr` whose author matches `username`. The lookup uses the existing `data-hn-user` selector pattern that tags and ratings already rely on.

Touched module: `src/features/click-indent-toggle.js`. The click handler grows a class check:

```js
indentCell.addEventListener("click", () => {
    if (row.classList.contains("hn-low-score")) {
        row.classList.toggle("hn-low-score-expanded");
        return;
    }
    toggleBtn.click();
});
```

Touched module: `src/config.js`. New constant:

```js
export const LOW_SCORE_COLLAPSE_THRESHOLD = -10;
```

### Pure helper (in `src/parsing.js`)

```js
// True iff this rating crosses the auto-collapse threshold. Threshold is
// expected to be negative; a rating of 0 (the default for an unrated user)
// must never collapse.
export function shouldAutoCollapseAuthor(rating, threshold)
```

Implementation is `rating <= threshold`, but the helper documents the intent and gives the unit test a concrete entry point.

### Testing

`tests/autoCollapseLowScore.test.js`:

- `shouldAutoCollapseAuthor`: at threshold (boundary inclusive); above threshold; far below; default rating of 0; threshold of 0 (degenerate but defined).

### Edge cases

| Case | Handling |
|---|---|
| First visit; user has no stored rating | `store.getRating(user)` returns `0`; `0 > -10`; row is not collapsed. |
| Author is OP and is also `<= -10` | Both `.hn-op` and `.hn-low-score` apply. The `[op]` suffix on the username is still visible (it lives in `.hn-main-row`, which we don't hide). |
| Comment is also new since last visit (`.hn-new-comment`) | Both classes apply. `.hn-new-comment` tints the row; `.hn-low-score` hides the body. The tint is still a useful "this is a comment you haven't seen" signal even when the body is hidden. |
| Comment is a watched comment (`.hn-watched`) | Watch styling applies normally (orange left-border, yellow tint). The score-collapse hides the body but does not interfere with watch markers. The user almost certainly does not want to score a user `-10` while still watching their replies, but the case is harmless. |
| Comment is dead (`.cdd`) | `.commtext.cdd` is already styled differently. Score-collapse hides it as it would any commtext. No special handling. |
| User raises rating to `-9` mid-page | `rerenderUserRatings` removes `.hn-low-score` and `.hn-low-score-expanded` from all of that user's comments; bodies become visible. |
| User has a comment manually expanded, then rates them down further (still `<= -10`) | The manual expansion is cleared by `rerenderUserRatings` (it removes `.hn-low-score-expanded`); the comment re-collapses. Acceptable: any rating change is treated as a state reset. |
| The page contains the user's own deleted/empty comment | Score-collapse still applies; the empty body becomes invisible-empty, which is fine. |

## Feature 2 — Parent-link hover popup

### User-facing behaviour

Hover the `parent` link in any comment's comhead for `HOVER_DWELL_MS` (250 ms — the same dwell the username and cited-item popups use). A small popup appears below the link showing the first paragraph or two of the parent comment's body. Move the cursor away or press `Escape` to dismiss.

The popup contains body text only — no author, no timestamp, no score. The point of the hover is to remind you what the comment-being-replied-to said, not to re-show the metadata you can already see by clicking through.

If the body has more than two paragraphs, an ellipsis (`…`) is appended after the second paragraph to signal truncation.

### Source resolution

The parent's body is resolved in this order on each hover:

1. **DOM lookup.** The href of a `parent` link contains `?id=<PARENT_ID>`. If `document.getElementById(PARENT_ID)` is a `tr.comtr` on the current page (the common case — a deep comment's parent is virtually always above it on the same page), we read its `.commtext` and clone the first two paragraph-equivalent runs.
2. **API fallback.** If the lookup misses (e.g. you are viewing a deep subtree at `/item?id=DEEP_COMMENT` and the parent isn't rendered on the page, or the parent is the story itself for a top-level comment), call `fetchItem(PARENT_ID)` (default cache, no `fresh: true` — parent comments don't change). The returned digest's `text` is parsed with the same paragraph-extraction helper. For story parents, the digest also has a `title`, which is rendered as a bold first line above the body if non-empty.

`fetchItem` is the existing helper used by `setupItemInfoHover`, sharing both its persistent cache and its in-flight dedup map. No new network plumbing.

### Paragraph extraction

HN comment HTML uses `<p>` as a paragraph **separator**, not a wrapper: the first paragraph is text and inline elements before any `<p>`, and subsequent paragraphs follow each `<p>` until the next one or the end. The pure helper `splitHtmlIntoParagraphs(html)` (in `src/parsing.js`) splits the raw HTML on `/<p[^>]*>/i`, trims and drops empties, and returns the array of paragraph HTML strings. The feature module slices the first two and tracks whether more were dropped.

For DOM rendering, each paragraph string is parsed via `DOMParser` and its child nodes are appended into a new `<p>` element inside the popup. This preserves inline elements (`<a>`, `<i>`, `<code>`, the `<p class="quote">` rewrites that `transformQuotes` already injected on the page).

### Module layout

New module: `src/features/parent-hover.js`. Exports `setupParentHover({ fetchItem, popup })`:

1. Find candidate links: `document.querySelectorAll("span.comhead a[href^='item?id=']")`, filtered to those with `link.textContent === "parent"` (other comhead links have the same href shape — `prev`, `next`, `root`, `context` — but different text).
2. For each, extract the parent id via `parseParentIdFromHref(link.href)` (new pure helper in `src/parsing.js`).
3. Wire `popup.attachDwell(link, loader, render)`:
   - `loader()` — try DOM lookup; on hit, return `{ source: "dom", paragraphs, hasMore }`. On miss, `await fetchItem(id)` and return `{ source: "api", title, paragraphs, hasMore }` (with `paragraphs` derived from the digest's `text`). Returns null if both miss.
   - `render(data)` — produce an array of nodes for the popup. For `source: "dom"`, each paragraph becomes a `<p>` populated from parsed nodes. For `source: "api"`, prepend a bolded title `<div>` if non-empty.

New shared behaviour: an `Escape` keydown listener that, while the popup is visible, calls `popup.hide()`. This is added as a one-shot `document` listener inside `createHoverPopup`, so all three hover features (user, item, parent) get keyboard dismissal at no additional cost.

### Pure helpers (in `src/parsing.js`)

```js
// "item?id=12345" or "item?id=12345#12345" -> "12345"; null on parse failure.
export function parseParentIdFromHref(href)

// "First text. <a>link</a><p>Second.<p>Third." ->
//   ["First text. <a>link</a>", "Second.", "Third."]
// Trims each, drops empty entries.
export function splitHtmlIntoParagraphs(html)
```

Both helpers are pure (no DOM access; `URL` is available under Node) and unit-tested.

### Testing

`tests/parentHover.test.js`:

- `parseParentIdFromHref`:
  - Bare `item?id=12345` (relative) — returns `"12345"`.
  - `https://news.ycombinator.com/item?id=12345` (absolute) — returns `"12345"`.
  - With fragment `item?id=12345#12345` — returns `"12345"`.
  - No `id` param — returns `null`.
  - Garbage input — returns `null`.
- `splitHtmlIntoParagraphs`:
  - Empty / null / whitespace — returns `[]`.
  - Single paragraph, no `<p>` tags — returns one entry.
  - Two paragraphs separated by `<p>` — returns two entries.
  - Multiple paragraphs with inline markup preserved — returns each entry with markup intact.
  - Trailing `<p>` with nothing after it — does not produce an empty trailing entry.

Browser-side rendering (popup DOM construction, dwell wiring) follows the existing convention of not being unit-tested — the same convention every other hover feature uses.

### Edge cases

| Case | Handling |
|---|---|
| Top-level comment hovered (parent is the story) | DOM lookup misses; API fallback returns the story digest. The story `title` is shown as a bold first line; `text` (only present for Ask/Show items) becomes the body. For regular link items with no text, only the title is shown. |
| Parent comment is on the page but its `.commtext` is empty (deleted) | DOM lookup returns an element but `splitHtmlIntoParagraphs("")` returns `[]`; loader treats this as a miss and falls through to API. The API fetch may return a `[deleted]` placeholder or null; on null, the popup doesn't show. |
| `fetchItem` times out | Loader returns `null`; popup doesn't show. (Same behaviour the username hover already has.) |
| User moves cursor from `parent` link straight into the popup | The existing `createHoverPopup` hides on `mouseleave` of the target. The user reads the popup in-place during the dwell-then-show frame; if they move into the popup they cross the 6px gap and trigger `mouseleave`, hiding it. This is an existing limitation of the shared primitive, not a regression. |
| Multiple `parent` links on the page (one per comment) | Each gets its own `attachDwell` registration. The shared popup is single-instance — whichever link wins the most recent dwell replaces the content, matching the existing user/item hover behaviour. |
| `Escape` pressed while no popup is visible | The `keydown` handler is a no-op; nothing on the page changes. |

## Wiring (`src/main.js`)

Both features are item-page-only (the `parent` link only appears in comments; `tr.comtr` only exists on item pages). They are added inside the existing `if (isItemPage())` block.

```js
import { setupAutoCollapseLowScore } from "./features/auto-collapse-low-score.js";
import { setupParentHover } from "./features/parent-hover.js";

// ... existing setup ...

if (isItemPage()) {
    // ... existing item-page passes ...
    userRender.renderAllUsernames();
    setupAutoCollapseLowScore({ store });   // after renderAllUsernames; reads ratings, applies classes
    setupClickIndentToggle();                // existing; now class-aware
    setupCollapseRootComment();              // existing
    // ... other comment-tree tweaks ...
    setupParentHover({ fetchItem, popup });  // can run any time after the comhead exists
    setupUserInfoHover({ fetchUser, popup }); // existing
    setupItemInfoHover({ fetchItem, popup }); // existing
}
```

`setupAutoCollapseLowScore` only reads the original `.hnuser` element's text (always present in the DOM), so its position relative to `renderAllUsernames` doesn't affect correctness — the order chosen above is purely so the visible shape of low-score rows is correct from the moment the rest of the page is rendered.

`setupParentHover` shares the popup instance with the existing user and item hovers — the same `popup` constructed once in `main.js` and passed to all three. There is no second popup div on the page.

## Out of scope (v1)

- A configurable threshold via the toolbar UI. The threshold is a one-line constant; if it ever needs to move, it's an edit to `src/config.js`.
- Bulk "show all collapsed" toggle. The existing per-row gutter click is enough.
- Score-based styling beyond `display: none` for the body — e.g. fading the username, tinting the row a hostile colour. The point of `-10` is "I don't want to see them"; visual flair would defeat the purpose.
- Hover popups for `prev`, `next`, `root`, or `context` links. They share the href shape but not the use case.
- Multi-level parent chain in the popup (great-grandparent etc.). The hover is one level of context.
- Author/score/timestamp inside the parent popup. Explicitly excluded above.

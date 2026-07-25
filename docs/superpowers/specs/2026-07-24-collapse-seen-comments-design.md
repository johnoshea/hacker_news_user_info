# Collapse seen comments — design

## Purpose

Returning to a thread you have already read, the handful of genuinely new comments are scattered
through hundreds of ones you have seen. The script already tints new comments orange
(`setupHighlightUnreadComments`), but a tint does not stop you scrolling past everything else to
find them.

This feature adds a toggle that hides what you have already read: subtrees containing nothing new
collapse to a single line, the ancestor chain leading down to each new comment stays visible as a
header-only stub, and the new comments themselves render in full. Toggling it off restores the page.
The mode is off on every load — you opt in per visit, nothing is persisted.

## User-facing behaviour

### The control

An item page whose comment table contains at least one new comment, and at least one old comment to
hide, grows a link in the fatitem subtext next to the existing `toggle all`:

```
487 points by pg 2 days ago | flag | hide | 213 comments | 👁 | toggle all | collapse seen (9 new)
```

Clicking it turns the mode on and the label becomes `show all`. Clicking again turns it off. A
thread with no new comments — a first visit, an entry past its 3-day TTL, or simply nothing new
since last time — gets no link at all.

### What the mode does

Three shapes, decided per comment:

| Comment | Rendering |
|---|---|
| New | Untouched — full body, orange tint, as today. |
| Old, but a new comment sits somewhere below it | **Stub**: comhead and username row visible, body and `reply` link hidden. Its children are still laid out below it, so the lineage down to the new comment reads normally. |
| Old, with nothing new anywhere below it | **Collapsed**: the row itself becomes a stub carrying an `[N hidden]` expander, and every row in its subtree is hidden outright. |

```
COLLAPSE-SEEN MODE ON

▾ pg  2 days ago                 [stub: body hidden]
  ▾ dang  1 day ago              [stub]
    ● tptacek  20 min ago
        Full comment body shown here, exactly as normal.
  ▸ jacquesm  1 day ago          [3 hidden]
▸ patio11  2 days ago            [14 hidden]
```

A stub is two lines: HN's comhead, plus the username row this script injects (username, account age
and karma, rating and tag controls). That is the same shape a low-score-collapsed comment already
has, and the username row has to stay for the same reason — it is where the rating buttons live, and
without it the username is invisible (the original `.hnuser` is `display: none` once
`renderAllUsernames` has run).

### Expanding individual comments

- Clicking `[N hidden]` restores that root and its whole subtree in full. It does not re-collapse:
  the expander is a one-way reveal, and the row rejoins the page as an ordinary comment.
- Clicking the indent gutter of a stub reveals just that comment's body. Clicking it again hides it
  again. This is the interaction `setupClickIndentToggle` already provides for low-score rows.
- Clicking the indent gutter of a collapsed root does the same as clicking its `[N hidden]` link.

### What the mode does not touch

HN's own collapse state is left alone. `hn.js`'s `toggleCollapse` sends `collapse?id=…` to the
server for logged-in users, so HN remembers which comments you collapsed. This feature therefore
never fires `a.togg`; it hides rows with its own classes. A comment you had collapsed on HN stays
collapsed, and turning this mode off does not expand it.

## Implementation

### Pure planner — `planSeenCollapse(levels, isNew)` in `src/parsing.js`

Takes the per-row indent level array (HN renders one indent unit as a 40px-wide `img` in `td.ind`,
the reading `setupCollapseRootComment` and `setupToggleAllComments` already do) and a parallel
array of booleans. Returns `{ stubs, collapsed }` where `stubs` is a list of row indices and
`collapsed` is a list of `{ root, descendants }`.

Walking top-down over the rows, for each row `i` whose subtree ends at `end`:

- `isNew[i]` → emit nothing, continue at `end`. A reply cannot predate its parent, so if a row is
  new every row below it is new too. Should HN ever violate that, the unemitted rows simply render
  in full — the failure mode is "shows too much", not a broken page.
- Some row in `(i, end)` is new → push `i` to `stubs`, continue at `i + 1` so the children are
  planned in turn.
- Otherwise → push `{ root: i, descendants: [i+1 … end-1] }` to `collapsed` and continue at `end`.
  A childless old comment has no descendants to hide, so it goes to `stubs` instead — it would
  otherwise render an `[0 hidden]` expander.

### Feature module — `src/features/collapse-seen-comments.js`

`setupCollapseSeenComments({ newIds })`, called on item pages after
`setupHighlightUnreadComments`. It builds the plan once at setup (the comment table does not change
after load), creates the `[N hidden]` expander links, and adds the subtext link. Applying and
removing the mode is class flipping over the pre-computed index lists.

`setupHighlightUnreadComments` changes to **return** the new-comment ids (an empty array on a first
visit) instead of returning nothing. That keeps the dependency explicit at the `main.js` call site
rather than having a second pass sniff the DOM for `.hn-new-comment` and depend on invisible
ordering.

### Classes

| Class | Meaning |
|---|---|
| `hn-seen-stub` | Hide this row's `.commtext` and `.reply`. |
| `hn-seen-collapsed` | Show this row's `[N hidden]` expander. A collapsed root carries both this and `hn-seen-stub`. |
| `hn-seen-hidden` | `display: none` on the whole row. |
| `hn-seen-expander` | The `[N hidden]` link itself, in the comhead. Rendered at setup, revealed by CSS only when its row has `hn-seen-collapsed`. |
| `hn-body-expanded` | Manual per-row reveal. Shared with the low-score collapse (see below). |

Turning the mode off removes the first three from every row. `hn-body-expanded` is left alone: it
only has an effect on a row that also carries a reason class.

### Shared expand marker

`.hn-low-score-expanded` is renamed to `.hn-body-expanded` so one marker serves both reasons a
body can be hidden, and the CSS collapses to a single `:not()` form:

```css
tr.comtr.hn-low-score:not(.hn-body-expanded) .commtext,
tr.comtr.hn-low-score:not(.hn-body-expanded) .reply,
tr.comtr.hn-seen-stub:not(.hn-body-expanded) .commtext,
tr.comtr.hn-seen-stub:not(.hn-body-expanded) .reply { display: none; }
```

That also removes the existing `display: revert` counter-rule. `rerenderUserRatings` in
`user-render.js` clears the renamed marker as it does today; the knock-on is that changing a
user's rating now also re-hides a seen-stub you had manually opened on one of their comments. The
row returns to its canonical collapsed shape, which is what that reset already means.

### Gutter click routing

`setupClickIndentToggle` grows two branches ahead of its existing default:

1. Row has `hn-seen-collapsed` → forward the click to the row's `.hn-seen-expander` link, so the
   reveal logic lives in one place.
2. Row has `hn-low-score` or `hn-seen-stub` → toggle `hn-body-expanded`.
3. Otherwise → fire HN's native `a.togg`, unchanged.

### Wiring

In `main.js`, inside the `isItemPage()` block:

```js
const newIds = setupHighlightUnreadComments({ store });
…
setupCollapseSeenComments({ newIds });
```

## Testing

`tests/planSeenCollapse.test.js` covers the planner: a new reply nested under two old ancestors, a
new root among old siblings, an all-new thread, an all-old thread, a childless old comment, a deep
ancestor chain, and empty input.

The DOM layer is not unit-tested, matching how every other feature module in this repo is treated.

## Out of scope

- Persisting the mode across page loads or across tabs.
- Any prev/next navigation between new comments. The toolbar already has that shape for watched
  comments; if it turns out to be wanted here it is a separate change.
- Changing what counts as "new". That stays exactly what `setupHighlightUnreadComments` decides.

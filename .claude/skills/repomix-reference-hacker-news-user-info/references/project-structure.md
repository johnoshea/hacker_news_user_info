# Directory Structure

```
.claude/
  settings.local.json (40 lines)
.github/
  workflows/
    ci.yml (40 lines)
docs/
  superpowers/
    plans/
      2026-04-18-tag-management-overlay.md (1412 lines)
    specs/
      2026-04-18-tag-management-overlay-design.md (186 lines)
scripts/
  build.js (152 lines)
  clean-orphan-tags.js (65 lines)
src/
  features/
    backticks-to-monospace.js (53 lines)
    click-indent-toggle.js (15 lines)
    collapse-root-comment.js (52 lines)
    comment-box-toggle.js (38 lines)
    highlight-unread-comments.js (64 lines)
    hover-popup.js (89 lines)
    item-info-hover.js (80 lines)
    legibility.js (46 lines)
    linkify-user-about.js (85 lines)
    reply-inline.js (148 lines)
    sort-stories.js (150 lines)
    tag-manager.js (389 lines)
    toggle-all-comments.js (82 lines)
    toolbar.js (92 lines)
    user-info-hover.js (65 lines)
    user-render.js (302 lines)
  api.js (122 lines)
  config.js (48 lines)
  dom.js (28 lines)
  main.js (100 lines)
  parsing.js (225 lines)
  state.js (472 lines)
  styles.js (538 lines)
tests/
  cache.test.js (53 lines)
  cleanOrphans.test.js (51 lines)
  findCommentRootIndices.test.js (40 lines)
  hoverHelpers.test.js (51 lines)
  importParser.test.js (113 lines)
  itemCache.test.js (68 lines)
  linkifyAndSort.test.js (159 lines)
  migration.test.js (122 lines)
  quotes.test.js (43 lines)
  readComments.test.js (92 lines)
  splitBackticks.test.js (104 lines)
  store.test.js (174 lines)
  tagManagement.test.js (204 lines)
  timeSince.test.js (34 lines)
.gitignore (2 lines)
CLAUDE.md (206 lines)
justfile (15 lines)
package.json (10 lines)
README.md (116 lines)
script.js (3335 lines)
```
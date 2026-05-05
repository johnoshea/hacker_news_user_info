// CSS for the userscript: site-wide legibility tweaks plus our injected UI.
// Tokens (`--colour-hn-orange`, `--gutter`, `--border-radius`) are declared
// on `:root` so feature-specific rules added later can reuse them.
//
// The site-wide block is adapted from
// https://github.com/mgladdish/website-customisations.
export const STYLES = `
    :root {
      --colour-hn-orange: #ff6600;
      --colour-hn-orange-pale: rgba(255, 102, 0, 0.05);
      --gutter: 0.5rem;
      --border-radius: 3px;
    }

    /* Site-wide legibility tweaks, adapted from
       https://github.com/mgladdish/website-customisations. */
    html, body, td, .title, .comment, .default {
      font-family: "Verdana", "Arial", sans-serif;
    }
    html, body { margin-top: 0; }
    body { padding: 0; margin: 0; }
    body, td, .title, .pagetop, .comment { font-size: 1rem; }

    html[op="news"] .title,
    .votelinks,
    .fatitem .title + .votelinks { vertical-align: inherit; }

    .comment-tree .votelinks,
    html[op="threads"] .votelinks,
    html[op="item"] .votelinks,
    xhtml[op="newcomments"] .votelinks { vertical-align: top; }

    span.titleline {
      font-size: 1rem;
      margin-top: var(--gutter);
      margin-bottom: var(--gutter);
      display: block;
    }
    html[op="item"] span.titleline { font-size: 1.2rem; }

    .rank { display: none; }

    html[op="news"]        #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="newest"]      #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="ask"]         #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="newcomments"] #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="shownew"]     #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="submitted"]   #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(1),
    html[op="favorites"]   #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2),
    html[op="front"]       #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2),
    html[op="show"]        #hnmain > tbody:nth-child(1) > tr:nth-child(3) > td:nth-child(1) > table:nth-child(2) {
      margin-left: var(--gutter);
    }

    .sitebit.comhead { margin-left: var(--gutter); }
    .subtext, .subline { font-size: 0.75rem; }

    #hnmain {
      width: 100%;
      background-color: white;
    }
    #hnmain > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) {
      padding: var(--gutter);
    }
    #hnmain > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) {
      padding-right: var(--gutter) !important;
    }

    .comment, .toptext { max-width: 40em; }
    .toptext, a { color: black; }
    a:visited { color: #4c2c92; }
    a:hover { text-decoration: underline; }

    input { padding: var(--gutter); }
    input, textarea {
      background-color: white;
      border: 2px solid var(--colour-hn-orange);
      border-radius: var(--border-radius);
    }
    input[type="button"], input[type="submit"] { cursor: pointer; }

    .downvoted {
      background-color: rgb(245, 245, 245);
      border-radius: var(--border-radius);
      padding: 6px;
    }
    .downvoted .commtext {
      color: black;
      font-size: smaller;
    }

    .quote {
      border-left: 3px solid var(--colour-hn-orange);
      padding: 6px 6px 6px 9px;
      font-style: italic;
      background-color: var(--colour-hn-orange-pale);
      border-radius: var(--border-radius);
    }

    .hidden { display: none; }

    .showComment a,
    .hideComment,
    .hideComment:link,
    .hideComment:visited {
      color: var(--colour-hn-orange);
      text-decoration: underline;
    }
    .hideComment { margin-left: var(--gutter); }

    /* Our own injected UI (account info, custom tags, ratings, toolbar,
       tag-management overlay). The site-wide input padding rule would
       otherwise inflate our compact fields, so the inputs below carry
       tighter padding overrides - but the orange border + radius from
       the site-wide rule are kept on purpose. */

    .hn-post-layout {
      display: grid;
      grid-template-columns: 1fr auto;
      margin: 5px 0;
      width: 100%;
    }
    .comment { padding-top: 10px; }
    /* Hide the stray <br>s HN puts above comment bodies.
       :has() is supported in all current evergreen browsers. */
    br:has(+ div.comment) { display: none; }
    .hn-username {
      font-weight: 700;
      font-size: 1.15em;
      margin-right: 5px;
    }
    .hn-main-row {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      padding-bottom: 2px;
      grid-column: 1;
    }
    .hn-info {
      font-size: 0.8em;
      margin-left: 4px;
      white-space: nowrap;
    }
    .hn-info-pending { opacity: 0.4; }
    .hn-tag-container {
      display: flex;
      flex-direction: column;
      grid-column: 2;
      padding-left: 10px;
      margin-left: 10px;
    }
    .hn-tag-group {
      display: flex;
      flex-direction: column;
    }
    .hn-tag {
      padding: 3px 6px;
      margin-bottom: 3px;
      margin-right: 5px;
      border-radius: 5px;
      font-size: 0.9em;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: fit-content;
    }
    .hn-tag-text { margin-right: 5px; }
    .hn-tag-icons {
      display: flex;
      align-items: center;
    }
    .hn-tag-icon {
      cursor: pointer;
      margin-left: 3px;
      font-size: 0.8em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.3);
    }
    .hn-tag-icon:hover { background-color: rgba(255, 255, 255, 0.6); }
    .hn-tag-input {
      font-size: 0.8em;
      margin-left: 4px;
      width: 250px;
      height: 30px;
      line-height: 30px;
      display: inline-block;
      vertical-align: middle;
      /* Tighter padding than the site-wide rule so the field stays
         compact; the orange border + radius from the site-wide rule
         are kept by design. */
      padding: 0 4px;
    }
    .hn-rating-container {
      margin-left: 4px;
      white-space: nowrap;
      display: flex;
      align-items: center;
    }
    .hn-rating-btn {
      font-size: 0.6em;
      padding: 1px 2px;
      margin-right: 2px;
    }
    .hn-rating-display {
      font-size: 1.3em;
      padding: 0 4px 0 2px;
      color: #575F94;
      font-weight: 700;
    }
    .hn-toolbar {
      position: fixed;
      top: 10px;
      right: 10px;
      background-color: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: 4px;
      padding: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      z-index: 9999;
      display: flex;
      align-items: center;
    }
    .hn-drag-handle {
      width: 12.5px;
      height: 100%;
      background-color: rgba(255, 102, 0, 0.5);
      cursor: move;
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      border-top-left-radius: 3px;
      border-bottom-left-radius: 3px;
    }
    .hn-toolbar-buttons {
      display: flex;
      padding-left: 8px;
    }
    .hn-toolbar-btn {
      background-color: var(--colour-hn-orange);
      color: white;
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      margin: 0 5px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-toolbar-btn:hover { background-color: #ff8533; }
    .hn-tagmgr-catcher {
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: transparent;
    }
    .hn-tagmgr-overlay {
      position: fixed;
      top: 5vh;
      right: 0;
      width: 33vw;
      min-width: 320px;
      height: 90vh;
      background-color: white;
      border: 1px solid var(--colour-hn-orange);
      border-radius: 4px 0 0 4px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      font-size: 0.9em;
    }
    .hn-tagmgr-header {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: bold;
    }
    .hn-tagmgr-header-count { color: #888; font-weight: normal; }
    .hn-tagmgr-controls {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .hn-tagmgr-filter {
      width: 100%;
      padding: 4px 6px;
      box-sizing: border-box;
    }
    .hn-tagmgr-sort { display: flex; gap: 6px; }
    .hn-tagmgr-sort-btn {
      font-size: 0.85em;
      padding: 2px 8px;
      background: #f4f4f4;
      border: 1px solid #ccc;
      border-radius: 3px;
      cursor: pointer;
    }
    .hn-tagmgr-sort-btn.active {
      background: var(--colour-hn-orange);
      color: white;
      border-color: var(--colour-hn-orange);
    }
    .hn-tagmgr-list {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 4px 0;
    }
    .hn-tagmgr-row {
      display: flex;
      align-items: center;
      padding: 4px 12px;
      gap: 8px;
      border-left: 2px solid transparent;
    }
    .hn-tagmgr-row.dirty { border-left-color: var(--colour-hn-orange); }
    .hn-tagmgr-row.removed .hn-tagmgr-name { text-decoration: line-through; }
    .hn-tagmgr-row.removed { opacity: 0.6; }
    .hn-tagmgr-swatch {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      flex: 0 0 12px;
      border: 1px solid rgba(0,0,0,0.1);
    }
    .hn-tagmgr-name {
      flex: 1 1 auto;
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: bold;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hn-tagmgr-name-input {
      flex: 1 1 auto;
      font-size: 1em;
      padding: 1px 5px;
    }
    .hn-tagmgr-count {
      flex: 0 0 auto;
      font-size: 0.85em;
      color: #666;
      min-width: 2em;
      text-align: right;
    }
    .hn-tagmgr-count.zero { color: #bbb; }
    .hn-tagmgr-icons { display: flex; gap: 4px; flex: 0 0 auto; }
    .hn-tagmgr-icon {
      cursor: pointer;
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-size: 0.9em;
    }
    .hn-tagmgr-icon:hover { background: #eee; }
    .hn-tagmgr-footer {
      padding: 8px 12px;
      border-top: 1px solid #eee;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .hn-tagmgr-btn {
      background: white;
      border: 1px solid #ccc;
      border-radius: 3px;
      padding: 5px 14px;
      cursor: pointer;
      font-weight: bold;
    }
    .hn-tagmgr-btn.primary {
      background: var(--colour-hn-orange);
      color: white;
      border-color: var(--colour-hn-orange);
    }
    .hn-tagmgr-btn:hover { filter: brightness(0.95); }

    /* Refined-HN-derived comment-tree tweaks (PR-2). HN's site-wide CSS
       sets .commtext.cdd to grey-on-grey for dead comments; we recolour
       it to a faint red so showdead users can spot them at a glance.
       The indent border puts a 1px shadow on the indent gutter so reply
       depth is visible without counting indents. <pre> and inline
       <code> get a subtle grey background to look like code, matching
       how most readers expect monospace text to render. */
    .commtext.cdd,
    .commtext.cdd * {
      color: #d89899 !important;
    }
    tr.comtr td.ind {
      box-shadow: inset -1px 0 #ccc;
    }
    .hn-clickable-indent {
      cursor: pointer;
    }
    .hn-clickable-indent:hover {
      box-shadow: inset -1px 0 #888;
    }
    div.comment span.commtext pre,
    div.comment span.commtext *:not(pre) > code {
      background: #e4e4e4;
      border-radius: var(--border-radius);
    }
    div.comment span.commtext *:not(pre) > code {
      padding: 0 4px;
      display: inline-block;
    }

    /* OP highlight: the [op] suffix is appended as a text node by
       user-render so the marker is grep-able in the DOM, and the
       .hn-op class colours the whole username (including the suffix)
       in HN orange. */
    .hn-op {
      color: var(--colour-hn-orange) !important;
    }

    /* The collapse-root link sits inline next to "parent | next" in the
       comhead. Match HN's existing comhead link size so it doesn't
       overpower the row. */
    a.hn-collapse-root,
    a.hn-collapse-root:link,
    a.hn-collapse-root:visited {
      color: var(--colour-hn-orange);
      margin-left: 4px;
    }
    a.hn-collapse-root:hover {
      text-decoration: underline;
    }
  `;

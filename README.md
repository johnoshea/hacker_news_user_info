# Hacker News User Info

A userscript that annotates every comment on Hacker News with the author's account age, karma, a personal up/down rating, and custom colored tags.

![match scope: news.ycombinator.com/item?id=*](https://img.shields.io/badge/scope-HN%20comment%20pages-ff6600)

## What it does

On any Hacker News comment page (`news.ycombinator.com/item?id=*`), each commenter's username is augmented with:

- **Account age and karma** pulled from HN's public API, e.g. `(7 years old, 12345 karma)`.
- **Up/down rating buttons** (▲ / ▼) that track your own opinion of the author. The rating is stored locally and persists across visits.
- **A tag input** where you can type comma-separated tags (e.g. `expert, javascript, helpful`). Each tag gets a random pastel color the first time you use it, and reuses the same color for every user you apply it to.
- **A tag list** in the right column showing all tags you've applied to the commenter, each with inline edit and remove icons.

A small draggable toolbar in the top-right corner has **Save state** and **Restore state** buttons for exporting and importing all your data as JSON.

## Install

1. Install a userscript manager:
   - [Violentmonkey](https://violentmonkey.github.io/) (recommended, open source)
   - [Tampermonkey](https://www.tampermonkey.net/)
2. Open [`script.js`](./script.js) in your browser and click the "Install" prompt your manager raises, or copy the file contents into a new script in the manager's dashboard.
3. Visit any HN comment page and the augmentations should appear.

There is no build step. The script is a single file.

## Using it

**Rating a commenter.** Click ▲ or ▼ next to any username. The number updates immediately on every comment by that user on the page. Revisiting the same thread (or any other thread the same person comments on) shows your stored rating.

**Tagging a commenter.** Type into the tag input next to the username, separating tags with commas. Tags are saved automatically after you stop typing for about half a second. Each tag name gets a color the first time you use it anywhere, and that same color is reused for every subsequent use.

**Editing a tag.** Click the ✏️ icon on a tag to rename it. The change applies to every comment by that user on the page.

**Removing a tag.** Click the ✖ icon on a tag to remove it from that user across all their comments on the page.

**Managing all tags.** Click the ☰ icon on any tag to open the tag manager overlay on the right-hand side of the page. It lists every tag you have ever created, sortable by name or by usage count and filterable by substring. From there you can rename a tag (press Enter to commit; renaming to a name that already exists prompts to merge), mark a tag for removal, or undo pending changes on a row. Click **Save** to apply everything at once, or **Cancel** / press **Escape** / click outside the overlay to discard your changes.

**Cross-tab sync.** Rating and tag changes made in one tab are automatically reflected in other open HN tabs.

**Backing up your data.** Click **Save state** in the top-right toolbar. A JSON file downloads containing all your ratings, tags, and tag colors.

**Restoring your data.** Click **Restore state** and pick a previously-exported JSON file. Your current data is replaced and the page reloads.

**Moving the toolbar.** Grab the orange handle on the left edge of the toolbar and drag it.

## Performance notes

User data is fetched from HN's Firebase API, which is one request per unique username. To keep pages snappy even on long threads:

- Every row renders immediately from local state. The `(age, karma)` blurb is a placeholder that gets filled in asynchronously as each fetch lands, so a slow request never blocks anything else.
- Fetched data is cached locally for 6 hours. Once you've seen a commenter recently, subsequent page loads don't hit the network for them at all.
- Each request has an 8-second timeout. A hanging request silently drops its placeholder instead of leaving the row in a loading state forever.

## Privacy

Everything is stored locally in your userscript manager's storage. Nothing is sent anywhere except requests to `hacker-news.firebaseio.com` to fetch public account info for the commenters on the page you're viewing.

## Development

See [CLAUDE.md](./CLAUDE.md) for architecture notes. Common tasks:

```sh
just test   # run the Node test suite (pure logic only)
just lint   # biome lint + autofix
just fmt    # biome format
just check  # lint + format + test
```

Tests cover the pure-logic layer (storage, migration, cache, time formatting, import/export parsing). Rendering and GM_* integration are verified manually in a userscript manager.

# Import validation implementation plan

**Goal:** Reject unrelated or malformed backups before any storage writes.

**Architecture:** A pure import validator checks current and legacy formats at the start of parseImport. Existing conversion runs only on validated input. Toolbar reports validation errors without calling replaceAll.

**Approved rules:** Current exports require users and customTags object maps; watches and storyWatches are optional. Validate every recognized entry, reject mixed formats, preserve legacy numeric-string ratings and embedded JSON, allow extra metadata and structured empty backups. Missing textColor defaults to black. No confirmation or recovery UI in this change.

- [x] Add parser acceptance/rejection cases and a restore-handler test asserting zero writes and unchanged stored data on rejection. Run tests and observe missing-validation failures.
- [x] Implement pure validation in src/import-validation.js, call it from src/state.js, and register it before state.js in scripts/build.js. Give errors field paths; show a no-data-changed message for parse/validation failures only.
- [x] Run focused tests, full tests, Biome, and build. Review the diff and validate bundle syntax.

Validation: 256 tests pass; Biome passes; build regenerated and bundle syntax verified. The pre-change regression run failed because rejected files wrote all three storage keys.

# Bare `just` runs the test suite.
default: test

# Run the Node test suite (pure-logic modules under tests/).
test:
    node --test "tests/*.test.js"

# Lint + format + organize-imports, autofixing; warnings fail. The pre-commit/CI gate.
biome:
    biome check --write --error-on-warnings src/ tests/ scripts/

# Lint only (autofix; warnings fail) — a tighter-loop shortcut for `biome`.
lint:
    biome lint --write --error-on-warnings src/ tests/ scripts/

# Format only — a tighter-loop shortcut for `biome`.
fmt:
    biome format --write src/ tests/ scripts/

# Rebuild the single-file script.js userscript bundle from src/.
build:
    node scripts/build.js

# Full local gate: lint + format + test + build (mirrors what CI runs).
check: biome test build

# Fail if the committed script.js is out of date with src/ (ignoring the @version line).
verify-build:
    #!/usr/bin/env bash
    set -euo pipefail
    node scripts/build.js
    if git diff --exit-code -I '^// @version' -- script.js; then
        git restore --worktree -- script.js
    else
        echo "script.js is out of sync with src/. Run 'just build' and stage script.js." >&2
        exit 1
    fi

# Install the prek git pre-commit hooks (run once per clone).
install-hooks:
    prek install

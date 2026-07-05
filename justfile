default: test

test:
    node --test "tests/*.test.js"

# `biome check` runs lint + format + assist (organize-imports). Mirrors
# what CI runs, so a clean `just check` locally means a clean CI run too.
# `just lint` and `just fmt` are kept as ad-hoc shortcuts for tighter
# loops, but the canonical pre-commit gate is `biome check --write`.
biome:
    biome check --write --error-on-warnings src/ tests/ scripts/

lint:
    biome lint --write --error-on-warnings src/ tests/ scripts/

fmt:
    biome format --write src/ tests/ scripts/

build:
    node scripts/build.js

check: biome test build

# Rebuild script.js and fail if the committed artifact is stale, ignoring the
# @version line (which always lags one commit, exactly as CI's diff does). On a
# clean result the version-only churn is discarded so the working tree is left
# untouched; on a real mismatch script.js is left rebuilt for `git add`.
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

# Install the prek-managed git pre-commit hooks (run once per clone).
install-hooks:
    prek install

default: test

test:
    node --test "tests/*.test.js"

# `biome check` runs lint + format + assist (organize-imports). Mirrors
# what CI runs, so a clean `just check` locally means a clean CI run too.
# `just lint` and `just fmt` are kept as ad-hoc shortcuts for tighter
# loops, but the canonical pre-commit gate is `biome check --write`.
biome:
    biome check --write src/ tests/ scripts/

lint:
    biome lint --write src/ tests/ scripts/

fmt:
    biome format --write src/ tests/ scripts/

build:
    node scripts/build.js

check: biome test build

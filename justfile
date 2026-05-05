default: test

test:
    node --test "tests/*.test.js"

lint:
    biome lint --write src/ tests/ scripts/

fmt:
    biome format --write src/ tests/ scripts/

build:
    node scripts/build.js

check: lint fmt test build

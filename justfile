default: test

test:
    node --test "tests/*.test.js"

lint:
    biome lint --write script.js

fmt:
    biome format --write script.js

check: lint fmt test

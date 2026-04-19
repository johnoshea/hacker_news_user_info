default: test

test:
    node --test "tests/*.test.js"

lint:
    biome lint --write script.js tests/

fmt:
    biome format --write script.js tests/

check: lint fmt test

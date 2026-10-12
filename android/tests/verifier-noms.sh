#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
lexos_test_dir=$(mktemp -d)
trap 'rm -rf "$lexos_test_dir"' EXIT
javac -encoding UTF-8 -d "$lexos_test_dir" app/src/main/java/org/lexos/textes/ProjectNames.java tests/ProjectNamesTest.java
java -cp "$lexos_test_dir" ProjectNamesTest

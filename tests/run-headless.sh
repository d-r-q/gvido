#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/overview-todo-test.XXXXXX")"

install -d -m 700 "$TEST_OUTPUT/run"
mkdir -p "$TEST_OUTPUT/config" "$TEST_OUTPUT/data" "$TEST_OUTPUT/cache"

echo "Тестовые артефакты: $TEST_OUTPUT"

if ! timeout 30s dbus-run-session -- env \
    GSETTINGS_BACKEND=memory \
    XDG_CONFIG_HOME="$TEST_OUTPUT/config" \
    XDG_DATA_HOME="$TEST_OUTPUT/data" \
    XDG_CACHE_HOME="$TEST_OUTPUT/cache" \
    XDG_RUNTIME_DIR="$TEST_OUTPUT/run" \
    OVERVIEW_TODO_TEST_ROOT="$PROJECT_DIR" \
    OVERVIEW_TODO_TEST_OUTPUT="$TEST_OUTPUT" \
    gnome-shell --headless --wayland --virtual-monitor 1000x800 \
        --automation-script "$PROJECT_DIR/tests/probe.js" \
        >"$TEST_OUTPUT/shell.log" 2>&1; then
    echo 'GNOME Shell завершился с ошибкой. Последние строки журнала:' >&2
    tail -n 80 "$TEST_OUTPUT/shell.log" >&2
    exit 1
fi

if ! rg -q 'PROBE COMPLETE' "$TEST_OUTPUT/shell.log"; then
    echo 'Проверки не завершились. Последние строки журнала:' >&2
    tail -n 80 "$TEST_OUTPUT/shell.log" >&2
    exit 1
fi

rg 'PROBE PASS|PROBE COMPLETE' "$TEST_OUTPUT/shell.log"

#!/usr/bin/env bash
set -euo pipefail

UUID=gvido@local
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXTENSIONS_DIR="${OVERVIEW_TODO_EXTENSIONS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions}"
TARGET="$EXTENSIONS_DIR/$UUID"
SOURCE_FILES=(extension.js metadata.json stylesheet.css)
HOT_RELOAD_FILES=(runtime.js config.json theme.css)
NEW_PREFS=0
if [[ -f "$SOURCE_DIR/prefs.js" ]]; then
    SOURCE_FILES+=(prefs.js)
fi
if [[ -f "$SOURCE_DIR/prefs.js" && -d "$TARGET" && ! -f "$TARGET/prefs.js" ]]; then
    NEW_PREFS=1
fi

if [[ ! -f "$SOURCE_DIR/metadata.json" || ! -f "$SOURCE_DIR/extension.js" || ! -f "$SOURCE_DIR/stylesheet.css" ]]; then
    echo "Missing required extension files in $SOURCE_DIR" >&2
    exit 1
fi

metadata_uuid="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["uuid"])' "$SOURCE_DIR/metadata.json")"
if [[ "$metadata_uuid" != "$UUID" ]]; then
    echo "metadata.json UUID is '$metadata_uuid', expected '$UUID'" >&2
    exit 1
fi

mkdir -p "$TARGET"
cp "${SOURCE_FILES[@]/#/$SOURCE_DIR/}" "$TARGET/"

# These files may be edited by the live runtime and are intentionally not
# removed during a code install.  If a source copy exists, update it; otherwise
# keep the installed copy untouched.
for file in "${HOT_RELOAD_FILES[@]}"; do
    if [[ -f "$SOURCE_DIR/$file" ]]; then
        cp "$SOURCE_DIR/$file" "$TARGET/$file"
    fi
done

echo "Installed to $TARGET"
if [[ "$NEW_PREFS" == 1 ]]; then
    echo 'GNOME Shell обнаружит новую кнопку настроек в приложении «Расширения» после выхода из сеанса и повторного входа.'
fi

# A Wayland GNOME Shell discovers extension directories at session start.  Put
# the UUID into its persistent enabled list now; the next login will load it
# even though `gnome-extensions enable` cannot enable an unknown live UUID.
enabled_extensions="$(gsettings get org.gnome.shell enabled-extensions)"
if [[ "$enabled_extensions" != *"'$UUID'"* ]]; then
    gsettings set org.gnome.shell enabled-extensions "${enabled_extensions%]}, '$UUID']"
    echo "Marked $UUID enabled for the next GNOME Shell session"
fi

if gnome-extensions info "$UUID" >/dev/null 2>&1; then
    gnome-extensions enable "$UUID"
    echo "Enabled $UUID in the current GNOME Shell session"
else
    echo "GNOME Shell has not discovered this new directory in the current session."
    echo "Log out and back in; it will load automatically because it is already enabled."
fi

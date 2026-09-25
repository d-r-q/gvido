# Overview Todo — GNOME Shell 50

A light todo/notes card that floats over the top-right corner of GNOME Activities Overview without changing the window/workspace preview layout.

## Features

- Visible in Activities Overview (`Super`)
- Light theme
- Vertical scrolling
- Markdown-like `~/todo.md` storage
- Headings (`#`, `##`, ...)
- Nested tasks (2 spaces per level)
- Add task / heading from the widget
- `Tab` / `Shift+Tab` changes nesting level while editing
- Checkbox completion
- Delete rows with `×`
- Reloads `~/todo.md` each time Overview opens

Use the drag handles to reorder rows.

## Keyboard shortcuts

- Opening Overview focuses the selected row, or the first row if none is selected, without entering edit mode.
- `↑` / `↓`: select the previous or next row; `Enter`: edit it.
- `Alt+↑` / `Alt+↓`: move a task or section. A task can cross a heading into the adjacent section.
- `Ctrl+Enter`: toggle completion of a task, including while editing.
- `Ctrl+Z` / `Ctrl+Shift+Z`: undo or redo text changes while editing a task or heading.
- `Delete`: remove the selected task. Inside the editor, it deletes text as usual.

## File format

```md
# Сейчас
- [ ] Задача
  - [ ] Вложенная задача
  - [x] Готовая задача

## Второй уровень заголовка
- [ ] Ещё задача
```

For headings, `Tab` / `Shift+Tab` changes the number of `#`. For tasks it changes indentation by two spaces.

## Install from the unpacked directory

```bash
./install.sh
```

The installer validates the UUID, copies the extension into the active XDG data directory, and adds it to `org.gnome.shell enabled-extensions`.
It does not remove `runtime.js`, `config.json`, or `theme.css` from an existing installed directory, so hot-reload state survives an update.
On Wayland a newly created extension directory is normally discovered only when the Shell starts, so log out and back in after the first install:

```bash
gnome-extensions info overview-todo@local
```

It should report the extension as enabled; no second `gnome-extensions enable` command is needed.

## Install from ZIP

```bash
gnome-extensions install --force overview-todo@local.shell-extension.zip
gnome-extensions enable overview-todo@local
```

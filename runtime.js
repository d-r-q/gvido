({Clutter, Gio, GLib, St, Main, config, openPreferences, extensionPath}) => {
    const DEFAULTS = {
        dataFile: '~/todo.md',
        defaultContent: '# Сейчас\n- [ ] Первая задача\n  - [ ] Вложенная задача\n\n# Позже\n- [ ] Ещё одна задача\n',
        ui: {
            title: 'Задачи',
            addTaskLabel: 'Задача',
            addHeadingLabel: 'Список',
            addTaskToHeadingLabel: '+',
            newTaskText: 'Новая задача',
            newHeadingText: 'Новый список',
            deleteLabel: '×',
            checkedLabel: '✓',
            dragHandleLabel: '⋮⋮',
        },
        behavior: {
            saveDelayMs: 250,
            maxLevel: 5,
            indentSpaces: 2,
            indentPx: 20,
            reloadTodoOnOverview: true,
            dragThresholdPx: 7,
        },
        layout: {
            margin: 24,
            panelGap: 24,
            widthFraction: 0.30,
            widthMin: 360,
            widthMax: 430,
            heightFraction: 0.64,
            heightMin: 360,
            heightMax: 660,
        },
    };

    function object(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function mergedConfig(raw) {
        const input = object(raw);
        return {
            ...DEFAULTS,
            ...input,
            ui: {...DEFAULTS.ui, ...object(input.ui)},
            behavior: {...DEFAULTS.behavior, ...object(input.behavior)},
            layout: {...DEFAULTS.layout, ...object(input.layout)},
        };
    }

    const cfg = mergedConfig(config);

    function documentTextIcon() {
        const source = Gio.File.new_for_path(`${extensionPath}/document-text-symbolic.svg`);
        const [ok, bytes] = source.load_contents(null);
        if (!ok)
            throw new Error('Could not read document-text-symbolic.svg');
        const svg = new TextDecoder().decode(bytes);
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, svg, -1);
        const cacheDir = Gio.File.new_for_path(GLib.build_filenamev([
            GLib.get_user_cache_dir(), 'gvido', 'icons',
        ]));
        if (!cacheDir.query_exists(null))
            cacheDir.make_directory_with_parents(null);
        const cached = cacheDir.get_child(`document-text-${hash}-symbolic.svg`);
        if (!cached.query_exists(null))
            cached.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
        return new Gio.FileIcon({file: cached});
    }

    let documentTextGicon = documentTextIcon();

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function expandHome(path) {
        if (path === '~')
            return GLib.get_home_dir();
        if (path.startsWith('~/'))
            return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
        return path;
    }

    function indentWidth(text) {
        let width = 0;
        const spaces = Math.max(1, Number(cfg.behavior.indentSpaces) || 2);
        for (const ch of text) {
            if (ch === '\t')
                width += spaces;
            else if (ch === ' ')
                width += 1;
        }
        return width;
    }

    function parseTodo(text) {
        const items = [];
        const spaces = Math.max(1, Number(cfg.behavior.indentSpaces) || 2);
        const maxLevel = Math.max(0, Number(cfg.behavior.maxLevel) || 5);
        let previousTask = null;

        for (const rawLine of text.split(/\r?\n/)) {
            if (!rawLine.trim()) {
                if (previousTask && indentWidth(rawLine) > previousTask.indent) {
                    previousTask.item.text += '\n';
                    continue;
                }
                previousTask = null;
                continue;
            }

            const heading = rawLine.match(/^(#{1,6})\s+(.*)$/);
            if (heading) {
                items.push({
                    type: 'heading',
                    level: clamp(heading[1].length - 1, 0, maxLevel),
                    text: heading[2].trim(),
                });
                previousTask = null;
                continue;
            }

            const task = rawLine.match(/^([ \t]*)-\s+(?:\[([ xX])\]\s+)?(.*)$/);
            if (task) {
                previousTask = {
                    item: {
                        type: 'task',
                        level: clamp(Math.floor(indentWidth(task[1]) / spaces), 0, maxLevel),
                        text: task[3].trim(),
                        done: task[2]?.toLowerCase() === 'x',
                    },
                    indent: indentWidth(task[1]),
                };
                items.push(previousTask.item);
                continue;
            }

            const continuationIndent = rawLine.match(/^([ \t]+)(.*)$/);
            if (previousTask && continuationIndent &&
                indentWidth(continuationIndent[1]) > previousTask.indent) {
                previousTask.item.text += `\n${continuationIndent[2].trim()}`;
                continue;
            }

            // Unknown non-empty Markdown remains visible/editable instead of
            // being discarded. It is normalized to a top-level heading on save.
            items.push({type: 'heading', level: 0, text: rawLine.trim()});
            previousTask = null;
        }

        return items;
    }

    function serializeTodo(items) {
        const lines = [];
        const spaces = ' '.repeat(Math.max(1, Number(cfg.behavior.indentSpaces) || 2));

        items.forEach((item, index) => {
            if (item.type === 'heading') {
                if (index > 0 && items[index - 1].type === 'task')
                    lines.push('');
                lines.push(`${'#'.repeat(item.level + 1)} ${item.text.trim()}`);
            } else {
                const checkbox = item.done ? 'x' : ' ';
                const [firstLine, ...continuationLines] = item.text.trim().split(/\r?\n/);
                lines.push(`${spaces.repeat(item.level)}- [${checkbox}] ${firstLine}`);
                for (const line of continuationLines)
                    lines.push(`${spaces.repeat(item.level + 1)}${line.trim()}`);
            }
        });

        return `${lines.join('\n')}\n`;
    }

    class OverviewTodoRuntime {
        constructor() {
            this._file = null;
            this._items = [];
            this._rowWidgets = [];
            this._selectedIndex = -1;
            this._saveSourceId = 0;
            this._renderSourceId = 0;
            this._overviewShowingId = 0;
            this._overviewShownId = 0;
            this._monitorsChangedId = 0;
            this._card = null;
            this._resizeHandle = null;
            this._resizeCaptureId = 0;
            this._resize = null;
            this._sizeOverride = null;
            this._sizeFile = null;
            this._settingsFile = null;
            this._settingsMonitor = null;
            this._settingsReloadId = 0;
            this._iconMonitor = null;
            this._iconReloadId = 0;
            this._dataPath = cfg.dataFile;
            this._list = null;
            this._scroll = null;
            this._dragCaptureId = 0;
            this._drag = null;
            this._dropIndicatorIndex = -1;
            this._undo = null;
            this._undoSourceId = 0;
            this._actionTooltip = null;
            this._actionTooltipOwner = null;
            this._textHistory = new WeakMap();
            this._editSnapshots = new WeakMap();
            this._newItems = new WeakSet();
            this._restoringText = false;
            this._textSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            this._textScaleChangedId = 0;
            this._contrastSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.interface'});
            this._contrastChangedId = 0;
        }

        enable() {
            this._settingsFile = Gio.File.new_for_path(GLib.build_filenamev([
                GLib.get_user_config_dir(), 'overview-todo-settings.json']));
            this._loadSettings();
            this._file = Gio.File.new_for_path(expandHome(this._dataPath));
            this._sizeFile = Gio.File.new_for_path(GLib.build_filenamev([
                GLib.get_user_config_dir(), 'overview-todo-size.json']));
            this._loadSize();
            this._watchSettings();
            this._watchDocumentIcon();
            this._items = [];
            this._rowWidgets = [];
            this._selectedIndex = -1;
            this._saveSourceId = 0;
            this._renderSourceId = 0;
            this._dragCaptureId = 0;
            this._drag = null;
            this._dropIndicatorIndex = -1;
            this._undo = null;
            this._textHistory = new WeakMap();
            this._editSnapshots = new WeakMap();
            this._newItems = new WeakSet();

            this._ensureFile();
            this._loadItems();
            this._buildUi();
            this._renderItems();

            // overviewGroup is visible only as part of Activities Overview.
            // Adding the card to it overlays workspace/window previews instead
            // of participating in their layout.
            Main.layoutManager.overviewGroup.add_child(this._card);
            Main.layoutManager.overviewGroup.add_child(this._resizeHandle);
            Main.layoutManager.overviewGroup.add_child(this._undoBar);
            this._positionCard();
            this._textScaleChangedId = this._textSettings.connect('changed::text-scaling-factor',
                () => this._positionCard());
            this._contrastChangedId = this._contrastSettings.connect('changed::high-contrast',
                () => this._updateContrast());

            this._overviewShowingId = Main.overview.connect('showing', () => {
                this._flushSave();
                if (cfg.behavior.reloadTodoOnOverview)
                    this._loadItems();
                this._renderItems();
                this._positionCard();
            });
            this._overviewShownId = Main.overview.connect('shown', () => {
                this._focusSelection();
            });

            this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
                this._positionCard();
            });
        }

        disable() {
            this._flushSave();
            this._hideActionTooltip();
            this._cancelDrag();
            this._cancelResize();
            this._settingsMonitor?.cancel();
            this._settingsMonitor = null;
            this._iconMonitor?.cancel();
            this._iconMonitor = null;
            if (this._settingsReloadId) {
                GLib.Source.remove(this._settingsReloadId);
                this._settingsReloadId = 0;
            }
            if (this._iconReloadId) {
                GLib.Source.remove(this._iconReloadId);
                this._iconReloadId = 0;
            }

            if (this._saveSourceId) {
                GLib.Source.remove(this._saveSourceId);
                this._saveSourceId = 0;
            }
            if (this._renderSourceId) {
                GLib.Source.remove(this._renderSourceId);
                this._renderSourceId = 0;
            }
            if (this._undoSourceId) {
                GLib.Source.remove(this._undoSourceId);
                this._undoSourceId = 0;
            }
            if (this._overviewShowingId) {
                Main.overview.disconnect(this._overviewShowingId);
                this._overviewShowingId = 0;
            }
            if (this._overviewShownId) {
                Main.overview.disconnect(this._overviewShownId);
                this._overviewShownId = 0;
            }
            if (this._monitorsChangedId) {
                Main.layoutManager.disconnect(this._monitorsChangedId);
                this._monitorsChangedId = 0;
            }
            if (this._textScaleChangedId) {
                this._textSettings.disconnect(this._textScaleChangedId);
                this._textScaleChangedId = 0;
            }
            if (this._contrastChangedId) {
                this._contrastSettings.disconnect(this._contrastChangedId);
                this._contrastChangedId = 0;
            }

            this._card?.destroy();
            this._resizeHandle?.destroy();
            this._undoBar?.destroy();
            this._card = null;
            this._resizeHandle = null;
            this._undoBar = null;
            this._undoMessage = null;
            this._sizeFile = null;
            this._settingsFile = null;
            this._list = null;
            this._scroll = null;
            this._dragCaptureId = 0;
            this._drag = null;
            this._dropIndicatorIndex = -1;
            this._rowWidgets = [];
            this._items = [];
            this._selectedIndex = -1;
            this._undo = null;
            this._file = null;
        }

        _ensureFile() {
            if (this._file.query_exists(null))
                return;
            this._writeText(cfg.defaultContent);
        }

        _loadItems() {
            try {
                const [ok, bytes] = this._file.load_contents(null);
                if (!ok)
                    return;
                this._items = parseTodo(new TextDecoder().decode(bytes));
            } catch (error) {
                console.error(`[Overview Todo] Could not read ${this._dataPath}: ${error}`);
            }
        }

        _writeText(text) {
            try {
                this._file.replace_contents(
                    new TextEncoder().encode(text),
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null
                );
            } catch (error) {
                console.error(`[Overview Todo] Could not write ${this._dataPath}: ${error}`);
            }
        }

        _scheduleSave() {
            if (this._saveSourceId)
                GLib.Source.remove(this._saveSourceId);

            this._saveSourceId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                Math.max(0, Number(cfg.behavior.saveDelayMs) || 250),
                () => {
                    this._saveSourceId = 0;
                    this._saveNow();
                    return GLib.SOURCE_REMOVE;
                }
            );
        }

        _flushSave() {
            if (!this._saveSourceId)
                return;
            GLib.Source.remove(this._saveSourceId);
            this._saveSourceId = 0;
            this._saveNow();
        }

        _saveNow() {
            if (this._file)
                this._writeText(serializeTodo(this._items));
        }

        _loadSettings() {
            this._dataPath = cfg.dataFile;
            try {
                const [ok, bytes] = this._settingsFile.load_contents(null);
                if (!ok)
                    return;
                const {dataFile} = JSON.parse(new TextDecoder().decode(bytes));
                if (typeof dataFile === 'string' && dataFile.trim() &&
                    GLib.path_is_absolute(expandHome(dataFile)))
                    this._dataPath = dataFile;
            } catch (error) {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    console.error(`[Overview Todo] Could not read settings: ${error}`);
            }
        }

        _watchSettings() {
            try {
                const directory = Gio.File.new_for_path(GLib.get_user_config_dir());
                this._settingsMonitor = directory.monitor_directory(
                    Gio.FileMonitorFlags.WATCH_MOVES, null);
                this._settingsMonitor.connect('changed', (_monitor, file, otherFile) => {
                    const names = [file, otherFile].filter(Boolean)
                        .map(item => item.get_basename());
                    if (!names.some(name => name === 'overview-todo-settings.json' ||
                        name === 'overview-todo-size.json'))
                        return;
                    if (this._settingsReloadId)
                        GLib.Source.remove(this._settingsReloadId);
                    this._settingsReloadId = GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT, 120, () => {
                            this._settingsReloadId = 0;
                            this._applyExternalSettings();
                            return GLib.SOURCE_REMOVE;
                        });
                });
            } catch (error) {
                console.error(`[Overview Todo] Could not watch settings: ${error}`);
            }
        }

        _watchDocumentIcon() {
            try {
                const directory = Gio.File.new_for_path(extensionPath);
                this._iconMonitor = directory.monitor_directory(
                    Gio.FileMonitorFlags.WATCH_MOVES, null);
                this._iconMonitor.connect('changed', (_monitor, file, otherFile) => {
                    if (![file, otherFile].filter(Boolean).some(item =>
                        item.get_basename() === 'document-text-symbolic.svg'))
                        return;
                    if (this._iconReloadId)
                        GLib.Source.remove(this._iconReloadId);
                    this._iconReloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
                        this._iconReloadId = 0;
                        try {
                            const nextIcon = documentTextIcon();
                            if (!documentTextGicon.get_file().equal(nextIcon.get_file())) {
                                documentTextGicon = nextIcon;
                                for (const widgets of this._rowWidgets)
                                    if (widgets.expandTask)
                                        widgets.expandTask.child.gicon = nextIcon;
                            }
                        } catch (error) {
                            console.error(`[Overview Todo] Could not reload document icon: ${error}`);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                });
            } catch (error) {
                console.error(`[Overview Todo] Could not watch document icon: ${error}`);
            }
        }

        _applyExternalSettings() {
            const previousPath = this._dataPath;
            this._loadSettings();
            if (this._dataPath !== previousPath) {
                const nextFile = Gio.File.new_for_path(expandHome(this._dataPath));
                try {
                    nextFile.load_contents(null);
                    this._flushSave();
                    this._file = nextFile;
                    this._items = [];
                    this._selectedIndex = -1;
                    this._loadItems();
                    this._renderItems();
                } catch (error) {
                    console.error(`[Overview Todo] Could not switch to ${this._dataPath}: ${error}`);
                    this._dataPath = previousPath;
                }
            }
            this._loadSize();
            this._positionCard();
        }

        _loadSize() {
            this._sizeOverride = null;
            try {
                const [ok, bytes] = this._sizeFile.load_contents(null);
                if (!ok)
                    return;
                const {width, height} = JSON.parse(new TextDecoder().decode(bytes));
                if (Number.isFinite(width) && width > 0 &&
                    Number.isFinite(height) && height > 0)
                    this._sizeOverride = {width, height};
            } catch (error) {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    console.error(`[Overview Todo] Could not read saved size: ${error}`);
            }
        }

        _saveSize() {
            if (!this._sizeOverride || !this._sizeFile)
                return;
            try {
                this._sizeFile.replace_contents(
                    new TextEncoder().encode(JSON.stringify(this._sizeOverride)),
                    null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            } catch (error) {
                console.error(`[Overview Todo] Could not save size: ${error}`);
            }
        }

        _buildUi() {
            this._card = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                reactive: true,
                can_focus: true,
                style_class: 'overview-todo-card',
            });

            const header = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                style_class: 'overview-todo-toolbar',
            });

            const title = new St.Label({
                text: cfg.ui.title,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style_class: 'overview-todo-title',
            });

            const actions = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'overview-todo-toolbar-actions',
            });

            const addActionContent = label => {
                const content = new St.BoxLayout({
                    y_align: Clutter.ActorAlign.CENTER,
                    style_class: 'overview-todo-action-content',
                });
                content.add_child(new St.Icon({
                    icon_name: 'list-add-symbolic',
                    icon_size: 16,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
                content.add_child(new St.Label({
                    text: label.replace(/^\+\s*/, ''),
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
                return content;
            };

            const addTask = new St.Button({
                child: addActionContent(cfg.ui.addTaskLabel),
                accessible_name: 'Добавить задачу',
                can_focus: true,
                style_class: 'overview-todo-action overview-todo-action-primary',
            });
            addTask.connect('clicked', () => this._addItem('task'));

            const addHeading = new St.Button({
                child: addActionContent(cfg.ui.addHeadingLabel),
                accessible_name: 'Добавить список',
                can_focus: true,
                style_class: 'overview-todo-action overview-todo-action-secondary',
            });
            addHeading.connect('clicked', () => this._addItem('heading'));

            const settingsButton = new St.Button({
                child: new St.Icon({icon_name: 'preferences-system-symbolic', icon_size: 16}),
                accessible_name: 'Настройки виджета',
                can_focus: true,
                style_class: 'overview-todo-action overview-todo-settings-button',
            });
            settingsButton.connect('clicked', () => {
                if (openPreferences) {
                    openPreferences();
                    return;
                }
                // Shell caches hasPrefs when it discovers an extension. A newly
                // installed prefs.js can still be opened before the next login.
                Gio.DBus.session.call(
                    'org.gnome.Shell.Extensions',
                    '/org/gnome/Shell/Extensions',
                    'org.gnome.Shell.Extensions',
                    'OpenExtensionPrefs',
                    new GLib.Variant('(ssa{sv})', ['gvido@local', '', {}]),
                    null, Gio.DBusCallFlags.NONE, -1, null
                ).catch(error => console.error(`[Overview Todo] Could not open preferences: ${error}`));
                Main.overview.hide();
            });

            header.add_child(title);
            actions.add_child(addTask);
            actions.add_child(addHeading);
            actions.add_child(settingsButton);
            header.add_child(actions);

            this._scroll = new St.ScrollView({
                x_expand: true,
                y_expand: true,
                reactive: true,
                overlay_scrollbars: true,
                enable_mouse_scrolling: true,
                style_class: 'overview-todo-scroll',
            });
            this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

            this._list = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                style_class: 'overview-todo-list',
            });
            this._scroll.set_child(this._list);

            this._card.add_child(header);
            this._card.add_child(this._scroll);

            this._undoBar = new St.BoxLayout({
                style_class: 'overview-todo-undo-bar',
                visible: false,
            });
            this._undoMessage = new St.Label({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const undoButton = new St.Button({
                label: 'Отменить',
                accessible_name: 'Отменить удаление',
                can_focus: true,
                style_class: 'overview-todo-undo-button',
            });
            undoButton.connect('clicked', () => this._undoDelete());
            this._undoBar.add_child(this._undoMessage);
            this._undoBar.add_child(undoButton);

            this._resizeHandle = new St.Button({
                label: '⋱',
                accessible_name: 'Изменить размер виджета стрелками',
                reactive: true,
                can_focus: true,
                style_class: 'overview-todo-resize-handle',
            });
            this._resizeHandle.connect('key-press-event', (_actor, event) =>
                this._handleResizeKey(event));
            this._resizeHandle.connect('button-press-event', (_actor, event) => {
                if (event.get_button() !== 1)
                    return Clutter.EVENT_PROPAGATE;
                this._beginResize(...event.get_coords());
                return Clutter.EVENT_STOP;
            });
            this._updateContrast();
        }

        _updateContrast() {
            const highContrast = this._contrastSettings.get_boolean('high-contrast');
            for (const actor of [this._card, this._undoBar, this._resizeHandle]) {
                if (!actor)
                    continue;
                if (highContrast)
                    actor.add_style_class_name('high-contrast');
                else
                    actor.remove_style_class_name('high-contrast');
            }
        }

        _positionCard() {
            if (!this._card || this._card.get_stage() !== global.stage)
                return;

            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor)
                return;

            const layout = cfg.layout;
            const textScale = Math.max(1, this._textSettings.get_double('text-scaling-factor'));
            const margin = Math.max(0, Number(layout.margin) || 0);
            const panelGap = Math.max(0, Number(layout.panelGap) || 0);
            const panelHeight = Math.max(Main.layoutManager.panelBox.height || 0, 0);

            const defaultWidth = Math.round(clamp(
                monitor.width * Number(layout.widthFraction || 0.30) * textScale,
                Number(layout.widthMin || 330) * textScale,
                Number(layout.widthMax || 430) * textScale
            ));

            const availableWidth = Math.max(1, monitor.width - margin * 2);
            const availableHeight = Math.max(1,
                monitor.height - panelHeight - panelGap - margin * 2);
            const maxHeight = Math.round(clamp(
                monitor.height * Number(layout.heightFraction || 0.64),
                Number(layout.heightMin || 360),
                Math.min(Number(layout.heightMax || 660), availableHeight)
            ));

            const width = Math.round(clamp(this._sizeOverride?.width ?? defaultWidth,
                Math.min(Number(layout.widthMin || 330) * textScale, availableWidth),
                availableWidth));
            const listHeight = this._list?.get_preferred_height(Math.max(1, width - 40))[1] || 0;
            const naturalHeight = listHeight + 92;
            const height = Math.round(clamp(this._sizeOverride?.height ?? naturalHeight,
                Math.min(150, availableHeight),
                this._sizeOverride ? availableHeight : maxHeight));

            this._card.set_size(width, height);
            this._card.set_position(
                monitor.x + monitor.width - width - margin,
                monitor.y + panelHeight + panelGap
            );
            this._resizeHandle?.set_position(
                monitor.x + monitor.width - width - margin + 5,
                monitor.y + panelHeight + panelGap + height - 23);
            const undoWidth = Math.min(width - 36, 260);
            this._undoBar?.set_size(undoWidth, 40);
            this._undoBar?.set_position(
                monitor.x + monitor.width - margin - (width + undoWidth) / 2,
                monitor.y + panelHeight + panelGap + height - 54);
        }

        _beginResize(x, y) {
            this._cancelResize();
            this._resize = {
                pressX: x,
                pressY: y,
                width: this._card.width,
                height: this._card.height,
            };
            this._resizeCaptureId = global.stage.connect('captured-event', (_stage, event) => {
                if (event.type() === Clutter.EventType.MOTION) {
                    const [px, py] = event.get_coords();
                    this._sizeOverride = {
                        width: this._resize.width + this._resize.pressX - px,
                        height: this._resize.height + py - this._resize.pressY,
                    };
                    this._positionCard();
                    return Clutter.EVENT_STOP;
                }
                if (event.type() === Clutter.EventType.BUTTON_RELEASE &&
                    event.get_button() === 1) {
                    this._cancelResize();
                    this._saveSize();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _handleResizeKey(event) {
            const step = event.get_state() & Clutter.ModifierType.SHIFT_MASK ? 1 : 10;
            const symbol = event.get_key_symbol();
            let width = this._card.width;
            let height = this._card.height;
            if (symbol === Clutter.KEY_Left)
                width += step;
            else if (symbol === Clutter.KEY_Right)
                width -= step;
            else if (symbol === Clutter.KEY_Up)
                height -= step;
            else if (symbol === Clutter.KEY_Down)
                height += step;
            else
                return Clutter.EVENT_PROPAGATE;

            this._sizeOverride = {width, height};
            this._positionCard();
            this._saveSize();
            return Clutter.EVENT_STOP;
        }

        _cancelResize() {
            if (this._resizeCaptureId) {
                global.stage.disconnect(this._resizeCaptureId);
                this._resizeCaptureId = 0;
            }
            this._resize = null;
        }

        _renderItems() {
            if (!this._list)
                return;

            this._hideActionTooltip();

            if (this._selectedIndex >= this._items.length)
                this._selectedIndex = this._items.length - 1;

            for (const child of this._list.get_children())
                child.destroy();

            this._rowWidgets = [];

            this._items.forEach((item, index) => {
                const row = new St.BoxLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    x_expand: true,
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                    style_class: 'overview-todo-row',
                    style: `margin-left: ${item.level * Math.max(0, Number(cfg.behavior.indentPx) || 0)}px; min-height: 38px;`,
                });

                if (index === this._selectedIndex)
                    row.add_style_class_name('selected');
                const selectionMark = new St.Widget({
                    opacity: index === this._selectedIndex ? 255 : 0,
                    style_class: 'overview-todo-selection-mark',
                });
                row.add_child(new St.Bin({
                    child: selectionMark,
                    y_align: Clutter.ActorAlign.START,
                    x_align: Clutter.ActorAlign.CENTER,
                    style_class: 'overview-todo-selection-slot',
                }));
                row.connect('notify::hover', () => {
                    this._updateDeleteVisibility(index);
                    this._updateRowActionStyles(index);
                });
                row.connect('key-focus-in', () => this._selectItem(index));
                row.connect('key-press-event', (_actor, event) =>
                    entryText.has_key_focus()
                        ? Clutter.EVENT_PROPAGATE
                        : this._handleRowKey(index, event));
                row.connect('button-press-event', (_actor, event) => {
                    if (event.get_button() === 1 && event.get_source() === row)
                        this._selectItem(index, true);
                    return Clutter.EVENT_PROPAGATE;
                });

                if (item.type === 'heading' &&
                    index > 0 &&
                    this._items[index - 1].type === 'task') {
                    row.add_style_class_name('overview-todo-heading-after-task');
                }

                const dragHandle = new St.Button({
                    child: new St.Icon({icon_name: 'list-drag-handle-symbolic', icon_size: 16}),
                    accessible_name: 'Переместить выше или ниже стрелками вверх и вниз',
                    can_focus: true,
                    reactive: true,
                    y_align: Clutter.ActorAlign.START,
                    translation_y: 6,
                    style_class: 'overview-todo-drag-handle',
                });
                dragHandle.connect('key-focus-in', () => this._selectItem(index));
                dragHandle.connect('key-press-event', (_actor, event) =>
                    this._handleDragHandleKey(index, event));
                this._bindActionTooltip(dragHandle);
                // DnD is deliberately optional at row-construction time: if a
                // future Shell changes this low-level event API, the todo widget
                // must still render and remain usable instead of disappearing.
                try {
                    dragHandle.connect('button-press-event', (_actor, event) => {
                        if (event.get_button() !== 1)
                            return Clutter.EVENT_PROPAGATE;
                        this._selectItem(index);
                        const [x, y] = event.get_coords();
                        this._beginDrag(index, x, y);
                        return Clutter.EVENT_STOP;
                    });
                } catch (error) {
                    console.error(`[Overview Todo] DnD handle disabled for row ${index}: ${error}`);
                    dragHandle.reactive = false;
                }
                row.add_child(dragHandle);

                let expandList = null;
                if (item.type === 'heading' && this._blockRange(index).end > index + 1) {
                    expandList = new St.Button({
                        child: new St.Icon({
                            icon_name: item.listCollapsed ? 'pan-end-symbolic' : 'pan-down-symbolic',
                            icon_size: 16,
                        }),
                        accessible_name: item.listCollapsed ? 'Показать список' : 'Свернуть список',
                        can_focus: true,
                        y_align: Clutter.ActorAlign.START,
                        translation_y: 6,
                        style_class: 'overview-todo-expand overview-todo-list-toggle',
                    });
                    expandList.connect('key-focus-in', () => this._selectItem(index));
                    this._bindActionTooltip(expandList);
                    expandList.connect('clicked', () => {
                        this._selectItem(index);
                        item.listCollapsed = !item.listCollapsed;
                        expandList.child.icon_name = item.listCollapsed
                            ? 'pan-end-symbolic' : 'pan-down-symbolic';
                        expandList.accessible_name = item.listCollapsed
                            ? 'Показать список' : 'Свернуть список';
                        if (expandList.hover)
                            this._showActionTooltip(expandList);
                        this._updateFoldVisibility();
                        this._positionCard();
                    });
                    row.add_child(expandList);
                }
                if (item.type === 'heading' && !expandList) {
                    row.add_child(new St.Bin({
                        y_align: Clutter.ActorAlign.START,
                        style_class: 'overview-todo-children-slot',
                    }));
                }

                let expandChildren = null;
                if (item.type === 'task' && this._blockRange(index).end > index + 1) {
                    expandChildren = new St.Button({
                        child: new St.Icon({
                            icon_name: item.childrenCollapsed ? 'pan-end-symbolic' : 'pan-down-symbolic',
                            icon_size: 16,
                        }),
                        accessible_name: item.childrenCollapsed
                            ? 'Показать подзадачи' : 'Свернуть подзадачи',
                        can_focus: true,
                        y_align: Clutter.ActorAlign.START,
                        translation_y: 6,
                        style_class: 'overview-todo-expand overview-todo-children-toggle',
                    });
                    expandChildren.connect('key-focus-in', () => this._selectItem(index));
                    this._bindActionTooltip(expandChildren);
                    expandChildren.connect('clicked', () => {
                        this._selectItem(index);
                        item.childrenCollapsed = !item.childrenCollapsed;
                        expandChildren.child.icon_name = item.childrenCollapsed
                            ? 'pan-end-symbolic' : 'pan-down-symbolic';
                        expandChildren.accessible_name = item.childrenCollapsed
                            ? 'Показать подзадачи' : 'Свернуть подзадачи';
                        if (expandChildren.hover)
                            this._showActionTooltip(expandChildren);
                        this._updateFoldVisibility();
                        this._positionCard();
                    });
                }
                if (item.type === 'task') {
                    row.add_child(expandChildren || new St.Bin({
                        y_align: Clutter.ActorAlign.START,
                        style_class: 'overview-todo-children-slot',
                    }));
                }

                let checkbox = null;
                if (item.type === 'task') {
                    const checkIcon = new St.Icon({
                        icon_name: 'object-select-symbolic',
                        icon_size: 10,
                        opacity: item.done ? 255 : 0,
                    });
                    const checkIndicator = new St.Bin({
                        child: checkIcon,
                        style_class: `overview-todo-check-indicator${item.done ? ' checked' : ''}`,
                    });
                    checkbox = new St.Button({
                        child: checkIndicator,
                        accessible_name: item.done ? 'Отметить невыполненной' : 'Отметить выполненной',
                        can_focus: true,
                        y_align: Clutter.ActorAlign.START,
                        translation_y: 6,
                        style_class: 'overview-todo-check-hit',
                    });
                    checkbox.connect('key-focus-in', () => this._selectItem(index));
                    checkbox.connect('clicked', () => this._toggleTask(index));
                    row.add_child(checkbox);
                }

                const taskLines = item.type === 'task' ? item.text.split(/\r?\n/) : [];
                const taskHasMultipleLines = item.type === 'task' &&
                    taskLines.filter(line => line.trim()).length >= 2;
                let isCollapsedTask = taskHasMultipleLines && !item.expanded;
                let updatingEntry = false;
                const entry = new St.Label({
                    text: isCollapsedTask ? item.text.split(/\r?\n/, 1)[0] : item.text,
                    reactive: true,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.START,
                    style_class: this._entryClass(item),
                });
                const entryText = entry.get_clutter_text();
                entryText.editable = true;
                entryText.reactive = true;
                entryText.can_focus = true;
                entryText.set_single_line_mode(item.type !== 'task');
                entryText.set_line_wrap(true);
                // Zero is Pango.EllipsizeMode.NONE; otherwise St.Label clips wrapped text.
                if (item.type === 'task')
                    entryText.set_ellipsize(0);
                let preview = null;
                const setEditing = editing => {
                    const showPreview = !editing && item.type === 'task';
                    entry.visible = !showPreview;
                    if (preview)
                        preview.visible = showPreview;
                    this._updateRowHeight(index);
                };
                entryText.connect('key-focus-in', () => {
                    this._selectItem(index);
                    const history = this._textHistory.get(item);
                    if (!this._editSnapshots.has(item)) {
                        this._editSnapshots.set(item, {
                            text: item.text,
                            level: item.level,
                            expanded: item.expanded,
                            history: history ? {
                                undo: [...history.undo],
                                redo: [...history.redo],
                                lastChange: history.lastChange,
                            } : null,
                        });
                    }
                    if (history)
                        history.lastChange = null;
                    setEditing(true);
                    entry.add_style_pseudo_class('focus');
                });
                entryText.connect('key-focus-out', () => {
                    const history = this._textHistory.get(item);
                    if (history)
                        history.lastChange = null;
                    entry.remove_style_pseudo_class('focus');
                    const switcher = Main.panel.statusArea.keyboard
                        ?._inputSourceManager?._switcherPopup;
                    if (switcher) {
                        // The input-source switcher temporarily takes the
                        // keyboard grab. Hiding the editor here prevents
                        // GNOME from restoring its previous focus.
                        switcher.connect('destroy', () => {
                            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                if (this._card && Main.overview.visible &&
                                    this._rowWidgets.some(w => w.entryText === entryText)) {
                                    setEditing(true);
                                    entryText.grab_key_focus();
                                }
                                return GLib.SOURCE_REMOVE;
                            });
                        });
                    } else {
                        this._newItems.delete(item);
                        setEditing(false);
                        this._flushSave();
                        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                            const currentIndex = this._items.indexOf(item);
                            if (!this._rowWidgets[currentIndex]?.entryText.has_key_focus())
                                this._editSnapshots.delete(item);
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                });
                // Theme colors have the native color type required by this
                // Shell version (Cogl.Color in GNOME 50). St.Label does not
                // apply selection colors to its editable Clutter.Text itself.
                entry.connect('style-changed', () => {
                    const theme = entry.get_theme_node();
                    entryText.set_selection_color(theme.get_color('selection-background-color'));
                    entryText.set_selected_text_color(theme.get_color('selected-color'));
                });
                entry.connect('button-press-event', () => {
                    entryText.grab_key_focus();
                    return Clutter.EVENT_PROPAGATE;
                });

                entryText.connect('text-changed', () => {
                    if (updatingEntry || this._restoringText)
                        return;
                    this._newItems.delete(item);
                    const previousText = item.text;
                    if (isCollapsedTask) {
                        const lines = item.text.split(/\r?\n/);
                        lines[0] = entryText.get_text();
                        item.text = lines.join('\n');
                    } else {
                        item.text = entryText.get_text();
                    }
                    if (item.text !== previousText)
                        this._recordTextChange(item, previousText, item.text,
                            entryText.get_cursor_position(), entryText.get_selection_bound());
                    // Update controls in place as the comment is typed. A
                    // rebuild on the first newline loses the caret and misses
                    // the later transition from an empty line to a comment.
                    if (item.type === 'task' && !isCollapsedTask)
                        item.expanded = item.text.includes('\n');
                    this._updateRowAppearance(index);
                    this._positionCard();
                    this._scheduleSave();
                });

                entryText.connect('key-press-event', (_actor, event) => {
                    if (this._handleEditorShortcut(index, event, entryText) === Clutter.EVENT_STOP)
                        return Clutter.EVENT_STOP;
                    const symbol = event.get_key_symbol();
                    const state = event.get_state();
                    const isEnter = symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter;
                    const shiftPressed = Boolean(state & Clutter.ModifierType.SHIFT_MASK);
                    if (isEnter && shiftPressed && item.type === 'task') {
                        if (isCollapsedTask) {
                            const previousText = item.text;
                            const cursor = entryText.get_cursor_position();
                            const lines = item.text.split(/\r?\n/);
                            lines[0] = `${lines[0].slice(0, cursor)}\n${lines[0].slice(cursor)}`;
                            item.text = lines.join('\n');
                            this._recordTextChange(item, previousText, item.text, cursor, cursor);
                            item.expanded = true;
                            this._scheduleSave();
                            this._queueRender(index);
                            return Clutter.EVENT_STOP;
                        }
                        return Clutter.EVENT_PROPAGATE;
                    }

                    if (isEnter) {
                        this._newItems.delete(item);
                        this._editSnapshots.delete(item);
                        this._flushSave();
                        this._selectItem(index, true);
                        return Clutter.EVENT_STOP;
                    }

                    const isTab = symbol === Clutter.KEY_Tab || symbol === Clutter.KEY_ISO_Left_Tab;
                    if (!isTab)
                        return Clutter.EVENT_PROPAGATE;

                    const backwards = symbol === Clutter.KEY_ISO_Left_Tab ||
                        Boolean(state & Clutter.ModifierType.SHIFT_MASK);
                    this._newItems.delete(item);
                    this._changeItemLevel(index, backwards ? -1 : 1);
                    return Clutter.EVENT_STOP;
                });

                const content = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.START,
                });
                content.add_child(entry);
                let previewTitle = null;
                let previewComment = null;
                if (item.type === 'task') {
                    const previewContent = new St.BoxLayout({
                        orientation: Clutter.Orientation.VERTICAL,
                        x_expand: true,
                        style_class: 'overview-todo-preview-content',
                    });
                    previewTitle = new St.Label({x_expand: true});
                    previewComment = new St.Label({
                        x_expand: true,
                        style_class: 'overview-todo-comment',
                    });
                    previewTitle.clutter_text.set_line_wrap(true);
                    previewTitle.clutter_text.set_ellipsize(0);
                    previewComment.clutter_text.set_line_wrap(true);
                    previewContent.add_child(previewTitle);
                    previewContent.add_child(previewComment);
                    preview = new St.Button({
                        child: previewContent,
                        x_expand: true,
                        can_focus: true,
                        style_class: 'overview-todo-preview',
                        accessible_name: 'Редактировать задачу и комментарий',
                    });
                    preview.connect('key-focus-in', () => this._selectItem(index));
                    preview.connect('clicked', () => {
                        setEditing(true);
                        entryText.grab_key_focus();
                        entryText.set_selection(-1, -1);
                    });
                    content.add_child(preview);
                }
                let expandTask = null;
                if (item.type === 'task') {
                    expandTask = new St.Button({
                        child: new St.Icon({
                            gicon: documentTextGicon,
                            icon_size: 16,
                            x_align: Clutter.ActorAlign.CENTER,
                            y_align: Clutter.ActorAlign.CENTER}),
                        accessible_name: item.expanded ? 'Свернуть комментарий' : 'Показать комментарий',
                        can_focus: true,
                        y_align: Clutter.ActorAlign.START,
                        style_class: 'overview-todo-expand overview-todo-comment-toggle',
                    });
                    expandTask.connect('key-focus-in', () => this._selectItem(index));
                    this._bindActionTooltip(expandTask);
                    expandTask.connect('clicked', () => {
                        this._selectItem(index);
                        if (entryText.has_key_focus())
                            expandTask.grab_key_focus();
                        item.expanded = !item.expanded;
                        isCollapsedTask = item.text.split(/\r?\n/)
                            .filter(line => line.trim()).length >= 2 && !item.expanded;
                        updatingEntry = true;
                        entryText.set_text(isCollapsedTask
                            ? item.text.split(/\r?\n/, 1)[0] : item.text);
                        updatingEntry = false;
                        this._updateRowAppearance(index);
                        if (expandTask.hover)
                            this._showActionTooltip(expandTask);
                        this._positionCard();
                    });
                }
                row.add_child(content);
                if (expandTask) {
                    row.add_child(new St.Bin({
                        child: expandTask,
                        y_align: Clutter.ActorAlign.START,
                        style_class: 'overview-todo-comment-slot',
                    }));
                }

                let addSubtask = null;
                if (item.type === 'task' && item.level <
                    Math.max(0, Number(cfg.behavior.maxLevel) || 5)) {
                    addSubtask = new St.Button({
                        child: new St.Icon({icon_name: 'list-add-symbolic', icon_size: 16,
                            x_align: Clutter.ActorAlign.CENTER,
                            y_align: Clutter.ActorAlign.CENTER}),
                        accessible_name: 'Добавить подзадачу',
                        can_focus: true,
                        y_align: Clutter.ActorAlign.START,
                        translation_y: 6,
                        style_class: 'overview-todo-expand overview-todo-add-subtask',
                    });
                    addSubtask.connect('key-focus-in', () => this._selectItem(index));
                    this._bindActionTooltip(addSubtask);
                    addSubtask.connect('clicked', () => this._addSubtask(index));
                    row.add_child(addSubtask);
                }
                if (item.type === 'task' && !addSubtask) {
                    row.add_child(new St.Bin({
                        y_align: Clutter.ActorAlign.START,
                        style_class: 'overview-todo-add-subtask-slot',
                    }));
                }

                let addTaskToHeading = null;
                if (item.type === 'heading') {
                    addTaskToHeading = new St.Button({
                        child: new St.Icon({icon_name: 'list-add-symbolic', icon_size: 16,
                            x_align: Clutter.ActorAlign.CENTER,
                            y_align: Clutter.ActorAlign.CENTER}),
                        accessible_name: 'Добавить задачу в список',
                        can_focus: true,
                        y_align: Clutter.ActorAlign.START,
                        translation_y: 6,
                        style_class: 'overview-todo-add-to-heading',
                    });
                    this._bindActionTooltip(addTaskToHeading);
                    addTaskToHeading.connect('key-focus-in', () => this._selectItem(index));
                    addTaskToHeading.connect('clicked', () => this._addTaskToHeading(index));
                    row.add_child(addTaskToHeading);
                }

                const removeIcon = new St.Icon({icon_name: 'user-trash-symbolic', icon_size: 16,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER});
                const remove = new St.Button({
                    child: removeIcon,
                    accessible_name: 'Удалить',
                    can_focus: true,
                    y_align: Clutter.ActorAlign.START,
                    translation_y: 6,
                    style_class: 'overview-todo-delete',
                });
                remove.connect('key-focus-in', () => {
                    this._selectItem(index);
                    this._updateDeleteVisibility(index);
                });
                remove.connect('key-focus-out', () => this._updateDeleteVisibility(index));
                remove.connect('clicked', () => this._deleteItem(index));
                row.add_child(remove);

                this._list.add_child(row);
                this._rowWidgets[index] = {row, selectionMark, entry, entryText, checkbox, dragHandle,
                    expandTask, expandChildren, expandList, preview, previewTitle, previewComment,
                    addSubtask, addTaskToHeading, remove, setEditing};
                entry.connect('notify::height', () => this._updateRowHeight(index));
                previewTitle?.connect('notify::height', () => this._updateRowHeight(index));
                previewComment?.connect('notify::height', () => this._updateRowHeight(index));
                this._updateRowAppearance(index);
                this._updateDeleteVisibility(index);
                this._updateRowActionStyles(index);
            });
            this._updateFoldVisibility();
            this._positionCard();
            const rows = this._rowWidgets;
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._rowWidgets === rows && this._card?.get_stage()) {
                    rows.forEach((_, index) => this._updateRowHeight(index));
                    this._positionCard();
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        _bindActionTooltip(button) {
            button.connect('notify::hover', () => {
                if (button.hover)
                    this._showActionTooltip(button);
                else if (this._actionTooltipOwner === button)
                    this._hideActionTooltip();
            });
        }

        _showActionTooltip(button) {
            this._hideActionTooltip();
            const tooltip = new St.Label({
                text: button.accessible_name,
                style_class: 'overview-todo-tooltip',
            });
            Main.layoutManager.overviewGroup.add_child(tooltip);
            const [x, y] = button.get_transformed_position();
            const [, height] = button.get_transformed_size();
            const width = tooltip.get_preferred_width(-1)[1];
            const monitor = Main.layoutManager.primaryMonitor;
            tooltip.set_position(clamp(x, monitor.x,
                monitor.x + monitor.width - width), y + height + 4);
            this._actionTooltip = tooltip;
            this._actionTooltipOwner = button;
        }

        _hideActionTooltip() {
            this._actionTooltip?.destroy();
            this._actionTooltip = null;
            this._actionTooltipOwner = null;
        }

        _updateFoldVisibility() {
            const collapsedEnds = [];
            this._items.forEach((item, index) => {
                while (collapsedEnds.length && index >= collapsedEnds.at(-1))
                    collapsedEnds.pop();
                const row = this._rowWidgets[index]?.row;
                if (row)
                    row.visible = collapsedEnds.length === 0;
                if (item.type === 'heading' && item.listCollapsed ||
                    item.type === 'task' && item.childrenCollapsed) {
                    const end = this._blockRange(index).end;
                    if (end > index + 1)
                        collapsedEnds.push(end);
                }
            });
        }

        _blockRange(index) {
            const item = this._items[index];
            if (!item)
                return {start: index, end: index};

            let end = index + 1;
            if (item.type === 'task') {
                while (end < this._items.length) {
                    const next = this._items[end];
                    if (next.type !== 'task' || next.level <= item.level)
                        break;
                    end += 1;
                }
            } else {
                while (end < this._items.length) {
                    const next = this._items[end];
                    if (next.type === 'heading' && next.level <= item.level)
                        break;
                    end += 1;
                }
            }

            return {start: index, end};
        }

        _beginDrag(index, x, y) {
            this._cancelDrag();

            const range = this._blockRange(index);
            this._drag = {
                sourceIndex: index,
                sourceStart: range.start,
                sourceEnd: range.end,
                pressX: x,
                pressY: y,
                active: false,
                insertIndex: null,
            };

            try {
                this._dragCaptureId = global.stage.connect('captured-event', (_stage, event) => {
                    const type = event.type();

                    if (type === Clutter.EventType.MOTION) {
                        const [px, py] = event.get_coords();
                        const threshold = Math.max(1, Number(cfg.behavior.dragThresholdPx) || 7);

                        if (!this._drag.active &&
                            Math.hypot(px - this._drag.pressX, py - this._drag.pressY) >= threshold) {
                            this._drag.active = true;
                            this._setDraggedRowsOpacity(120);
                        }

                        if (this._drag.active) {
                            this._autoScrollForDrag(py);
                            this._setDropInsertion(this._findDropInsertion(py));
                        }
                        return Clutter.EVENT_STOP;
                    }

                    if (type === Clutter.EventType.BUTTON_RELEASE && event.get_button() === 1) {
                        if (this._drag.active && this._drag.insertIndex !== null)
                            this._finishDrag();
                        else
                            this._cancelDrag();
                        return Clutter.EVENT_STOP;
                    }

                    return this._drag.active ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                });
            } catch (error) {
                console.error(`[Overview Todo] Could not start DnD: ${error}`);
                this._drag = null;
            }
        }

        _setDraggedRowsOpacity(opacity) {
            if (!this._drag)
                return;
            for (let i = this._drag.sourceStart; i < this._drag.sourceEnd; i++)
                this._rowWidgets[i]?.row.set_opacity(opacity);
        }

        _autoScrollForDrag(stageY) {
            if (!this._scroll)
                return;

            const [, scrollY] = this._scroll.get_transformed_position();
            const [, scrollHeight] = this._scroll.get_transformed_size();
            const edge = 36;
            const adjustment = this._scroll.get_vadjustment();
            if (!adjustment)
                return;

            if (stageY < scrollY + edge)
                adjustment.set_value(adjustment.get_value() - 18);
            else if (stageY > scrollY + scrollHeight - edge)
                adjustment.set_value(adjustment.get_value() + 18);
        }

        _findDropInsertion(stageY) {
            if (!this._items.length)
                return 0;

            for (let i = 0; i < this._rowWidgets.length; i++) {
                const row = this._rowWidgets[i]?.row;
                if (!row?.visible)
                    continue;

                const [, rowY] = row.get_transformed_position();
                const [, rowHeight] = row.get_transformed_size();
                if (stageY < rowY + rowHeight / 2)
                    return i;
                if (stageY <= rowY + rowHeight)
                    return this._blockRange(i).end;
            }

            return this._items.length;
        }

        _setDropInsertion(insertIndex) {
            if (!this._drag)
                return;

            const {sourceStart, sourceEnd} = this._drag;
            // Inserting anywhere inside the dragged block, or immediately after
            // it, leaves the list unchanged after removal.
            if (insertIndex >= sourceStart && insertIndex <= sourceEnd)
                insertIndex = null;

            if (this._drag.insertIndex === insertIndex)
                return;

            this._clearDropIndicator();
            this._drag.insertIndex = insertIndex;
            if (insertIndex === null)
                return;

            if (insertIndex < this._rowWidgets.length) {
                const target = this._rowWidgets[insertIndex]?.row;
                if (target?.visible) {
                    target.add_style_class_name('overview-todo-drop-before');
                    this._dropIndicatorIndex = insertIndex;
                }
            } else if (this._rowWidgets.length) {
                for (let last = this._rowWidgets.length - 1; last >= 0; last--) {
                    const row = this._rowWidgets[last]?.row;
                    if (row?.visible) {
                        row.add_style_class_name('overview-todo-drop-after');
                        this._dropIndicatorIndex = last;
                        break;
                    }
                }
            }
        }

        _clearDropIndicator() {
            if (this._dropIndicatorIndex >= 0) {
                const row = this._rowWidgets[this._dropIndicatorIndex]?.row;
                row?.remove_style_class_name('overview-todo-drop-before');
                row?.remove_style_class_name('overview-todo-drop-after');
            }
            this._dropIndicatorIndex = -1;
        }

        _finishDrag() {
            const drag = this._drag;
            if (!drag || drag.insertIndex === null) {
                this._cancelDrag();
                return;
            }

            const count = drag.sourceEnd - drag.sourceStart;
            const moved = this._items.splice(drag.sourceStart, count);
            let insertIndex = drag.insertIndex;
            if (insertIndex > drag.sourceStart)
                insertIndex -= count;
            insertIndex = clamp(insertIndex, 0, this._items.length);
            this._items.splice(insertIndex, 0, ...moved);

            this._cancelDrag();
            this._scheduleSave();
            this._selectedIndex = insertIndex;
            this._queueRender(-1, false, insertIndex);
        }

        _cancelDrag() {
            if (this._dragCaptureId) {
                global.stage.disconnect(this._dragCaptureId);
                this._dragCaptureId = 0;
            }

            this._clearDropIndicator();
            if (this._drag)
                this._setDraggedRowsOpacity(255);
            this._drag = null;
        }

        _selectItem(index, focus = false) {
            if (index < 0 || index >= this._items.length)
                return;

            const previousIndex = this._selectedIndex;
            this._rowWidgets[this._selectedIndex]?.row
                .remove_style_class_name('selected');
            const previousMark = this._rowWidgets[this._selectedIndex]?.selectionMark;
            if (previousMark)
                previousMark.opacity = 0;
            this._selectedIndex = index;
            this._updateDeleteVisibility(previousIndex);
            this._updateRowActionStyles(previousIndex);
            const row = this._rowWidgets[index]?.row;
            row?.add_style_class_name('selected');
            if (this._rowWidgets[index]?.selectionMark)
                this._rowWidgets[index].selectionMark.opacity = 255;
            this._updateDeleteVisibility(index);
            this._updateRowActionStyles(index);
            if (focus && row) {
                row.grab_key_focus();
                this._ensureSelectionVisible(row);
            }
        }

        _updateDeleteVisibility(index) {
            const widgets = this._rowWidgets[index];
            if (widgets?.remove)
                widgets.remove.opacity = widgets.row.hover || widgets.remove.has_key_focus()
                    ? 255 : 0;
        }

        _updateRowActionStyles(index) {
            const widgets = this._rowWidgets[index];
            if (!widgets)
                return;
            const emphasized = widgets.row.hover || index === this._selectedIndex;
            for (const actor of [widgets.dragHandle, widgets.expandTask, widgets.addSubtask,
                widgets.addTaskToHeading, widgets.remove]) {
                if (!actor)
                    continue;
                if (emphasized)
                    actor.add_style_class_name('overview-todo-row-emphasis');
                else
                    actor.remove_style_class_name('overview-todo-row-emphasis');
            }
        }

        _focusSelection() {
            if (this._items.length)
                this._selectItem(this._selectedIndex >= 0 ? this._selectedIndex : 0, true);
            else
                this._card?.grab_key_focus();
        }

        _ensureSelectionVisible(row) {
            const adjustment = this._scroll?.get_vadjustment();
            if (!adjustment)
                return;

            const [, scrollY] = this._scroll.get_transformed_position();
            const [, scrollHeight] = this._scroll.get_transformed_size();
            const [, rowY] = row.get_transformed_position();
            const [, rowHeight] = row.get_transformed_size();
            const padding = 8;
            if (rowY < scrollY + padding)
                adjustment.set_value(adjustment.get_value() + rowY - scrollY - padding);
            else if (rowY + rowHeight > scrollY + scrollHeight - padding)
                adjustment.set_value(adjustment.get_value() + rowY + rowHeight -
                    scrollY - scrollHeight + padding);
        }

        _toggleTask(index) {
            const item = this._items[index];
            const checkbox = this._rowWidgets[index]?.checkbox;
            if (item?.type !== 'task' || !checkbox)
                return;

            this._selectItem(index);
            item.done = !item.done;
            checkbox.child.child.opacity = item.done ? 255 : 0;
            checkbox.accessible_name = item.done
                ? 'Отметить невыполненной' : 'Отметить выполненной';
            if (item.done)
                checkbox.child.add_style_class_name('checked');
            else
                checkbox.child.remove_style_class_name('checked');
            this._updateRowAppearance(index);
            this._scheduleSave();
        }

        _deleteItem(index) {
            if (index < 0 || index >= this._items.length)
                return;
            const [item] = this._items.splice(index, 1);
            this._undo = {item, index};
            this._undoMessage.text = item.type === 'heading' ? 'Список удалён' : 'Задача удалена';
            this._undoBar.visible = true;
            if (this._undoSourceId)
                GLib.Source.remove(this._undoSourceId);
            this._undoSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 7000, () => {
                this._undoSourceId = 0;
                this._undo = null;
                this._undoBar.visible = false;
                this._positionCard();
                return GLib.SOURCE_REMOVE;
            });
            this._scheduleSave();
            const nextIndex = Math.min(index, this._items.length - 1);
            this._selectedIndex = nextIndex;
            this._queueRender(-1, false, nextIndex);
        }

        _undoDelete() {
            if (!this._undo)
                return;
            const {item, index} = this._undo;
            this._undo = null;
            if (this._undoSourceId) {
                GLib.Source.remove(this._undoSourceId);
                this._undoSourceId = 0;
            }
            this._undoBar.visible = false;
            const insertIndex = Math.min(index, this._items.length);
            this._items.splice(insertIndex, 0, item);
            this._selectedIndex = insertIndex;
            this._scheduleSave();
            this._queueRender(-1, false, insertIndex);
        }

        _recordTextChange(item, previousText, nextText, cursor, bound) {
            let history = this._textHistory.get(item);
            if (!history) {
                history = {undo: [], redo: [], lastChange: null};
                this._textHistory.set(item, history);
            }

            let start = 0;
            while (start < previousText.length && start < nextText.length &&
                previousText[start] === nextText[start])
                start++;
            let oldEnd = previousText.length;
            let newEnd = nextText.length;
            while (oldEnd > start && newEnd > start &&
                previousText[oldEnd - 1] === nextText[newEnd - 1]) {
                oldEnd--;
                newEnd--;
            }
            const removed = oldEnd - start;
            const added = newEnd - start;
            const kind = removed === 0 && added === 1 ? 'insert'
                : removed === 1 && added === 0 ? 'delete' : null;
            const now = GLib.get_monotonic_time();
            const last = history.lastChange;
            const consecutive = last && kind && last.kind === kind &&
                now - last.time < 750000 &&
                (kind === 'insert' ? start === last.position + 1
                    : start === last.position || start + 1 === last.position);
            if (!consecutive) {
                history.undo.push({text: previousText,
                    cursor: cursor < 0 ? start : Math.min(cursor, previousText.length),
                    bound: bound < 0 ? -1 : Math.min(bound, previousText.length)});
                if (history.undo.length > 100)
                    history.undo.shift();
            }
            history.redo = [];
            history.lastChange = kind ? {kind, position: start, time: now} : null;
        }

        _restoreText(index, entryText, redo = false) {
            const item = this._items[index];
            const history = this._textHistory.get(item);
            const from = redo ? history?.redo : history?.undo;
            if (!from?.length)
                return;

            const to = redo ? history.undo : history.redo;
            to.push({text: item.text, cursor: entryText.get_cursor_position(),
                bound: entryText.get_selection_bound()});
            const snapshot = from.pop();
            const collapsed = item.type === 'task' && entryText.get_text() !== item.text;
            item.text = snapshot.text;
            if (item.type === 'task' && !collapsed)
                item.expanded = item.text.includes('\n');
            this._restoringText = true;
            try {
                entryText.set_text(collapsed ? item.text.split(/\r?\n/, 1)[0] : item.text);
            } finally {
                this._restoringText = false;
            }
            if (snapshot.bound >= 0 && snapshot.bound !== snapshot.cursor)
                entryText.set_selection(snapshot.bound, snapshot.cursor);
            else
                entryText.set_cursor_position(snapshot.cursor);
            history.lastChange = null;
            this._updateRowAppearance(index);
            this._positionCard();
            this._scheduleSave();
        }

        _cancelEdit(index, entryText) {
            const item = this._items[index];
            const snapshot = item && this._editSnapshots.get(item);
            if (snapshot) {
                item.text = snapshot.text;
                item.level = snapshot.level;
                item.expanded = snapshot.expanded;
                if (snapshot.history)
                    this._textHistory.set(item, snapshot.history);
                else
                    this._textHistory.delete(item);
                this._restoringText = true;
                try {
                    const collapsed = item.type === 'task' && !item.expanded &&
                        item.text.split(/\r?\n/).filter(line => line.trim()).length >= 2;
                    entryText.set_text(collapsed ? item.text.split(/\r?\n/, 1)[0] : item.text);
                } finally {
                    this._restoringText = false;
                }
                this._editSnapshots.delete(item);
                this._updateRowAppearance(index);
                this._positionCard();
                this._scheduleSave();
            }
            this._selectItem(index, true);
        }

        _handleEditorShortcut(index, event, entryText) {
            const symbol = event.get_key_symbol();
            const state = event.get_state();
            if (symbol === Clutter.KEY_Escape) {
                if (this._newItems.has(this._items[index]))
                    this._discardNewItem(index);
                else
                    this._cancelEdit(index, entryText);
                return Clutter.EVENT_STOP;
            }
            if ((state & Clutter.ModifierType.CONTROL_MASK) &&
                (symbol === Clutter.KEY_a || symbol === Clutter.KEY_A ||
                    symbol === Clutter.KEY_Cyrillic_ef || symbol === Clutter.KEY_Cyrillic_EF)) {
                entryText.set_selection(0, -1);
                return Clutter.EVENT_STOP;
            }
            if ((state & Clutter.ModifierType.CONTROL_MASK) &&
                (symbol === Clutter.KEY_c || symbol === Clutter.KEY_C ||
                    symbol === Clutter.KEY_Cyrillic_es || symbol === Clutter.KEY_Cyrillic_ES)) {
                const selectedText = entryText.get_selection();
                if (selectedText)
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, selectedText);
                return Clutter.EVENT_STOP;
            }
            if ((state & Clutter.ModifierType.CONTROL_MASK) &&
                (symbol === Clutter.KEY_x || symbol === Clutter.KEY_X ||
                    symbol === Clutter.KEY_Cyrillic_che || symbol === Clutter.KEY_Cyrillic_CHE)) {
                const selectedText = entryText.get_selection();
                if (selectedText) {
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, selectedText);
                    entryText.delete_selection();
                }
                return Clutter.EVENT_STOP;
            }
            if ((state & Clutter.ModifierType.CONTROL_MASK) &&
                (symbol === Clutter.KEY_v || symbol === Clutter.KEY_V ||
                    symbol === Clutter.KEY_Cyrillic_em || symbol === Clutter.KEY_Cyrillic_EM)) {
                St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD,
                    (_clipboard, text) => {
                        if (!text || this._rowWidgets[index]?.entryText !== entryText ||
                            !entryText.has_key_focus())
                            return;
                        const characters = Array.from(entryText.get_text());
                        const cursor = entryText.get_cursor_position();
                        const bound = entryText.get_selection_bound();
                        const anchor = cursor < 0 ? characters.length : cursor;
                        const start = bound >= 0 ? Math.min(anchor, bound) : anchor;
                        const end = bound >= 0 ? Math.max(anchor, bound) : anchor;
                        const inserted = Array.from(text);
                        characters.splice(start, end - start, ...inserted);
                        entryText.set_text(characters.join(''));
                        entryText.set_cursor_position(start + inserted.length);
                    });
                return Clutter.EVENT_STOP;
            }
            if ((state & Clutter.ModifierType.CONTROL_MASK) &&
                (symbol === Clutter.KEY_z || symbol === Clutter.KEY_Z ||
                    symbol === Clutter.KEY_Cyrillic_ya || symbol === Clutter.KEY_Cyrillic_YA)) {
                this._restoreText(index, entryText,
                    Boolean(state & Clutter.ModifierType.SHIFT_MASK));
                return Clutter.EVENT_STOP;
            }
            const isEnter = symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter;
            if ((state & Clutter.ModifierType.CONTROL_MASK) && isEnter) {
                this._toggleTask(index);
                return Clutter.EVENT_STOP;
            }
            if ((state & Clutter.ModifierType.MOD1_MASK) &&
                (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_Down)) {
                this._moveItem(index, symbol === Clutter.KEY_Up ? -1 : 1,
                    {cursor: entryText.get_cursor_position(),
                        bound: entryText.get_selection_bound()});
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        _handleRowKey(index, event) {
            const symbol = event.get_key_symbol();
            const state = event.get_state();
            const isEnter = symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter;
            if (symbol === Clutter.KEY_Tab || symbol === Clutter.KEY_ISO_Left_Tab) {
                const backwards = symbol === Clutter.KEY_ISO_Left_Tab ||
                    Boolean(state & Clutter.ModifierType.SHIFT_MASK);
                this._changeItemLevel(index, backwards ? -1 : 1);
                return Clutter.EVENT_STOP;
            }
            if ((state & Clutter.ModifierType.CONTROL_MASK) && isEnter) {
                this._toggleTask(index);
                return Clutter.EVENT_STOP;
            }
            if (this._items[index]?.type === 'task' && isEnter &&
                (state & Clutter.ModifierType.SHIFT_MASK)) {
                this._addSiblingTask(index);
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Delete || symbol === Clutter.KEY_KP_Delete) {
                if (this._items[index])
                    this._deleteItem(index);
                return Clutter.EVENT_STOP;
            }
            if ((state & Clutter.ModifierType.MOD1_MASK) &&
                (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_Down)) {
                const entryText = this._rowWidgets[index]?.entryText;
                const editingState = entryText?.has_key_focus()
                    ? {cursor: entryText.get_cursor_position(),
                        bound: entryText.get_selection_bound()}
                    : null;
                this._moveItem(index, symbol === Clutter.KEY_Up ? -1 : 1,
                    editingState);
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_Down) {
                const direction = symbol === Clutter.KEY_Up ? -1 : 1;
                let next = index + direction;
                while (next >= 0 && next < this._items.length &&
                    !this._rowWidgets[next]?.row.visible)
                    next += direction;
                if (next >= 0 && next < this._items.length)
                    this._selectItem(next, true);
                return Clutter.EVENT_STOP;
            }
            if (isEnter) {
                const widgets = this._rowWidgets[index];
                widgets.setEditing(true);
                widgets.entryText.grab_key_focus();
                widgets.entryText.set_cursor_position(-1);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        _changeItemLevel(index, direction) {
            const item = this._items[index];
            const maxLevel = Math.max(0, Number(cfg.behavior.maxLevel) || 5);
            item.level = clamp(item.level + direction, 0, maxLevel);
            this._updateRowAppearance(index);
            this._positionCard();
            this._scheduleSave();
        }

        _handleDragHandleKey(index, event) {
            const symbol = event.get_key_symbol();
            if (symbol !== Clutter.KEY_Up && symbol !== Clutter.KEY_Down)
                return Clutter.EVENT_PROPAGATE;
            this._moveItem(index, symbol === Clutter.KEY_Up ? -1 : 1, null, true);
            return Clutter.EVENT_STOP;
        }

        _moveItem(index, direction, editingState = null, focusHandle = false) {
            const item = this._items[index];
            if (!item)
                return;

            const source = this._blockRange(index);
            let neighborStart;
            if (direction < 0) {
                neighborStart = -1;
                for (let candidate = 0; candidate < index; candidate++) {
                    const neighbor = this._items[candidate];
                    if (neighbor.type === item.type && neighbor.level === item.level &&
                        this._blockRange(candidate).end === index)
                        neighborStart = candidate;
                }
                if (neighborStart < 0 && item.type === 'task' &&
                    this._items[index - 1]?.type === 'heading')
                    neighborStart = index - 1;
            } else {
                neighborStart = source.end;
                const neighbor = this._items[neighborStart];
                if (!neighbor || (neighbor.type !== item.type ||
                    neighbor.level !== item.level) &&
                    !(item.type === 'task' && neighbor.type === 'heading'))
                    return;
            }
            if (neighborStart < 0)
                return;

            // Crossing a section boundary swaps the task block with only the
            // heading row; the rest of that section stays in place.
            const neighbor = item.type === 'task' &&
                this._items[neighborStart].type === 'heading'
                ? {start: neighborStart, end: neighborStart + 1}
                : this._blockRange(neighborStart);
            const sourceItems = this._items.slice(source.start, source.end);
            const neighborItems = this._items.slice(neighbor.start, neighbor.end);
            const newIndex = direction < 0
                ? neighbor.start : source.start + neighborItems.length;
            if (direction < 0) {
                this._items.splice(neighbor.start,
                    neighborItems.length + sourceItems.length,
                    ...sourceItems, ...neighborItems);
            } else {
                this._items.splice(source.start,
                    sourceItems.length + neighborItems.length,
                    ...neighborItems, ...sourceItems);
            }

            this._selectedIndex = newIndex;
            this._scheduleSave();
            this._queueRender(editingState ? newIndex : -1, false,
                editingState || focusHandle ? -1 : newIndex, editingState,
                focusHandle ? newIndex : -1);
        }

        _entryClass(item) {
            if (item.type === 'heading')
                return `overview-todo-entry overview-todo-heading heading-${item.level + 1}`;
            return `overview-todo-entry overview-todo-task${item.done ? ' completed' : ''}`;
        }

        _isPriorityTask(item) {
            return item.type === 'task' && item.text.split(/\r?\n/, 1)[0].includes('!!');
        }

        _updateRowAppearance(index) {
            const item = this._items[index];
            const widgets = this._rowWidgets[index];
            if (!item || !widgets)
                return;
            if (this._isPriorityTask(item))
                widgets.row.add_style_class_name('priority');
            else
                widgets.row.remove_style_class_name('priority');
            widgets.entry.set_style_class_name(this._entryClass(item));
            const itemName = item.text.split(/\r?\n/, 1)[0].trim() || 'Без названия';
            widgets.remove.accessible_name = item.type === 'heading'
                ? `Удалить список «${itemName}»` : `Удалить задачу «${itemName}»`;
            if (widgets.preview) {
                const [title, ...comment] = item.text.split(/\r?\n/);
                widgets.previewTitle.text = title;
                widgets.previewTitle.set_style_class_name(
                    `overview-todo-task${item.done ? ' completed' : ''}`);
                widgets.previewComment.text = comment.join('\n');
                widgets.previewComment.visible = item.expanded &&
                    comment.some(line => line.trim());
                widgets.setEditing(widgets.entryText.has_key_focus());
            }
            if (widgets.expandTask) {
                widgets.expandTask.visible = item.text.split(/\r?\n/)
                    .filter(line => line.trim()).length >= 2;
                widgets.expandTask.accessible_name = item.expanded
                    ? 'Свернуть комментарий' : 'Показать комментарий';
            }
            this._updateRowHeight(index);
        }

        _updateRowHeight(index) {
            const item = this._items[index];
            const widgets = this._rowWidgets[index];
            if (!item || !widgets)
                return;
            if (!widgets.row.get_stage())
                return;

            const lineCount = item.type === 'task' && item.expanded
                ? Math.max(1, item.text.split(/\r?\n/).length)
                : 1;
            const content = widgets.preview?.visible ? widgets.preview : widgets.entry;
            const wrappedHeight = content.width > 0 && content.get_stage()
                ? content.get_preferred_height(content.width)[0] : 0;
            const rowHeight = Math.max(38, lineCount * 24 + 14, wrappedHeight);
            const indentPx = Math.max(0, Number(cfg.behavior.indentPx) || 0);
            const style = `margin-left: ${item.level * indentPx}px; min-height: ${rowHeight}px;`;
            if (widgets.row.get_style() !== style)
                widgets.row.set_style(style);
        }

        _addItem(type) {
            const item = type === 'heading'
                ? {type: 'heading', level: 0, text: cfg.ui.newHeadingText}
                : {type: 'task', level: 0, text: cfg.ui.newTaskText, done: false};

            const firstHeading = this._items.findIndex(existing => existing.type === 'heading');
            const insertIndex = type === 'task' && firstHeading >= 0
                ? firstHeading : this._items.length;
            this._insertNewItem(insertIndex, item);
        }

        _addTaskToHeading(headingIndex) {
            this._items[headingIndex].listCollapsed = false;
            let insertIndex = headingIndex + 1;
            while (insertIndex < this._items.length &&
                this._items[insertIndex].type !== 'heading') {
                insertIndex++;
            }

            this._insertNewItem(insertIndex, {
                type: 'task',
                level: 0,
                text: cfg.ui.newTaskText,
                done: false,
            });
        }

        _addSubtask(parentIndex) {
            const parent = this._items[parentIndex];
            const maxLevel = Math.max(0, Number(cfg.behavior.maxLevel) || 5);
            if (parent?.type !== 'task' || parent.level >= maxLevel)
                return;

            const insertIndex = this._blockRange(parentIndex).end;
            parent.childrenCollapsed = false;
            this._insertNewItem(insertIndex, {
                type: 'task',
                level: parent.level + 1,
                text: cfg.ui.newTaskText,
                done: false,
            });
        }

        _addSiblingTask(index) {
            const item = this._items[index];
            const insertIndex = this._blockRange(index).end;
            this._insertNewItem(insertIndex, {
                type: 'task',
                level: item.level,
                text: cfg.ui.newTaskText,
                done: false,
            });
        }

        _insertNewItem(index, item) {
            this._items.splice(index, 0, item);
            this._newItems.add(item);
            this._scheduleSave();
            this._queueRender(index, true, -1, null, -1, true);
        }

        _discardNewItem(index) {
            const [item] = this._items.splice(index, 1);
            this._newItems.delete(item);
            this._editSnapshots.delete(item);
            this._textHistory.delete(item);
            const nextIndex = Math.min(index, this._items.length - 1);
            this._selectedIndex = nextIndex;
            this._scheduleSave();
            this._queueRender(-1, false, nextIndex);
        }

        _queueRender(focusIndex = -1, selectAll = false, focusRowIndex = -1,
            editingState = null, focusHandleIndex = -1, scrollToFocus = false) {
            if (this._renderSourceId)
                GLib.Source.remove(this._renderSourceId);

            this._renderSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._renderSourceId = 0;
                this._renderItems();

                const entryText = this._rowWidgets[focusIndex]?.entryText;
                if (entryText) {
                    this._selectItem(focusIndex);
                    this._rowWidgets[focusIndex].setEditing(true);
                    entryText.grab_key_focus();
                    if (editingState) {
                        if (editingState.bound < 0 ||
                            editingState.bound === editingState.cursor) {
                            entryText.set_selection(-1, -1);
                            entryText.set_cursor_position(editingState.cursor);
                        } else {
                            entryText.set_selection(editingState.bound,
                                editingState.cursor);
                        }
                    } else if (selectAll) {
                        entryText.set_selection(0, -1);
                    } else {
                        entryText.set_selection(-1, -1);
                        entryText.set_cursor_position(-1);
                    }
                } else if (focusHandleIndex >= 0) {
                    this._selectItem(focusHandleIndex);
                    this._rowWidgets[focusHandleIndex].dragHandle.grab_key_focus();
                } else if (focusRowIndex >= 0) {
                    this._selectItem(focusRowIndex, true);
                } else {
                    this._card.grab_key_focus();
                }

                if (scrollToFocus) {
                    const row = this._rowWidgets[focusIndex]?.row;
                    if (row) {
                        const allocationId = row.connect('notify::allocation', () => {
                            row.disconnect(allocationId);
                            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                if (this._rowWidgets[focusIndex]?.row === row && row.get_stage())
                                    this._ensureSelectionVisible(row);
                                return GLib.SOURCE_REMOVE;
                            });
                        });
                    }
                }

                return GLib.SOURCE_REMOVE;
            });
        }
    }

    return new OverviewTodoRuntime();
}

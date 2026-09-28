import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';

const root = GLib.getenv('OVERVIEW_TODO_TEST_ROOT');
const output = GLib.getenv('OVERVIEW_TODO_TEST_OUTPUT');
if (!root || !output)
    throw new Error('Set OVERVIEW_TODO_TEST_ROOT and OVERVIEW_TODO_TEST_OUTPUT');
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
async function screenshot(name, actor) {
    const stream = Gio.File.new_for_path(`${output}/${name}.png`).replace(null, false, Gio.FileCreateFlags.NONE, null);
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    await new Shell.Screenshot().screenshot_area(
        Math.round(x), Math.round(y), Math.round(width), Math.round(height), stream);
    stream.close(null);
}

export async function run() {
    const [, bytes] = Gio.File.new_for_path(GLib.getenv('PROBE_RUNTIME') || `${root}/runtime.js`).load_contents(null);
    const factory = eval(new TextDecoder().decode(bytes));
    const runtime = factory({Clutter, Gio, GLib, St, Main, Keyboard,
        extensionPath: root, config: {}});
    runtime._items = [
        {type: 'heading', level: 0, text: 'Сегодня'},
        {type: 'task', level: 0, text: 'Подготовить релиз', done: false},
        {type: 'task', level: 1, text: 'Проверить изменения', done: true},
        {type: 'task', level: 1, text: 'Обновить документацию', done: false},
        {type: 'task', level: 0, text: 'Обсудить дизайн\nОтступы и состояния кнопок', done: false},
        {type: 'heading', level: 0, text: 'Позже'},
        {type: 'task', level: 0, text: 'Разобрать заметки', done: false},
        {type: 'task', level: 0, text: 'Спланировать неделю', done: false},
    ];
    runtime._buildUi();
    runtime._renderItems();
    runtime._card.set_size(430, 600);
    runtime._card.set_position(100, 100);
    runtime._resizeHandle.set_position(105, 677);
    Main.layoutManager.addTopChrome(runtime._card);
    Main.layoutManager.addTopChrome(runtime._resizeHandle);
    Main.layoutManager.addTopChrome(runtime._undoBar);
    St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(Gio.File.new_for_path(`${root}/theme.css`));
    await delay(1000);
    runtime._focusSelection();
    if (runtime._selectedIndex !== 0 || !runtime._rowWidgets[0].row.has_key_focus() ||
        runtime._rowWidgets[0].entryText.has_key_focus())
        throw new Error('Opening did not focus the first row without editing');
    runtime._selectItem(1);
    runtime._rowWidgets[1].row.hover = false;
    if (runtime._rowWidgets[1].remove.opacity !== 0 ||
        !runtime._rowWidgets[0].row.hover && runtime._rowWidgets[0].remove.opacity !== 0)
        throw new Error('Keyboard selection showed the delete button');
    runtime._rowWidgets[1].remove.grab_key_focus();
    if (runtime._rowWidgets[1].remove.opacity !== 255)
        throw new Error('Focused delete button is hidden');
    runtime._rowWidgets[1].row.grab_key_focus();
    if (runtime._rowWidgets[1].remove.opacity !== 0)
        throw new Error('Delete button stayed visible after focus left it');
    if (runtime._rowWidgets[1].selectionMark.opacity !== 255 ||
        runtime._rowWidgets[0].selectionMark.opacity !== 0)
        throw new Error('Selected row does not have a non-color marker');
    const priorityEditor = runtime._rowWidgets[1].entryText;
    priorityEditor.set_text('!! Подготовить релиз');
    if (!runtime._rowWidgets[1].row.has_style_class_name('priority'))
        throw new Error('Priority marker at the start of a title was not detected');
    priorityEditor.set_text('Подготовить !! релиз');
    if (!runtime._rowWidgets[1].row.has_style_class_name('priority'))
        throw new Error('Priority marker in the middle of a title was not detected');
    priorityEditor.set_text('Подготовить релиз !!');
    if (!runtime._rowWidgets[1].row.has_style_class_name('priority'))
        throw new Error('Priority marker at the end of a title was not detected');
    priorityEditor.set_text('Подготовить релиз\nКомментарий с !!');
    if (runtime._rowWidgets[1].row.has_style_class_name('priority'))
        throw new Error('Priority marker in a comment changed the task priority');
    priorityEditor.set_text('Подготовить релиз');
    if (runtime._rowWidgets[1].row.has_style_class_name('priority'))
        throw new Error('Removing the priority marker did not restore the normal row');
    console.log('PROBE PASS: priority follows !! anywhere in the task title');
    runtime._card.grab_key_focus();
    runtime._focusSelection();
    if (runtime._selectedIndex !== 1 || !runtime._rowWidgets[1].row.has_key_focus() ||
        runtime._rowWidgets[1].entryText.has_key_focus())
        throw new Error('Opening did not restore the selected row without editing');
    console.log('PROBE PASS: opening focuses first or selected row without editing');
    const buttonsIn = actor => [
        ...(actor instanceof St.Button ? [actor] : []),
        ...actor.get_children().flatMap(buttonsIn),
    ];
    for (const button of [...buttonsIn(runtime._card), ...buttonsIn(runtime._undoBar),
        runtime._resizeHandle]) {
        if (!button.accessible_name?.trim())
            throw new Error(`Button has no accessible name: ${button.style_class}`);
    }
    const toolbar = runtime._card.get_children()[0];
    const toolbarActions = toolbar.get_children()[1].get_children();
    const boxes = toolbarActions.map(button => {
        const [x, y] = button.get_transformed_position();
        const [width, height] = button.get_transformed_size();
        return {x, y, width, height};
    });
    if (boxes.length !== 3 || boxes.some(box => Math.abs(box.height - 36) > 1) ||
        Math.abs(boxes[2].width - 36) > 1 ||
        boxes.some(box => Math.abs(box.y - boxes[0].y) > 1) ||
        boxes.slice(1).some((box, i) =>
            Math.abs(box.x - boxes[i].x - boxes[i].width - 7) > 1))
        throw new Error(`Toolbar button geometry differs: ${JSON.stringify(boxes)}`);
    const [taskButton, listButton, gearButton] = toolbarActions;
    const taskContent = taskButton.child.get_children();
    const listContent = listButton.child.get_children();
    if (taskContent[0].icon_name !== 'list-add-symbolic' ||
        listContent[0].icon_name !== taskContent[0].icon_name ||
        taskContent[1].text !== 'Задача' || listContent[1].text !== 'Список' ||
        gearButton.child.icon_size !== 16)
        throw new Error('Toolbar icons or labels differ');
    await screenshot('toolbar', runtime._card);
    listButton.hover = true;
    await delay(100);
    await screenshot('toolbar-hover', runtime._card);
    listButton.hover = false;
    listButton.add_style_pseudo_class('active');
    await delay(100);
    await screenshot('toolbar-pressed', runtime._card);
    listButton.remove_style_pseudo_class('active');
    gearButton.grab_key_focus();
    await delay(100);
    await screenshot('toolbar-focus', runtime._card);
    runtime._rowWidgets[1].row.grab_key_focus();
    console.log('PROBE PASS: toolbar buttons share 36px height and 7px gaps');
    if (runtime._rowWidgets[0].remove.accessible_name !== 'Удалить список «Сегодня»' ||
        runtime._rowWidgets[1].remove.accessible_name !== 'Удалить задачу «Подготовить релиз»')
        throw new Error('Delete names do not distinguish tasks from lists');
    console.log('PROBE PASS: buttons have accessible names and deletion names identify items');
    for (const i of [0, 4, 5]) {
        const row = runtime._rowWidgets[i].row;
        for (const button of row.get_children().filter(actor =>
            ['overview-todo-add-to-heading', 'overview-todo-expand', 'overview-todo-delete']
                .some(name => actor.has_style_class_name(name)))) {
            const [x, y] = button.get_transformed_position();
            const [width, height] = button.get_transformed_size();
            const [iconX, iconY] = button.child.get_transformed_position();
            const [iconWidth, iconHeight] = button.child.get_transformed_size();
            if (width !== 24 || height !== 24)
                throw new Error(`Action slot is not 24×24: ${button.style_class} ${width}×${height}`);
            console.log(`ACTION row=${i} class=${button.style_class} buttonCenter=${x + width / 2},${y + height / 2} iconCenter=${iconX + iconWidth / 2},${iconY + iconHeight / 2}`);
        }
    }
    const [handleWidth, handleHeight] = runtime._rowWidgets[0].dragHandle.get_transformed_size();
    if (handleWidth !== 24 || handleHeight !== 24)
        throw new Error('Drag handle slot is not 24×24');
    console.log('PROBE PASS: action slots are 24×24');
    const checkboxRow = runtime._rowWidgets[1];
    checkboxRow.checkbox.emit('clicked', 1);
    if (!runtime._items[1].done || runtime._rowWidgets[1] !== checkboxRow ||
        checkboxRow.entryText.has_key_focus())
        throw new Error('Checkbox click rebuilt the row or entered edit mode');
    console.log('PROBE PASS: checkbox click does not enter edit mode');
    const parent = runtime._rowWidgets[1];
    if (!parent.expandChildren || runtime._rowWidgets[4].expandChildren)
        throw new Error('Subtask toggle is not limited to parent tasks');
    const parentCheckboxX = parent.checkbox.get_transformed_position()[0];
    const leafCheckboxX = runtime._rowWidgets[4].checkbox.get_transformed_position()[0];
    if (Math.abs(parentCheckboxX - leafCheckboxX) > 1)
        throw new Error('Checkboxes shift when a task has a subtask toggle');
    console.log('PROBE PASS: checkbox position is independent of the subtask toggle');
    parent.expandChildren.emit('clicked', 1);
    if (runtime._rowWidgets[2].row.visible || runtime._rowWidgets[3].row.visible ||
        !runtime._rowWidgets[4].row.visible || runtime._items.length !== 8 ||
        runtime._rowWidgets[1].entryText.has_key_focus())
        throw new Error('Collapsing a task did not hide only its descendants');
    runtime._selectItem(1, true);
    runtime._handleRowKey(1, {
        get_key_symbol: () => Clutter.KEY_Down,
        get_state: () => 0,
    });
    if (runtime._selectedIndex !== 4)
        throw new Error('Keyboard navigation entered hidden subtasks');
    parent.expandChildren.emit('clicked', 1);
    if (!runtime._rowWidgets[2].row.visible || !runtime._rowWidgets[3].row.visible)
        throw new Error('Expanding a task did not restore its subtasks');
    console.log('PROBE PASS: task disclosure hides descendants and skips them in navigation');
    const longTitleItem = runtime._items[1];
    const originalTitle = longTitleItem.text;
    longTitleItem.text = 'Подготовить подробный план выпуска с проверкой всех изменений и согласованием оставшихся задач команды перед публикацией';
    runtime._rowWidgets[1].entryText.set_text(longTitleItem.text);
    await delay(300);
    const longTitleWidgets = runtime._rowWidgets[1];
    const titleLines = longTitleWidgets.previewTitle.clutter_text.get_layout().get_line_count();
    const titleHeight = longTitleWidgets.previewTitle.height;
    const rowHeight = longTitleWidgets.row.height;
    await screenshot('long-title', runtime._card);
    if (titleLines < 2 || titleHeight < 35 || rowHeight < longTitleWidgets.preview.height)
        throw new Error('Long task title did not wrap into a fully visible row');
    longTitleWidgets.preview.emit('clicked', 1);
    await delay(100);
    if (!longTitleWidgets.entryText.has_key_focus() ||
        longTitleWidgets.entryText.get_text() !== longTitleItem.text ||
        longTitleWidgets.row.height < longTitleWidgets.entry.height)
        throw new Error('Long task title overflowed the row while editing');
    runtime._card.grab_key_focus();
    longTitleItem.text = originalTitle;
    longTitleWidgets.entryText.set_text(originalTitle);
    await delay(100);
    if (longTitleWidgets.row.height > 100)
        throw new Error('Row did not shrink after shortening the task title');
    console.log('PROBE PASS: long task title wraps within the row');
    const firstList = runtime._rowWidgets[0].expandList;
    if (!firstList || runtime._rowWidgets[4].expandList ||
        firstList.accessible_name !== 'Свернуть список')
        throw new Error('List toggle is not limited to nonempty headings');
    firstList.emit('clicked', 1);
    if (runtime._rowWidgets.slice(1, 5).some(w => w.row.visible) ||
        !runtime._rowWidgets[5].row.visible || runtime._items.length !== 8 ||
        firstList.accessible_name !== 'Показать список')
        throw new Error('Collapsing a list hid the wrong rows');
    runtime._selectItem(0, true);
    runtime._handleRowKey(0, {
        get_key_symbol: () => Clutter.KEY_Down,
        get_state: () => 0,
    });
    if (runtime._selectedIndex !== 5)
        throw new Error('Keyboard navigation entered a collapsed list');
    firstList.emit('clicked', 1);
    if (runtime._rowWidgets.slice(1, 5).some(w => !w.row.visible))
        throw new Error('Expanding a list did not restore its rows');
    console.log('PROBE PASS: list disclosure hides its rows and skips them in navigation');
    const measure = label => {
        const w = runtime._rowWidgets[4];
        const check = w.checkbox;
        console.log(`MEASURE ${label} check=${check.get_size()} checkY=${check.get_transformed_position()[1]} rowY=${w.row.get_transformed_position()[1]} titleY=${w.previewTitle.get_transformed_position()[1]}`);
    };
    measure('collapsed');
    runtime._rowWidgets[4].expandTask.emit('clicked', 1);
    await delay(1000);
    measure('expanded');
    runtime._selectItem(4);
    const expandedRow = runtime._rowWidgets[4];
    const centerY = actor => actor.get_transformed_position()[1] +
        actor.get_transformed_size()[1] / 2;
    const visibleTitleLines = expandedRow.previewTitle.clutter_text.get_layout().get_line_count();
    const firstLineCenter = expandedRow.previewTitle.get_transformed_position()[1] +
        expandedRow.previewTitle.height / visibleTitleLines / 2;
    for (const [label, actor] of Object.entries({mark: expandedRow.selectionMark,
        drag: expandedRow.dragHandle.child, check: expandedRow.checkbox.child,
        comment: expandedRow.expandTask.child, add: expandedRow.addSubtask.child,
        remove: expandedRow.remove.child})) {
        if (Math.abs(centerY(actor) - firstLineCenter) > 1)
            throw new Error(`Row control is not aligned with the first title line: ${label} ${centerY(actor)} vs ${firstLineCenter}`);
    }
    const rowBottom = expandedRow.row.get_transformed_position()[1] + expandedRow.row.height;
    const previewBottom = expandedRow.preview.get_transformed_position()[1] +
        expandedRow.preview.height;
    if (previewBottom > rowBottom + 1)
        throw new Error('Expanded comment extends outside the highlighted row');
    const headingPlus = runtime._rowWidgets[0].row.get_children().find(actor =>
        actor.has_style_class_name('overview-todo-add-to-heading'));
    const taskPlus = expandedRow.addSubtask;
    if (!(headingPlus.child instanceof St.Icon) ||
        Math.abs(headingPlus.get_transformed_position()[0] -
            taskPlus.get_transformed_position()[0]) > 1 ||
        Math.abs(runtime._rowWidgets[0].remove.get_transformed_position()[0] -
            expandedRow.remove.get_transformed_position()[0]) > 1 ||
        Math.abs(centerY(taskPlus) - centerY(expandedRow.remove)) > 1)
        throw new Error('Add and delete buttons do not keep their action columns');
    const [plusX, plusWidth] = [taskPlus.get_transformed_position()[0], taskPlus.width];
    const [removeX, removeWidth] = [expandedRow.remove.get_transformed_position()[0],
        expandedRow.remove.width];
    const [rowX, rowWidth] = [expandedRow.row.get_transformed_position()[0],
        expandedRow.row.width];
    if (plusWidth !== 24 || removeWidth !== 24 ||
        Math.abs(removeX - plusX - plusWidth - 6) > 1 ||
        Math.abs(rowX + rowWidth - removeX - removeWidth - 6) > 1)
        throw new Error('Right actions do not have equal slots, a 6px gap and 6px edge');
    const headingPlusWidth = headingPlus.width;
    runtime._showActionTooltip(headingPlus);
    if (runtime._actionTooltip.text !== 'Добавить задачу в список' ||
        headingPlus.width !== headingPlusWidth)
        throw new Error('Heading add hint displaced its button');
    runtime._hideActionTooltip();
    await screenshot('aligned-actions', runtime._card);
    console.log('PROBE PASS: selection mark and action columns align on multi-line rows');
    const text = runtime._rowWidgets[4].entryText;
    if (text.has_key_focus() || runtime._rowWidgets[4].entry.visible || !runtime._rowWidgets[4].preview.visible)
        throw new Error('Disclosure entered edit mode');
    console.log(`PROBE selection=${text.get_selection()} cursor=${text.get_cursor_position()} bound=${text.get_selection_bound()}`);
    await screenshot('expanded', runtime._card);
    runtime._rowWidgets[4].preview.emit('clicked', 1);
    if (!text.has_key_focus() || !runtime._rowWidgets[4].entry.visible)
        throw new Error('Explicit click did not enter edit mode');
    text.set_cursor_position(2);
    text.set_selection(2, 2);
    await delay(1000);
    await screenshot('clicked', runtime._card);
    text.set_selection(0, -1);
    await delay(500);
    await screenshot('selected', runtime._card);
    const color = text.get_selection_color();
    console.log(`PROBE selection-color=${color.red},${color.green},${color.blue}`);
    runtime._card.grab_key_focus();
    await delay(300);
    await screenshot('design', runtime._card);
    const textSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const normalWidth = runtime._card.width;
    const taskFontSize = runtime._rowWidgets[1].entry.get_theme_node().get_font().get_size();
    textSettings.set_double('text-scaling-factor', 1.5);
    await delay(400);
    const largeTaskFontSize = runtime._rowWidgets[1].entry.get_theme_node().get_font().get_size();
    runtime._positionCard();
    await delay(100);
    await screenshot('large-text', runtime._card);
    if (largeTaskFontSize <= taskFontSize || runtime._card.width <= normalWidth ||
        runtime._card.x + runtime._card.width > 1000)
        throw new Error(`Large Text did not scale font/card: ${taskFontSize} -> ${largeTaskFontSize}, width=${normalWidth} -> ${runtime._card.width}`);
    textSettings.set_double('text-scaling-factor', 1);
    await delay(400);
    runtime._positionCard();
    console.log('PROBE PASS: Large Text scales font and card width');
    const contrastSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.interface'});
    contrastSettings.set_boolean('high-contrast', true);
    runtime._updateContrast();
    await delay(350);
    await screenshot('high-contrast', runtime._card);
    const handleColor = runtime._rowWidgets[0].dragHandle.get_theme_node().get_foreground_color();
    if (!runtime._card.has_style_class_name('high-contrast') ||
        !runtime._undoBar.has_style_class_name('high-contrast') ||
        !runtime._resizeHandle.has_style_class_name('high-contrast') ||
        handleColor.red > 64 || handleColor.green > 64 || handleColor.blue > 64)
        throw new Error('High Contrast did not apply to widget and drag handles');
    contrastSettings.set_boolean('high-contrast', false);
    runtime._updateContrast();
    await delay(350);
    runtime._card.set_width(330);
    await delay(300);
    await screenshot('narrow', runtime._card);
    runtime._card.set_width(430);
    runtime._addTaskToHeading(5);
    await delay(300);
    const index = runtime._items.length - 1;
    const contentGeometry = () => {
        const content = runtime._rowWidgets[index].entry.get_parent();
        return [content.get_transformed_position()[0], content.get_transformed_size()[0]];
    };
    const geometryWithoutComment = contentGeometry();
    const editor = runtime._rowWidgets[index].entryText;
    editor.set_text('Новое дело');
    editor.insert_text('\n', -1);
    await delay(300);
    // Type into the current editor as a user would after Shift+Enter.
    const currentEditor = runtime._rowWidgets[index].entryText;
    currentEditor.insert_text('коммент', -1);
    currentEditor.set_cursor_position(3);
    await delay(300);
    const geometryWithComment = contentGeometry();
    if (geometryWithComment.some((value, i) =>
        Math.abs(value - geometryWithoutComment[i]) > 1))
        throw new Error('Comment toggle moved or resized task text');
    if (!runtime._rowWidgets[index].expandTask?.visible)
        throw new Error('Missing expand button after typing a new comment');
    if (runtime._rowWidgets[index].entryText !== editor || editor.get_cursor_position() !== 3)
        throw new Error('Typing a comment rebuilt the editor or moved the caret');
    const fullText = runtime._items[index].text;
    runtime._rowWidgets[index].expandTask.emit('clicked', 1);
    await delay(300);
    if (runtime._rowWidgets[index].entryText.get_text() !== 'Новое дело' || runtime._items[index].text !== fullText)
        throw new Error('Collapse lost the comment');
    runtime._rowWidgets[index].expandTask.emit('clicked', 1);
    await delay(300);
    if (runtime._rowWidgets[index].entryText.get_text() !== fullText)
        throw new Error('Expand did not restore the comment');
    if (runtime._rowWidgets[index].entryText.has_key_focus() || !runtime._rowWidgets[index].preview.visible)
        throw new Error('New comment disclosure entered edit mode');
    await screenshot('new-comment', runtime._card);
    runtime._rowWidgets[index].preview.emit('clicked', 1);
    runtime._rowWidgets[index].entryText.set_text('Новое дело\n');
    if (runtime._rowWidgets[index].expandTask.visible)
        throw new Error('Expand button remains after deleting the comment');
    await delay(100);
    if (contentGeometry().some((value, i) =>
        Math.abs(value - geometryWithoutComment[i]) > 1))
        throw new Error('Removing the comment toggle moved or resized task text');
    console.log('PROBE PASS: new comment toggle, stable editor/caret, collapse/expand, comment deletion');

    const undoKey = {
        get_key_symbol: () => Clutter.KEY_z,
        get_state: () => Clutter.ModifierType.CONTROL_MASK,
    };
    const redoKey = {
        get_key_symbol: () => Clutter.KEY_Z,
        get_state: () => Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.SHIFT_MASK,
    };
    const headingEditor = runtime._rowWidgets[0].entryText;
    headingEditor.grab_key_focus();
    headingEditor.set_text('СегодняA');
    headingEditor.set_text('СегодняAB');
    runtime._renderItems();
    const rebuiltHeadingEditor = runtime._rowWidgets[0].entryText;
    runtime._handleEditorShortcut(0, undoKey, rebuiltHeadingEditor);
    if (runtime._items[0].text !== 'Сегодня' || rebuiltHeadingEditor.get_text() !== 'Сегодня')
        throw new Error('Ctrl+Z did not undo a typing burst after editor rebuild');
    runtime._handleEditorShortcut(0, redoKey, rebuiltHeadingEditor);
    if (runtime._items[0].text !== 'СегодняAB')
        throw new Error('Ctrl+Shift+Z did not redo the typing burst');
    runtime._handleEditorShortcut(0, undoKey, rebuiltHeadingEditor);
    rebuiltHeadingEditor.set_text('Сегодня!');
    runtime._handleEditorShortcut(0, redoKey, rebuiltHeadingEditor);
    if (runtime._items[0].text !== 'Сегодня!')
        throw new Error('New typing did not clear the redo history');
    runtime._handleEditorShortcut(0, undoKey, rebuiltHeadingEditor);
    if (runtime._items[0].text !== 'Сегодня')
        throw new Error('Ctrl+Z did not restore the heading after a new edit');

    const commentTask = runtime._items[4];
    const originalComment = commentTask.text;
    runtime._rowWidgets[4].expandTask.emit('clicked', 1);
    const collapsedEditor = runtime._rowWidgets[4].entryText;
    collapsedEditor.set_text('Обсудить макет');
    runtime._handleEditorShortcut(4, undoKey, collapsedEditor);
    if (commentTask.text !== originalComment ||
        collapsedEditor.get_text() !== originalComment.split('\n')[0])
        throw new Error('Undo in a collapsed task lost its comment');
    runtime._rowWidgets[4].expandTask.emit('clicked', 1);
    console.log('PROBE PASS: Ctrl+Z/Ctrl+Shift+Z undo text per item and preserve comments');

    await delay(100);
    const cancelTask = runtime._items[4];
    const beforeEdit = {text: cancelTask.text, level: cancelTask.level,
        expanded: cancelTask.expanded};
    runtime._rowWidgets[4].preview.emit('clicked', 1);
    runtime._rowWidgets[4].entryText.set_text('Черновик');
    cancelTask.level = 2;
    runtime._queueRender(4);
    await delay(150);
    const cancelEditor = runtime._rowWidgets[4].entryText;
    cancelEditor.set_text('Другой черновик');
    const escapeKey = {
        get_key_symbol: () => Clutter.KEY_Escape,
        get_state: () => 0,
    };
    if (runtime._handleEditorShortcut(4, escapeKey, cancelEditor) !== Clutter.EVENT_STOP ||
        cancelTask.text !== beforeEdit.text || cancelTask.level !== beforeEdit.level ||
        cancelTask.expanded !== beforeEdit.expanded ||
        !runtime._rowWidgets[4].row.has_key_focus() ||
        runtime._rowWidgets[4].entryText.has_key_focus())
        throw new Error('Escape did not cancel the full inline edit after rebuild');
    console.log('PROBE PASS: Escape cancels inline edits across editor rebuilds');

    runtime._sizeOverride = {width: 500, height: 500};
    runtime._positionCard();
    if (runtime._card.width !== 500 || runtime._card.height !== 500 ||
        !runtime._resizeHandle)
        throw new Error('Resize size/handle unavailable');
    runtime._sizeFile = Gio.File.new_for_path(`${output}/probe-size.json`);
    runtime._saveSize();
    runtime._sizeOverride = null;
    runtime._loadSize();
    if (runtime._sizeOverride?.width !== 500 || runtime._sizeOverride?.height !== 500)
        throw new Error('Resize size did not persist');
    console.log('PROBE PASS: resize bounds and saved size');
    runtime._resizeHandle.grab_key_focus();
    if (!runtime._resizeHandle.has_key_focus())
        throw new Error('Resize handle cannot receive keyboard focus');
    const resizeKeyboard = Clutter.get_default_backend().get_default_seat()
        .create_virtual_device(Clutter.VirtualDeviceType.KEYBOARD);
    resizeKeyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Right, Clutter.KeyState.PRESSED);
    resizeKeyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Right, Clutter.KeyState.RELEASED);
    await delay(100);
    if (runtime._card.width !== 490)
        throw new Error('Right arrow did not shrink the widget');
    resizeKeyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Down, Clutter.KeyState.PRESSED);
    resizeKeyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Down, Clutter.KeyState.RELEASED);
    await delay(100);
    if (runtime._card.height !== 510)
        throw new Error('Down arrow did not grow the widget');
    const fineResize = {
        get_key_symbol: () => Clutter.KEY_Left,
        get_state: () => Clutter.ModifierType.SHIFT_MASK,
    };
    if (runtime._handleResizeKey(fineResize) !== Clutter.EVENT_STOP ||
        runtime._card.width !== 491)
        throw new Error('Shift+Left did not resize by one pixel');
    runtime._sizeOverride = null;
    runtime._loadSize();
    if (runtime._sizeOverride?.width !== 491 || runtime._sizeOverride?.height !== 510)
        throw new Error('Keyboard resize did not persist');
    runtime._sizeOverride = {width: 500, height: 500};
    runtime._positionCard();
    console.log('PROBE PASS: focused resize handle responds to arrow keys');
    runtime._rowWidgets[4].row.get_children().find(child =>
        child.has_style_class_name('overview-todo-delete')).emit('clicked', 1);
    await delay(300);
    if (runtime._card.height !== 500 || !runtime._undoBar.visible)
        throw new Error('Undo notification changed the card height or did not appear');
    const [cardX] = runtime._card.get_position();
    const [toastX] = runtime._undoBar.get_position();
    if (Math.abs(toastX + runtime._undoBar.width / 2 - cardX - runtime._card.width / 2) > 1)
        throw new Error('Undo notification is not horizontally centered');
    await screenshot('undo', runtime._card);
    if (runtime._items[4].type !== 'heading' ||
        runtime._rowWidgets[4].entryText.has_key_focus() ||
        !runtime._rowWidgets[4].entry.visible)
        throw new Error('Deleting a task opened the following heading for editing');
    console.log('PROBE PASS: deleting a task leaves the following heading unedited');
    runtime._undoDelete();
    await delay(300);
    if (runtime._items[4].text !== 'Обсудить дизайн\nОтступы и состояния кнопок' ||
        runtime._undoBar.visible || runtime._selectedIndex !== 4)
        throw new Error('Undo did not restore the deleted task and selection');
    console.log('PROBE PASS: undo restores a deleted task');
    runtime._deleteItem(4);
    await delay(300);
    Main.overview.show();
    await delay(500);
    const layoutEditor = runtime._rowWidgets[1].entryText;
    runtime._rowWidgets[1].setEditing(true);
    layoutEditor.grab_key_focus();
    layoutEditor.set_cursor_position(3);
    const manager = Keyboard.getInputSourceManager();
    if (Main.panel.statusArea.keyboard?._inputSourceManager !== manager)
        throw new Error('Panel keyboard does not expose the input source manager');
    const popup = new St.Button({can_focus: true});
    Main.layoutManager.addTopChrome(popup);
    manager._switcherPopup = popup;
    popup.grab_key_focus();
    await delay(100);
    if (!runtime._rowWidgets[1].entry.visible)
        throw new Error('Layout popup hid the editor');
    popup.destroy();
    manager._switcherPopup = null;
    await delay(100);
    if (!layoutEditor.has_key_focus() || layoutEditor.get_cursor_position() !== 3)
        throw new Error('Layout popup did not restore editor focus/caret');
    console.log('PROBE PASS: layout popup preserves editor and restores focus');
    runtime._card.grab_key_focus();
    if (runtime._rowWidgets[1].entry.visible || !runtime._rowWidgets[1].preview.visible)
        throw new Error('Ordinary focus loss did not leave edit mode');
    console.log('PROBE PASS: ordinary focus loss still leaves edit mode');
    runtime._selectItem(1, true);
    if (!runtime._rowWidgets[1].row.has_key_focus() ||
        !runtime._rowWidgets[1].row.has_style_class_name('selected'))
        throw new Error('Selection is not highlighted/focused');
    runtime._handleRowKey(1, {
        get_key_symbol: () => Clutter.KEY_Down,
        get_state: () => 0,
    });
    if (runtime._selectedIndex !== 2 ||
        !runtime._rowWidgets[2].row.has_key_focus() ||
        runtime._rowWidgets[1].row.has_style_class_name('selected') ||
        runtime._rowWidgets[1].selectionMark.opacity !== 0 ||
        runtime._rowWidgets[2].selectionMark.opacity !== 255)
        throw new Error('Down arrow did not move selection');
    await delay(100);
    await screenshot('selected-row', runtime._card);
    runtime._handleRowKey(2, {
        get_key_symbol: () => Clutter.KEY_Return,
        get_state: () => 0,
    });
    if (!runtime._rowWidgets[2].entryText.has_key_focus())
        throw new Error('Enter did not open the editor');
    console.log('PROBE PASS: selected row, arrow navigation, Enter to edit');
    const movedItem = runtime._items[2];
    runtime._rowWidgets[2].entryText.set_cursor_position(3);
    runtime._moveItem(2, 1, {cursor: 3, bound: 3});
    await delay(150);
    if (runtime._items[3] !== movedItem || runtime._selectedIndex !== 3 ||
        !runtime._rowWidgets[3].entryText.has_key_focus() ||
        runtime._rowWidgets[3].entryText.get_cursor_position() !== 3)
        throw new Error('Alt+Down did not move item while preserving edit focus/caret');
    runtime._selectItem(3, true);
    runtime._handleRowKey(3, {
        get_key_symbol: () => Clutter.KEY_Up,
        get_state: () => Clutter.ModifierType.MOD1_MASK,
    });
    await delay(150);
    if (runtime._items[2] !== movedItem || runtime._selectedIndex !== 2 ||
        !runtime._rowWidgets[2].row.has_key_focus() ||
        runtime._rowWidgets[2].entryText.has_key_focus())
        throw new Error('Alt+Up did not move selected item without editing');
    console.log('PROBE PASS: Alt+Up/Down reorders in edit and selection modes');
    const handle = runtime._rowWidgets[2].dragHandle;
    if (handle.accessible_name !== 'Переместить выше или ниже стрелками вверх и вниз')
        throw new Error('Drag handle does not describe keyboard reordering');
    handle.grab_key_focus();
    runtime._handleDragHandleKey(2, {
        get_key_symbol: () => Clutter.KEY_Down,
    });
    await delay(150);
    if (runtime._items[3] !== movedItem ||
        !runtime._rowWidgets[3].dragHandle.has_key_focus())
        throw new Error('Down arrow on drag handle did not move item and focus');
    runtime._handleDragHandleKey(3, {
        get_key_symbol: () => Clutter.KEY_Up,
    });
    await delay(150);
    if (runtime._items[2] !== movedItem ||
        !runtime._rowWidgets[2].dragHandle.has_key_focus())
        throw new Error('Up arrow on drag handle did not move item and focus');
    console.log('PROBE PASS: focused drag handle reorders with arrows');
    const heading = runtime._items[0];
    const section = runtime._items.slice(0, runtime._blockRange(0).end);
    runtime._moveItem(0, 1);
    await delay(150);
    const movedHeading = runtime._items.indexOf(heading);
    if (movedHeading <= 0 ||
        runtime._items.slice(movedHeading, movedHeading + section.length)
            .some((item, i) => item !== section[i]))
        throw new Error('Moving a heading split its section');
    console.log('PROBE PASS: moving a heading preserves its section');

    const firstHeading = {type: 'heading', level: 0, text: 'Первый раздел'};
    const movingTask = {type: 'task', level: 0, text: 'Перенести', done: false};
    const childTask = {type: 'task', level: 1, text: 'Дочернее дело', done: false};
    const secondHeading = {type: 'heading', level: 0, text: 'Второй раздел'};
    const secondTask = {type: 'task', level: 0, text: 'Удалить', done: false};
    runtime._items = [firstHeading, movingTask, childTask, secondHeading, secondTask];
    runtime._selectedIndex = -1;
    runtime._renderItems();
    const altDown = {
        get_key_symbol: () => Clutter.KEY_Down,
        get_state: () => Clutter.ModifierType.MOD1_MASK,
    };
    const altUp = {
        get_key_symbol: () => Clutter.KEY_Up,
        get_state: () => Clutter.ModifierType.MOD1_MASK,
    };
    runtime._selectItem(1, true);
    runtime._handleRowKey(1, altDown);
    await delay(150);
    if (runtime._items[1] !== secondHeading || runtime._items[2] !== movingTask ||
        runtime._items[3] !== childTask || runtime._selectedIndex !== 2 ||
        !runtime._rowWidgets[2].row.has_key_focus())
        throw new Error('Alt+Down did not move a task block into the next section');
    runtime._handleRowKey(2, altUp);
    await delay(150);
    if (runtime._items[1] !== movingTask || runtime._items[2] !== childTask ||
        runtime._items[3] !== secondHeading)
        throw new Error('Alt+Up did not move a task block into the previous section');
    runtime._rowWidgets[1].preview.emit('clicked', 1);
    const crossEditor = runtime._rowWidgets[1].entryText;
    crossEditor.set_cursor_position(2);
    runtime._handleEditorShortcut(1, altDown, crossEditor);
    await delay(150);
    if (runtime._items[2] !== movingTask ||
        !runtime._rowWidgets[2].entryText.has_key_focus() ||
        runtime._rowWidgets[2].entryText.get_cursor_position() !== 2)
        throw new Error('Cross-section move lost edit focus/caret');
    console.log('PROBE PASS: Alt+Up/Down crosses sections with child tasks and edit focus');

    const ctrlEnter = {
        get_key_symbol: () => Clutter.KEY_Return,
        get_state: () => Clutter.ModifierType.CONTROL_MASK,
    };
    const editingTask = runtime._rowWidgets[2];
    runtime._handleEditorShortcut(2, ctrlEnter, editingTask.entryText);
    if (!movingTask.done || runtime._rowWidgets[2] !== editingTask ||
        !editingTask.entryText.has_key_focus())
        throw new Error('Ctrl+Enter did not toggle completion during editing');
    runtime._selectItem(2, true);
    runtime._handleRowKey(2, ctrlEnter);
    if (movingTask.done || !runtime._rowWidgets[2].row.has_key_focus() ||
        runtime._rowWidgets[2].entryText.has_key_focus())
        throw new Error('Ctrl+Enter did not toggle completion on a selected task');
    console.log('PROBE PASS: Ctrl+Enter toggles completion in both modes');

    const deleteKey = {
        get_key_symbol: () => Clutter.KEY_Delete,
        get_state: () => 0,
    };
    runtime._rowWidgets[4].preview.emit('clicked', 1);
    const deleteEditor = runtime._rowWidgets[4].entryText;
    if (runtime._handleEditorShortcut(4, deleteKey, deleteEditor) !==
        Clutter.EVENT_PROPAGATE || runtime._items.length !== 5)
        throw new Error('Delete was intercepted while editing text');
    runtime._selectItem(4, true);
    runtime._handleRowKey(4, deleteKey);
    await delay(150);
    if (runtime._items.includes(secondTask) || runtime._items.length !== 4 ||
        runtime._rowWidgets[3].entryText.has_key_focus())
        throw new Error('Delete did not remove the selected task cleanly');
    runtime._selectItem(1, true);
    runtime._rowWidgets[1].row.hover = false;
    if (runtime._rowWidgets[1].remove.opacity !== 0)
        throw new Error('Delete action is visible on the keyboard-selected heading');
    runtime._handleRowKey(1, deleteKey);
    await delay(150);
    if (runtime._items.length !== 3 || runtime._items.includes(secondHeading) ||
        runtime._undoMessage.text !== 'Список удалён')
        throw new Error('Delete did not remove the selected heading');
    runtime._undoDelete();
    await delay(150);
    if (runtime._items[1] !== secondHeading)
        throw new Error('Undo did not restore the selected heading');
    console.log('PROBE PASS: Delete removes selected tasks and headings with Undo, not editor text');
    runtime._items = [
        {type: 'task', level: 0, text: 'Родитель\nКомментарий', done: false},
        {type: 'task', level: 1, text: 'Дочерняя', done: false},
        {type: 'task', level: 2, text: 'Внучатая', done: false},
        {type: 'task', level: 0, text: 'Соседняя', done: false},
    ];
    runtime._renderItems();
    const combinedRow = runtime._rowWidgets[0];
    const combinedActors = combinedRow.row.get_children();
    if (!(combinedActors.indexOf(combinedRow.expandChildren.get_parent()) <
        combinedActors.indexOf(combinedRow.checkbox) &&
        combinedActors.indexOf(combinedRow.checkbox) <
        combinedActors.indexOf(combinedRow.entry.get_parent()) &&
        combinedActors.indexOf(combinedRow.entry.get_parent()) <
        combinedActors.indexOf(combinedRow.expandTask.get_parent()) &&
        combinedActors.indexOf(combinedRow.expandTask.get_parent()) <
        combinedActors.indexOf(combinedRow.addSubtask)) ||
        !combinedRow.expandTask.child.gicon.get_file().get_basename().startsWith('document-text-') ||
        combinedRow.expandChildren.child.icon_name !== 'pan-down-symbolic' ||
        combinedRow.addSubtask.child.icon_name !== 'list-add-symbolic')
        throw new Error('Task, comment, and add-subtask actions are not correctly placed');
    runtime._showActionTooltip(combinedRow.expandChildren);
    if (runtime._actionTooltip.text !== 'Свернуть подзадачи')
        throw new Error('Subtask tooltip does not describe its action');
    runtime._showActionTooltip(combinedRow.expandTask);
    if (runtime._actionTooltip.text !== 'Показать комментарий')
        throw new Error('Comment tooltip does not describe its action');
    runtime._showActionTooltip(combinedRow.addSubtask);
    if (runtime._actionTooltip.text !== 'Добавить подзадачу')
        throw new Error('Add-subtask tooltip does not describe its action');
    runtime._hideActionTooltip();
    runtime._rowWidgets[1].expandChildren.emit('clicked', 1);
    runtime._rowWidgets[0].expandChildren.emit('clicked', 1);
    runtime._rowWidgets[0].expandTask.emit('clicked', 1);
    if (runtime._rowWidgets[1].row.visible || runtime._rowWidgets[2].row.visible ||
        !runtime._rowWidgets[3].row.visible || !runtime._items[0].expanded)
        throw new Error('Subtask folding interfered with the comment or sibling task');
    runtime._rowWidgets[0].expandChildren.emit('clicked', 1);
    if (!runtime._rowWidgets[1].row.visible || runtime._rowWidgets[2].row.visible)
        throw new Error('Nested task fold state was not preserved');
    runtime._renderItems();
    if (!runtime._rowWidgets[1].row.visible || runtime._rowWidgets[2].row.visible)
        throw new Error('Re-render lost the nested fold state');
    runtime._rowWidgets[1].expandChildren.emit('clicked', 1);
    if (!runtime._rowWidgets[2].row.visible)
        throw new Error('Nested subtasks did not expand');
    console.log('PROBE PASS: nested folds preserve child state and comment disclosure');
    runtime._items = [
        {type: 'heading', level: 0, text: 'Основной список'},
        {type: 'task', level: 0, text: 'Родитель', done: false},
        {type: 'task', level: 1, text: 'Дочерняя', done: false},
        {type: 'heading', level: 1, text: 'Вложенный список'},
        {type: 'task', level: 0, text: 'Вложенная задача', done: false},
        {type: 'heading', level: 0, text: 'Другой список'},
        {type: 'task', level: 0, text: 'Другая задача', done: false},
        {type: 'heading', level: 0, text: 'Пустой список'},
    ];
    runtime._renderItems();
    if (runtime._rowWidgets[7].expandList)
        throw new Error('Empty list unexpectedly has a disclosure button');
    if (Math.abs(runtime._rowWidgets[0].entry.get_transformed_position()[0] -
        runtime._rowWidgets[7].entry.get_transformed_position()[0]) > 1)
        throw new Error('Empty heading moved its title into the disclosure column');
    runtime._rowWidgets[1].expandChildren.emit('clicked', 1);
    runtime._rowWidgets[3].expandList.emit('clicked', 1);
    runtime._rowWidgets[0].expandList.emit('clicked', 1);
    if (runtime._rowWidgets.slice(1, 5).some(w => w.row.visible) ||
        !runtime._rowWidgets[5].row.visible || !runtime._rowWidgets[6].row.visible)
        throw new Error('Outer list collapse hid a sibling list');
    runtime._rowWidgets[0].expandList.emit('clicked', 1);
    if (!runtime._rowWidgets[1].row.visible || runtime._rowWidgets[2].row.visible ||
        !runtime._rowWidgets[3].row.visible || runtime._rowWidgets[4].row.visible)
        throw new Error('Opening a list lost its nested fold states');
    runtime._renderItems();
    if (runtime._rowWidgets[2].row.visible || runtime._rowWidgets[4].row.visible)
        throw new Error('Re-render lost nested list or task folds');
    runtime._rowWidgets[0].expandList.emit('clicked', 1);
    runtime._addTaskToHeading(0);
    await delay(150);
    if (runtime._items[3].text !== 'Новая задача' ||
        !runtime._rowWidgets[3].row.visible ||
        !runtime._rowWidgets[3].entryText.has_key_focus() ||
        runtime._items[0].listCollapsed)
        throw new Error('Adding to a collapsed list did not reveal the new task');
    console.log('PROBE PASS: nested list folds survive re-render and adding to a folded list');
    runtime._items = [
        {type: 'task', level: 0, text: 'Родитель\nКомментарий', done: false,
            childrenCollapsed: true},
        {type: 'task', level: 1, text: 'Первая дочерняя', done: false},
        {type: 'task', level: 2, text: 'Внучатая', done: false},
        {type: 'task', level: 0, text: 'Соседняя', done: false},
        {type: 'task', level: 5, text: 'Предельная глубина', done: false},
    ];
    runtime._renderItems();
    if (!runtime._rowWidgets[0].addSubtask ||
        runtime._rowWidgets[4].addSubtask ||
        runtime._rowWidgets[1].row.visible)
        throw new Error('Add-subtask availability or initial fold state is wrong');
    if (Math.abs(runtime._rowWidgets[0].expandTask.get_parent().get_transformed_position()[0] -
        runtime._rowWidgets[4].expandTask.get_parent().get_transformed_position()[0]) > 1)
        throw new Error('Maximum-depth task moved the comment action column');
    const sibling = runtime._items[3];
    runtime._rowWidgets[0].addSubtask.emit('clicked', 1);
    await delay(150);
    if (runtime._items[3].text !== 'Новая задача' ||
        runtime._items[3].level !== 1 || runtime._items[4] !== sibling ||
        runtime._items[0].childrenCollapsed ||
        !runtime._rowWidgets[3].row.visible ||
        !runtime._rowWidgets[3].entryText.has_key_focus())
        throw new Error('Adding a subtask did not append to the parent branch and focus it');
    console.log('PROBE PASS: add-subtask action follows comment, opens parent, and focuses new child');
    runtime._items = [
        {type: 'heading', level: 0, text: 'Раздел'},
        {type: 'task', level: 0, text: 'Родитель', done: false},
        {type: 'task', level: 1, text: 'Дочерняя', done: false},
        {type: 'task', level: 2, text: 'Внучатая', done: false},
        {type: 'task', level: 0, text: 'Следующая', done: false},
    ];
    runtime._renderItems();
    const nextTask = runtime._items[4];
    runtime._selectItem(2, true);
    if (runtime._handleRowKey(2, {
        get_key_symbol: () => Clutter.KEY_Return,
        get_state: () => Clutter.ModifierType.SHIFT_MASK,
    }) !== Clutter.EVENT_STOP)
        throw new Error('Shift+Enter was not handled on a selected task');
    await delay(150);
    if (runtime._items[3].text !== 'Внучатая' ||
        runtime._items[4].text !== 'Новая задача' ||
        runtime._items[4].level !== 1 || runtime._items[5] !== nextTask ||
        runtime._selectedIndex !== 4 ||
        !runtime._rowWidgets[4].entryText.has_key_focus())
        throw new Error('Shift+Enter did not add a sibling after the selected task branch');
    runtime._selectItem(1, true);
    runtime._handleRowKey(1, {
        get_key_symbol: () => Clutter.KEY_KP_Enter,
        get_state: () => Clutter.ModifierType.SHIFT_MASK,
    });
    await delay(150);
    if (runtime._items[5].text !== 'Новая задача' ||
        runtime._items[5].level !== 0 || runtime._items[6] !== nextTask ||
        runtime._selectedIndex !== 5 ||
        !runtime._rowWidgets[5].entryText.has_key_focus())
        throw new Error('Shift+KP_Enter did not add a top-level sibling after the branch');
    console.log('PROBE PASS: Shift+Enter adds a same-level task after its branch in navigation mode');
    runtime._items = [
        {type: 'heading', level: 0, text: 'Раздел'},
        {type: 'task', level: 0, text: 'Задача', done: false},
    ];
    runtime._renderItems();
    const tabKey = {
        get_key_symbol: () => Clutter.KEY_Tab,
        get_state: () => 0,
    };
    const shiftTabKey = {
        get_key_symbol: () => Clutter.KEY_ISO_Left_Tab,
        get_state: () => Clutter.ModifierType.SHIFT_MASK,
    };
    runtime._selectItem(1, true);
    if (runtime._handleRowKey(1, tabKey) !== Clutter.EVENT_STOP ||
        runtime._items[1].level !== 1 ||
        !runtime._rowWidgets[1].row.has_key_focus() ||
        runtime._rowWidgets[1].entryText.has_key_focus())
        throw new Error('Tab did not indent the selected task without editing it');
    runtime._handleRowKey(1, shiftTabKey);
    runtime._handleRowKey(1, shiftTabKey);
    if (runtime._items[1].level !== 0 ||
        !runtime._rowWidgets[1].row.has_key_focus())
        throw new Error('Shift+Tab did not outdent the task with a zero-level bound');
    runtime._selectItem(0, true);
    runtime._handleRowKey(0, tabKey);
    if (runtime._items[0].level !== 1 ||
        !runtime._rowWidgets[0].row.has_key_focus())
        throw new Error('Tab did not indent the selected heading');
    runtime._handleRowKey(0, {
        get_key_symbol: () => Clutter.KEY_Tab,
        get_state: () => Clutter.ModifierType.SHIFT_MASK,
    });
    if (runtime._items[0].level !== 0)
        throw new Error('Shift+Tab did not outdent the selected heading');
    runtime._selectItem(1, true);
    const navigationKeyboard = Clutter.get_default_backend().get_default_seat()
        .create_virtual_device(Clutter.VirtualDeviceType.KEYBOARD);
    navigationKeyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Tab, Clutter.KeyState.PRESSED);
    navigationKeyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Tab, Clutter.KeyState.RELEASED);
    await delay(100);
    if (runtime._items[1].level !== 1 ||
        !runtime._rowWidgets[1].row.has_key_focus())
        throw new Error('Real Tab event did not indent the selected task');
    navigationKeyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
    navigationKeyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Tab, Clutter.KeyState.PRESSED);
    navigationKeyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Tab, Clutter.KeyState.RELEASED);
    navigationKeyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
    await delay(100);
    if (runtime._items[1].level !== 0 ||
        !runtime._rowWidgets[1].row.has_key_focus())
        throw new Error('Real Shift+Tab event did not outdent the selected task');
    console.log('PROBE PASS: Tab and Shift+Tab change selected task and heading levels');
    runtime._items = [
        {type: 'heading', level: 0, text: 'Сегодня'},
        {type: 'task', level: 0, text: 'Подготовить релиз\nСверить сценарии',
            done: false, expanded: true},
        {type: 'task', level: 1, text: 'Проверить код', done: true},
        {type: 'heading', level: 0, text: 'Позже'},
        {type: 'task', level: 0, text: 'Спланировать неделю', done: false},
    ];
    runtime._renderItems();
    runtime._card.set_size(430, 370);
    runtime._card.set_style('box-shadow: 0 10px 40px 4px rgba(29, 38, 53, 0.16);');
    const screenshotFrame = new St.Widget({
        width: 590,
        height: 530,
        style: 'background-color: #ffffff;',
    });
    screenshotFrame.set_position(20, 20);
    Main.layoutManager.addTopChrome(screenshotFrame);
    if (screenshotFrame.get_parent() !== runtime._card.get_parent())
        throw new Error('Screenshot frame and widget have different parents');
    runtime._resizeHandle.set_position(900, 700);
    runtime._card.get_parent().set_child_below_sibling(screenshotFrame, runtime._card);
    runtime._card.set_position(100, 100);
    runtime._selectItem(1, true);
    await delay(250);
    await screenshot('readme-widget', screenshotFrame);
    screenshotFrame.destroy();
    runtime._items = [
        {type: 'heading', level: 0, text: 'Сетка задач'},
        {type: 'task', level: 0, text: 'Родитель', done: false},
        {type: 'task', level: 1, text: 'Дочерняя задача', done: false},
        {type: 'task', level: 2, text: 'Длинная вложенная задача с текстом в две строки для проверки подсветки и положения кнопок', done: false},
        {type: 'task', level: 3, text: 'Третий уровень', done: true},
        {type: 'task', level: 4, text: 'Четвёртый уровень', done: false},
        {type: 'task', level: 5, text: 'Без кнопки добавления', done: false},
    ];
    runtime._renderItems();
    runtime._card.set_size(430, 600);
    runtime._selectItem(3, true);
    await delay(250);
    const nestedRows = runtime._rowWidgets.slice(1);
    const firstMarkX = nestedRows[0].selectionMark.get_transformed_position()[0];
    const firstDragX = nestedRows[0].dragHandle.get_transformed_position()[0];
    const firstRemoveX = nestedRows[0].remove.get_transformed_position()[0];
    const firstRowRight = nestedRows[0].row.get_transformed_position()[0] +
        nestedRows[0].row.width;
    for (const [level, widgets] of nestedRows.entries()) {
        const markX = widgets.selectionMark.get_transformed_position()[0];
        const dragX = widgets.dragHandle.get_transformed_position()[0];
        const removeX = widgets.remove.get_transformed_position()[0];
        const rowX = widgets.row.get_transformed_position()[0];
        if (Math.abs(markX - firstMarkX - level * 20) > 1 ||
            Math.abs(dragX - firstDragX - level * 20) > 1 ||
            Math.abs(removeX - firstRemoveX) > 1 ||
            Math.abs(markX - rowX - 3) > 1 ||
            Math.abs(rowX + widgets.row.width - firstRowRight) > 1 ||
            Math.abs(dragX - markX - (firstDragX - firstMarkX)) > 1)
            throw new Error('Nested task columns or indicator gap drifted');
    }
    if (nestedRows[5].addSubtask ||
        !nestedRows[5].row.get_children().some(actor =>
            actor.has_style_class_name('overview-todo-add-subtask-slot')))
        throw new Error('Missing add action did not reserve its column');
    await screenshot('nested-grid', runtime._card);
    console.log('PROBE PASS: levels 0–5 keep the control grid and absent add slot');
    const hoveredRow = nestedRows[1].row;
    hoveredRow.hover = true;
    await delay(200);
    if (!hoveredRow.hover || nestedRows[1].remove.opacity !== 255 ||
        !nestedRows[1].dragHandle.has_style_class_name('overview-todo-row-emphasis') ||
        !nestedRows[1].addSubtask.has_style_class_name('overview-todo-row-emphasis') ||
        !nestedRows[1].remove.has_style_class_name('overview-todo-row-emphasis'))
        throw new Error('Hover did not emphasize row actions');
    await screenshot('nested-hover', runtime._card);
    hoveredRow.hover = false;
    runtime._selectItem(2, true);
    if (!nestedRows[1].row.has_key_focus() ||
        !nestedRows[1].addSubtask.has_style_class_name('overview-todo-row-emphasis') ||
        nestedRows[2].addSubtask.has_style_class_name('overview-todo-row-emphasis'))
        throw new Error('Keyboard selection did not emphasize only the active row');
    console.log('PROBE PASS: hover and keyboard focus emphasize secondary actions');
    runtime._items = [
        {type: 'task', level: 0, text: 'Только добавить', done: false},
        {type: 'task', level: 0, text: 'Добавить и удалить', done: false},
        {type: 'task', level: 0, text: 'Задача с комментарием\nДетали задачи', done: false},
    ];
    runtime._renderItems();
    runtime._card.set_size(430, 260);
    await delay(200);
    const actionRows = runtime._rowWidgets;
    for (const widgets of actionRows) {
        const actions = [widgets.expandTask, widgets.addSubtask, widgets.remove]
            .filter(button => button?.visible);
        for (const button of actions) {
            const [width, height] = button.get_transformed_size();
            const [iconWidth, iconHeight] = button.child.get_transformed_size();
            const [x, y] = button.get_transformed_position();
            const [iconX, iconY] = button.child.get_transformed_position();
            if (width !== 24 || height !== 24 || iconWidth !== 16 || iconHeight !== 16 ||
                Math.abs(iconX + 8 - x - 12) > 1 ||
                Math.abs(iconY + 8 - y - 12) > 1)
                throw new Error(`Right action geometry differs: ${button.style_class}`);
        }
    }
    const [, svgBytes] = Gio.File.new_for_path(`${root}/document-text-symbolic.svg`)
        .load_contents(null);
    const svgHash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256,
        new TextDecoder().decode(svgBytes), -1);
    if (actionRows[2].expandTask.child.gicon.get_file().get_basename() !==
            `document-text-${svgHash}-symbolic.svg` ||
        !actionRows[2].expandTask.child.is_symbolic ||
        actionRows[1].addSubtask.child.icon_name !== 'list-add-symbolic' ||
        actionRows[1].remove.child.icon_name !== 'user-trash-symbolic' ||
        actionRows[0].expandTask.visible || actionRows[1].expandTask.visible)
        throw new Error('Right action icon family or conditional details action differs');
    runtime._selectItem(2, true);
    await delay(200);
    await screenshot('right-actions-add-only', runtime._card);
    runtime._selectItem(1, true);
    await delay(200);
    await screenshot('right-actions-add-remove', runtime._card);
    runtime._selectItem(2, true);
    await delay(200);
    await screenshot('right-actions-details-add-remove', runtime._card);
    runtime._rowWidgets[0].row.hover = true;
    await delay(200);
    if (!actionRows[0].addSubtask.has_style_class_name('overview-todo-row-emphasis') ||
        !actionRows[2].expandTask.has_style_class_name('overview-todo-row-emphasis'))
        throw new Error('Hover or keyboard selection does not emphasize all right actions');
    await screenshot('right-actions-hover-focus', runtime._card);
    runtime._rowWidgets[0].row.hover = false;
    runtime.disable();
    Main.overview.hide();
    await delay(900);
    const iconFixtureDir = Gio.File.new_for_path(`${output}/icon-fixture`);
    iconFixtureDir.make_directory(null);
    const iconFixture = iconFixtureDir.get_child('document-text-symbolic.svg');
    Gio.File.new_for_path(`${root}/document-text-symbolic.svg`)
        .copy(iconFixture, Gio.FileCopyFlags.NONE, null, null);
    const iconRuntime = factory({Clutter, Gio, GLib, St, Main,
        extensionPath: iconFixtureDir.get_path(), config: {
            dataFile: `${output}/icon-fixture-todo.md`,
            defaultContent: '- [ ] Проверка иконки\n',
        }});
    iconRuntime.enable();
    Main.overview.show();
    await delay(900);
    iconRuntime._items[0].text = 'Проверка иконки\nКомментарий';
    iconRuntime._renderItems();
    await delay(200);
    const beforeIconPath = iconRuntime._rowWidgets[0].expandTask.child.gicon
        .get_file().get_path();
    if (!iconRuntime._rowWidgets[0].expandTask.child.is_symbolic)
        throw new Error('The visible document icon is not symbolic before editing the SVG');
    const [, iconBytes] = iconFixture.load_contents(null);
    const changedSvg = `${new TextDecoder().decode(iconBytes)}\n<!-- updated -->\n`;
    iconFixture.replace_contents(changedSvg, null, false, Gio.FileCreateFlags.NONE, null);
    await delay(700);
    const refreshedIcon = iconRuntime._rowWidgets[0].expandTask.child;
    if (refreshedIcon.gicon.get_file().get_path() === beforeIconPath ||
        !refreshedIcon.is_symbolic)
        throw new Error('Editing the SVG did not refresh the symbolic icon in place');
    iconRuntime.disable();
    Main.overview.hide();
    await delay(900);
    console.log('PROBE PASS: editing the SVG refreshes the icon without restarting GNOME Shell');
    let openedPreferences = 0;
    const focusRuntime = factory({Clutter, Gio, GLib, St, Main, extensionPath: root,
        openPreferences: () => openedPreferences++, config: {
        dataFile: `${output}/focus-todo.md`,
        defaultContent: '# Первый раздел\n- [ ] Первое дело\n',
    }});
    focusRuntime.enable();
    if (focusRuntime._card.height < 150 || focusRuntime._card.height >= 360)
        throw new Error(`Short list did not get a compact card: ${focusRuntime._card.height}`);
    console.log('PROBE PASS: short list uses compact card height');
    const compactWidth = focusRuntime._card.width;
    textSettings.set_double('text-scaling-factor', 1.5);
    await delay(150);
    if (focusRuntime._card.width <= compactWidth)
        throw new Error('Live text-scale change did not resize the widget');
    textSettings.set_double('text-scaling-factor', 1);
    await delay(150);
    if (focusRuntime._card.width !== compactWidth)
        throw new Error('Widget width did not return after text-scale reset');
    console.log('PROBE PASS: enabled widget follows live text-scale changes');
    contrastSettings.set_boolean('high-contrast', true);
    await delay(150);
    if (!focusRuntime._card.has_style_class_name('high-contrast'))
        throw new Error('Enabled widget did not follow High Contrast setting');
    contrastSettings.set_boolean('high-contrast', false);
    await delay(150);
    if (focusRuntime._card.has_style_class_name('high-contrast'))
        throw new Error('Enabled widget did not leave High Contrast mode');
    console.log('PROBE PASS: enabled widget follows live High Contrast changes');
    Main.overview.show();
    await delay(900);
    if (!focusRuntime._rowWidgets[0].row.has_key_focus() ||
        focusRuntime._rowWidgets[0].entryText.has_key_focus())
        throw new Error('Overview opening did not focus the first row');
    Main.overview.hide();
    await delay(900);
    focusRuntime._selectItem(1);
    Main.overview.show();
    await delay(900);
    if (focusRuntime._selectedIndex !== 1 ||
        !focusRuntime._rowWidgets[1].row.has_key_focus() ||
        focusRuntime._rowWidgets[1].entryText.has_key_focus())
        throw new Error('Overview reopening did not restore the selected row');
    console.log('PROBE PASS: Overview opening and reopening focus the selected row');
    focusRuntime._rowWidgets[1].preview.emit('clicked', 1);
    const focusedEditor = focusRuntime._rowWidgets[1].entryText;
    focusedEditor.insert_text('!', -1);
    const keyboard = Clutter.get_default_backend().get_default_seat()
        .create_virtual_device(Clutter.VirtualDeviceType.KEYBOARD);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_a, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_a, Clutter.KeyState.RELEASED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    await delay(100);
    if (focusedEditor.get_selection() !== 'Первое дело!' ||
        !focusedEditor.has_key_focus())
        throw new Error('Ctrl+A did not select all text in the editor');
    console.log('PROBE PASS: Ctrl+A selects all editor text');
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_z, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_z, Clutter.KeyState.RELEASED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    await delay(100);
    if (focusRuntime._items[1].text !== 'Первое дело' ||
        !focusedEditor.has_key_focus())
        throw new Error(`Ctrl+Z key event escaped to Overview search: text=${focusRuntime._items[1].text}, focus=${global.stage.get_key_focus()}`);
    const inputSources = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
    inputSources.set_value('sources', new GLib.Variant('a(ss)',
        [['xkb', 'us'], ['xkb', 'ru']]));
    await delay(300);
    const russianSource = Main.panel.statusArea.keyboard._inputSourceManager._inputSources[1];
    if (!russianSource)
        throw new Error('Russian input source was not registered in the isolated Shell');
    russianSource.activate(true);
    await delay(300);
    focusedEditor.grab_key_focus();
    focusedEditor.set_text('Первое дело!');
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_ya, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_ya, Clutter.KeyState.RELEASED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    await delay(100);
    if (focusRuntime._items[1].text !== 'Первое дело' ||
        !focusedEditor.has_key_focus())
        throw new Error(`Russian Ctrl+Z key event escaped to Overview search: text=${focusRuntime._items[1].text}, focus=${global.stage.get_key_focus()}`);
    console.log('PROBE PASS: actual Ctrl+Z key event stays in the editor for English and Russian layouts');
    focusedEditor.set_text('Первое дело');
    focusedEditor.set_cursor_position(3);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_ef, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_ef, Clutter.KeyState.RELEASED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    await delay(100);
    if (focusedEditor.get_selection() !== 'Первое дело' ||
        !focusedEditor.has_key_focus())
        throw new Error('Russian Ctrl+A did not select all editor text');
    console.log('PROBE PASS: Russian Ctrl+A selects all editor text');
    focusedEditor.set_text('Копировать');
    focusedEditor.set_selection(0, 4);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_es, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_es, Clutter.KeyState.RELEASED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    await delay(100);
    const copiedText = await new Promise(resolve =>
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD,
            (_clipboard, text) => resolve(text)));
    if (copiedText !== 'Копи' || focusedEditor.get_text() !== 'Копировать' ||
        !focusedEditor.has_key_focus())
        throw new Error(`Russian Ctrl+C did not copy the selection: ${copiedText}`);
    console.log('PROBE PASS: Russian Ctrl+C copies selected editor text');
    focusedEditor.set_text('Вырезать');
    focusedEditor.set_selection(0, 3);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_che, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_che, Clutter.KeyState.RELEASED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    await delay(100);
    const cutText = await new Promise(resolve =>
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD,
            (_clipboard, text) => resolve(text)));
    if (cutText !== 'Выр' || focusedEditor.get_text() !== 'езать' ||
        focusRuntime._items[1].text !== 'езать' || !focusedEditor.has_key_focus())
        throw new Error(`Russian Ctrl+X did not cut selection: ${cutText}`);
    console.log('PROBE PASS: Russian Ctrl+X cuts selected editor text');
    focusedEditor.set_cursor_position(0);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_em, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_em, Clutter.KeyState.RELEASED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    await delay(100);
    if (focusedEditor.get_text() !== 'Вырезать' ||
        focusRuntime._items[1].text !== 'Вырезать' ||
        !focusedEditor.has_key_focus())
        throw new Error(`Russian Ctrl+V did not paste at the editor cursor: ${focusedEditor.get_text()}, ${focusRuntime._items[1].text}, ${focusedEditor.get_cursor_position()}`);
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'Другое');
    focusedEditor.set_selection(0, 3);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_em, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_em, Clutter.KeyState.RELEASED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    await delay(100);
    if (focusedEditor.get_text() !== 'Другоеезать' ||
        focusRuntime._items[1].text !== 'Другоеезать' ||
        !focusedEditor.has_key_focus())
        throw new Error('Russian Ctrl+V did not replace the editor selection');
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_ya, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Cyrillic_ya, Clutter.KeyState.RELEASED);
    keyboard.notify_keyval(Clutter.CURRENT_TIME, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    await delay(100);
    if (focusedEditor.get_text() !== 'Вырезать')
        throw new Error('One undo did not revert the pasted selection');
    console.log('PROBE PASS: Russian Ctrl+V pastes at cursor and replaces selection');
    focusRuntime._addItem('task');
    await delay(300);
    if (focusRuntime._items[0].type !== 'task' ||
        focusRuntime._items[1].type !== 'heading' ||
        focusRuntime._selectedIndex !== 0 ||
        !focusRuntime._rowWidgets[0].entryText.has_key_focus())
        throw new Error('Global add did not insert a free task before the first list');
    focusRuntime._addItem('task');
    await delay(300);
    if (focusRuntime._items[1].type !== 'task' ||
        focusRuntime._items[2].type !== 'heading' ||
        focusRuntime._selectedIndex !== 1)
        throw new Error('Global add did not append to the free task block');
    console.log('PROBE PASS: global add inserts free tasks before the first list');
    focusRuntime._items = [
        {type: 'heading', level: 0, text: 'Список'},
        {type: 'task', level: 0, text: 'Родитель', done: false},
    ];
    focusRuntime._renderItems();
    const cancelNewItem = async add => {
        const before = [...focusRuntime._items];
        add();
        await delay(150);
        const index = focusRuntime._selectedIndex;
        const item = focusRuntime._items[index];
        const editor = focusRuntime._rowWidgets[index]?.entryText;
        if (!editor?.has_key_focus() || !item || before.includes(item))
            throw new Error('New item did not open its editor');
        focusRuntime._handleEditorShortcut(index, escapeKey, editor);
        await delay(150);
        if (focusRuntime._items.length !== before.length ||
            focusRuntime._items.some((existing, i) => existing !== before[i]) ||
            focusRuntime._undoBar.visible)
            throw new Error('Escape did not discard an untouched new item');
    };
    await cancelNewItem(() => focusRuntime._addItem('task'));
    await cancelNewItem(() => focusRuntime._addItem('heading'));
    await cancelNewItem(() => focusRuntime._addTaskToHeading(0));
    await cancelNewItem(() => focusRuntime._addSubtask(1));
    await cancelNewItem(() => focusRuntime._addSiblingTask(1));
    focusRuntime._addItem('task');
    await delay(150);
    const typedItem = focusRuntime._items[0];
    const typedEditor = focusRuntime._rowWidgets[0].entryText;
    typedEditor.set_text('Введённый текст');
    focusRuntime._handleEditorShortcut(0, escapeKey, typedEditor);
    if (focusRuntime._items[0] !== typedItem ||
        typedItem.text !== 'Новая задача' ||
        !focusRuntime._rowWidgets[0].row.has_key_focus())
        throw new Error('Escape removed a new item after text was entered');
    console.log('PROBE PASS: Escape discards untouched new tasks and headings, but cancels edits after input');
    focusRuntime._items = [
        {type: 'heading', level: 0, text: 'Длинный список'},
        ...Array.from({length: 30}, (_, i) => ({
            type: 'task', level: 0, text: `Задача ${i + 1}`, done: false,
        })),
    ];
    focusRuntime._renderItems();
    focusRuntime._card.set_size(430, 300);
    await delay(150);
    const newRowInViewport = () => {
        const row = focusRuntime._rowWidgets[focusRuntime._selectedIndex].row;
        const [, top] = row.get_transformed_position();
        const [, height] = row.get_transformed_size();
        const [, viewportTop] = focusRuntime._scroll.get_transformed_position();
        const [, viewportHeight] = focusRuntime._scroll.get_transformed_size();
        return top >= viewportTop && top + height <= viewportTop + viewportHeight;
    };
    focusRuntime._addItem('heading');
    await delay(200);
    if (!newRowInViewport())
        throw new Error('New heading at the end was not scrolled into view');
    const adjustment = focusRuntime._scroll.get_vadjustment();
    adjustment.set_value(adjustment.get_upper() - adjustment.get_page_size());
    await delay(100);
    focusRuntime._addItem('task');
    await delay(200);
    if (!newRowInViewport())
        throw new Error('New task near the start was not scrolled into view');
    console.log('PROBE PASS: new rows scroll into the viewport from either end');

    const settingsButton = buttonsIn(focusRuntime._card)
        .find(child => child.accessible_name === 'Настройки виджета');
    settingsButton.emit('clicked', 1);
    if (openedPreferences !== 1 || focusRuntime._card.get_children().length !== 2)
        throw new Error('Gear did not open the separate preferences window');
    console.log('PROBE PASS: gear invokes the extension preferences window');

    const newDataPath = `${output}/settings-todo.md`;
    Gio.File.new_for_path(newDataPath).replace_contents(
        new TextEncoder().encode('# Новый файл\n- [ ] Дело\n'),
        null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    Gio.File.new_for_path(`${output}/config/overview-todo-settings.json`).replace_contents(
        new TextEncoder().encode(JSON.stringify({dataFile: newDataPath})),
        null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    await delay(350);
    if (focusRuntime._dataPath !== newDataPath ||
        focusRuntime._items[0]?.text !== 'Новый файл' ||
        !Gio.File.new_for_path(newDataPath).query_exists(null))
        throw new Error('External settings did not switch the data file');
    const savedSettings = JSON.parse(new TextDecoder().decode(
        Gio.File.new_for_path(`${output}/config/overview-todo-settings.json`).load_contents(null)[1]));
    if (savedSettings.dataFile !== newDataPath)
        throw new Error('Data file path did not persist');
    const restoredRuntime = factory({Clutter, Gio, GLib, St, Main, extensionPath: root, config: {
        dataFile: `${output}/focus-todo.md`,
    }});
    restoredRuntime._settingsFile = Gio.File.new_for_path(`${output}/config/overview-todo-settings.json`);
    restoredRuntime._loadSettings();
    if (restoredRuntime._dataPath !== newDataPath)
        throw new Error('Saved data file path was not restored');
    console.log('PROBE PASS: settings file changes switch the data file immediately');

    focusRuntime._sizeOverride = {width: 500, height: 500};
    focusRuntime._saveSize();
    focusRuntime._positionCard();
    focusRuntime._sizeFile.delete(null);
    await delay(350);
    if (focusRuntime._sizeOverride ||
        focusRuntime._sizeFile.query_exists(null) || focusRuntime._card.height >= 360)
        throw new Error('External reset did not restore compact automatic height');
    const resetHeight = focusRuntime._card.height;
    focusRuntime._items.push(...Array.from({length: 12}, (_, i) => ({
        type: 'task', level: 0, text: `Дополнительная задача ${i}`, done: false,
    })));
    focusRuntime._renderItems();
    await delay(150);
    if (focusRuntime._card.height <= resetHeight)
        throw new Error('Automatic height did not grow with the list after reset');
    console.log('PROBE PASS: reset removes saved size and restores content-driven height');
    focusRuntime.disable();

    const prefsOutput = `${output}/prefs-probe`;
    GLib.mkdir_with_parents(`${prefsOutput}/config`, 0o700);
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    launcher.setenv('GVIDO_TEST_ROOT', root, true);
    launcher.setenv('GVIDO_TEST_OUTPUT', prefsOutput, true);
    launcher.setenv('XDG_CONFIG_HOME', `${prefsOutput}/config`, true);
    launcher.setenv('GI_TYPELIB_PATH', '/usr/lib/gnome-shell/girepository-1.0', true);
    const prefsProbe = launcher.spawnv(['gjs', '-m', `${root}/tests/prefs-probe.js`]);
    const [prefsOk, prefsStdout, prefsStderr] = await new Promise((resolve, reject) => {
        prefsProbe.communicate_utf8_async(null, null, (process, result) => {
            try {
                resolve(process.communicate_utf8_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
    if (!prefsOk || !prefsProbe.get_successful() ||
        !prefsStdout.includes('PREFS PROBE COMPLETE'))
        throw new Error(`Preferences window probe failed: ${prefsStderr}`);
    console.log('PROBE PASS: separate preferences window saves paths and resets size');
    console.log('PROBE COMPLETE');
    global.context.terminate();
}

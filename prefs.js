import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SETTINGS_NAME = 'overview-todo-settings.json';
const SIZE_NAME = 'overview-todo-size.json';

function expandHome(path) {
    if (path === '~')
        return GLib.get_home_dir();
    if (path.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
    return path;
}

export default class GvidoPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const config = JSON.parse(new TextDecoder().decode(
            this.dir.get_child('config.json').load_contents(null)[1]));
        const configDir = GLib.get_user_config_dir();
        const settingsFile = Gio.File.new_for_path(GLib.build_filenamev([configDir, SETTINGS_NAME]));
        const sizeFile = Gio.File.new_for_path(GLib.build_filenamev([configDir, SIZE_NAME]));
        let dataPath = config.dataFile || '~/todo.md';
        try {
            const saved = JSON.parse(new TextDecoder().decode(settingsFile.load_contents(null)[1]));
            if (typeof saved.dataFile === 'string' && saved.dataFile.trim())
                dataPath = saved.dataFile;
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.error(`[Gvido] Could not read settings: ${error}`);
        }

        const page = new Adw.PreferencesPage({title: 'Gvido'});
        const group = new Adw.PreferencesGroup({title: 'Файл задач'});
        page.add(group);
        window.add(page);

        const pathRow = new Adw.EntryRow({title: 'Путь к файлу задач', text: dataPath});
        group.add(pathRow);

        const sizeGroup = new Adw.PreferencesGroup({title: 'Размер виджета'});
        page.add(sizeGroup);
        const resetRow = new Adw.ActionRow({
            title: 'Сбросить размер',
            subtitle: 'Ширина вернётся к исходной, высота подстроится под список',
        });
        const resetButton = new Gtk.Button({label: 'Сбросить', valign: Gtk.Align.CENTER});
        sizeGroup.add(resetRow);
        resetRow.add_suffix(resetButton);

        const statusRow = new Adw.ActionRow({visible: false});
        sizeGroup.add(statusRow);
        const showStatus = message => {
            statusRow.title = message;
            statusRow.visible = Boolean(message);
        };

        const savePath = () => {
            const path = pathRow.text.trim();
            if (path === dataPath)
                return;
            const expanded = expandHome(path);
            if (!path || !GLib.path_is_absolute(expanded)) {
                showStatus('Укажите абсолютный путь к файлу');
                return;
            }
            try {
                const file = Gio.File.new_for_path(expanded);
                if (file.query_exists(null)) {
                    if (file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) !== Gio.FileType.REGULAR)
                        throw new Error('Путь должен указывать на обычный файл');
                    file.load_contents(null);
                } else {
                    file.replace_contents(new TextEncoder().encode(config.defaultContent || ''),
                        null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                }
                GLib.mkdir_with_parents(configDir, 0o700);
                settingsFile.replace_contents(new TextEncoder().encode(JSON.stringify({dataFile: path})),
                    null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                dataPath = path;
                showStatus('Путь сохранён');
            } catch (error) {
                showStatus(`Не удалось открыть файл: ${error.message || error}`);
            }
        };
        const pathFocus = new Gtk.EventControllerFocus();
        pathFocus.connect('leave', savePath);
        pathRow.add_controller(pathFocus);

        resetButton.connect('clicked', () => {
            try {
                sizeFile.delete(null);
                showStatus('Размер сброшен');
            } catch (error) {
                if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    showStatus('Размер уже исходный');
                else
                    showStatus(`Не удалось сбросить размер: ${error.message || error}`);
            }
        });
    }
}

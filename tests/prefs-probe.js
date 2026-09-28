import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

Gio.resources_register(Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));
const root = GLib.getenv('GVIDO_TEST_ROOT');
const output = GLib.getenv('GVIDO_TEST_OUTPUT');
const {default: Preferences} = await import(`file://${root}/prefs.js`);
Adw.init();
const prefs = new Preferences({uuid: 'gvido@local', dir: Gio.File.new_for_path(root), path: root});
const window = new Adw.PreferencesWindow();
prefs.fillPreferencesWindow(window);
function descendants(widget) {
    const result = [widget];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        result.push(...descendants(child));
    return result;
}
const widgets = descendants(window);
const entry = widgets.find(widget => widget instanceof Adw.EntryRow);
const save = widgets.find(widget => widget instanceof Gtk.Button && widget.label === 'Сохранить');
const reset = widgets.find(widget => widget instanceof Gtk.Button && widget.label === 'Сбросить');
if (!entry || save || !reset)
    throw new Error('Preferences controls missing');
const controllers = entry.observe_controllers();
let focusController;
for (let index = 0; index < controllers.get_n_items(); index++) {
    const controller = controllers.get_item(index);
    if (controller instanceof Gtk.EventControllerFocus)
        focusController = controller;
}
if (!focusController)
    throw new Error('Path focus handler missing');
entry.text = 'relative.md';
focusController.emit('leave');
if (Gio.File.new_for_path(`${output}/config/overview-todo-settings.json`).query_exists(null))
    throw new Error('Relative path was accepted');
entry.text = `${output}/tasks.md`;
focusController.emit('leave');
const [, saved] = Gio.File.new_for_path(`${output}/config/overview-todo-settings.json`).load_contents(null);
if (JSON.parse(new TextDecoder().decode(saved)).dataFile !== entry.text ||
    !Gio.File.new_for_path(entry.text).query_exists(null))
    throw new Error('Preferences did not save path or create data file');
const size = Gio.File.new_for_path(`${output}/config/overview-todo-size.json`);
size.replace_contents(new TextEncoder().encode('{"width":500,"height":500}'), null, false, Gio.FileCreateFlags.NONE, null);
reset.emit('clicked');
if (size.query_exists(null))
    throw new Error('Preferences did not reset size');
print('PREFS PROBE COMPLETE');
window.destroy();

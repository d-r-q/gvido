import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const LIVE_FILES = new Set(['runtime.js', 'config.json', 'theme.css']);
const RELOAD_DELAY_MS = 120;

function decode(bytes) {
    return new TextDecoder().decode(bytes);
}

export default class OverviewTodoExtension extends Extension {
    enable() {
        this._runtime = null;
        this._config = null;
        this._themeFile = null;
        this._dirMonitor = null;
        this._reloadSourceId = 0;

        this._watchDirectory();
        this._reloadAll('enable');
    }

    disable() {
        if (this._reloadSourceId) {
            GLib.Source.remove(this._reloadSourceId);
            this._reloadSourceId = 0;
        }

        this._dirMonitor?.cancel();
        this._dirMonitor = null;

        try {
            this._runtime?.disable();
        } catch (error) {
            console.error(`[Overview Todo] Runtime disable failed: ${error}`);
        }
        this._runtime = null;

        this._unloadTheme();
        this._config = null;
    }

    _watchDirectory() {
        try {
            this._dirMonitor = this.dir.monitor_directory(
                Gio.FileMonitorFlags.WATCH_MOVES,
                null
            );
            this._dirMonitor.connect('changed', (_monitor, file, otherFile) => {
                const names = [file, otherFile]
                    .filter(Boolean)
                    .map(item => item.get_basename());

                if (!names.some(name => LIVE_FILES.has(name)))
                    return;

                this._scheduleReload();
            });
        } catch (error) {
            console.error(`[Overview Todo] Could not watch extension directory: ${error}`);
        }
    }

    _scheduleReload() {
        if (this._reloadSourceId)
            GLib.Source.remove(this._reloadSourceId);

        this._reloadSourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            RELOAD_DELAY_MS,
            () => {
                this._reloadSourceId = 0;
                this._reloadAll('file change');
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _readText(name) {
        const file = this.dir.get_child(name);
        const [ok, bytes] = file.load_contents(null);
        if (!ok)
            throw new Error(`Could not read ${name}`);
        return decode(bytes);
    }

    _readConfig() {
        const raw = this._readText('config.json');
        return JSON.parse(raw);
    }

    _createRuntime(config) {
        const source = this._readText('runtime.js');

        // runtime.js intentionally contains a plain function expression rather
        // than an imported ES module. Evaluating the file avoids GJS module
        // caching, so saving runtime.js can hot-reload the widget in-place.
        // This extension is local-only: runtime.js has the same trust level as
        // extension.js itself.
        const factory = eval(source);
        if (typeof factory !== 'function')
            throw new Error('runtime.js must evaluate to a function');

        const runtime = factory({
            Clutter,
            Gio,
            GLib,
            St,
            Main,
            config,
            extensionPath: this.path,
        });

        if (!runtime || typeof runtime.enable !== 'function' || typeof runtime.disable !== 'function')
            throw new Error('runtime.js must return an object with enable() and disable()');

        return runtime;
    }

    _reloadAll(reason) {
        let nextConfig;
        let nextRuntime;

        try {
            nextConfig = this._readConfig();
            nextRuntime = this._createRuntime(nextConfig);
        } catch (error) {
            console.error(`[Overview Todo] Live reload rejected (${reason}); keeping current widget: ${error}`);
            return;
        }

        const previousRuntime = this._runtime;
        const previousConfig = this._config;

        try {
            previousRuntime?.disable();
            nextRuntime.enable();
            this._runtime = nextRuntime;
            this._config = nextConfig;
            this._reloadTheme(nextConfig);
            console.log(`[Overview Todo] Reloaded (${reason})`);
        } catch (error) {
            console.error(`[Overview Todo] New runtime failed; restoring previous widget: ${error}`);

            try {
                nextRuntime.disable();
            } catch (_) {
                // Best effort cleanup of a partially enabled runtime.
            }

            this._runtime = previousRuntime;
            this._config = previousConfig;

            try {
                previousRuntime?.enable();
                if (previousConfig)
                    this._reloadTheme(previousConfig);
            } catch (restoreError) {
                console.error(`[Overview Todo] Could not restore previous runtime: ${restoreError}`);
            }
        }
    }

    _reloadTheme(config) {
        const themeName = config?.themeFile || 'theme.css';
        const nextFile = this.dir.get_child(themeName);
        const context = St.ThemeContext.get_for_stage(global.stage);
        const theme = context.get_theme();

        try {
            if (this._themeFile)
                theme.unload_stylesheet(this._themeFile);
            theme.load_stylesheet(nextFile);
            this._themeFile = nextFile;
        } catch (error) {
            console.error(`[Overview Todo] Could not reload ${themeName}: ${error}`);
        }
    }

    _unloadTheme() {
        if (!this._themeFile)
            return;

        try {
            const context = St.ThemeContext.get_for_stage(global.stage);
            context.get_theme().unload_stylesheet(this._themeFile);
        } catch (error) {
            console.error(`[Overview Todo] Could not unload theme: ${error}`);
        }
        this._themeFile = null;
    }
}

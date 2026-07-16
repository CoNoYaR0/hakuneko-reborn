import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Per-OS application paths. Port of legacy src/app/Configuration{,Linux,Windows,Darwin}.js.
 *
 * Regular mode (directory name comes from app.setName('hakuneko-reborn')):
 *   - Linux:   ~/.config/hakuneko-reborn (userData) + ~/.cache/hakuneko-reborn
 *   - Windows: %APPDATA%\hakuneko-reborn + %LOCALAPPDATA%\hakuneko-reborn\cache
 *   - macOS:   ~/Library/Application Support/hakuneko-reborn + ~/Library/Caches/hakuneko-reborn
 *
 * Portable mode (a file named `<exe>.portable` exists next to the executable,
 * same convention as legacy): everything lives next to the executable.
 */
export class AppConfig {

    readonly portable: boolean;
    readonly userDataDir: string;
    readonly cacheDir: string;
    /** Declarative source definitions (Phase 2+): sources/*.json */
    readonly sourcesDir: string;
    /** Code-plugin escape hatch (Phase 2+): sources/custom/*.mjs */
    readonly customSourcesDir: string;
    readonly downloadsDir: string;

    constructor() {
        const exeDir = path.dirname(app.getPath('exe'));
        this.portable = fs.existsSync(app.getPath('exe') + '.portable');

        if (this.portable) {
            this.userDataDir = path.join(exeDir, 'userdata');
            this.cacheDir = path.join(exeDir, 'cache');
        } else {
            this.userDataDir = app.getPath('userData');
            this.cacheDir = this.#platformCacheDir();
        }

        this.sourcesDir = path.join(this.userDataDir, 'sources');
        this.customSourcesDir = path.join(this.sourcesDir, 'custom');
        this.downloadsDir = path.join(app.getPath('downloads'), 'hakuneko-reborn');

        for (const dir of [this.userDataDir, this.cacheDir, this.sourcesDir, this.customSourcesDir]) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    #platformCacheDir(): string {
        switch (process.platform) {
            case 'win32':
                return path.join(app.getPath('appData'), '..', 'Local', app.getName(), 'cache');
            case 'darwin':
                return path.join(app.getPath('home'), 'Library', 'Caches', app.getName());
            default: {
                const xdgCache = process.env['XDG_CACHE_HOME'] || path.join(app.getPath('home'), '.cache');
                return path.join(xdgCache, app.getName());
            }
        }
    }

    printInfo(): void {
        console.log('');
        console.log('-------------');
        console.log('Configuration');
        console.log('-------------');
        console.log('Portable           :', this.portable);
        console.log('UserData Directory :', this.userDataDir);
        console.log('Cache Directory    :', this.cacheDir);
        console.log('Sources Directory  :', this.sourcesDir);
        console.log('Downloads Directory:', this.downloadsDir);
        console.log('');
    }
}

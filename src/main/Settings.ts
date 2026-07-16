import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppSettings {
    /**
     * Whether the user has confirmed they are 18+ and opted to see adult
     * sources. Default false — NSFW sources are hidden until an explicit,
     * affirmative age confirmation (child-safety default).
     */
    adultUnlocked: boolean;
    /** Preferred download format. */
    downloadFormat: 'cbz' | 'folder' | 'pdf' | 'epub';
    /** Max concurrent requests per host (successor of legacy connector locks). */
    maxConcurrentPerHost: number;
    /** UI theme; 'system' follows the OS. */
    theme: ThemePreference;
    /** Check for app updates on startup (packaged builds only). */
    autoUpdate: boolean;
    /** Block ad/tracker/malware requests while scraping (legacy Blacklist). */
    blockAds: boolean;
}

const DEFAULTS: AppSettings = {
    adultUnlocked: false,
    downloadFormat: 'cbz',
    maxConcurrentPerHost: 4,
    theme: 'system',
    autoUpdate: true,
    blockAds: true
};

/** Tiny JSON-file settings store in the user data directory. */
export class Settings {

    readonly #file: string;
    #values: AppSettings;

    constructor(userDataDir: string) {
        this.#file = path.join(userDataDir, 'settings.json');
        this.#values = { ...DEFAULTS };
        try {
            if (fs.existsSync(this.#file)) {
                const parsed = JSON.parse(fs.readFileSync(this.#file, 'utf-8')) as Partial<AppSettings>;
                this.#values = { ...DEFAULTS, ...parsed };
            }
        } catch {
            /* corrupt settings file → fall back to defaults */
        }
    }

    get(): AppSettings {
        return { ...this.#values };
    }

    async set(patch: Partial<AppSettings>): Promise<AppSettings> {
        this.#values = { ...this.#values, ...patch };
        await fsp.writeFile(this.#file, JSON.stringify(this.#values, null, 2));
        return this.get();
    }
}

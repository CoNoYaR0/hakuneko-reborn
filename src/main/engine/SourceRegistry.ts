import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Source } from './Source';
import { TEMPLATES } from './templates';
import { parseDefinition, validateDefinition } from './validate';
import { isAdultSource } from './nsfw';
import { loadCodePlugins, installCodePlugin, uninstallCodePlugin } from './CodePlugin';
import { createBuiltinProviders } from './builtins';
import type { PluginProvider } from './CodePlugin';
import type { RequestBridge } from '../RequestBridge';
import type { SourceDefinition, Manga, Chapter, Page } from './types';

export interface SourceSummary {
    id: string;
    label: string;
    url: string;
    template: string;
    tags: string[];
    language?: string;
    nsfw: boolean;
    icon?: string;
    origin: 'bundled' | 'user';
    /** true when the template is registered (source is actually usable). */
    usable: boolean;
}

/** Minimal contract shared by template-backed Sources and code-plugin providers. */
export interface SourceLike {
    getMangas(): Promise<Manga[]>;
    getChapters(manga: Manga): Promise<Chapter[]>;
    getPages(chapter: Chapter): Promise<Page[]>;
}

/**
 * Loads and manages source definitions. This is what makes add/remove one-click:
 *
 *  - bundled catalog (resources/catalog.json) ships with the app
 *  - user sources live as individual JSON files in {userData}/sources/*.json
 *  - the folder is watched → adding/removing a file updates the app live
 *  - removing a bundled source writes a tombstone ({id, disabled:true}) instead
 *    of touching the read-only catalog
 *  - Source objects are instantiated lazily (first use), so 1k+ sources cost
 *    ~nothing at startup
 */
export class SourceRegistry {

    readonly #bridge: RequestBridge;
    readonly #sourcesDir: string;
    readonly #customDir: string;
    readonly #catalogPath: string;

    /** Effective, tombstone-applied definitions by id. */
    #definitions = new Map<string, SourceDefinition>();
    /** Lazily instantiated live sources. */
    readonly #instances = new Map<string, Source>();
    /** Loaded code-plugin providers by id (executed at load time). */
    #customProviders = new Map<string, PluginProvider>();
    #customFiles = new Map<string, string>();
    #watcher?: fs.FSWatcher;
    #reloadTimer?: NodeJS.Timeout;
    #onChange?: () => void;

    constructor(bridge: RequestBridge, sourcesDir: string, catalogPath: string) {
        this.#bridge = bridge;
        this.#sourcesDir = sourcesDir;
        this.#customDir = path.join(sourcesDir, 'custom');
        this.#catalogPath = catalogPath;
    }

    get templateNames(): ReadonlySet<string> {
        return new Set(TEMPLATES.keys());
    }

    async initialize(onChange?: () => void): Promise<void> {
        this.#onChange = onChange;
        await fsp.mkdir(this.#sourcesDir, { recursive: true });
        await this.reload();
        this.#watch();
    }

    /** (Re)build the effective definition map from catalog + user folder + code plugins. */
    async reload(): Promise<void> {
        const bundled = await this.#loadCatalog();
        const user = await this.#loadUserDefinitions();

        const effective = new Map<string, SourceDefinition>();
        for (const def of bundled) {
            effective.set(def.id, { ...def, origin: 'bundled' });
        }

        // First-party built-in code providers (MangaDex, …) are bundled sources:
        // add them at the bundled stage so a user tombstone can still hide them,
        // and a user-installed code plugin of the same id can still override them.
        const builtins = createBuiltinProviders(this.#bridge);
        for (const b of builtins) {
            effective.set(b.meta.id, {
                id: b.meta.id,
                label: b.meta.label,
                url: b.meta.url,
                template: 'custom',
                tags: b.meta.tags,
                language: b.meta.language,
                nsfw: b.meta.nsfw,
                origin: 'bundled'
            });
        }

        for (const def of user) {
            if (def.disabled) {
                effective.delete(def.id); // tombstone masks a bundled source
            } else {
                effective.set(def.id, { ...def, origin: 'user' });
            }
        }

        // Code plugins (executed) contribute pseudo-definitions with template 'custom'.
        const plugins = await loadCodePlugins(this.#bridge, this.#customDir);
        this.#customProviders = new Map();
        this.#customFiles = new Map();
        // Register built-in providers that survived user tombstones.
        for (const b of builtins) {
            if (effective.get(b.meta.id)?.template === 'custom') {
                this.#customProviders.set(b.meta.id, b.provider);
            }
        }
        for (const plugin of plugins) {
            effective.set(plugin.meta.id, {
                id: plugin.meta.id,
                label: plugin.meta.label,
                url: plugin.meta.url,
                template: 'custom',
                tags: plugin.meta.tags,
                nsfw: plugin.meta.nsfw,
                origin: 'user'
            });
            this.#customProviders.set(plugin.meta.id, plugin.provider);
            this.#customFiles.set(plugin.meta.id, plugin.file);
        }

        this.#definitions = effective;
        // Drop cached instances whose definition changed or disappeared
        for (const id of [...this.#instances.keys()]) {
            if (!effective.has(id)) {
                this.#instances.delete(id);
            }
        }
    }

    list(): SourceSummary[] {
        const templates = this.templateNames;
        return [...this.#definitions.values()]
            .map(def => ({
                id: def.id,
                label: def.label,
                url: def.url,
                template: def.template,
                tags: def.tags ?? [],
                language: def.language,
                nsfw: isAdultSource(def),
                icon: def.icon,
                origin: def.origin ?? 'bundled',
                usable: templates.has(def.template) || this.#customProviders.has(def.id)
            }))
            .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    }

    /** Full definition for a source (for editing/duplicating in Source Studio). */
    getDefinition(id: string): SourceDefinition | undefined {
        const def = this.#definitions.get(id);
        return def ? { ...def } : undefined;
    }

    /** Get (or lazily create) the live source for an id (template or code plugin). */
    get(id: string): SourceLike {
        const provider = this.#customProviders.get(id);
        if (provider) {
            return provider;
        }
        let source = this.#instances.get(id);
        if (!source) {
            const def = this.#definitions.get(id);
            if (!def) {
                throw new Error(`No source with id "${id}"`);
            }
            source = new Source(this.#bridge, def);
            this.#instances.set(id, source);
        }
        return source;
    }

    /** One-click add: validate + write {id}.json into the user folder. */
    async add(definition: unknown): Promise<SourceDefinition> {
        const def = parseDefinition(definition, this.templateNames);
        const file = path.join(this.#sourcesDir, `${def.id}.json`);
        await fsp.writeFile(file, JSON.stringify({ $schema: 'https://hakuneko.dev/schemas/source-v1.json', ...def }, null, 2));
        await this.reload();
        return def;
    }

    /**
     * Export a shareable source pack: all current effective definitions minus
     * origin/disabled bookkeeping. A pack is just a JSON array of definitions.
     */
    exportPack(): SourceDefinition[] {
        return [...this.#definitions.values()].map(({ origin: _o, disabled: _d, ...def }) => def);
    }

    /**
     * Install a source pack (JSON array of definitions). Valid entries are
     * written as user sources; invalid ones are reported, not thrown.
     */
    async importPack(pack: unknown): Promise<{ added: number; skipped: number; errors: string[] }> {
        const entries = Array.isArray(pack) ? pack : [];
        const errors: string[] = [];
        let added = 0;
        for (const entry of entries) {
            const result = validateDefinition(entry, this.templateNames);
            if (!result.valid) {
                errors.push(`${(entry as { id?: string })?.id ?? 'entry'}: ${result.errors[0]}`);
                continue;
            }
            const def = entry as SourceDefinition;
            await fsp.writeFile(
                path.join(this.#sourcesDir, `${def.id}.json`),
                JSON.stringify({ $schema: 'https://hakuneko.dev/schemas/source-v1.json', ...def }, null, 2)
            );
            added++;
        }
        await this.reload();
        return { added, skipped: entries.length - added, errors };
    }

    /**
     * Install a code plugin from a local file the user chose (after the UI's
     * security warning). Never called with a remote URL — see CodePlugin.ts.
     */
    async installCodePlugin(sourcePath: string): Promise<void> {
        await installCodePlugin(sourcePath, this.#customDir);
        await this.reload();
    }

    /** Uninstall a code plugin by its source id. */
    async removeCodePlugin(id: string): Promise<void> {
        const file = this.#customFiles.get(id);
        if (file) {
            await uninstallCodePlugin(this.#customDir, file);
            await this.reload();
        }
    }

    /** ids of user-installed code plugins (excludes first-party built-ins). */
    listCodePlugins(): string[] {
        return [...this.#customFiles.keys()];
    }

    /**
     * One-click remove. User sources: delete the JSON file. Bundled sources:
     * write a tombstone so the catalog entry is masked (reversible).
     */
    async remove(id: string): Promise<void> {
        const def = this.#definitions.get(id);
        if (!def) {
            return;
        }
        const userFile = path.join(this.#sourcesDir, `${id}.json`);
        if (def.origin === 'user' && fs.existsSync(userFile)) {
            await fsp.rm(userFile, { force: true });
        } else {
            // bundled → tombstone
            await fsp.writeFile(userFile, JSON.stringify({ id, disabled: true }, null, 2));
        }
        await this.reload();
    }

    /** Restore a removed bundled source (delete its tombstone). */
    async restore(id: string): Promise<void> {
        const userFile = path.join(this.#sourcesDir, `${id}.json`);
        if (fs.existsSync(userFile)) {
            const raw = JSON.parse(await fsp.readFile(userFile, 'utf-8')) as SourceDefinition;
            if (raw.disabled) {
                await fsp.rm(userFile, { force: true });
                await this.reload();
            }
        }
    }

    dispose(): void {
        this.#watcher?.close();
        if (this.#reloadTimer) {
            clearTimeout(this.#reloadTimer);
        }
    }

    async #loadCatalog(): Promise<SourceDefinition[]> {
        try {
            const raw = await fsp.readFile(this.#catalogPath, 'utf-8');
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
                return [];
            }
            const templates = this.templateNames;
            return parsed.filter((entry): entry is SourceDefinition => validateDefinition(entry, templates).valid);
        } catch {
            return []; // no catalog yet (before the codemod runs) is fine
        }
    }

    async #loadUserDefinitions(): Promise<SourceDefinition[]> {
        let files: string[];
        try {
            files = await fsp.readdir(this.#sourcesDir);
        } catch {
            return [];
        }
        const definitions: SourceDefinition[] = [];
        for (const file of files) {
            if (!file.endsWith('.json')) {
                continue;
            }
            try {
                const raw = await fsp.readFile(path.join(this.#sourcesDir, file), 'utf-8');
                const parsed = JSON.parse(raw) as SourceDefinition;
                // Tombstones ({id, disabled}) are allowed through without full validation
                if (parsed.disabled && parsed.id) {
                    definitions.push(parsed);
                } else if (validateDefinition(parsed, this.templateNames).valid) {
                    definitions.push(parsed);
                } else {
                    console.warn(`Skipping invalid source file: ${file}`);
                }
            } catch (error) {
                console.warn(`Failed to read source file ${file}:`, error);
            }
        }
        return definitions;
    }

    #watch(): void {
        try {
            this.#watcher = fs.watch(this.#sourcesDir, () => this.#scheduleReload());
        } catch {
            /* folder watching unavailable on this platform; add/remove still reload explicitly */
        }
    }

    #scheduleReload(): void {
        if (this.#reloadTimer) {
            clearTimeout(this.#reloadTimer);
        }
        // debounce rapid fs events (editors write temp files then rename)
        this.#reloadTimer = setTimeout(() => {
            void this.reload().then(() => this.#onChange?.());
        }, 150);
    }
}

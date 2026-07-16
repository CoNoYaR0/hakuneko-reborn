import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SourceContext } from './SourceContext';
import { isAdultSource } from './nsfw';
import type { RequestBridge } from '../RequestBridge';
import type { Manga, Chapter, Page } from './types';

/**
 * Code-plugin escape hatch for sources too complex for a JSON template
 * (custom APIs, image descrambling — the ~300 legacy custom connectors).
 *
 * A plugin is a `.mjs` file the user explicitly installs (with a security
 * warning — it runs real code) into {userData}/sources/custom/. Contract:
 *
 *   export const meta = { id, label, url, tags?, nsfw?, path? };
 *   export default function createProvider(ctx) {
 *       // ctx is a SourceContext: ctx.fetchDom / fetchJson / fetchText /
 *       // fetchWindow / absolute / rootRelativeOrAbsolute / url / path
 *       return {
 *           getMangas()          { ... },
 *           getChapters(manga)   { ... },
 *           getPages(chapter)    { ... }
 *       };
 *   }
 *
 * Plugins are NEVER auto-installed from URLs — only from a local file the user
 * chose, after confirming the warning. This keeps remote code out.
 */

export interface PluginMeta {
    id: string;
    label: string;
    url: string;
    tags?: string[];
    nsfw?: boolean;
    path?: string;
}

export interface PluginProvider {
    getMangas(): Promise<Manga[]>;
    getChapters(manga: Manga): Promise<Chapter[]>;
    getPages(chapter: Chapter): Promise<Page[]>;
}

export interface LoadedPlugin {
    meta: PluginMeta;
    provider: PluginProvider;
    file: string;
}

interface PluginModule {
    meta?: PluginMeta;
    default?: (ctx: SourceContext) => PluginProvider;
}

function validMeta(meta: unknown): meta is PluginMeta {
    const m = meta as PluginMeta | undefined;
    return Boolean(m && typeof m.id === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(m.id)
        && typeof m.label === 'string' && typeof m.url === 'string' && /^https?:\/\//.test(m.url));
}

/** Load every valid code plugin in the custom directory. Bad plugins are skipped. */
export async function loadCodePlugins(bridge: RequestBridge, dir: string): Promise<LoadedPlugin[]> {
    let files: string[];
    try {
        files = await fsp.readdir(dir);
    } catch {
        return [];
    }
    const loaded: LoadedPlugin[] = [];
    for (const file of files) {
        if (!file.endsWith('.mjs') && !file.endsWith('.js')) {
            continue;
        }
        const full = path.join(dir, file);
        try {
            // Cache-bust so a reinstalled plugin re-imports.
            const mod = (await import(`${pathToFileURL(full).href}?t=${Date.now()}`)) as PluginModule;
            if (!validMeta(mod.meta) || typeof mod.default !== 'function') {
                console.warn(`Code plugin "${file}" is missing a valid meta export or default factory.`);
                continue;
            }
            const meta: PluginMeta = {
                ...mod.meta,
                nsfw: mod.meta.nsfw ?? isAdultSource(mod.meta)
            };
            const ctx = new SourceContext(bridge, { ...meta, template: 'custom', origin: 'user' }, {});
            const provider = mod.default(ctx);
            loaded.push({ meta, provider, file: full });
        } catch (error) {
            console.warn(`Failed to load code plugin "${file}":`, error);
        }
    }
    return loaded;
}

/** Copy a chosen plugin file into the custom directory (the "install"). */
export async function installCodePlugin(sourcePath: string, customDir: string): Promise<string> {
    if (!/\.(mjs|js)$/.test(sourcePath)) {
        throw new Error('A code plugin must be a .mjs or .js file.');
    }
    await fsp.mkdir(customDir, { recursive: true });
    const base = path.basename(sourcePath).replace(/\.js$/, '.mjs');
    const target = path.join(customDir, base);
    await fsp.copyFile(sourcePath, target);
    return target;
}

/** Remove an installed code plugin by its source id. */
export async function uninstallCodePlugin(customDir: string, file: string): Promise<void> {
    const target = path.join(customDir, path.basename(file));
    if (fs.existsSync(target)) {
        await fsp.rm(target, { force: true });
    }
}

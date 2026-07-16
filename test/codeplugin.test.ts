import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCodePlugins, installCodePlugin } from '../src/main/engine/CodePlugin';
import type { RequestBridge } from '../src/main/RequestBridge';

// The plugin API is a SourceContext, which only touches the bridge for network
// calls. The sample plugin does no network, so a stub bridge suffices.
const stubBridge = {} as unknown as RequestBridge;

const samplePath = fileURLToPath(new URL('./fixtures/sample-plugin.mjs', import.meta.url));

describe('code plugins', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-plugins-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('installs and loads a plugin, executing its provider', async () => {
        await installCodePlugin(samplePath, dir);
        const loaded = await loadCodePlugins(stubBridge, dir);
        expect(loaded).toHaveLength(1);

        const plugin = loaded[0]!;
        expect(plugin.meta.id).toBe('sample-plugin');
        expect(plugin.meta.label).toBe('Sample Plugin');

        const mangas = await plugin.provider.getMangas();
        expect(mangas).toHaveLength(2);
        // rootRelativeOrAbsolute collapses same-host to a path.
        expect(mangas[0]).toEqual({ id: '/manga/alpha', title: 'Alpha' });

        const chapters = await plugin.provider.getChapters(mangas[0]!);
        expect(chapters[0]?.id).toBe('/manga/alpha/ch-1');

        const pages = await plugin.provider.getPages(chapters[0]!);
        expect(pages[0]).toBe('https://example.test/manga/alpha/ch-1/1.jpg');
        expect(pages[1]).toEqual({ url: 'https://example.test/manga/alpha/ch-1/2.jpg', referer: 'https://example.test' });
    });

    it('rejects installing a non-plugin file type', async () => {
        const txt = path.join(dir, 'notaplugin.txt');
        fs.writeFileSync(txt, 'nope');
        await expect(installCodePlugin(txt, dir)).rejects.toThrow(/\.mjs or \.js/);
    });

    it('skips invalid plugins without throwing', async () => {
        fs.writeFileSync(path.join(dir, 'bad.mjs'), 'export const meta = { id: "x" }; // no url/label, no default');
        const loaded = await loadCodePlugins(stubBridge, dir);
        expect(loaded).toHaveLength(0);
    });
});

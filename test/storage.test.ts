import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Storage } from '../src/main/Storage';
import type { SourceRegistry } from '../src/main/engine/SourceRegistry';

// Minimal registry stand-in: label lookup + a fixed manga list.
function fakeRegistry(): SourceRegistry {
    return {
        list: () => [{ id: 'demo', label: 'Demo Source' }],
        get: () => ({ getMangas: async () => [{ id: '/m/1', title: 'Alpha' }, { id: '/m/2', title: 'Beta' }] }),
        getChapters: async () => []
    } as unknown as SourceRegistry;
}

describe('Storage', () => {
    let userDir: string;
    let cacheDir: string;
    let storage: Storage;

    beforeEach(async () => {
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-user-'));
        cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-cache-'));
        storage = new Storage(fakeRegistry(), userDir, cacheDir);
        await storage.initialize();
    });

    afterEach(() => {
        fs.rmSync(userDir, { recursive: true, force: true });
        fs.rmSync(cacheDir, { recursive: true, force: true });
    });

    it('adds, lists, and de-dupes bookmarks', async () => {
        await storage.addBookmark('demo', { id: '/m/1', title: 'Alpha' });
        await storage.addBookmark('demo', { id: '/m/1', title: 'Alpha' }); // dup ignored
        expect(storage.listBookmarks()).toHaveLength(1);
        expect(storage.isBookmarked('demo', '/m/1')).toBe(true);
        expect(storage.listBookmarks()[0]?.sourceLabel).toBe('Demo Source');
    });

    it('removes bookmarks', async () => {
        await storage.addBookmark('demo', { id: '/m/1', title: 'Alpha' });
        await storage.removeBookmark('demo', '/m/1');
        expect(storage.listBookmarks()).toHaveLength(0);
    });

    it('imports legacy HakuNeko bookmarks and skips dups/garbage', async () => {
        await storage.addBookmark('demo', { id: '/m/1', title: 'Alpha' });
        const legacy = JSON.stringify([
            { title: { connector: 'Demo Source', manga: 'Gamma' }, key: { connector: 'demo', manga: '/m/3' } },
            { title: { connector: 'Demo Source', manga: 'Alpha' }, key: { connector: 'demo', manga: '/m/1' } },
            { garbage: true }
        ]);
        const result = await storage.importLegacyBookmarks(legacy);
        expect(result).toEqual({ added: 1, skipped: 2, total: 3 });
        expect(storage.listBookmarks()).toHaveLength(2);
    });

    it('exports bookmarks in the legacy shape (round-trips)', async () => {
        await storage.addBookmark('demo', { id: '/m/1', title: 'Alpha' });
        const exported = JSON.parse(storage.exportLegacyBookmarks());
        expect(exported[0]).toEqual({
            title: { connector: 'Demo Source', manga: 'Alpha' },
            key: { connector: 'demo', manga: '/m/1' }
        });
    });

    it('rejects non-JSON on import', async () => {
        await expect(storage.importLegacyBookmarks('not json')).rejects.toThrow();
    });

    it('caches the manga list and serves it from cache', async () => {
        const first = await storage.getMangas('demo');
        expect(first).toHaveLength(2);
        expect(fs.existsSync(path.join(cacheDir, 'mangas', 'demo.json'))).toBe(true);
        const cached = storage.getCachedMangas('demo');
        expect(cached?.mangas).toHaveLength(2);
    });

    it('persists bookmarks across instances', async () => {
        await storage.addBookmark('demo', { id: '/m/2', title: 'Beta' });
        const reopened = new Storage(fakeRegistry(), userDir, cacheDir);
        await reopened.initialize();
        expect(reopened.listBookmarks()).toHaveLength(1);
    });
});

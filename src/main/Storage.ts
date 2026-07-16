import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { SourceRegistry } from './engine/SourceRegistry';
import type { Manga, Chapter } from './engine/types';

export interface Bookmark {
    sourceId: string;
    mangaId: string;
    title: string;
    sourceLabel: string;
    addedAt: string;
}

export interface CachedMangas {
    fetchedAt: string;
    mangas: Manga[];
}

export interface ChapterMark {
    /** Chapter ids the user has already seen (for new-chapter highlighting). */
    seen: string[];
    lastCheckedAt: string;
}

export interface ImportResult {
    added: number;
    skipped: number;
    total: number;
}

/** Legacy HakuNeko bookmark shape (src/web/mjs/engine/Bookmark.mjs). */
interface LegacyBookmark {
    title?: { connector?: string; manga?: string };
    key?: { connector?: string; manga?: string };
}

const MANGA_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * On-disk persistence: bookmarks, a per-source manga-list cache, and
 * chapter-seen marks for new-chapter highlighting. Legacy-compatible enough to
 * import a HakuNeko classic bookmark export.
 *
 *   {userData}/bookmarks.json           Bookmark[]
 *   {userData}/chaptermarks.json        { "sourceId::mangaId": ChapterMark }
 *   {cache}/mangas/{sourceId}.json      CachedMangas
 */
export class Storage {

    readonly #registry: SourceRegistry;
    readonly #userDataDir: string;
    readonly #mangaCacheDir: string;
    readonly #bookmarksFile: string;
    readonly #chaptermarksFile: string;

    #bookmarks: Bookmark[] = [];
    #chaptermarks: Record<string, ChapterMark> = {};

    constructor(registry: SourceRegistry, userDataDir: string, cacheDir: string) {
        this.#registry = registry;
        this.#userDataDir = userDataDir;
        this.#mangaCacheDir = path.join(cacheDir, 'mangas');
        this.#bookmarksFile = path.join(userDataDir, 'bookmarks.json');
        this.#chaptermarksFile = path.join(userDataDir, 'chaptermarks.json');
    }

    async initialize(): Promise<void> {
        await fsp.mkdir(this.#mangaCacheDir, { recursive: true });
        this.#bookmarks = readJson<Bookmark[]>(this.#bookmarksFile, []);
        this.#chaptermarks = readJson<Record<string, ChapterMark>>(this.#chaptermarksFile, {});
    }

    // --- Bookmarks ---

    listBookmarks(): Bookmark[] {
        return [...this.#bookmarks].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    }

    isBookmarked(sourceId: string, mangaId: string): boolean {
        return this.#bookmarks.some(b => b.sourceId === sourceId && b.mangaId === mangaId);
    }

    async addBookmark(sourceId: string, manga: Manga): Promise<void> {
        if (this.isBookmarked(sourceId, manga.id)) {
            return;
        }
        const sourceLabel = this.#registry.list().find(s => s.id === sourceId)?.label ?? sourceId;
        this.#bookmarks.push({ sourceId, mangaId: manga.id, title: manga.title, sourceLabel, addedAt: new Date().toISOString() });
        await this.#saveBookmarks();
    }

    async removeBookmark(sourceId: string, mangaId: string): Promise<void> {
        this.#bookmarks = this.#bookmarks.filter(b => !(b.sourceId === sourceId && b.mangaId === mangaId));
        await this.#saveBookmarks();
    }

    /** Import a legacy HakuNeko bookmark export ({title,key} entries). */
    async importLegacyBookmarks(json: string): Promise<ImportResult> {
        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch {
            throw new Error('Not valid JSON.');
        }
        const entries = Array.isArray(parsed) ? (parsed as LegacyBookmark[]) : [];
        let added = 0;
        let skipped = 0;
        for (const entry of entries) {
            const sourceId = entry.key?.connector;
            const mangaId = entry.key?.manga;
            const title = entry.title?.manga;
            if (!sourceId || !mangaId || !title) {
                skipped++;
                continue;
            }
            if (this.isBookmarked(sourceId, mangaId)) {
                skipped++;
                continue;
            }
            this.#bookmarks.push({
                sourceId,
                mangaId,
                title,
                sourceLabel: entry.title?.connector ?? sourceId,
                addedAt: new Date().toISOString()
            });
            added++;
        }
        if (added > 0) {
            await this.#saveBookmarks();
        }
        return { added, skipped, total: entries.length };
    }

    /** Export current bookmarks in the legacy format (round-trips with import). */
    exportLegacyBookmarks(): string {
        const legacy = this.#bookmarks.map(b => ({
            title: { connector: b.sourceLabel, manga: b.title },
            key: { connector: b.sourceId, manga: b.mangaId }
        }));
        return JSON.stringify(legacy, null, 2);
    }

    // --- Manga list cache ---

    /** Cached manga list for a source, or undefined when absent/stale. */
    getCachedMangas(sourceId: string): CachedMangas | undefined {
        const cached = readJson<CachedMangas | null>(this.#mangaCacheFile(sourceId), null);
        if (!cached) {
            return undefined;
        }
        const age = Date.now() - new Date(cached.fetchedAt).getTime();
        return age < MANGA_CACHE_TTL_MS ? cached : undefined;
    }

    /**
     * Manga list for a source, from cache when fresh, else fetched and cached.
     * `refresh` forces a network fetch.
     */
    async getMangas(sourceId: string, refresh = false): Promise<Manga[]> {
        if (!refresh) {
            const cached = this.getCachedMangas(sourceId);
            if (cached) {
                return cached.mangas;
            }
        }
        const mangas = await this.#registry.get(sourceId).getMangas();
        const payload: CachedMangas = { fetchedAt: new Date().toISOString(), mangas };
        await fsp.writeFile(this.#mangaCacheFile(sourceId), JSON.stringify(payload));
        return mangas;
    }

    // --- Chapter marks (new-chapter highlighting) ---

    /**
     * Get chapters for a manga and flag which are new since the user last saw
     * this manga. First view marks everything seen (nothing shows as new).
     */
    async getChaptersWithNew(sourceId: string, manga: Manga): Promise<Array<Chapter & { isNew: boolean }>> {
        const chapters = await this.#registry.get(sourceId).getChapters(manga);
        const key = markKey(sourceId, manga.id);
        const mark = this.#chaptermarks[key];
        const seen = new Set(mark?.seen ?? []);
        const firstView = !mark;
        return chapters.map(chapter => ({
            ...chapter,
            isNew: !firstView && !seen.has(chapter.id)
        }));
    }

    /** Record every current chapter id as seen (call after the user opens the chapter list). */
    async markChaptersSeen(sourceId: string, mangaId: string, chapterIds: string[]): Promise<void> {
        this.#chaptermarks[markKey(sourceId, mangaId)] = {
            seen: chapterIds,
            lastCheckedAt: new Date().toISOString()
        };
        await fsp.writeFile(this.#chaptermarksFile, JSON.stringify(this.#chaptermarks));
    }

    #mangaCacheFile(sourceId: string): string {
        return path.join(this.#mangaCacheDir, `${encodeURIComponent(sourceId)}.json`);
    }

    async #saveBookmarks(): Promise<void> {
        await fsp.writeFile(this.#bookmarksFile, JSON.stringify(this.#bookmarks, null, 2));
    }
}

function markKey(sourceId: string, mangaId: string): string {
    return `${sourceId}::${mangaId}`;
}

function readJson<T>(file: string, fallback: T): T {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
        }
    } catch {
        /* corrupt file → fallback */
    }
    return fallback;
}

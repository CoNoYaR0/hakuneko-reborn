import type { SourceContext } from '../SourceContext';
import type { PluginProvider } from '../CodePlugin';
import type { Manga, Chapter, Page } from '../types';
import type { BuiltinMeta } from './types';

/**
 * MangaDex — the highest-value legacy "custom" connector. It is a JSON API, not
 * an HTML site, so no CSS template or the adaptive extractor can drive it; it
 * needs real code. Ported here as a trusted, first-party built-in provider
 * (same runtime contract as a user code plugin, but bundled and un-gated).
 *
 * Source: https://api.mangadex.org/docs/ (stable v5 API).
 *
 * Child-safety: this built-in restricts every request to the `safe` and
 * `suggestive` content ratings, so the bundled MangaDex source never surfaces
 * `erotica`/`pornographic` titles and stays un-gated. (Legacy HakuNeko included
 * all ratings.) See [[hakuneko-modernization]] / docs/PARITY.md.
 */

const API = 'https://api.mangadex.org';
const SITE = 'https://mangadex.org';
/** Child-safe subset of MangaDex content ratings (excludes erotica/pornographic). */
const RATINGS = ['safe', 'suggestive'] as const;
/** Cap the browse list at the most-followed ~2000 titles (Storage caches it 24h). */
const MAX_LIST_PAGES = 20;
const PER_PAGE = 100;
/** Politeness delay between API calls (API global limit is ~5 req/s). */
const THROTTLE_MS = 250;
/** MangaDex feed refuses offsets beyond 10000. */
const MAX_FEED_OFFSET = 9900;

export const meta: BuiltinMeta = {
    id: 'mangadex',
    label: 'MangaDex',
    url: SITE,
    tags: ['manga', 'multi-lingual', 'official-api'],
    language: 'multi',
    nsfw: false
};

interface MdTitleMap { [lang: string]: string }
interface MdManga {
    id: string;
    attributes: { title: MdTitleMap; altTitles?: MdTitleMap[] };
}
interface MdRelationship { id: string; type: string; attributes?: { name?: string } }
interface MdChapter {
    id: string;
    attributes: {
        volume?: string | null;
        chapter?: string | null;
        title?: string | null;
        translatedLanguage?: string | null;
        pages?: number;
        externalUrl?: string | null;
    };
    relationships?: MdRelationship[];
}
interface MdList<T> { data?: T[]; total?: number }
interface MdAtHome { baseUrl: string; chapter: { hash: string; data: string[]; dataSaver?: string[] } }

/** Pick a human title from MangaDex's per-language title map (prefer English). */
export function pickTitle(m: MdManga): string {
    const t = m.attributes.title ?? {};
    if (t['en']) {
        return t['en'];
    }
    const romaji = t['ja-ro'] ?? t['ja-ro'.toLowerCase()];
    if (romaji) {
        return romaji;
    }
    const first = Object.values(t)[0];
    if (first) {
        return first;
    }
    // Fall back to an English alt-title, then the id.
    for (const alt of m.attributes.altTitles ?? []) {
        if (alt['en']) {
            return alt['en'];
        }
    }
    return m.id;
}

/** Build a readable chapter label: "Vol.2 Ch.14 - Title (en) [Group]". Pure — unit-tested. */
export function formatChapterTitle(a: MdChapter['attributes'], groups: string[]): string {
    const parts: string[] = [];
    if (a.volume) {
        parts.push(`Vol.${a.volume}`);
    }
    if (a.chapter) {
        parts.push(`Ch.${a.chapter}`);
    }
    let title = parts.join(' ');
    if (a.title) {
        title += (title ? ' - ' : '') + a.title;
    }
    if (!title) {
        title = 'Oneshot';
    }
    if (a.translatedLanguage) {
        title += ` (${a.translatedLanguage})`;
    }
    if (groups.length > 0) {
        title += ` [${groups.join(', ')}]`;
    }
    return title.trim();
}

function groupNames(chapter: MdChapter): string[] {
    return (chapter.relationships ?? [])
        .filter(r => r.type === 'scanlation_group')
        .map(r => r.attributes?.name)
        .filter((n): n is string => Boolean(n));
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export function create(ctx: SourceContext): PluginProvider {

    async function getMangas(): Promise<Manga[]> {
        const out: Manga[] = [];
        const seen = new Set<string>();
        for (let page = 0; page < MAX_LIST_PAGES; page++) {
            const url = new URL('/manga', API);
            url.searchParams.set('limit', String(PER_PAGE));
            url.searchParams.set('offset', String(page * PER_PAGE));
            url.searchParams.set('order[followedCount]', 'desc');
            url.searchParams.set('hasAvailableChapters', 'true');
            for (const r of RATINGS) {
                url.searchParams.append('contentRating[]', r);
            }
            const res = await ctx.fetchJson<MdList<MdManga>>(url.href, { referer: SITE });
            const data = res?.data ?? [];
            for (const m of data) {
                if (!seen.has(m.id)) {
                    seen.add(m.id);
                    out.push({ id: m.id, title: pickTitle(m) });
                }
            }
            ctx.debug(`MangaDex list page ${page + 1}: +${data.length} (total ${out.length})`);
            if (data.length < PER_PAGE || (page + 1) * PER_PAGE >= (res?.total ?? 0)) {
                break;
            }
            await wait(THROTTLE_MS);
        }
        return out;
    }

    async function getChapters(manga: Manga): Promise<Chapter[]> {
        const chapters: Chapter[] = [];
        for (let offset = 0; offset <= MAX_FEED_OFFSET; offset += PER_PAGE) {
            const url = new URL(`/manga/${manga.id}/feed`, API);
            url.searchParams.set('limit', String(PER_PAGE));
            url.searchParams.set('offset', String(offset));
            url.searchParams.set('order[volume]', 'asc');
            url.searchParams.set('order[chapter]', 'asc');
            url.searchParams.append('includes[]', 'scanlation_group');
            for (const r of RATINGS) {
                url.searchParams.append('contentRating[]', r);
            }
            const res = await ctx.fetchJson<MdList<MdChapter>>(url.href, { referer: SITE });
            const data = res?.data ?? [];
            for (const c of data) {
                // Skip chapters hosted off-site (MangaPlus/Comikey etc.) — not downloadable.
                if (c.attributes.externalUrl) {
                    continue;
                }
                chapters.push({
                    id: c.id,
                    title: formatChapterTitle(c.attributes, groupNames(c)),
                    language: c.attributes.translatedLanguage ?? undefined
                });
            }
            if (data.length < PER_PAGE || offset + PER_PAGE >= (res?.total ?? 0)) {
                break;
            }
            await wait(THROTTLE_MS);
        }
        return chapters;
    }

    async function getPages(chapter: Chapter): Promise<Page[]> {
        const res = await ctx.fetchJson<MdAtHome>(`${API}/at-home/server/${chapter.id}`, { referer: SITE });
        const base = res.baseUrl?.replace(/\/+$/, '');
        const hash = res.chapter?.hash;
        const files = res.chapter?.data ?? [];
        if (!base || !hash) {
            return [];
        }
        // MangaDex@Home serves images directly from the returned base URL.
        return files.map(file => ({ url: `${base}/data/${hash}/${file}`, referer: SITE }));
    }

    return { getMangas, getChapters, getPages };
}

import type { Template } from './Template';
import { SourceContext } from '../SourceContext';
import type { CheerioAPI, AnyNode } from '../SourceContext';
import type { Manga, Chapter, Page } from '../types';

/**
 * Adaptive, structure-based extractor. Instead of fixed CSS selectors (which
 * break when a site drifts or is a custom variant), it infers the manga list,
 * chapters and pages from the *shape* of the page:
 *   - manga list  → the dominant cluster of same-structured detail links
 *   - chapters    → links whose text/href look like "chapter N" (multilingual)
 *   - pages       → the sequence of reader images (lazy-src aware, JS fallback)
 *
 * It's the universal fallback: any source whose assigned template returns 0
 * self-heals through this (see Source.#run). Not perfect, but it works on sites
 * no hand-written template fits.
 */

const CHAPTER_TEXT = /(?:chapter|chapitre|cap[íi]tulo|cap\b|chap\b|episode|\bep\b|\bch\b|\bvol\b|volume|tome|화|話|章|권)\s*\.?\s*\d|^\s*\d+([.,]\d+)?\s*$/i;
const CHAPTER_HREF = /chapter|chapitre|capitulo|episode|-ch-|\/ch\/|\/c\/|\/chap/i;
/** First-path-segments that typically front a manga detail page. */
const DETAIL_SEGMENTS = ['manga', 'series', 'serie', 'comic', 'comics', 'manhwa', 'manhua', 'title', 'read', 'book', 'webtoon', 'bd', 'oeuvre'];
/** A path segment that is a chapter marker (word) — used to find the manga root. */
const CHAPTER_SEGMENT = /^(chapit?res?|chapters?|cap[íi]tulos?|caps?|episodes?|eps?|vol|volumes?|tomes?|scan|read)$/i;
/** Generic nav/UI links that are never a manga title. */
const NAV_WORDS = /^(accueil|home|menu|login|log ?in|logout|register|sign ?in|sign ?up|s'inscrire|connexion|se connecter|search|recherche|contact|about|à propos|apropos|discord|telegram|twitter|facebook|next|prev|previous|suivant|pr[ée]c[ée]dent|read|lire|plus|voir plus|more|see all|voir tout|populaire|popular|recent|r[ée]cent|al[ée]atoire|random|premium|latest|nouveau|new|tous|toutes|all|genres?|genre|top|bookmark|bookmarks|favoris|profile|profil|settings?|param[èe]tres?|dmca|terms|privacy|faq|help|aide|advanced|filter|filtres?)$/i;
/** URL fragments that mark an image as chrome/ad, not a content page.
 *  Note the \b before "ad" so it doesn't false-match "upl(oads)/". */
const IMAGE_NOISE = /logo|avatar|icon|banner|sprite|placeholder|loading|blank|spinner|\bads?[-_/]|1x1|pixel|favicon|doubleclick|googlesyndication|adservice|adsystem|amazon-adsystem|taboola|outbrain|popads|propellerads|media\.net|gravatar/i;

/**
 * Script for the render fallback: waits until the DOM stops growing (AJAX /
 * lazy-loaded chapter lists and reader images have finished) before returning
 * the HTML — up to ~9s. Madara loads its chapter list via admin-ajax AFTER the
 * page's did-finish-load, so capturing immediately misses it.
 */
const RENDER_WAIT_SCRIPT = `new Promise((resolve) => {
    let last = -1, stable = 0, elapsed = 0;
    const tick = () => {
        const n = document.querySelectorAll('a[href], img, source').length;
        if (n === last && n > 0) { stable++; } else { stable = 0; last = n; }
        elapsed += 700;
        if (stable >= 2 || elapsed >= 9000) resolve(document.documentElement.outerHTML);
        else setTimeout(tick, 700);
    };
    setTimeout(tick, 700);
});`;

export const Adaptive: Template = {
    name: 'auto',
    defaults: { path: '' },

    async getMangas(ctx: SourceContext): Promise<Manga[]> {
        const paths = [ctx.path, '/', '/manga/', '/manga-list/', '/series/', '/comics/', '/browse/', '/manhwa/']
            .filter((p, i, a) => p !== undefined && a.indexOf(p) === i);
        let best: Manga[] = [];
        for (const path of paths) {
            const endpoint = ctx.absolute(path || '/', ctx.url);
            let $: CheerioAPI;
            try {
                $ = await ctx.fetchDom(endpoint);
            } catch {
                continue;
            }
            const cluster = pickMangaCluster($, endpoint);
            ctx.debug(`adaptive getMangas: ${cluster.length} candidates at ${endpoint}`, cluster.length ? 'info' : 'warn');
            if (cluster.length > best.length) {
                best = cluster;
            }
            if (best.length >= 20) {
                break; // good enough; stop probing paths
            }
        }

        // Nothing in the static HTML → JS-rendered site (a "Loading…" shell).
        // Render the homepage once in a browser and try again.
        if (best.length === 0) {
            try {
                const home = ctx.absolute('/', ctx.url);
                const html = await ctx.fetchWindow<string>(home, RENDER_WAIT_SCRIPT, ctx.url);
                best = pickMangaCluster(SourceContext.parse(html), home);
                ctx.debug(`adaptive getMangas (rendered): ${best.length} candidates`, best.length ? 'info' : 'warn');
            } catch {
                /* rendering failed; give up */
            }
        }
        return best;
    },

    async getChapters(ctx: SourceContext, manga: Manga): Promise<Chapter[]> {
        const url = ctx.absolute(manga.id, ctx.url);
        let $ = await ctx.fetchDom(url);
        let chapters = extractChapters($, url);

        // Madara & friends load the chapter list via AJAX/JS — the static HTML
        // has only a placeholder. Too few chapters → render the page and retry.
        if (chapters.length < 2) {
            try {
                const html = await ctx.fetchWindow<string>(url, RENDER_WAIT_SCRIPT, ctx.url);
                $ = SourceContext.parse(html);
                const rendered = extractChapters($, url);
                if (rendered.length > chapters.length) {
                    chapters = rendered;
                }
            } catch {
                /* keep what we have */
            }
        }
        ctx.debug(`adaptive getChapters: ${chapters.length} chapter-like links on ${url}`, chapters.length ? 'info' : 'warn');
        return chapters;
    },

    async getPages(ctx: SourceContext, chapter: Chapter): Promise<Page[]> {
        const url = ctx.absolute(chapter.id, ctx.url);
        let $ = await ctx.fetchDom(url);
        let pages = extractPages(ctx, $, url);

        // JS reader? Nothing (or almost nothing) in the static HTML → render it.
        if (pages.length < 2) {
            try {
                const html = await ctx.fetchWindow<string>(url, RENDER_WAIT_SCRIPT, ctx.url);
                $ = SourceContext.parse(html);
                pages = extractPages(ctx, $, url);
            } catch {
                /* keep whatever we had */
            }
        }
        ctx.debug(`adaptive getPages: ${pages.length} images on ${url}`, pages.length ? 'info' : 'warn');
        return pages;
    }
};

/** Extract manga candidates from a page's HTML (used by the catalog verifier). */
export function mangaCandidatesFromHtml(html: string, base: string): Manga[] {
    return pickMangaCluster(SourceContext.parse(html), base);
}

/**
 * Find the manga list on a listing page. Handles the real-world messiness:
 *  - "latest update"/"featured" sections list CHAPTER links (e.g. "Grand Blue
 *    74") → collapsed to the manga via the URL root, chapter number stripped
 *    from the title (the user's insight).
 *  - some sites link to a DIFFERENT canonical host than the entry domain
 *    (e.g. 3asq.org → 3asq.online) → we cluster by host+segment and take the
 *    dominant cluster, keeping absolute ids so chapters/pages resolve there.
 *  - cover-image cards with no anchor text → fall back to the image `alt`.
 *  - nav/footer links dropped; deduped by manga root.
 */
function pickMangaCluster($: CheerioAPI, base: string): Manga[] {
    const sourceHost = new URL(base).hostname;
    const groups = new Map<string, Map<string, string>>(); // "host|firstSegment" → (id → title)
    for (const el of $('a[href]').toArray()) {
        const href = ($(el).attr('href') ?? '').trim();
        const rawTitle = (($(el).attr('title') ?? $(el).text() ?? '').replace(/\s+/g, ' ').trim())
            || ($(el).find('source, img').attr('alt') ?? '').replace(/\s+/g, ' ').trim();
        if (!href || !rawTitle) continue;
        if (NAV_WORDS.test(rawTitle)) continue;
        // Keep <header> (themes put featured/latest content there); drop nav/footer.
        if ($(el).closest('nav, footer').length > 0) continue;

        let abs: URL;
        try { abs = new URL(href, base); } catch { continue; }
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;

        const origPath = (abs.pathname.replace(/\/+$/, '') || '/');
        const rootPath = mangaRoot(abs);
        const segments = rootPath.split('/').filter(Boolean);
        if (segments.length === 0 || segments.length > 3 || rootPath === '/') continue;

        const wasChapter = rootPath !== origPath;
        const title = (wasChapter ? cleanChapterTitle(rawTitle) : rawTitle).trim();
        if (title.length < 2 || title.length > 140) continue;
        if (/\b(vues?|views?)\b/i.test(title)) continue; // leftover chapter-card metadata

        const seg = segments[0]!.toLowerCase();
        const key = `${abs.hostname}|${seg}`;
        // Same-host → relative id; cross-host (canonical domain) → absolute id.
        const id = abs.hostname === sourceHost ? rootPath : abs.origin + rootPath;
        let group = groups.get(key);
        if (!group) { group = new Map(); groups.set(key, group); }
        const existing = group.get(id);
        if (!existing || preferTitle(title, existing)) {
            group.set(id, title);
        }
    }

    // Pick the dominant cluster: bonus for a manga-detail segment and for the
    // source's own host (so we don't wander onto some cross-linked site).
    let chosen: Map<string, string> | undefined;
    let chosenScore = 0;
    for (const [key, group] of groups) {
        const [host, seg] = key.split('|') as [string, string];
        let score = group.size;
        if (DETAIL_SEGMENTS.includes(seg)) score *= 3;
        if (host === sourceHost) score *= 1.25;
        if (group.size >= 3 && score > chosenScore) { chosen = group; chosenScore = score; }
    }
    if (!chosen) return [];
    return [...chosen.entries()]
        .map(([id, title]) => ({ id, title }))
        .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
}

/**
 * Chapter-like links on a manga page. The strongest, language-agnostic signal
 * is structural: a chapter lives *deeper under the manga's own URL* (e.g.
 * /manga/vagabond → /manga/vagabond/327). That catches numeric and non-Latin
 * ("الفصل 327", "第327話") chapter links that text patterns miss. Explicit
 * chapter words/hrefs are also accepted for sites with a different layout.
 * Absolute ids so pages resolve cross-host.
 */
function extractChapters($: CheerioAPI, url: string): Chapter[] {
    const host = new URL(url).hostname;
    const selfPath = new URL(url).pathname.replace(/\/+$/, '');
    const seen = new Set<string>();
    const chapters: Chapter[] = [];
    for (const el of $('a[href]').toArray()) {
        const href = ($(el).attr('href') ?? '').trim();
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (!href || !text) continue;
        let abs: URL;
        try { abs = new URL(href, url); } catch { continue; }
        if (abs.hostname !== host) continue;
        const relPath = abs.pathname.replace(/\/+$/, '');
        if (relPath === selfPath) continue; // self link
        const isDeeper = relPath.startsWith(selfPath + '/') && relPath.length > selfPath.length + 1;
        const explicitChapter = CHAPTER_HREF.test(abs.pathname)
            || /(chapter|chapitre|cap[íi]tulo|episode|فصل|화|話|章|권)\s*\.?\s*\d/i.test(text);
        if (!(isDeeper || explicitChapter)) continue;
        const id = abs.href;
        if (seen.has(id)) continue;
        seen.add(id);
        chapters.push({ id, title: text, language: '' });
    }
    return chapters;
}

/** Reduce a chapter URL to the manga detail URL it belongs to (drops trailing chapter/number segments). */
function mangaRoot(abs: URL): string {
    const parts = abs.pathname.split('/').filter(Boolean);
    while (parts.length > 1) {
        const last = parts[parts.length - 1]!;
        const prev = parts[parts.length - 2]!;
        if (/^\d+([.,]\d+)?$/.test(last) || CHAPTER_SEGMENT.test(last)) { parts.pop(); continue; }
        if (CHAPTER_SEGMENT.test(prev)) { parts.pop(); parts.pop(); continue; } // e.g. …/chapter/<uuid>
        break;
    }
    return '/' + parts.join('/');
}

/** Strip chapter number / view-count / date noise from a chapter-card title to recover the manga name. */
function cleanChapterTitle(text: string): string {
    return text
        .replace(/\s*\d[\d\s]*\b(vues?|views?|vus)\b.*$/i, '')                         // "…186186 vues Il y a…"
        .replace(/\s*(chapit?re|chapter|chap|ch|episode|ep|vol|volume|tome)\.?\s*\d+([.,]\d+)?.*$/i, '') // "… Chapitre 232.5 - …"
        .replace(/\s*[-–—:]\s.*$/, '')                                                 // trailing subtitle
        .replace(/\s+\d+([.,]\d+)?\s*$/, '')                                           // trailing bare number "Grand Blue 74"
        .replace(/\s+/g, ' ')
        .trim();
}

/** Prefer a cleaner manga title on dedupe (no trailing digit, then shorter). */
function preferTitle(candidate: string, existing: string): boolean {
    const cDigit = /\d$/.test(candidate);
    const eDigit = /\d$/.test(existing);
    if (cDigit !== eDigit) return !cDigit;
    return candidate.length < existing.length;
}

/** Extract the ordered reader image sequence from a chapter page. */
function extractPages(ctx: SourceContext, $: CheerioAPI, base: string): Page[] {
    // Prefer images inside a reader-ish container; fall back to the whole doc.
    const readerRoot = $('[class*="read" i], [id*="read" i], [class*="chapter" i], [id*="chapter" i], [class*="viewer" i], [id*="viewer" i], [class*="page" i]')
        .filter((_, el) => $(el).find('img, source').length >= 2)
        .first();
    const images: AnyNode[] = readerRoot.length
        ? readerRoot.find('img, source').toArray()
        : $('img, source').toArray();

    const pages: Page[] = [];
    const seen = new Set<string>();
    for (const el of images) {
        const raw = ($(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original')
            || $(el).attr('data-url') || firstSrcset($(el).attr('srcset')) || $(el).attr('src') || '').trim();
        if (!raw) continue;
        if (raw.startsWith('data:')) {
            continue; // skip inline placeholders
        }
        if (IMAGE_NOISE.test(raw)) continue;
        let abs: string;
        try { abs = new URL(raw, base).href; } catch { continue; }
        if (!/\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(abs) && !/\/(uploads|images?|chapters?|manga|data)\//i.test(abs)) {
            continue; // doesn't look like a content image
        }
        if (seen.has(abs)) continue;
        seen.add(abs);
        pages.push({ url: abs, referer: ctx.url });
    }
    return pages;
}

function firstSrcset(srcset: string | undefined): string {
    return srcset ? (srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? '') : '';
}

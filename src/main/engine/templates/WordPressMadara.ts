import type { Template } from './Template';
import type { SourceContext, CheerioAPI, AnyNode } from '../SourceContext';
import type { Manga, Chapter, Page } from '../types';

/**
 * WordPress + Madara theme. The single most common source engine
 * (439 legacy connectors). Port of connectors/templates/WordPressMadara.mjs.
 */
export const WordPressMadara: Template = {
    name: 'wordpress-madara',
    defaults: {
        path: '',
        queryMangas: 'div.post-title h3 a, div.post-title h5 a',
        queryChapters: 'li.wp-manga-chapter > a',
        queryChaptersTitleBloat: undefined,
        queryPages: 'div.page-break source',
        queryTitleForURI: 'head meta[property="og:title"]',
        queryPlaceholder: '[id^="manga-chapters-holder"][data-id]'
    },

    async getMangas(ctx: SourceContext): Promise<Manga[]> {
        const query = ctx.str('queryMangas');
        const mangas: Manga[] = [];
        for (let page = 0; ; page++) {
            const pageMangas = await fetchMangaPage(ctx, query, page);
            if (page === 0) {
                ctx.debug(`getMangas: page 0 matched ${pageMangas.length} of "${query}" via admin-ajax`, pageMangas.length ? 'info' : 'warn');
                if (pageMangas.length === 0) {
                    ctx.debug('hint: this site may not use the Madara admin-ajax list endpoint, or renamed its post-title classes; try a different template or add overrides', 'warn');
                }
            }
            if (pageMangas.length === 0) {
                break;
            }
            mangas.push(...pageMangas);
        }
        return mangas;
    },

    async getChapters(ctx: SourceContext, manga: Manga): Promise<Chapter[]> {
        const url = ctx.absolute(manga.id, ctx.url);
        const query = ctx.str('queryChapters');
        const $ = await ctx.fetchDom(url);

        const placeholder = $(ctx.str('queryPlaceholder')).first();
        if (placeholder.length > 0) {
            const dataId = placeholder.attr('data-id');
            const results = await Promise.allSettled([
                fetchChaptersAjaxNew(ctx, manga.id, query),
                dataId ? fetchChaptersAjaxOld(ctx, dataId, query) : Promise.reject(new Error('no data-id'))
            ]);
            const fulfilled = results.find(r => r.status === 'fulfilled' && r.value.els.length > 0);
            if (fulfilled && fulfilled.status === 'fulfilled') {
                const { $: $ajax, els } = fulfilled.value;
                return els.map(el => chapterFromAnchor(ctx, $ajax, el, manga, url));
            }
        }
        return $(query).toArray().map(el => chapterFromAnchor(ctx, $, el, manga, url));
    },

    async getPages(ctx: SourceContext, chapter: Chapter): Promise<Page[]> {
        const query = ctx.str('queryPages');
        const uri = new URL(ctx.absolute(chapter.id, ctx.url));
        uri.searchParams.set('style', 'list');
        let $ = await ctx.fetchDom(uri.href);
        let elements = $(query).toArray();
        // Some Madara sites made '?style=list' a Cloudflare WAF trigger — retry without it.
        if (elements.length === 0) {
            uri.searchParams.delete('style');
            $ = await ctx.fetchDom(uri.href);
            elements = $(query).toArray();
        }
        return elements.map(el => {
            const raw = ($(el).attr('data-url') || $(el).attr('data-src') || $(el).attr('srcset') || $(el).attr('src') || '').trim();
            if (raw.startsWith('data:image')) {
                return raw.match(/data:image[^\s'"]*/)?.[0] ?? raw;
            }
            const abs = new URL(ctx.absolute(raw, uri.href));
            // webpc-passthru proxy => unwrap the canonical ?src=
            const canonical = abs.searchParams.get('src');
            if (canonical && /^https?:/.test(canonical)) {
                abs.href = canonical;
            }
            return {
                url: abs.href.replace(/\/i\d+\.wp\.com/, ''),
                referer: uri.href
            };
        });
    }
};

async function fetchMangaPage(ctx: SourceContext, query: string, page: number): Promise<Manga[]> {
    const form = new URLSearchParams();
    form.set('action', 'madara_load_more');
    form.set('template', 'madara-core/content/content-archive');
    form.set('page', String(page));
    form.set('vars[paged]', '0');
    form.set('vars[post_type]', 'wp-manga');
    form.set('vars[posts_per_page]', '250');
    const endpoint = ctx.absolute(ctx.path + '/wp-admin/admin-ajax.php', ctx.url);
    const $ = await ctx.fetchDom(endpoint, {
        method: 'POST',
        body: form.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        referer: ctx.url
    });
    return $(query).toArray().map(el => ({
        id: ctx.rootRelativeOrAbsolute($(el).attr('href') ?? '', endpoint),
        title: $(el).text().trim()
    }));
}

interface AjaxChapters { $: CheerioAPI; els: AnyNode[] }

async function fetchChaptersAjaxNew(ctx: SourceContext, mangaId: string, query: string): Promise<AjaxChapters> {
    const endpoint = ctx.absolute(mangaId.replace(/\/?$/, '/') + 'ajax/chapters/', ctx.url);
    const $ = await ctx.fetchDom(endpoint, { method: 'POST' });
    const els = $(query).toArray();
    if (els.length === 0) {
        throw new Error('No chapters found (new ajax endpoint)!');
    }
    return { $, els };
}

async function fetchChaptersAjaxOld(ctx: SourceContext, dataId: string, query: string): Promise<AjaxChapters> {
    const endpoint = ctx.absolute(ctx.path + '/wp-admin/admin-ajax.php', ctx.url);
    const $ = await ctx.fetchDom(endpoint, {
        method: 'POST',
        body: `action=manga_get_chapters&manga=${dataId}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        referer: ctx.url
    });
    const els = $(query).toArray();
    if (els.length === 0) {
        throw new Error('No chapters found (old ajax endpoint)!');
    }
    return { $, els };
}

function chapterFromAnchor(ctx: SourceContext, $: CheerioAPI, el: AnyNode, manga: Manga, base: string): Chapter {
    const bloat = ctx.str('queryChaptersTitleBloat');
    if (bloat) {
        $(el).find(bloat).remove();
    }
    return {
        id: ctx.rootRelativeOrAbsolute($(el).attr('href') ?? '', base),
        title: $(el).text().replace(manga.title, '').trim(),
        language: ''
    };
}

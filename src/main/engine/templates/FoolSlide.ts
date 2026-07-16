import type { Template } from './Template';
import type { SourceContext } from '../SourceContext';
import type { Manga, Chapter, Page } from '../types';

/**
 * FoolSlide reader (60 legacy connectors).
 * Port of connectors/templates/FoolSlide.mjs.
 */
export const FoolSlide: Template = {
    name: 'foolslide',
    defaults: {
        path: '/directory/',
        defaultPageCount: 1,
        queryMangasPageCount: 'div.prevnext div.next a:first-of-type',
        queryMangas: 'div.list div.group > div.title a',
        queryChapters: 'div.list div.element div.title a'
    },

    async getMangas(ctx: SourceContext): Promise<Manga[]> {
        const directory = ctx.absolute(ctx.path, ctx.url);
        const $ = await ctx.fetchDom(directory);
        const nextHref = $(ctx.str('queryMangasPageCount')).first().attr('href');
        const defaultCount = Number(ctx.config['defaultPageCount'] ?? 1);
        const pageCount = nextHref ? Number(nextHref.match(/(\d+)\/$/)?.[1] ?? defaultCount) : defaultCount;

        const query = ctx.str('queryMangas');
        const mangas: Manga[] = [];
        for (let page = 1; page <= pageCount; page++) {
            const pageUrl = `${ctx.url}${ctx.path}${page}/`;
            const $page = await ctx.fetchDom(pageUrl, { retries: 5 });
            for (const el of $page(query).toArray()) {
                mangas.push({
                    id: ctx.rootRelativeOrAbsolute($page(el).attr('href') ?? '', pageUrl),
                    title: $page(el).text().trim()
                });
            }
        }
        return mangas;
    },

    async getChapters(ctx: SourceContext, manga: Manga): Promise<Chapter[]> {
        const url = ctx.absolute(manga.id, ctx.url);
        const $ = await ctx.fetchDom(url, {
            method: 'POST',
            body: 'adult=true',
            headers: { 'content-type': 'application/x-www-form-urlencoded' }
        });
        const language = ctx.str('language');
        return $(ctx.str('queryChapters')).toArray().map(el => ({
            id: ctx.rootRelativeOrAbsolute($(el).attr('href') ?? '', ctx.url),
            title: $(el).text().trim(),
            language
        }));
    },

    async getPages(ctx: SourceContext, chapter: Chapter): Promise<Page[]> {
        const url = ctx.absolute(chapter.id, ctx.url);
        const data = await ctx.fetchText(url, {
            method: 'POST',
            body: 'adult=true',
            headers: { 'content-type': 'application/x-www-form-urlencoded' }
        });
        // The page list is a JS array literal in the response body.
        let pagesRaw: string | undefined;
        const plain = data.match(/pages\s*=\s*(\[.*?\])\s*;/);
        if (plain) {
            pagesRaw = plain[1];
        }
        const b64 = data.match(/pages\s*=\s*JSON\.parse\s*\(\s*atob\s*\(\s*"(.*?)"\s*\)\s*\)\s*;/);
        if (b64?.[1]) {
            pagesRaw = Buffer.from(b64[1], 'base64').toString('utf-8');
        }
        if (!pagesRaw) {
            throw new Error('Failed to extract page list!');
        }
        const pages = JSON.parse(pagesRaw) as Array<{ url: string }>;
        return pages.map(page => ctx.absolute(page.url, url));
    }
};

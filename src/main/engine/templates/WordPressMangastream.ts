import type { Template } from './Template';
import type { SourceContext } from '../SourceContext';
import type { Manga, Chapter, Page } from '../types';

/**
 * WordPress + Mangastream/Themesia theme (192 legacy connectors).
 * Port of connectors/templates/WordPressMangastream.mjs.
 */
export const WordPressMangastream: Template = {
    name: 'wordpress-mangastream',
    defaults: {
        path: '/list/',
        queryMangas: 'div#content div.soralist ul li a.series',
        queryChapters: 'div#chapterlist ul li div.eph-num a',
        queryChaptersTitle: 'span.chapternum',
        queryChaptersTitleBloat: undefined,
        queryPages: 'div#readerarea img[src]:not([src=""])'
    },

    async getMangas(ctx: SourceContext): Promise<Manga[]> {
        const endpoint = ctx.absolute(ctx.path, ctx.url);
        const query = ctx.str('queryMangas');
        const $ = await ctx.fetchDom(endpoint);
        const els = $(query).toArray();
        ctx.debug(`getMangas: ${els.length} matched "${query}" at ${endpoint}`, els.length ? 'info' : 'warn');
        if (els.length === 0) {
            ctx.debug(`hint: the list page may use a different path (current path="${ctx.path}") or the theme renamed its classes; try editing the source's path/overrides`, 'warn');
        }
        return els.map(el => ({
            id: ctx.rootRelativeOrAbsolute($(el).attr('href') ?? '', endpoint),
            title: ($(el).attr('title') ?? $(el).text()).trim()
        }));
    },

    async getChapters(ctx: SourceContext, manga: Manga): Promise<Chapter[]> {
        const url = ctx.absolute(manga.id, ctx.url);
        const $ = await ctx.fetchDom(url);
        const titleQuery = ctx.str('queryChaptersTitle');
        const bloat = ctx.str('queryChaptersTitleBloat');
        return $(ctx.str('queryChapters')).toArray().map(el => {
            if (bloat) {
                $(el).find(bloat).remove();
            }
            const rawTitle = titleQuery ? $(el).find(titleQuery).text() : $(el).text();
            return {
                id: ctx.rootRelativeOrAbsolute($(el).attr('href') ?? '', url),
                title: rawTitle.replace(manga.title, '').trim() || manga.title
            };
        });
    },

    async getPages(ctx: SourceContext, chapter: Chapter): Promise<Page[]> {
        const query = ctx.str('queryPages');
        const url = ctx.absolute(chapter.id, ctx.url);
        // Pages come from the ts_reader JS object when present, else the DOM
        // after a short settle. Needs a real browser => fetchWindow.
        const script = `
            new Promise((resolve, reject) => {
                if(window.ts_reader && ts_reader.params && ts_reader.params.sources) {
                    resolve(ts_reader.params.sources.shift().images);
                } else {
                    setTimeout(() => {
                        try {
                            const images = [...document.querySelectorAll(${JSON.stringify(query)})];
                            resolve(images.map(img => img.dataset['lazySrc'] || img.dataset['src'] || img.getAttribute('original') || img.src));
                        } catch(error) { reject(error); }
                    }, 2500);
                }
            });
        `;
        const links = await ctx.fetchWindow<string[]>(url, script, ctx.url);
        return links
            .map(link => ctx.absolute(link, url).replace(/\/i\d+\.wp\.com/, ''))
            .filter(link => !link.includes('histats.com'));
    }
};

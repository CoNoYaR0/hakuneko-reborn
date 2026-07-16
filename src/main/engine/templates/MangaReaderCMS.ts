import type { Template } from './Template';
import type { SourceContext } from '../SourceContext';
import type { Manga, Chapter, Page } from '../types';

/**
 * MangaReader CMS (43 legacy connectors).
 * Port of connectors/templates/MangaReaderCMS.mjs.
 */
export const MangaReaderCMS: Template = {
    name: 'mangareader-cms',
    defaults: {
        path: '/',
        queryMangas: 'ul.manga-list li a',
        queryChapters: 'ul.chapters li h5.chapter-title-rtl',
        queryPages: 'div#all source.img-responsive',
        queryTitleForURI: 'h1.widget-title, h2.widget-title, h2.listmanga-header'
    },

    async getMangas(ctx: SourceContext): Promise<Manga[]> {
        const endpoint = ctx.absolute(ctx.path + 'changeMangaList?type=text', ctx.url);
        const $ = await ctx.fetchDom(endpoint, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        return $(ctx.str('queryMangas')).toArray().map(el => ({
            id: ctx.rootRelativeOrAbsolute($(el).attr('href') ?? '', endpoint),
            title: $(el).text().trim()
        }));
    },

    async getChapters(ctx: SourceContext, manga: Manga): Promise<Chapter[]> {
        const url = ctx.absolute(manga.id, ctx.url);
        const $ = await ctx.fetchDom(url);
        const language = ctx.str('language');
        return $(ctx.str('queryChapters')).toArray().map(el => {
            const self = $(el);
            const anchor = self.is('a') ? self : self.find('a').first();
            return {
                id: ctx.rootRelativeOrAbsolute(anchor.attr('href') ?? '', url),
                title: $(el).text().replace(/\s*:\s*$/, '').replace(manga.title, '').trim(),
                language
            };
        });
    },

    async getPages(ctx: SourceContext, chapter: Chapter): Promise<Page[]> {
        const url = ctx.absolute(chapter.id, ctx.url);
        const $ = await ctx.fetchDom(url);
        return $(ctx.str('queryPages')).toArray().map(el => {
            const dataSrc = $(el).attr('data-src');
            if (dataSrc) {
                try {
                    const encoded = dataSrc.split('://').pop() ?? '';
                    const decoded = decodeURIComponent(Buffer.from(encoded, 'base64').toString('binary'));
                    if (/^https?:/.test(decoded)) {
                        return decoded;
                    }
                } catch {
                    /* fall through to plain handling */
                }
            }
            const src = (dataSrc || $(el).attr('src') || '').trim();
            return ctx.absolute(src, url);
        });
    }
};

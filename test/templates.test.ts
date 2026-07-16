import { describe, it, expect } from 'vitest';
import { SourceContext } from '../src/main/engine/SourceContext';
import { WordPressMadara } from '../src/main/engine/templates/WordPressMadara';
import { WordPressMangastream } from '../src/main/engine/templates/WordPressMangastream';
import { FoolSlide } from '../src/main/engine/templates/FoolSlide';
import { MangaReaderCMS } from '../src/main/engine/templates/MangaReaderCMS';
import { fakeBridge, route } from './helpers';
import type { SourceDefinition } from '../src/main/engine/types';

function ctxFor(bridge: ReturnType<typeof fakeBridge>, def: Partial<SourceDefinition>, defaults: Record<string, unknown>): SourceContext {
    return new SourceContext(bridge, { id: 'x', label: 'X', url: 'https://site.com', template: 't', ...def }, defaults);
}

describe('WordPressMadara', () => {
    it('paginates getMangas until an empty page and parses titles', async () => {
        const page0 = '<div class="post-title"><h3><a href="https://site.com/manga/a">Alpha</a></h3></div><div class="post-title"><h3><a href="https://site.com/manga/b">Beta</a></h3></div>';
        const bridge = fakeBridge({
            routes: [
                route(page0, r => r.url.includes('admin-ajax') && (r.body ?? '').includes('page=0')),
                route('', r => r.url.includes('admin-ajax')) // any later page => empty => stop
            ]
        });
        const mangas = await WordPressMadara.getMangas(ctxFor(bridge, {}, WordPressMadara.defaults));
        expect(mangas).toEqual([
            { id: '/manga/a', title: 'Alpha' },
            { id: '/manga/b', title: 'Beta' }
        ]);
    });

    it('extracts pages, applying img→source, referer and i0.wp.com strip', async () => {
        const chapterHtml = '<div class="page-break"><img src="https://i0.wp.com/site.com/img/1.jpg"></div><div class="page-break"><img data-src="https://site.com/img/2.jpg"></div>';
        const bridge = fakeBridge({ routes: [route(chapterHtml, r => r.url.includes('/chapter/1'))] });
        const pages = await WordPressMadara.getPages(ctxFor(bridge, {}, WordPressMadara.defaults), { id: '/chapter/1', title: 'c1' });
        expect(pages).toHaveLength(2);
        expect(pages[0]).toEqual({ url: 'https://site.com/img/1.jpg', referer: expect.stringContaining('/chapter/1') });
        expect(pages[1]).toMatchObject({ url: 'https://site.com/img/2.jpg' });
    });
});

describe('WordPressMangastream', () => {
    it('parses the soralist and prefers the title attribute', async () => {
        const list = '<div id="content"><div class="soralist"><ul><li><a class="series" href="https://site.com/manga/x" title="Series X">x</a></li></ul></div></div>';
        const bridge = fakeBridge({ routes: [route(list, r => r.url.includes('/list/') || r.url.endsWith('/'))] });
        const ctx = ctxFor(bridge, { path: '/list/' }, WordPressMangastream.defaults);
        const mangas = await WordPressMangastream.getMangas(ctx);
        expect(mangas).toEqual([{ id: '/manga/x', title: 'Series X' }]);
    });

    it('gets pages from the browser-rendered ts_reader result', async () => {
        const bridge = fakeBridge({
            routes: [],
            windowResults: [{ urlIncludes: '/chapter/1', result: ['https://site.com/p/1.webp', 'https://histats.com/x.gif', 'https://i2.wp.com/site.com/p/2.webp'] }]
        });
        const ctx = ctxFor(bridge, {}, WordPressMangastream.defaults);
        const pages = await WordPressMangastream.getPages(ctx, { id: '/chapter/1', title: 'c1' });
        // histats filtered out, i2.wp.com stripped
        expect(pages).toEqual(['https://site.com/p/1.webp', 'https://site.com/p/2.webp']);
    });
});

describe('FoolSlide', () => {
    it('extracts pages from the inline JS pages array', async () => {
        const body = 'var pages = [{"url":"https://site.com/p/1.png"},{"url":"https://site.com/p/2.png"}];';
        const bridge = fakeBridge({ routes: [route(body, r => r.url.includes('/read/'))] });
        const ctx = ctxFor(bridge, {}, FoolSlide.defaults);
        const pages = await FoolSlide.getPages(ctx, { id: '/read/x/1/', title: 'c1' });
        expect(pages).toEqual(['https://site.com/p/1.png', 'https://site.com/p/2.png']);
    });

    it('decodes a base64-encoded pages array', async () => {
        const inner = JSON.stringify([{ url: 'https://site.com/p/1.png' }]);
        const b64 = Buffer.from(inner, 'utf-8').toString('base64');
        const body = `var pages = JSON.parse(atob("${b64}"));`;
        const bridge = fakeBridge({ routes: [route(body, () => true)] });
        const ctx = ctxFor(bridge, {}, FoolSlide.defaults);
        const pages = await FoolSlide.getPages(ctx, { id: '/read/x/1/', title: 'c1' });
        expect(pages).toEqual(['https://site.com/p/1.png']);
    });
});

describe('MangaReaderCMS', () => {
    it('lists mangas from the changeMangaList endpoint', async () => {
        const list = '<ul class="manga-list"><li><a href="https://site.com/manga/a">Alpha</a></li></ul>';
        const bridge = fakeBridge({ routes: [route(list, r => r.url.includes('changeMangaList'))] });
        const ctx = ctxFor(bridge, {}, MangaReaderCMS.defaults);
        const mangas = await MangaReaderCMS.getMangas(ctx);
        expect(mangas).toEqual([{ id: '/manga/a', title: 'Alpha' }]);
    });

    it('decodes base64 data-src page urls, falling back to plain src', async () => {
        const encoded = Buffer.from('https://cdn.site.com/p/1.jpg', 'utf-8').toString('base64');
        const html = `<div id="all"><img class="img-responsive" data-src="x://${encoded}"><img class="img-responsive" src="https://site.com/p/2.jpg"></div>`;
        const bridge = fakeBridge({ routes: [route(html, r => r.url.includes('/chapter/1'))] });
        const ctx = ctxFor(bridge, {}, MangaReaderCMS.defaults);
        const pages = await MangaReaderCMS.getPages(ctx, { id: '/chapter/1', title: 'c1' });
        expect(pages[0]).toBe('https://cdn.site.com/p/1.jpg');
        expect(pages[1]).toBe('https://site.com/p/2.jpg');
    });
});

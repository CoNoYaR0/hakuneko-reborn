// Sample code plugin used by test/codeplugin.test.ts — demonstrates the contract.
export const meta = {
    id: 'sample-plugin',
    label: 'Sample Plugin',
    url: 'https://example.test',
    tags: ['manga', 'test']
};

export default function createProvider(ctx) {
    return {
        async getMangas() {
            // ctx exposes absolute()/rootRelativeOrAbsolute() and the fetch helpers.
            return [
                { id: ctx.rootRelativeOrAbsolute('/manga/alpha', ctx.url), title: 'Alpha' },
                { id: '/manga/beta', title: 'Beta' }
            ];
        },
        async getChapters(manga) {
            return [{ id: `${manga.id}/ch-1`, title: 'Chapter 1', language: 'en' }];
        },
        async getPages(chapter) {
            return [`${ctx.url}${chapter.id}/1.jpg`, { url: `${ctx.url}${chapter.id}/2.jpg`, referer: ctx.url }];
        }
    };
}

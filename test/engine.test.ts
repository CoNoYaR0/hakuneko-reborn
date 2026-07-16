import { describe, it, expect } from 'vitest';
import { SourceContext } from '../src/main/engine/SourceContext';
import { HostLimiter } from '../src/main/HostLimiter';

describe('SourceContext helpers', () => {
    const ctx = new SourceContext({} as never, { id: 'x', label: 'X', url: 'https://site.com', template: 't' }, {});

    it('collapses same-host links to root-relative', () => {
        expect(ctx.rootRelativeOrAbsolute('https://site.com/manga/a', 'https://site.com')).toBe('/manga/a');
    });
    it('keeps cross-host links absolute', () => {
        expect(ctx.rootRelativeOrAbsolute('https://other.com/x', 'https://site.com')).toBe('https://other.com/x');
    });
    it('resolves relative links against a base', () => {
        expect(ctx.absolute('/chapter/1', 'https://site.com/manga/a')).toBe('https://site.com/chapter/1');
    });

    it('prepareHtml rewrites img/use to source (load-bearing for page selectors)', () => {
        const html = SourceContext.prepareHtml('<div class="page-break"><img src="a.jpg" data-src="b.jpg"></div>');
        expect(html).toContain('<source');
        expect(html).not.toContain('<img');
        expect(html).toContain('data-src="b.jpg"');
    });

    it('strips iframe attributes', () => {
        expect(SourceContext.prepareHtml('<iframe src="x" onload="y">')).toContain('<iframe>');
    });
});

describe('HostLimiter', () => {
    it('never exceeds max concurrency per host', async () => {
        const limiter = new HostLimiter(2);
        let active = 0;
        let peak = 0;
        const task = () => limiter.run('https://site.com/x', async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise(r => setTimeout(r, 10));
            active--;
        });
        await Promise.all([task(), task(), task(), task(), task()]);
        expect(peak).toBeLessThanOrEqual(2);
    });

    it('runs different hosts independently', async () => {
        const limiter = new HostLimiter(1);
        const order: string[] = [];
        await Promise.all([
            limiter.run('https://a.com', async () => { order.push('a'); }),
            limiter.run('https://b.com', async () => { order.push('b'); })
        ]);
        expect(order.sort()).toEqual(['a', 'b']);
    });
});

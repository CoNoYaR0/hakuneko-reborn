import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { buildPdf } from '../src/main/download/pdf';
import { buildEpub } from '../src/main/download/epub';

// Real 16x24 image fixtures (generated with PIL) so pdf-lib/EPUB get valid bytes.
const fixtures = path.join(__dirname, 'fixtures');
const PNG = fs.readFileSync(path.join(fixtures, 'page.png'));
const JPG = fs.readFileSync(path.join(fixtures, 'page.jpg'));
const WEBP = fs.readFileSync(path.join(fixtures, 'page.webp'));

describe('buildPdf', () => {
    it('embeds JPEG and PNG pages losslessly and reports 0 skipped', async () => {
        const { pdf, skipped } = await buildPdf([{ data: JPG, ext: 'jpg' }, { data: PNG, ext: 'png' }]);
        expect(skipped).toBe(0);
        expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
        const reloaded = await PDFDocument.load(pdf);
        expect(reloaded.getPageCount()).toBe(2);
    });

    it('skips WebP pages when no normalizer is supplied, but keeps the others', async () => {
        const { pdf, skipped } = await buildPdf([{ data: JPG, ext: 'jpg' }, { data: WEBP, ext: 'webp' }]);
        expect(skipped).toBe(1);
        expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('routes non-JPEG/PNG through the injected normalizer', async () => {
        // Pretend the normalizer decodes WebP → PNG.
        const { pdf, skipped } = await buildPdf([{ data: WEBP, ext: 'webp' }], () => PNG);
        expect(skipped).toBe(0);
        expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('throws a helpful error when nothing can be embedded', async () => {
        await expect(buildPdf([{ data: WEBP, ext: 'webp' }])).rejects.toThrow(/CBZ or EPUB/);
    });
});

describe('buildEpub', () => {
    it('produces a zip whose first entry is an uncompressed "mimetype"', async () => {
        const epub = await buildEpub([{ data: JPG, ext: 'jpg' }, { data: WEBP, ext: 'webp' }], { title: 'Ch. 1' });
        // ZIP local file header magic
        expect(epub.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
        // First entry name is "mimetype" and its content follows immediately (stored).
        expect(epub.subarray(30, 38).toString('ascii')).toBe('mimetype');
        expect(epub.subarray(38, 58).toString('ascii')).toBe('application/epub+zip');
    });

    it('keeps every image format (WebP included) by carrying the native file', async () => {
        // Zip entry filenames are stored uncompressed in the local headers, so the
        // WebP page being present at all proves EPUB preserved the native format.
        const epub = await buildEpub([{ data: WEBP, ext: 'webp' }], { title: 'X' });
        expect(epub.toString('latin1')).toContain('images/page-001.webp');
    });
});

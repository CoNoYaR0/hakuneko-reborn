import { describe, it, expect } from 'vitest';
import { sanitizeSegment, pageFileName, sniffImageExtension } from '../src/main/download/fileutil';

describe('sanitizeSegment', () => {
    it('strips path-illegal characters', () => {
        expect(sanitizeSegment('a/b\\c:d*e?f')).toBe('a_b_c_d_e_f');
    });

    it('trims trailing dots and spaces (Windows)', () => {
        expect(sanitizeSegment('Chapter 1...  ')).toBe('Chapter 1');
    });

    it('escapes reserved Windows device names', () => {
        expect(sanitizeSegment('CON')).toBe('_CON');
        expect(sanitizeSegment('lpt1')).toBe('_lpt1');
    });

    it('never returns an empty string', () => {
        expect(sanitizeSegment('***').length).toBeGreaterThan(0);
        expect(sanitizeSegment('').length).toBeGreaterThan(0);
    });

    it('caps absurd lengths', () => {
        expect(sanitizeSegment('x'.repeat(500)).length).toBeLessThanOrEqual(150);
    });
});

describe('pageFileName', () => {
    it('zero-pads to at least three digits', () => {
        expect(pageFileName(0, 29, 'jpg')).toBe('001.jpg');
        expect(pageFileName(8, 29, 'jpg')).toBe('009.jpg');
    });

    it('widens padding for large chapters', () => {
        expect(pageFileName(0, 1200, 'png')).toBe('0001.png');
    });
});

describe('sniffImageExtension', () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const gif = Buffer.from('GIF89a', 'ascii');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);

    it('detects by magic bytes regardless of URL', () => {
        expect(sniffImageExtension(jpg, 'x.png')).toBe('jpg');
        expect(sniffImageExtension(png, 'x.jpg')).toBe('png');
        expect(sniffImageExtension(gif)).toBe('gif');
        expect(sniffImageExtension(webp)).toBe('webp');
    });

    it('falls back to the URL extension when bytes are unknown', () => {
        expect(sniffImageExtension(Buffer.from([0, 1, 2, 3]), 'https://x/img.png?v=2')).toBe('png');
        expect(sniffImageExtension(Buffer.from([0, 1, 2, 3]), 'https://x/img.jpeg')).toBe('jpg');
    });

    it('defaults to jpg when nothing matches', () => {
        expect(sniffImageExtension(Buffer.from([0, 1, 2, 3]))).toBe('jpg');
    });
});

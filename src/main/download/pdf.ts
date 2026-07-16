import { PDFDocument } from 'pdf-lib';

export interface PageImage {
    data: Buffer;
    ext: string;
}

/**
 * Optional image normalizer: convert a non-JPEG/PNG buffer to PNG bytes (the
 * real app injects one backed by Electron's `nativeImage`). Returns null when
 * the format can't be decoded. Kept as an injected dependency so this module
 * stays Electron-free and unit-testable.
 */
export type ImageNormalizer = (data: Buffer, ext: string) => Buffer | null;

/**
 * Copy into a fresh, zero-offset Uint8Array. Node pools small Buffers inside a
 * shared ArrayBuffer at a non-zero `byteOffset`; pdf-lib's embedders read via
 * `new DataView(bytes.buffer)` and ignore that offset, so a pooled JPEG/PNG is
 * misread ("SOI not found"). Copying guarantees offset 0.
 */
function zeroOffset(data: Buffer): Uint8Array {
    return new Uint8Array(data);
}

/**
 * Build a PDF from page images. JPEG and PNG embed losslessly (pixel-perfect,
 * no re-rasterization); other formats are routed through the normalizer if one
 * is provided. Pages that can't be embedded are skipped and counted — the PDF
 * still saves. One PDF page per image, sized to the image's pixel dimensions.
 */
export async function buildPdf(images: PageImage[], normalize?: ImageNormalizer): Promise<{ pdf: Buffer; skipped: number }> {
    const doc = await PDFDocument.create();
    let skipped = 0;

    for (const img of images) {
        const ext = img.ext.toLowerCase();
        let embedded: Awaited<ReturnType<typeof doc.embedPng>> | undefined;
        try {
            if (ext === 'jpg' || ext === 'jpeg') {
                embedded = await doc.embedJpg(zeroOffset(img.data));
            } else if (ext === 'png') {
                embedded = await doc.embedPng(zeroOffset(img.data));
            } else {
                const png = normalize?.(img.data, ext);
                if (png) {
                    embedded = await doc.embedPng(zeroOffset(png));
                }
            }
        } catch {
            // Corrupt/mislabelled bytes: try one normalization pass before giving up.
            const png = normalize?.(img.data, ext);
            if (png) {
                try {
                    embedded = await doc.embedPng(zeroOffset(png));
                } catch {
                    embedded = undefined;
                }
            }
        }

        if (!embedded) {
            skipped++;
            continue;
        }
        const page = doc.addPage([embedded.width, embedded.height]);
        page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    }

    if (doc.getPageCount() === 0) {
        throw new Error('PDF export failed: none of the pages were JPEG/PNG. Try CBZ or EPUB for this source.');
    }
    const bytes = await doc.save();
    return { pdf: Buffer.from(bytes), skipped };
}

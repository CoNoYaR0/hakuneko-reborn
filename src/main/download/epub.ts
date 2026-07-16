import yazl from 'yazl';
import type { PageImage } from './pdf';

/**
 * Build a valid EPUB 3 from page images. Unlike PDF, EPUB just carries the image
 * files as-is, so every format (JPEG/PNG/GIF/WebP/AVIF) is preserved. Each page
 * is a reflowable XHTML doc showing one full-width image — renders correctly in
 * any EPUB reader without needing per-image dimensions.
 */

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const STYLE_CSS = `html,body{margin:0;padding:0;background:#000;}
img{display:block;width:100%;height:auto;margin:0 auto;}`;

const MIME: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic'
};

function escapeXml(s: string): string {
    return s.replace(/[<>&'"]/g, c => (
        { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] ?? c
    ));
}

function pad(n: number, total: number): string {
    return String(n).padStart(Math.max(3, String(total).length), '0');
}

function pageXhtml(n: number, imageHref: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Page ${n}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><img src="${imageHref}" alt="Page ${n}"/></body>
</html>`;
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

export async function buildEpub(images: PageImage[], meta: { title: string; id?: string }): Promise<Buffer> {
    const zip = new yazl.ZipFile();
    // Per the EPUB spec, "mimetype" must be the first entry and stored uncompressed.
    zip.addBuffer(Buffer.from('application/epub+zip'), 'mimetype', { compress: false });
    zip.addBuffer(Buffer.from(CONTAINER_XML), 'META-INF/container.xml');
    zip.addBuffer(Buffer.from(STYLE_CSS), 'OEBPS/style.css');

    const total = images.length;
    const manifest: string[] = ['<item id="css" href="style.css" media-type="text/css"/>'];
    const spine: string[] = [];
    const nav: string[] = [];

    images.forEach((img, i) => {
        const n = i + 1;
        const ext = MIME[img.ext.toLowerCase()] ? img.ext.toLowerCase() : 'jpg';
        const imageHref = `images/page-${pad(n, total)}.${ext}`;
        const pageHref = `page-${pad(n, total)}.xhtml`;
        zip.addBuffer(img.data, `OEBPS/${imageHref}`);
        zip.addBuffer(Buffer.from(pageXhtml(n, imageHref)), `OEBPS/${pageHref}`);
        manifest.push(`<item id="img${n}" href="${imageHref}" media-type="${MIME[ext] ?? 'image/jpeg'}"/>`);
        manifest.push(`<item id="page${n}" href="${pageHref}" media-type="application/xhtml+xml"/>`);
        spine.push(`<itemref idref="page${n}"/>`);
        nav.push(`<li><a href="${pageHref}">Page ${n}</a></li>`);
    });

    const bookId = meta.id ?? `urn:uuid:hakuneko-${Date.now()}`;
    const title = escapeXml(meta.title);
    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>
    ${spine.join('\n    ')}
  </spine>
</package>`;

    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title></head>
<body>
  <nav epub:type="toc" id="toc"><h1>${title}</h1><ol>${nav.join('')}</ol></nav>
</body>
</html>`;

    zip.addBuffer(Buffer.from(contentOpf), 'OEBPS/content.opf');
    zip.addBuffer(Buffer.from(navXhtml), 'OEBPS/nav.xhtml');
    zip.end();
    return streamToBuffer(zip.outputStream);
}

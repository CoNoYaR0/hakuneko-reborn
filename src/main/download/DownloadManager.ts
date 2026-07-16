import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import { sanitizeSegment, pageFileName, sniffImageExtension } from './fileutil';
import { buildPdf, type ImageNormalizer } from './pdf';
import { buildEpub } from './epub';
import { logLine } from '../log';
import type { RequestBridge } from '../RequestBridge';
import type { SourceRegistry } from '../engine/SourceRegistry';
import type { Page } from '../engine/types';
import type { DownloadRequest, DownloadJobInfo, DownloadFormat, DownloadStatus } from '@shared/ipc';

interface Job extends DownloadJobInfo {
    request: DownloadRequest;
    cancel: boolean;
}

/**
 * Sequential chapter download queue. One chapter at a time keeps sites happy;
 * within a chapter, pages are fetched with a small worker pool. Output is a
 * .cbz (zip) or a plain folder, matching legacy's layout under
 * {downloads}/{manga}/{chapter}.
 */
export class DownloadManager {

    readonly #bridge: RequestBridge;
    readonly #registry: SourceRegistry;
    readonly #downloadsDir: string;
    readonly #pagePoolSize = 4;
    /** Optional non-JPEG/PNG → PNG converter (Electron nativeImage) for PDF export. */
    readonly #normalizeImage?: ImageNormalizer;

    readonly #jobs = new Map<string, Job>();
    readonly #queue: string[] = [];
    #active = false;
    #onChange?: (jobs: DownloadJobInfo[]) => void;
    #seq = 0;

    constructor(bridge: RequestBridge, registry: SourceRegistry, downloadsDir: string, normalizeImage?: ImageNormalizer) {
        this.#bridge = bridge;
        this.#registry = registry;
        this.#downloadsDir = downloadsDir;
        this.#normalizeImage = normalizeImage;
    }

    setOnChange(listener: (jobs: DownloadJobInfo[]) => void): void {
        this.#onChange = listener;
    }

    list(): DownloadJobInfo[] {
        return [...this.#jobs.values()].map(stripInternals);
    }

    enqueue(request: DownloadRequest): DownloadJobInfo {
        const id = `job-${++this.#seq}`;
        const label = this.#registry.list().find(s => s.id === request.sourceId)?.label ?? request.sourceId;
        const job: Job = {
            id,
            request,
            cancel: false,
            sourceId: request.sourceId,
            sourceLabel: label,
            mangaTitle: request.manga.title,
            chapterTitle: request.chapter.title,
            format: request.format ?? 'cbz',
            status: 'queued',
            done: 0,
            total: 0
        };
        this.#jobs.set(id, job);
        this.#queue.push(id);
        this.#emit();
        void this.#pump();
        return stripInternals(job);
    }

    cancel(id: string): void {
        const job = this.#jobs.get(id);
        if (!job) {
            return;
        }
        if (job.status === 'queued') {
            job.status = 'cancelled';
            const at = this.#queue.indexOf(id);
            if (at >= 0) {
                this.#queue.splice(at, 1);
            }
        } else if (job.status === 'running') {
            job.cancel = true; // picked up between pages
        }
        this.#emit();
    }

    retry(id: string): void {
        const job = this.#jobs.get(id);
        if (!job || job.status === 'running' || job.status === 'queued') {
            return;
        }
        job.status = 'queued';
        job.error = undefined;
        job.done = 0;
        job.cancel = false;
        this.#queue.push(id);
        this.#emit();
        void this.#pump();
    }

    clearFinished(): void {
        for (const [id, job] of this.#jobs) {
            if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
                this.#jobs.delete(id);
            }
        }
        this.#emit();
    }

    async #pump(): Promise<void> {
        if (this.#active) {
            return;
        }
        this.#active = true;
        try {
            while (this.#queue.length > 0) {
                const id = this.#queue.shift()!;
                const job = this.#jobs.get(id);
                if (!job || job.status !== 'queued') {
                    continue;
                }
                await this.#runJob(job);
            }
        } finally {
            this.#active = false;
        }
    }

    async #runJob(job: Job): Promise<void> {
        job.status = 'running';
        this.#emit();
        try {
            const source = this.#registry.get(job.sourceId);
            const pages = await source.getPages(job.request.chapter);
            job.total = pages.length;
            this.#emit();
            if (pages.length === 0) {
                throw new Error('Chapter has no pages.');
            }

            const mangaDir = path.join(this.#downloadsDir, sanitizeSegment(job.mangaTitle));
            const chapterName = sanitizeSegment(job.chapterTitle);
            const images = await this.#downloadPages(job, pages);
            if (job.cancel) {
                job.status = 'cancelled';
                this.#emit();
                return;
            }

            job.outputPath = await this.#writeOutput(job.format, mangaDir, chapterName, images);

            job.status = 'completed';
            this.#emit();
        } catch (error) {
            job.status = 'failed';
            job.error = error instanceof Error ? error.message : String(error);
            this.#emit();
        }
    }

    /** Fetch every page with a bounded pool, preserving order; returns page bytes + extension. */
    async #downloadPages(job: Job, pages: Page[]): Promise<Array<{ data: Buffer; ext: string }>> {
        const results = new Array<{ data: Buffer; ext: string }>(pages.length);
        let next = 0;
        let completed = 0;

        const worker = async (): Promise<void> => {
            while (true) {
                if (job.cancel) {
                    return;
                }
                const index = next++;
                if (index >= pages.length) {
                    return;
                }
                results[index] = await this.#downloadPage(pages[index]!);
                completed++;
                job.done = completed;
                this.#emit();
            }
        };

        const pool = Array.from({ length: Math.min(this.#pagePoolSize, pages.length) }, () => worker());
        await Promise.all(pool);
        return results;
    }

    async #downloadPage(page: Page): Promise<{ data: Buffer; ext: string }> {
        const url = typeof page === 'string' ? page : page.url;
        const referer = typeof page === 'string' ? undefined : page.referer;
        const response = await this.#bridge.fetch({
            url,
            headers: referer ? { 'x-referer': referer } : undefined
        });
        if (!response.ok) {
            throw new Error(`Page fetch failed (${response.status}) for ${url}`);
        }
        const data = Buffer.from(response.bodyBase64, 'base64');
        return { data, ext: sniffImageExtension(data, url) };
    }

    #writeOutput(format: DownloadFormat, mangaDir: string, chapterName: string, images: Array<{ data: Buffer; ext: string }>): Promise<string> {
        switch (format) {
            case 'folder': return this.#writeFolder(mangaDir, chapterName, images);
            case 'pdf': return this.#writePdf(mangaDir, chapterName, images);
            case 'epub': return this.#writeEpub(mangaDir, chapterName, images);
            case 'cbz':
            default: return this.#writeCbz(mangaDir, chapterName, images);
        }
    }

    async #writePdf(mangaDir: string, chapterName: string, images: Array<{ data: Buffer; ext: string }>): Promise<string> {
        await fsp.mkdir(mangaDir, { recursive: true });
        const { pdf, skipped } = await buildPdf(images, this.#normalizeImage);
        if (skipped > 0) {
            logLine('source', `PDF "${chapterName}": skipped ${skipped} page(s) not embeddable as JPEG/PNG (use CBZ/EPUB to keep them)`, 'warn');
        }
        const target = path.join(mangaDir, `${chapterName}.pdf`);
        await fsp.writeFile(target, pdf);
        return target;
    }

    async #writeEpub(mangaDir: string, chapterName: string, images: Array<{ data: Buffer; ext: string }>): Promise<string> {
        await fsp.mkdir(mangaDir, { recursive: true });
        const epub = await buildEpub(images, { title: chapterName });
        const target = path.join(mangaDir, `${chapterName}.epub`);
        await fsp.writeFile(target, epub);
        return target;
    }

    async #writeFolder(mangaDir: string, chapterName: string, images: Array<{ data: Buffer; ext: string }>): Promise<string> {
        const dir = path.join(mangaDir, chapterName);
        await fsp.mkdir(dir, { recursive: true });
        await Promise.all(images.map((img, i) =>
            fsp.writeFile(path.join(dir, pageFileName(i, images.length, img.ext)), img.data)
        ));
        return dir;
    }

    async #writeCbz(mangaDir: string, chapterName: string, images: Array<{ data: Buffer; ext: string }>): Promise<string> {
        await fsp.mkdir(mangaDir, { recursive: true });
        const target = path.join(mangaDir, `${chapterName}.cbz`);
        const zip = new yazl.ZipFile();
        images.forEach((img, i) => zip.addBuffer(img.data, pageFileName(i, images.length, img.ext)));
        zip.end();
        await new Promise<void>((resolve, reject) => {
            const out = fs.createWriteStream(target);
            zip.outputStream.pipe(out);
            out.on('close', resolve);
            out.on('error', reject);
        });
        return target;
    }

    #emit(): void {
        this.#onChange?.(this.list());
    }
}

function stripInternals(job: Job): DownloadJobInfo {
    const { request: _request, cancel: _cancel, ...info } = job;
    return info;
}

export type { DownloadFormat, DownloadStatus };

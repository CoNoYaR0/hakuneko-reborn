import { Source } from './Source';
import { validateDefinition } from './validate';
import { TEMPLATES } from './templates';
import type { RequestBridge } from '../RequestBridge';
import type { SourceDefinition, Manga, Chapter } from './types';

export interface StepResult {
    ok: boolean;
    count: number;
    sample?: string;
    error?: string;
    /** Milliseconds this step took. */
    ms: number;
}

export interface SourceTestResult {
    ok: boolean;
    mangas: StepResult;
    chapters: StepResult;
    pages: StepResult;
    /** First page URL, so the wizard can show a real thumbnail as proof. */
    thumbnailUrl?: string;
}

const EMPTY: StepResult = { ok: false, count: 0, ms: 0 };

/**
 * Dry-run a candidate definition end-to-end WITHOUT saving it: list mangas,
 * open the first manga's chapters, open the first chapter's pages. This is the
 * Source Studio "live test" that lets a non-coder confirm a source works before
 * committing it. Each step is independent so the wizard can show exactly where
 * a near-miss breaks (and offer selector overrides for that step).
 */
export async function testDefinition(bridge: RequestBridge, definition: unknown): Promise<SourceTestResult> {
    const validation = validateDefinition(definition, new Set(TEMPLATES.keys()));
    if (!validation.valid) {
        return {
            ok: false,
            mangas: { ...EMPTY, error: validation.errors.join('; ') },
            chapters: EMPTY,
            pages: EMPTY
        };
    }

    const def = definition as SourceDefinition;
    const source = new Source(bridge, def);
    const result: SourceTestResult = { ok: false, mangas: { ...EMPTY }, chapters: { ...EMPTY }, pages: { ...EMPTY } };

    // Step 1: manga list
    let firstManga: Manga | undefined;
    result.mangas = await step(async () => {
        const mangas = await source.getMangas();
        firstManga = mangas[0];
        return { count: mangas.length, sample: firstManga?.title };
    });
    if (!result.mangas.ok || !firstManga) {
        return result;
    }

    // Step 2: chapters of the first manga
    let firstChapter: Chapter | undefined;
    result.chapters = await step(async () => {
        const chapters = await source.getChapters(firstManga!);
        firstChapter = chapters[0];
        return { count: chapters.length, sample: firstChapter?.title };
    });
    if (!result.chapters.ok || !firstChapter) {
        return result;
    }

    // Step 3: pages of the first chapter
    result.pages = await step(async () => {
        const pages = await source.getPages(firstChapter!);
        const first = pages[0];
        const url = typeof first === 'string' ? first : first?.url;
        result.thumbnailUrl = url;
        return { count: pages.length, sample: url };
    });

    result.ok = result.mangas.count > 0 && result.chapters.count > 0 && result.pages.count > 0;
    return result;
}

async function step(run: () => Promise<{ count: number; sample?: string }>): Promise<StepResult> {
    const started = Date.now();
    try {
        const { count, sample } = await run();
        return { ok: count > 0, count, sample, ms: Date.now() - started };
    } catch (error) {
        return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
    }
}

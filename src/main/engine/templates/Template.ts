import type { SourceContext } from '../SourceContext';
import type { Manga, Chapter, Page } from '../types';

/**
 * A scraping strategy shared by many sources. A concrete source = a Template +
 * a JSON definition (url, label, selector overrides). This is the abstraction
 * that makes 77% of sources pure data.
 */
export interface Template {
    /** Registry name referenced by SourceDefinition.template. */
    readonly name: string;
    /** Default selectors/options; a definition's `overrides` are merged on top. */
    readonly defaults: Record<string, unknown>;

    getMangas(ctx: SourceContext): Promise<Manga[]>;
    getChapters(ctx: SourceContext, manga: Manga): Promise<Chapter[]>;
    getPages(ctx: SourceContext, chapter: Chapter): Promise<Page[]>;
}

import { SourceContext } from './SourceContext';
import { getTemplate, Adaptive, ADAPTIVE_TEMPLATE } from './templates';
import { logLine } from '../log';
import type { Template } from './templates';
import type { RequestBridge } from '../RequestBridge';
import type { SourceDefinition, Manga, Chapter, Page } from './types';

/**
 * A live source: a JSON definition bound to its template and a scraping context.
 * Instantiated lazily by the registry on first use (keeps startup cheap).
 *
 * Self-healing: if the assigned template returns 0 results (site drifted, custom
 * variant, wrong template), the operation is retried with the Adaptive
 * structure-based extractor — so a stale template doesn't leave the user with a
 * dead source.
 */
export class Source {

    readonly definition: SourceDefinition;
    readonly #template: Template;
    readonly #ctx: SourceContext;
    /** Separate context for the adaptive fallback (its own default options). */
    readonly #adaptiveCtx: SourceContext;

    constructor(bridge: RequestBridge, definition: SourceDefinition) {
        const template = getTemplate(definition.template);
        if (!template) {
            throw new Error(`Unknown template "${definition.template}" for source "${definition.id}"`);
        }
        this.definition = definition;
        this.#template = template;
        this.#ctx = new SourceContext(bridge, definition, template.defaults);
        this.#adaptiveCtx = new SourceContext(bridge, definition, Adaptive.defaults);
    }

    get id(): string { return this.definition.id; }
    get label(): string { return this.definition.label; }

    getMangas(): Promise<Manga[]> {
        return this.#run('getMangas',
            () => this.#template.getMangas(this.#ctx),
            () => Adaptive.getMangas(this.#adaptiveCtx));
    }

    getChapters(manga: Manga): Promise<Chapter[]> {
        return this.#run(`getChapters "${manga.title}"`,
            () => this.#template.getChapters(this.#ctx, manga),
            () => Adaptive.getChapters(this.#adaptiveCtx, manga));
    }

    getPages(chapter: Chapter): Promise<Page[]> {
        return this.#run(`getPages "${chapter.title}"`,
            () => this.#template.getPages(this.#ctx, chapter),
            () => Adaptive.getPages(this.#adaptiveCtx, chapter));
    }

    /**
     * Run the primary template op with timing/count logging; if it yields 0 (and
     * the source isn't already adaptive), self-heal via the adaptive fallback.
     */
    async #run<T>(what: string, op: () => Promise<T[]>, fallback: () => Promise<T[]>): Promise<T[]> {
        const started = Date.now();
        logLine('source', `${this.id} (${this.definition.template}): ${what}…`);
        let result: T[];
        try {
            result = await op();
        } catch (error) {
            logLine('source', `${this.id}: ${what} FAILED: ${error instanceof Error ? error.message : String(error)} — trying adaptive fallback`, 'warn');
            result = [];
        }

        if (result.length === 0 && this.definition.template !== ADAPTIVE_TEMPLATE) {
            logLine('source', `${this.id}: ${what} → 0 with "${this.definition.template}"; self-healing with adaptive extractor…`, 'warn');
            try {
                const healed = await fallback();
                if (healed.length > 0) {
                    logLine('source', `${this.id}: adaptive ${what} → ${healed.length} items in ${Date.now() - started}ms ✓`);
                    return healed;
                }
                logLine('source', `${this.id}: adaptive ${what} also found 0 — the site may be unsupported or need manual selectors`, 'warn');
            } catch (error) {
                logLine('source', `${this.id}: adaptive ${what} FAILED: ${error instanceof Error ? error.message : String(error)}`, 'error');
            }
            return result;
        }

        logLine('source', `${this.id}: ${what} → ${result.length} items in ${Date.now() - started}ms`);
        return result;
    }
}

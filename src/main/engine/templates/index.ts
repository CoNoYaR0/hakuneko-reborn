import type { Template } from './Template';
import { WordPressMadara } from './WordPressMadara';
import { WordPressMangastream } from './WordPressMangastream';
import { FoolSlide } from './FoolSlide';
import { MangaReaderCMS } from './MangaReaderCMS';
import { Adaptive } from './Adaptive';

/**
 * Registry of scraping templates by name (referenced by SourceDefinition.template).
 * The four hand-written templates cover the highest-volume legacy engines; the
 * 'auto' Adaptive template is the structure-based universal fallback.
 */
const templateList: Template[] = [
    WordPressMadara,
    WordPressMangastream,
    FoolSlide,
    MangaReaderCMS,
    Adaptive
];

/** The universal structure-based fallback template. */
export const ADAPTIVE_TEMPLATE = 'auto';

export const TEMPLATES: ReadonlyMap<string, Template> = new Map(
    templateList.map(template => [template.name, template])
);

export function getTemplate(name: string): Template | undefined {
    return TEMPLATES.get(name);
}

export type { Template };
export { WordPressMadara, WordPressMangastream, FoolSlide, MangaReaderCMS, Adaptive };

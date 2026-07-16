import type { SourceDefinition } from './types';

/**
 * Adult-content classification. Used to age-gate sources: NSFW sources are
 * hidden until the user confirms they are 18+ (see the renderer age gate).
 *
 * Child safety is the priority, so this errs toward flagging: an explicit
 * `nsfw` field always wins, then adult tags, then adult keywords in the
 * id/label/url. The same logic classifies bundled catalog entries and any
 * source a user adds, so nothing slips through the wizard.
 *
 * NOTE: scripts/classify-nsfw.mjs mirrors these two lists to stamp the shipped
 * catalog. Keep them in sync (guarded by test/nsfw.test.ts).
 */

/** Tags that mark a source as adult. */
export const ADULT_TAGS: readonly string[] = [
    'hentai', 'porn', 'adult', 'nsfw', 'r18', '18+', 'smut',
    'doujin', 'doujinshi', 'erotic', 'ecchi', 'xxx'
];

/** Substrings in id/label/url that mark a source as adult. */
export const ADULT_KEYWORDS: readonly string[] = [
    'hentai', 'hentay', 'porn', 'xxx', 'r18', '18plus', 'adult', 'nsfw',
    'doujin', 'milftoon', 'lewd', 'smut', 'erotic', 'nhentai', 'fakku',
    'ecchi', 'boobs', 'sex'
];

export function isAdultSource(def: Pick<SourceDefinition, 'nsfw' | 'tags' | 'id' | 'label' | 'url'>): boolean {
    if (typeof def.nsfw === 'boolean') {
        return def.nsfw;
    }
    const tags = (def.tags ?? []).map(tag => tag.toLowerCase());
    if (tags.some(tag => ADULT_TAGS.includes(tag))) {
        return true;
    }
    const haystack = `${def.id} ${def.label} ${def.url}`.toLowerCase();
    return ADULT_KEYWORDS.some(keyword => haystack.includes(keyword));
}

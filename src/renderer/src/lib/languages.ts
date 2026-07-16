/**
 * Language detection for sources. A source's language lives in its `language`
 * field (ISO code) and/or its tags (e.g. "english", "spanish"), inconsistently
 * across the catalog — so we normalize both into canonical display names for
 * the Sources language filter.
 */

/** Any token (ISO code or tag name) → canonical display name. */
const LANGUAGE_MAP: Record<string, string> = {
    en: 'English', english: 'English',
    es: 'Spanish', spanish: 'Spanish', 'es-la': 'Spanish',
    fr: 'French', french: 'French',
    pt: 'Portuguese', 'pt-br': 'Portuguese', portuguese: 'Portuguese', brazilian: 'Portuguese',
    id: 'Indonesian', indonesian: 'Indonesian',
    tr: 'Turkish', turkish: 'Turkish',
    ar: 'Arabic', arabic: 'Arabic',
    ja: 'Japanese', jp: 'Japanese', japanese: 'Japanese',
    ko: 'Korean', korean: 'Korean',
    ru: 'Russian', russian: 'Russian',
    th: 'Thai', thai: 'Thai',
    it: 'Italian', italian: 'Italian',
    pl: 'Polish', polish: 'Polish',
    zh: 'Chinese', cn: 'Chinese', chinese: 'Chinese',
    de: 'German', german: 'German',
    vi: 'Vietnamese', vietnamese: 'Vietnamese'
};

export interface HasLanguage {
    language?: string;
    tags: string[];
}

/** Canonical display languages for a source (deduped, sorted). */
export function sourceLanguages(source: HasLanguage): string[] {
    const found = new Set<string>();
    const tokens = [...(source.tags ?? [])];
    if (source.language) {
        tokens.push(source.language);
    }
    for (const token of tokens) {
        const name = LANGUAGE_MAP[token.trim().toLowerCase()];
        if (name) {
            found.add(name);
        }
    }
    return [...found].sort();
}

/** Distinct languages present across sources, each with a count, most common first. */
export function availableLanguages(sources: HasLanguage[]): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    for (const source of sources) {
        for (const lang of sourceLanguages(source)) {
            counts.set(lang, (counts.get(lang) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

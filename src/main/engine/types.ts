/**
 * Core engine data types. Plain, serializable shapes that cross IPC.
 */

/** A manga/comic/novel series listed by a source. */
export interface Manga {
    /** Root-relative path or absolute URL, unique within a source. */
    id: string;
    title: string;
}

/** A single chapter of a manga. */
export interface Chapter {
    id: string;
    title: string;
    language?: string;
}

/**
 * A downloadable page. Either a direct image URL, or a descriptor telling the
 * download layer to fetch `url` with a specific `referer` (some hosts 403
 * without it). Legacy encoded this as a `connector://` URI; v2 keeps it typed.
 */
export type Page =
    | string
    | { url: string; referer?: string };

export interface FetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    /** Sent as the smuggled `x-referer` header (see main/headers.ts). */
    referer?: string;
    /** Text decoding for non-UTF-8 sites (e.g. some legacy CMS use gbk). */
    encoding?: string;
    /** Retry count on HTTP 5xx. */
    retries?: number;
}

/**
 * A declarative source definition (the JSON a user or the codemod produces).
 * Schema: resources/schemas/source-v1.json.
 */
export interface SourceDefinition {
    id: string;
    label: string;
    url: string;
    /** Name of a registered template (see engine/templates/index.ts). */
    template: string;
    tags?: string[];
    /** Sub-path used by some templates (e.g. Mangastream '/list/'). */
    path?: string;
    language?: string;
    nsfw?: boolean;
    /** favicon/icon as a data: URI. */
    icon?: string;
    /** Template-specific selector/option overrides. */
    overrides?: Record<string, unknown>;
    /** Set on catalog entries the user has removed (masks a bundled source). */
    disabled?: boolean;
    /** Where this definition came from (bundled catalog vs user folder). */
    origin?: 'bundled' | 'user';
}

/**
 * Typed IPC contract shared between main, preload and renderer.
 * Every request from the UI to the system goes through this API.
 */

export const IPC = {
    netFetch: 'net:fetch',
    netFetchWindow: 'net:fetch-window',
    appInfo: 'app:info',
    sourcesList: 'sources:list',
    sourcesAdd: 'sources:add',
    sourcesRemove: 'sources:remove',
    sourcesTemplates: 'sources:templates',
    sourceMangas: 'source:mangas',
    sourceChapters: 'source:chapters',
    sourcePages: 'source:pages',
    sourcePageImage: 'source:page-image',
    sourcesChanged: 'sources:changed',
    sourcesDetect: 'sources:detect',
    sourcesTest: 'sources:test',
    sourcesDefinition: 'sources:definition',
    sourcesExportPack: 'sources:export-pack',
    sourcesImportPack: 'sources:import-pack',
    sourcesInstallPlugin: 'sources:install-plugin',
    sourcesPickElement: 'sources:pick-element',
    downloadsEnqueue: 'downloads:enqueue',
    downloadsList: 'downloads:list',
    downloadsCancel: 'downloads:cancel',
    downloadsRetry: 'downloads:retry',
    downloadsClear: 'downloads:clear',
    downloadsChanged: 'downloads:changed',
    settingsGet: 'settings:get',
    settingsSet: 'settings:set',
    logsList: 'logs:list',
    logsClear: 'logs:clear',
    logsChanged: 'logs:changed',
    updateStatus: 'update:status',
    updateCheck: 'update:check',
    updateDownload: 'update:download',
    updateInstall: 'update:install',
    updateChanged: 'update:changed',
    bookmarksList: 'bookmarks:list',
    bookmarksAdd: 'bookmarks:add',
    bookmarksRemove: 'bookmarks:remove',
    bookmarksImport: 'bookmarks:import',
    bookmarksExport: 'bookmarks:export',
    bookmarksIs: 'bookmarks:is',
    bookmarksChanged: 'bookmarks:changed',
    libraryMangas: 'library:mangas',
    libraryChapters: 'library:chapters'
} as const;

export interface Bookmark {
    sourceId: string;
    mangaId: string;
    title: string;
    sourceLabel: string;
    addedAt: string;
}

export interface BookmarkImportResult {
    added: number;
    skipped: number;
    total: number;
}

export type ChapterWithNew = Chapter & { isNew: boolean };

export interface LogEntry {
    t: number;
    scope: string;
    level: 'info' | 'warn' | 'error';
    msg: string;
}

export interface UpdateStatus {
    state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'none' | 'error';
    version?: string;
    percent?: number;
    error?: string;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppSettings {
    /** User confirmed 18+ and opted into adult sources. Default false. */
    adultUnlocked: boolean;
    downloadFormat: DownloadFormat;
    /** Max concurrent requests per host (successor of legacy connector locks). */
    maxConcurrentPerHost: number;
    theme: ThemePreference;
    /** Check for app updates on startup (packaged builds only). */
    autoUpdate: boolean;
    /** Block ad/tracker/malware requests while scraping (legacy Blacklist). Default true. */
    blockAds: boolean;
}

// --- Downloads ---

/**
 * Output format. `cbz`/`folder` and `epub` preserve every image type; `pdf`
 * embeds JPEG/PNG pages (the scanlation norm) — WebP-heavy chapters are better
 * saved as cbz/epub. See docs/PARITY.md.
 */
export type DownloadFormat = 'cbz' | 'folder' | 'pdf' | 'epub';

export type DownloadStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DownloadRequest {
    sourceId: string;
    manga: Manga;
    chapter: Chapter;
    format?: DownloadFormat;
}

export interface DownloadJobInfo {
    id: string;
    sourceId: string;
    sourceLabel: string;
    mangaTitle: string;
    chapterTitle: string;
    format: DownloadFormat;
    status: DownloadStatus;
    /** Pages written so far / total pages (total 0 until the page list is known). */
    done: number;
    total: number;
    error?: string;
    /** Final artifact path once completed (cbz file or chapter folder). */
    outputPath?: string;
}

// --- Engine data types (mirror of main/engine/types.ts, kept plain for IPC) ---

export interface Manga {
    id: string;
    title: string;
}

export interface Chapter {
    id: string;
    title: string;
    language?: string;
}

export type Page = string | { url: string; referer?: string };

export interface SourceSummary {
    id: string;
    label: string;
    url: string;
    template: string;
    tags: string[];
    language?: string;
    nsfw: boolean;
    icon?: string;
    origin: 'bundled' | 'user';
    usable: boolean;
}

/** Full declarative source definition (mirror of main/engine/types.ts). */
export interface SourceDefinition {
    id: string;
    label: string;
    url: string;
    template: string;
    tags?: string[];
    path?: string;
    language?: string;
    nsfw?: boolean;
    icon?: string;
    overrides?: Record<string, unknown>;
    disabled?: boolean;
    origin?: 'bundled' | 'user';
}

// --- Source Studio (auto-detect + live test) ---

export interface TemplateCandidate {
    template: string;
    confidence: number;
    reasons: string[];
    path?: string;
}

export interface DetectionResult {
    url: string;
    reachable: boolean;
    error?: string;
    candidates: TemplateCandidate[];
    suggested: {
        id: string;
        label: string;
        language?: string;
        icon?: string;
        tags: string[];
        nsfw: boolean;
    };
}

export interface StepResult {
    ok: boolean;
    count: number;
    sample?: string;
    error?: string;
    ms: number;
}

export interface SourceTestResult {
    ok: boolean;
    mangas: StepResult;
    chapters: StepResult;
    pages: StepResult;
    thumbnailUrl?: string;
}

/** Plain HTTP(S) request through the Chromium network stack (shares session cookies). */
export interface FetchRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    /** Text body (e.g. form-urlencoded for Madara admin-ajax endpoints). */
    body?: string;
}

export interface FetchResponse {
    ok: boolean;
    status: number;
    statusText: string;
    finalUrl: string;
    headers: Record<string, string>;
    /** Body as base64 so binary responses (images) survive IPC. */
    bodyBase64: string;
}

/**
 * Render a page in a hidden BrowserWindow (anti-bot capable: Cloudflare,
 * DDoS-Guard, JS-rendered sites) and run a script in page context.
 * Port of legacy Request.mjs#fetchUI.
 */
export interface FetchWindowRequest {
    url: string;
    /**
     * JavaScript evaluated in the page after load and anti-bot checks pass.
     * Must evaluate to a structured-cloneable value. When omitted, a default
     * script returns `{ title, url, html }` of the settled page.
     */
    script?: string;
    /** Milliseconds before the attempt is aborted. Default 60000. */
    timeout?: number;
    /** Load images while rendering (needed for some DDoS-Guard sites). Default false. */
    images?: boolean;
    referer?: string;
    userAgent?: string;
}

export interface FetchWindowResponse<T = unknown> {
    finalUrl: string;
    result: T;
    elapsedMs: number;
}

export interface AppInfo {
    version: string;
    electron: string;
    chrome: string;
    node: string;
    platform: NodeJS.Platform;
    portable: boolean;
    paths: {
        userData: string;
        cache: string;
        sources: string;
        customSources: string;
        downloads: string;
    };
}

/** API surface exposed on `window.hakuneko` by the preload script. */
export interface HakunekoApi {
    fetch(request: FetchRequest): Promise<FetchResponse>;
    fetchWindow<T = unknown>(request: FetchWindowRequest): Promise<FetchWindowResponse<T>>;
    appInfo(): Promise<AppInfo>;

    sources: {
        list(): Promise<SourceSummary[]>;
        add(definition: unknown): Promise<{ ok: boolean; error?: string }>;
        remove(id: string): Promise<void>;
        templates(): Promise<string[]>;
        /** Source Studio: fetch a URL and detect template + metadata. */
        detect(url: string): Promise<DetectionResult>;
        /** Source Studio: dry-run an unsaved definition end-to-end. */
        test(definition: unknown): Promise<SourceTestResult>;
        /** Full definition for editing/duplicating. */
        definition(id: string): Promise<SourceDefinition | undefined>;
        /** Export all sources as a shareable pack (JSON array). */
        exportPack(): Promise<SourceDefinition[]>;
        /** Install a source pack (JSON array of definitions). */
        importPack(pack: unknown): Promise<{ added: number; skipped: number; errors: string[] }>;
        /** Pick a local .mjs code plugin and install it (opens a file dialog). Returns installed id or null if cancelled. */
        installPlugin(): Promise<{ ok: boolean; error?: string; cancelled?: boolean }>;
        /** Open the site and let the user click an element; resolves a CSS selector (empty if cancelled). */
        pickElement(url: string): Promise<string>;
        mangas(id: string): Promise<Manga[]>;
        chapters(id: string, manga: Manga): Promise<Chapter[]>;
        pages(id: string, chapter: Chapter): Promise<Page[]>;
        /** Fetch a page image through the bridge (referer/anti-bot aware) as a data: URI, or null. */
        pageImage(page: Page): Promise<string | null>;
        /** Subscribe to registry changes (folder watch / add / remove). Returns an unsubscribe fn. */
        onChanged(listener: () => void): () => void;
    };

    downloads: {
        enqueue(request: DownloadRequest): Promise<DownloadJobInfo>;
        list(): Promise<DownloadJobInfo[]>;
        cancel(id: string): Promise<void>;
        retry(id: string): Promise<void>;
        /** Remove finished (completed/failed/cancelled) jobs from the list. */
        clear(): Promise<void>;
        /** Subscribe to job updates. Returns an unsubscribe fn. */
        onChanged(listener: (jobs: DownloadJobInfo[]) => void): () => void;
    };

    settings: {
        get(): Promise<AppSettings>;
        set(patch: Partial<AppSettings>): Promise<AppSettings>;
    };

    logs: {
        list(): Promise<LogEntry[]>;
        clear(): Promise<void>;
        onChanged(listener: () => void): () => void;
    };

    updates: {
        status(): Promise<UpdateStatus>;
        check(): Promise<UpdateStatus>;
        download(): Promise<void>;
        install(): Promise<void>;
        onChanged(listener: (status: UpdateStatus) => void): () => void;
    };

    bookmarks: {
        list(): Promise<Bookmark[]>;
        add(sourceId: string, manga: Manga): Promise<void>;
        remove(sourceId: string, mangaId: string): Promise<void>;
        isBookmarked(sourceId: string, mangaId: string): Promise<boolean>;
        importLegacy(json: string): Promise<BookmarkImportResult>;
        exportLegacy(): Promise<string>;
        onChanged(listener: () => void): () => void;
    };

    library: {
        /** Manga list from cache (fresh) or network; refresh forces fetch. */
        mangas(sourceId: string, refresh?: boolean): Promise<Manga[]>;
        /** Chapters with new-since-last-seen flags; marks them seen. */
        chapters(sourceId: string, manga: Manga): Promise<ChapterWithNew[]>;
    };
}

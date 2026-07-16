import type { AppInfo, SourceSummary, DownloadJobInfo, Bookmark, AppSettings } from '@shared/ipc';

/**
 * Central reactive app state (Svelte 5 runes). Views read from here and call
 * the load/refresh actions; IPC change events keep it live. One place so
 * Sources, Library, Downloads and Settings stay in sync.
 */
class AppStore {
    info = $state<AppInfo | undefined>(undefined);
    sources = $state<SourceSummary[]>([]);
    templates = $state<string[]>([]);
    jobs = $state<DownloadJobInfo[]>([]);
    bookmarks = $state<Bookmark[]>([]);
    settings = $state<AppSettings | undefined>(undefined);

    #wired = false;

    async init(): Promise<void> {
        const [info, settings] = await Promise.all([
            window.hakuneko.appInfo(),
            window.hakuneko.settings.get()
        ]);
        this.info = info;
        this.settings = settings;
        applyTheme(settings.theme);

        await Promise.all([this.refreshSources(), this.refreshBookmarks(), this.refreshJobs()]);
        window.hakuneko.sources.templates().then(t => { this.templates = t; });

        if (!this.#wired) {
            this.#wired = true;
            window.hakuneko.sources.onChanged(() => { void this.refreshSources(); });
            window.hakuneko.downloads.onChanged(jobs => { this.jobs = jobs; });
            window.hakuneko.bookmarks.onChanged(() => { void this.refreshBookmarks(); });
        }
    }

    get adultUnlocked(): boolean {
        return this.settings?.adultUnlocked ?? false;
    }

    /** Sources honoring the age gate. */
    get visibleSources(): SourceSummary[] {
        return this.adultUnlocked ? this.sources : this.sources.filter(s => !s.nsfw);
    }

    get adultCount(): number {
        return this.sources.filter(s => s.nsfw).length;
    }

    async refreshSources(): Promise<void> {
        this.sources = await window.hakuneko.sources.list();
    }

    async refreshBookmarks(): Promise<void> {
        this.bookmarks = await window.hakuneko.bookmarks.list();
    }

    async refreshJobs(): Promise<void> {
        this.jobs = await window.hakuneko.downloads.list();
    }

    async updateSettings(patch: Partial<AppSettings>): Promise<void> {
        this.settings = await window.hakuneko.settings.set(patch);
        if (patch.theme) {
            applyTheme(this.settings.theme);
        }
    }
}

export function applyTheme(theme: AppSettings['theme']): void {
    const root = document.documentElement;
    if (theme === 'system') {
        root.removeAttribute('data-theme');
    } else {
        root.setAttribute('data-theme', theme);
    }
}

export const store = new AppStore();

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipc';
import type { FetchRequest, FetchWindowRequest, HakunekoApi, Manga, Chapter, Page, DownloadRequest, DownloadJobInfo, AppSettings, UpdateStatus } from '@shared/ipc';

const api: HakunekoApi = {
    fetch: (request: FetchRequest) => ipcRenderer.invoke(IPC.netFetch, request),
    fetchWindow: (request: FetchWindowRequest) => ipcRenderer.invoke(IPC.netFetchWindow, request),
    appInfo: () => ipcRenderer.invoke(IPC.appInfo),

    sources: {
        list: () => ipcRenderer.invoke(IPC.sourcesList),
        add: (definition: unknown) => ipcRenderer.invoke(IPC.sourcesAdd, definition),
        remove: (id: string) => ipcRenderer.invoke(IPC.sourcesRemove, id),
        templates: () => ipcRenderer.invoke(IPC.sourcesTemplates),
        detect: (url: string) => ipcRenderer.invoke(IPC.sourcesDetect, url),
        test: (definition: unknown) => ipcRenderer.invoke(IPC.sourcesTest, definition),
        definition: (id: string) => ipcRenderer.invoke(IPC.sourcesDefinition, id),
        exportPack: () => ipcRenderer.invoke(IPC.sourcesExportPack),
        importPack: (pack: unknown) => ipcRenderer.invoke(IPC.sourcesImportPack, pack),
        installPlugin: () => ipcRenderer.invoke(IPC.sourcesInstallPlugin),
        pickElement: (url: string) => ipcRenderer.invoke(IPC.sourcesPickElement, url),
        mangas: (id: string) => ipcRenderer.invoke(IPC.sourceMangas, id),
        chapters: (id: string, manga: Manga) => ipcRenderer.invoke(IPC.sourceChapters, id, manga),
        pages: (id: string, chapter: Chapter) => ipcRenderer.invoke(IPC.sourcePages, id, chapter),
        pageImage: (page: Page) => ipcRenderer.invoke(IPC.sourcePageImage, page),
        onChanged: (listener: () => void) => {
            const handler = (): void => listener();
            ipcRenderer.on(IPC.sourcesChanged, handler);
            return () => ipcRenderer.removeListener(IPC.sourcesChanged, handler);
        }
    },

    downloads: {
        enqueue: (request: DownloadRequest) => ipcRenderer.invoke(IPC.downloadsEnqueue, request),
        list: () => ipcRenderer.invoke(IPC.downloadsList),
        cancel: (id: string) => ipcRenderer.invoke(IPC.downloadsCancel, id),
        retry: (id: string) => ipcRenderer.invoke(IPC.downloadsRetry, id),
        clear: () => ipcRenderer.invoke(IPC.downloadsClear),
        onChanged: (listener: (jobs: DownloadJobInfo[]) => void) => {
            const handler = (_event: unknown, jobs: DownloadJobInfo[]): void => listener(jobs);
            ipcRenderer.on(IPC.downloadsChanged, handler);
            return () => ipcRenderer.removeListener(IPC.downloadsChanged, handler);
        }
    },

    settings: {
        get: () => ipcRenderer.invoke(IPC.settingsGet),
        set: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsSet, patch)
    },

    logs: {
        list: () => ipcRenderer.invoke(IPC.logsList),
        clear: () => ipcRenderer.invoke(IPC.logsClear),
        onChanged: (listener: () => void) => {
            const handler = (): void => listener();
            ipcRenderer.on(IPC.logsChanged, handler);
            return () => ipcRenderer.removeListener(IPC.logsChanged, handler);
        }
    },

    updates: {
        status: () => ipcRenderer.invoke(IPC.updateStatus),
        check: () => ipcRenderer.invoke(IPC.updateCheck),
        download: () => ipcRenderer.invoke(IPC.updateDownload),
        install: () => ipcRenderer.invoke(IPC.updateInstall),
        onChanged: (listener: (status: UpdateStatus) => void) => {
            const handler = (_event: unknown, status: UpdateStatus): void => listener(status);
            ipcRenderer.on(IPC.updateChanged, handler);
            return () => ipcRenderer.removeListener(IPC.updateChanged, handler);
        }
    },

    bookmarks: {
        list: () => ipcRenderer.invoke(IPC.bookmarksList),
        add: (sourceId: string, manga: Manga) => ipcRenderer.invoke(IPC.bookmarksAdd, sourceId, manga),
        remove: (sourceId: string, mangaId: string) => ipcRenderer.invoke(IPC.bookmarksRemove, sourceId, mangaId),
        isBookmarked: (sourceId: string, mangaId: string) => ipcRenderer.invoke(IPC.bookmarksIs, sourceId, mangaId),
        importLegacy: (json: string) => ipcRenderer.invoke(IPC.bookmarksImport, json),
        exportLegacy: () => ipcRenderer.invoke(IPC.bookmarksExport),
        onChanged: (listener: () => void) => {
            const handler = (): void => listener();
            ipcRenderer.on(IPC.bookmarksChanged, handler);
            return () => ipcRenderer.removeListener(IPC.bookmarksChanged, handler);
        }
    },

    library: {
        mangas: (sourceId: string, refresh?: boolean) => ipcRenderer.invoke(IPC.libraryMangas, sourceId, refresh),
        chapters: (sourceId: string, manga: Manga) => ipcRenderer.invoke(IPC.libraryChapters, sourceId, manga)
    }
};

contextBridge.exposeInMainWorld('hakuneko', api);

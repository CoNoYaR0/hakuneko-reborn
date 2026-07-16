import { app, BrowserWindow, ipcMain, dialog, shell, session, nativeImage } from 'electron';
import path from 'node:path';
import { AppConfig } from './config';
import { RequestBridge } from './RequestBridge';
import { installAdBlocker } from './Blacklist';
import { defaultUserAgent, installHeaderRules } from './headers';
import { SourceRegistry } from './engine/SourceRegistry';
import { DownloadManager } from './download/DownloadManager';
import { Settings } from './Settings';
import { Storage } from './Storage';
import { detectSource, buildDefinition } from './engine/detect';
import { testDefinition } from './engine/testSource';
import { pickElement } from './engine/pickElement';
import { getLogs, clearLogs, setLogListener } from './log';
import { verifyCatalog } from './verifyCatalog';
import { initUpdater, checkForUpdates, downloadUpdate, installUpdate, getUpdateStatus } from './updater';
import { TEMPLATES } from './engine/templates';
import { IPC } from '@shared/ipc';
import type { AppInfo, FetchRequest, FetchWindowRequest, Manga, Chapter, DownloadRequest, AppSettings } from '@shared/ipc';

/**
 * Smoke mode (CI / dev verification without the UI):
 *   electron . --smoke <url>            → fetch a page through the bridge
 *   electron . --smoke-source <id>      → run a catalog source end-to-end
 * Prints a JSON summary; exit 0 on success.
 */
const smokeArgIndex = process.argv.indexOf('--smoke');
const smokeUrl = smokeArgIndex >= 0 ? process.argv[smokeArgIndex + 1] : undefined;
const smokeSourceIndex = process.argv.indexOf('--smoke-source');
const smokeSourceId = smokeSourceIndex >= 0 ? process.argv[smokeSourceIndex + 1] : undefined;
const smokeDownloadIndex = process.argv.indexOf('--smoke-download');
const smokeDownloadId = smokeDownloadIndex >= 0 ? process.argv[smokeDownloadIndex + 1] : undefined;
const smokeDownloadFormat = (smokeDownloadIndex >= 0 ? process.argv[smokeDownloadIndex + 2] : undefined) as import('@shared/ipc').DownloadFormat | undefined;
const smokeDetectIndex = process.argv.indexOf('--smoke-detect');
const smokeDetectUrl = smokeDetectIndex >= 0 ? process.argv[smokeDetectIndex + 1] : undefined;
const verifyCatalogFlag = process.argv.includes('--verify-catalog');
const applyFlag = process.argv.includes('--apply');
const isSmoke = Boolean(smokeUrl || smokeSourceId || smokeDownloadId || smokeDetectUrl || verifyCatalogFlag);

// Ensure per-OS paths resolve under "hakuneko-reborn" (not the default
// "Electron") in dev and packaged builds alike. Must run before any getPath()
// call. The distinct name also keeps our data clear of a legacy HakuNeko
// install's config directory rather than sharing/overwriting it.
app.setName('hakuneko-reborn');

// Anti-bot stealth: hide the automation signals Chromium exposes by default.
// `AutomationControlled` is the blink feature that sets navigator.webdriver and
// tips off Cloudflare that this is an automated browser — disabling it makes the
// engine look like an ordinary Chrome, so more challenges pass (must run before
// app is ready). Cheap, no dependencies.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

let config: AppConfig;
let bridge: RequestBridge;
let registry: SourceRegistry;
let downloads: DownloadManager;
let settings: Settings;
let storage: Storage;

function catalogPath(): string {
    // Packaged: extraResources copies resources/ into process.resourcesPath.
    // Dev/build: __dirname is out/main → repo resources/ is two levels up.
    return app.isPackaged
        ? path.join(process.resourcesPath, 'catalog.json')
        : path.join(__dirname, '../../resources/catalog.json');
}

function registerIpc(): void {
    ipcMain.handle(IPC.netFetch, (_event, request: FetchRequest) => bridge.fetch(request));
    ipcMain.handle(IPC.netFetchWindow, (_event, request: FetchWindowRequest) => bridge.fetchWindow(request));
    ipcMain.handle(IPC.appInfo, (): AppInfo => ({
        version: app.getVersion(),
        electron: process.versions.electron ?? '',
        chrome: process.versions.chrome ?? '',
        node: process.versions.node ?? '',
        platform: process.platform,
        portable: config.portable,
        paths: {
            userData: config.userDataDir,
            cache: config.cacheDir,
            sources: config.sourcesDir,
            customSources: config.customSourcesDir,
            downloads: config.downloadsDir
        }
    }));

    ipcMain.handle(IPC.sourcesList, () => registry.list());
    ipcMain.handle(IPC.sourcesTemplates, () => [...TEMPLATES.keys()]);
    ipcMain.handle(IPC.sourcesAdd, async (_event, definition: unknown) => {
        try {
            await registry.add(definition);
            return { ok: true };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    ipcMain.handle(IPC.sourcesRemove, (_event, id: string) => registry.remove(id));
    ipcMain.handle(IPC.sourcesDetect, (_event, url: string) => detectSource(bridge, url));
    ipcMain.handle(IPC.sourcesTest, (_event, definition: unknown) => testDefinition(bridge, definition));
    ipcMain.handle(IPC.sourcesDefinition, (_event, id: string) => registry.getDefinition(id) ?? null);
    ipcMain.handle(IPC.sourcesExportPack, () => registry.exportPack());
    ipcMain.handle(IPC.sourcesImportPack, (_event, pack: unknown) => registry.importPack(pack));
    ipcMain.handle(IPC.sourcesInstallPlugin, async () => {
        const result = await dialog.showOpenDialog({
            title: 'Install code plugin',
            properties: ['openFile'],
            filters: [{ name: 'Code plugin', extensions: ['mjs', 'js'] }]
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { ok: false, cancelled: true };
        }
        try {
            await registry.installCodePlugin(result.filePaths[0]!);
            return { ok: true };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    ipcMain.handle(IPC.sourcesPickElement, (_event, url: string) => pickElement(url, defaultUserAgent()));
    ipcMain.handle(IPC.sourceMangas, (_event, id: string) => registry.get(id).getMangas());
    ipcMain.handle(IPC.sourceChapters, (_event, id: string, manga: Manga) => registry.get(id).getChapters(manga));
    ipcMain.handle(IPC.sourcePages, (_event, id: string, chapter: Chapter) => registry.get(id).getPages(chapter));
    ipcMain.handle(IPC.sourcePageImage, async (_event, page: import('@shared/ipc').Page) => {
        const url = typeof page === 'string' ? page : page.url;
        const referer = typeof page === 'string' ? undefined : page.referer;
        try {
            const response = await bridge.fetch({ url, headers: referer ? { 'x-referer': referer } : undefined });
            if (!response.ok) {
                return null;
            }
            const mime = response.headers['content-type']?.split(';')[0]?.trim() || 'image/jpeg';
            return `data:${mime};base64,${response.bodyBase64}`;
        } catch {
            return null;
        }
    });

    ipcMain.handle(IPC.downloadsEnqueue, (_event, request: DownloadRequest) => downloads.enqueue(request));
    ipcMain.handle(IPC.downloadsList, () => downloads.list());
    ipcMain.handle(IPC.downloadsCancel, (_event, id: string) => downloads.cancel(id));
    ipcMain.handle(IPC.downloadsRetry, (_event, id: string) => downloads.retry(id));
    ipcMain.handle(IPC.downloadsClear, () => downloads.clearFinished());

    ipcMain.handle(IPC.settingsGet, () => settings.get());
    ipcMain.handle(IPC.settingsSet, async (_event, patch: Partial<AppSettings>) => {
        const updated = await settings.set(patch);
        bridge.setMaxConcurrentPerHost(updated.maxConcurrentPerHost);
        return updated;
    });

    ipcMain.handle(IPC.logsList, () => getLogs());
    ipcMain.handle(IPC.logsClear, () => clearLogs());

    ipcMain.handle(IPC.updateStatus, () => getUpdateStatus());
    ipcMain.handle(IPC.updateCheck, () => checkForUpdates());
    ipcMain.handle(IPC.updateDownload, () => downloadUpdate());
    ipcMain.handle(IPC.updateInstall, () => installUpdate());

    ipcMain.handle(IPC.bookmarksList, () => storage.listBookmarks());
    ipcMain.handle(IPC.bookmarksAdd, async (_event, sourceId: string, manga: Manga) => {
        await storage.addBookmark(sourceId, manga);
        broadcast(IPC.bookmarksChanged);
    });
    ipcMain.handle(IPC.bookmarksRemove, async (_event, sourceId: string, mangaId: string) => {
        await storage.removeBookmark(sourceId, mangaId);
        broadcast(IPC.bookmarksChanged);
    });
    ipcMain.handle(IPC.bookmarksImport, async (_event, json: string) => {
        const result = await storage.importLegacyBookmarks(json);
        broadcast(IPC.bookmarksChanged);
        return result;
    });
    ipcMain.handle(IPC.bookmarksExport, () => storage.exportLegacyBookmarks());
    ipcMain.handle(IPC.bookmarksIs, (_event, sourceId: string, mangaId: string) => storage.isBookmarked(sourceId, mangaId));

    ipcMain.handle(IPC.libraryMangas, (_event, sourceId: string, refresh?: boolean) => storage.getMangas(sourceId, refresh));
    ipcMain.handle(IPC.libraryChapters, (_event, sourceId: string, manga: Manga) => storage.getChaptersWithNew(sourceId, manga));
}

function broadcast(channel: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel);
    }
}

function broadcastSourcesChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.sourcesChanged);
    }
}

function broadcastDownloadsChanged(jobs: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.downloadsChanged, jobs);
    }
}

function createMainWindow(): void {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        show: false,
        backgroundColor: '#0e0e12',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            // Explicit hardening (defense-in-depth): keep Node out of the
            // renderer and isolate the preload world regardless of defaults.
            sandbox: true,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });
    win.once('ready-to-show', () => win.show());

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

    // Security: external links (source/page URLs) open in the system browser,
    // never in a new — unhardened — Electron window; and injected content can't
    // navigate the app window away from our own UI.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            void shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
        const appOrigin = devServerUrl ?? 'file://';
        if (!url.startsWith(appOrigin)) {
            event.preventDefault();
            if (url.startsWith('http:') || url.startsWith('https:')) {
                void shell.openExternal(url);
            }
        }
    });

    if (devServerUrl) {
        void win.loadURL(devServerUrl);
    } else {
        void win.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
}

async function runUrlSmoke(url: string): Promise<void> {
    try {
        const { finalUrl, result, elapsedMs } = await bridge.fetchWindow<{ title: string; url: string; html: string }>({
            url, timeout: 90_000, images: true
        });
        console.log(JSON.stringify({ ok: true, requestedUrl: url, finalUrl, title: result.title, htmlBytes: result.html.length, elapsedMs }, null, 2));
        app.exit(0);
    } catch (error) {
        console.error(JSON.stringify({ ok: false, requestedUrl: url, error: error instanceof Error ? error.message : String(error) }, null, 2));
        app.exit(1);
    }
}

async function runSourceSmoke(id: string): Promise<void> {
    try {
        const source = registry.get(id);
        const started = Date.now();
        const mangas = await source.getMangas();
        const firstManga = mangas[0];
        const chapters = firstManga ? await source.getChapters(firstManga) : [];
        const firstChapter = chapters[0];
        const pages = firstChapter ? await source.getPages(firstChapter) : [];
        console.log(JSON.stringify({
            ok: mangas.length > 0,
            source: id,
            mangaCount: mangas.length,
            sampleManga: firstManga?.title,
            chapterCount: chapters.length,
            sampleChapter: firstChapter?.title,
            pageCount: pages.length,
            samplePage: pages[0],
            elapsedMs: Date.now() - started
        }, null, 2));
        app.exit(mangas.length > 0 ? 0 : 1);
    } catch (error) {
        console.error(JSON.stringify({ ok: false, source: id, error: error instanceof Error ? error.message : String(error) }, null, 2));
        app.exit(1);
    }
}

async function runDownloadSmoke(id: string): Promise<void> {
    try {
        const source = registry.get(id);
        const mangas = await source.getMangas();
        const manga = mangas[0];
        if (!manga) {
            throw new Error('no manga');
        }
        const chapters = await source.getChapters(manga);
        const chapter = chapters[0];
        if (!chapter) {
            throw new Error('no chapters');
        }
        const finished = new Promise<void>(resolve => {
            downloads.setOnChange(jobs => {
                const job = jobs[0];
                if (job && (job.status === 'completed' || job.status === 'failed')) {
                    console.log(JSON.stringify({ ok: job.status === 'completed', ...job }, null, 2));
                    resolve();
                }
            });
        });
        const format = smokeDownloadFormat && ['cbz', 'folder', 'pdf', 'epub'].includes(smokeDownloadFormat) ? smokeDownloadFormat : 'cbz';
        downloads.enqueue({ sourceId: id, manga, chapter, format });
        await finished;
        const job = downloads.list()[0];
        app.exit(job?.status === 'completed' ? 0 : 1);
    } catch (error) {
        console.error(JSON.stringify({ ok: false, source: id, error: error instanceof Error ? error.message : String(error) }, null, 2));
        app.exit(1);
    }
}

async function runDetectSmoke(url: string): Promise<void> {
    try {
        const detection = await detectSource(bridge, url);
        const best = detection.candidates[0];
        let test: unknown;
        if (best) {
            const definition = buildDefinition(detection, best.template);
            test = await testDefinition(bridge, definition);
        }
        console.log(JSON.stringify({
            url: detection.url,
            reachable: detection.reachable,
            error: detection.error,
            suggested: detection.suggested,
            candidates: detection.candidates.map(c => ({ template: c.template, confidence: c.confidence, reasons: c.reasons })),
            test
        }, null, 2));
        app.exit(detection.candidates.length > 0 ? 0 : 1);
    } catch (error) {
        console.error(JSON.stringify({ ok: false, url, error: error instanceof Error ? error.message : String(error) }, null, 2));
        app.exit(1);
    }
}

void app.whenReady().then(async () => {
    config = new AppConfig();
    bridge = new RequestBridge(defaultUserAgent());
    installHeaderRules(defaultUserAgent());
    registry = new SourceRegistry(bridge, config.sourcesDir, catalogPath());
    await registry.initialize(broadcastSourcesChanged);
    settings = new Settings(config.userDataDir);
    bridge.setMaxConcurrentPerHost(settings.get().maxConcurrentPerHost);

    // Convert non-JPEG/PNG page images to PNG for PDF export (best-effort; Electron
    // nativeImage decodes JPEG/PNG/GIF but not WebP — those pages are then skipped).
    const normalizeImage = (data: Buffer, _ext: string): Buffer | null => {
        const img = nativeImage.createFromBuffer(data);
        return img.isEmpty() ? null : img.toPNG();
    };
    downloads = new DownloadManager(bridge, registry, config.downloadsDir, normalizeImage);
    downloads.setOnChange(broadcastDownloadsChanged);

    // Ad/tracker/malware request blocker (legacy Blacklist). Reads the setting
    // live, so the Settings toggle takes effect without restart.
    installAdBlocker(session.defaultSession, () => settings.get().blockAds);
    storage = new Storage(registry, config.userDataDir, config.cacheDir);
    await storage.initialize();
    registerIpc();

    // Notify the Diagnostics panel when logs change (throttled — logs are frequent).
    let logNotifyTimer: NodeJS.Timeout | undefined;
    setLogListener(() => {
        if (!logNotifyTimer) {
            logNotifyTimer = setTimeout(() => { logNotifyTimer = undefined; broadcast(IPC.logsChanged); }, 250);
        }
    });

    // Auto-update (packaged builds only). Broadcast status to the renderer.
    initUpdater(app.isPackaged, status => {
        for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC.updateChanged, status);
        }
    });

    if (verifyCatalogFlag) {
        // Point at the repo's source catalog (dev), not a packaged copy.
        const repoCatalog = app.isPackaged ? catalogPath() : path.join(__dirname, '../../resources/catalog.json');
        verifyCatalog(bridge, repoCatalog, applyFlag)
            .then(() => app.exit(0))
            .catch(error => { console.error(error); app.exit(1); });
        return;
    }
    if (smokeUrl) {
        void runUrlSmoke(smokeUrl);
        return;
    }
    if (smokeSourceId) {
        void runSourceSmoke(smokeSourceId);
        return;
    }
    if (smokeDownloadId) {
        void runDownloadSmoke(smokeDownloadId);
        return;
    }
    if (smokeDetectUrl) {
        void runDetectSmoke(smokeDetectUrl);
        return;
    }

    config.printInfo();
    console.log(`Sources loaded: ${registry.list().length}`);
    createMainWindow();

    // Check for updates shortly after startup (packaged + opted in).
    if (app.isPackaged && settings.get().autoUpdate) {
        setTimeout(() => void checkForUpdates(), 4000);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !isSmoke) {
        app.quit();
    }
});

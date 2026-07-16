import electronUpdater from 'electron-updater';
import { logLine } from './log';
import type { UpdateStatus } from '@shared/ipc';

const { autoUpdater } = electronUpdater;

/**
 * Auto-update via electron-updater. Reads the `latest*.yml` manifests that
 * electron-builder publishes alongside the installers (see publish: in
 * electron-builder.yml) and updates AppImage / NSIS / dmg in place.
 *
 * Only active in a packaged build — in dev there is no update feed, so calls
 * are no-ops that report an idle state. Downloads are user-triggered by default
 * (autoDownload off) so we never surprise the user with background traffic.
 */

let status: UpdateStatus = { state: 'idle' };
let broadcast: ((s: UpdateStatus) => void) | undefined;
let initialized = false;

function setStatus(next: UpdateStatus): void {
    status = next;
    broadcast?.(next);
}

export function getUpdateStatus(): UpdateStatus {
    return status;
}

export function initUpdater(isPackaged: boolean, onStatus: (s: UpdateStatus) => void): void {
    broadcast = onStatus;
    if (!isPackaged || initialized) {
        return;
    }
    initialized = true;
    autoUpdater.autoDownload = false;          // let the user choose to download
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
        info: (m: unknown) => logLine('update', String(m)),
        warn: (m: unknown) => logLine('update', String(m), 'warn'),
        error: (m: unknown) => logLine('update', String(m), 'error'),
        debug: () => undefined
    };

    autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }));
    autoUpdater.on('update-available', info => setStatus({ state: 'available', version: info.version }));
    autoUpdater.on('update-not-available', () => setStatus({ state: 'none' }));
    autoUpdater.on('download-progress', p => setStatus({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', info => setStatus({ state: 'downloaded', version: info.version }));
    autoUpdater.on('error', err => setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) }));
}

export async function checkForUpdates(): Promise<UpdateStatus> {
    if (!initialized) {
        setStatus({ state: 'idle', error: 'Updates are only available in an installed build.' });
        return status;
    }
    try {
        await autoUpdater.checkForUpdates();
    } catch (error) {
        setStatus({ state: 'error', error: error instanceof Error ? error.message : String(error) });
    }
    return status;
}

export async function downloadUpdate(): Promise<void> {
    if (!initialized) return;
    try {
        await autoUpdater.downloadUpdate();
    } catch (error) {
        setStatus({ state: 'error', error: error instanceof Error ? error.message : String(error) });
    }
}

/** Quit and install a downloaded update. */
export function installUpdate(): void {
    if (initialized && status.state === 'downloaded') {
        autoUpdater.quitAndInstall();
    }
}

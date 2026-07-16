<script lang="ts">
    import type { DownloadFormat, ThemePreference, UpdateStatus } from '@shared/ipc';
    import { store } from '../store.svelte';
    import DiagnosticsPanel from '../lib/DiagnosticsPanel.svelte';

    let update = $state<UpdateStatus>({ state: 'idle' });
    void window.hakuneko.updates.status().then(s => { update = s; });
    const unsubUpdate = window.hakuneko.updates.onChanged(s => { update = s; });
    $effect(() => () => unsubUpdate());

    const updateLabel = $derived(
        update.state === 'checking' ? 'Checking…'
        : update.state === 'available' ? `Update ${update.version} available`
        : update.state === 'downloading' ? `Downloading… ${update.percent ?? 0}%`
        : update.state === 'downloaded' ? `Update ${update.version} ready`
        : update.state === 'none' ? 'You’re up to date'
        : update.state === 'error' ? (update.error ?? 'Update check failed')
        : 'Up to date check'
    );

    interface Props { onToggleAdult: () => void }
    let { onToggleAdult }: Props = $props();

    let importMsg = $state('');
    let importErr = $state('');
    let packMsg = $state('');
    let pluginMsg = $state('');
    let showPluginWarning = $state(false);

    const settings = $derived(store.settings);

    async function setFormat(format: DownloadFormat): Promise<void> {
        await store.updateSettings({ downloadFormat: format });
    }
    async function setTheme(theme: ThemePreference): Promise<void> {
        await store.updateSettings({ theme });
    }
    async function setAutoUpdate(on: boolean): Promise<void> {
        await store.updateSettings({ autoUpdate: on });
    }
    async function setBlockAds(on: boolean): Promise<void> {
        await store.updateSettings({ blockAds: on });
    }
    async function setRate(value: number): Promise<void> {
        await store.updateSettings({ maxConcurrentPerHost: Math.min(16, Math.max(1, Math.round(value))) });
    }

    async function importBookmarks(event: Event): Promise<void> {
        importMsg = ''; importErr = '';
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
            const json = await file.text();
            const result = await window.hakuneko.bookmarks.importLegacy(json);
            importMsg = `Imported ${result.added} bookmark${result.added === 1 ? '' : 's'} (${result.skipped} skipped of ${result.total}).`;
        } catch (e) {
            importErr = e instanceof Error ? e.message : String(e);
        } finally {
            input.value = '';
        }
    }

    async function exportBookmarks(): Promise<void> {
        downloadJson(await window.hakuneko.bookmarks.exportLegacy(), 'hakuneko-reborn-bookmarks.json');
    }

    function downloadJson(json: string, filename: string): void {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function exportPack(): Promise<void> {
        const pack = await window.hakuneko.sources.exportPack();
        downloadJson(JSON.stringify(pack, null, 2), 'hakuneko-reborn-source-pack.json');
        packMsg = `Exported ${pack.length} sources.`;
    }

    async function importPack(event: Event): Promise<void> {
        packMsg = '';
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
            const pack = JSON.parse(await file.text());
            const result = await window.hakuneko.sources.importPack(pack);
            await store.refreshSources();
            packMsg = `Installed ${result.added} sources (${result.skipped} skipped).`;
        } catch (e) {
            packMsg = `Import failed: ${e instanceof Error ? e.message : String(e)}`;
        } finally {
            input.value = '';
        }
    }

    function focusOnMount(node: HTMLElement): void {
        node.focus();
    }

    async function confirmInstallPlugin(): Promise<void> {
        showPluginWarning = false;
        pluginMsg = '';
        const result = await window.hakuneko.sources.installPlugin();
        if (result.cancelled) return;
        if (result.ok) {
            await store.refreshSources();
            pluginMsg = 'Code plugin installed.';
        } else {
            pluginMsg = `Install failed: ${result.error ?? 'unknown error'}`;
        }
    }
</script>

<div class="settings">
    <h2>Settings</h2>

    {#if settings}
        <section>
            <h3>Downloads</h3>
            <div class="field">
                <span class="label">Format
                    <span class="hint">.cbz, folder & .epub keep every image; .pdf embeds JPEG/PNG pages.</span>
                </span>
                <div class="segmented">
                    <button class:on={settings.downloadFormat === 'cbz'} onclick={() => setFormat('cbz')}>.cbz archive</button>
                    <button class:on={settings.downloadFormat === 'folder'} onclick={() => setFormat('folder')}>Folder</button>
                    <button class:on={settings.downloadFormat === 'pdf'} onclick={() => setFormat('pdf')}>.pdf</button>
                    <button class:on={settings.downloadFormat === 'epub'} onclick={() => setFormat('epub')}>.epub</button>
                </div>
            </div>
            <div class="field">
                <span class="label">Requests per site
                    <span class="hint">Lower = gentler on sites; higher = faster. Default 4.</span>
                </span>
                <div class="rate">
                    <input type="range" min="1" max="16" value={settings.maxConcurrentPerHost} oninput={(e) => setRate(+(e.currentTarget as HTMLInputElement).value)} />
                    <span class="rate-val">{settings.maxConcurrentPerHost}</span>
                </div>
            </div>
            <div class="field">
                <span class="label">Block ads &amp; trackers
                    <span class="hint">Blocks ad/tracker/malware requests while scraping. Recommended on.</span>
                </span>
                <label class="switch">
                    <input type="checkbox" checked={settings.blockAds} onchange={(e) => setBlockAds((e.currentTarget as HTMLInputElement).checked)} />
                    <span>{settings.blockAds ? 'On' : 'Off'}</span>
                </label>
            </div>
        </section>

        <section>
            <h3>Appearance</h3>
            <div class="field">
                <span class="label">Theme</span>
                <div class="segmented">
                    {#each (['system', 'light', 'dark'] as ThemePreference[]) as t (t)}
                        <button class:on={settings.theme === t} onclick={() => setTheme(t)}>{t}</button>
                    {/each}
                </div>
            </div>
        </section>

        <section>
            <h3>Content</h3>
            <div class="field">
                <span class="label">Adult sources (18+)
                    <span class="hint">{store.adultCount} adult source{store.adultCount === 1 ? '' : 's'} in your catalog.</span>
                </span>
                <label class="switch">
                    <input type="checkbox" checked={store.adultUnlocked} onchange={onToggleAdult} />
                    <span>{store.adultUnlocked ? 'Shown' : 'Hidden'}</span>
                </label>
            </div>
        </section>

        <section>
            <h3>Bookmarks</h3>
            <div class="field">
                <span class="label">Import / export
                    <span class="hint">Import a legacy HakuNeko bookmark export, or back yours up.</span>
                </span>
                <div class="btn-row">
                    <label class="btn ghost">
                        Import…
                        <input type="file" accept="application/json,.json" onchange={importBookmarks} hidden />
                    </label>
                    <button class="btn ghost" onclick={exportBookmarks} disabled={store.bookmarks.length === 0}>Export ({store.bookmarks.length})</button>
                </div>
            </div>
            {#if importMsg}<p class="ok">{importMsg}</p>{/if}
            {#if importErr}<p class="err">{importErr}</p>{/if}
        </section>

        <section>
            <h3>Source packs</h3>
            <div class="field">
                <span class="label">Share your sources
                    <span class="hint">A pack is a JSON file of source definitions — share it or back it up.</span>
                </span>
                <div class="btn-row">
                    <label class="btn ghost">
                        Import pack…
                        <input type="file" accept="application/json,.json" onchange={importPack} hidden />
                    </label>
                    <button class="btn ghost" onclick={exportPack}>Export pack</button>
                </div>
            </div>
            {#if packMsg}<p class="ok">{packMsg}</p>{/if}
        </section>

        <section>
            <h3>Advanced</h3>
            <div class="field">
                <span class="label">Code plugins
                    <span class="hint">For sites too complex for a template. Code plugins run real code — only install ones you trust.</span>
                </span>
                <button class="btn ghost" onclick={() => (showPluginWarning = true)}>Install plugin…</button>
            </div>
            {#if pluginMsg}<p class="ok">{pluginMsg}</p>{/if}
        </section>

        <section>
            <h3>Updates</h3>
            <div class="field">
                <span class="label">Automatic updates
                    <span class="hint">Check for a new version on startup. {updateLabel}.</span>
                </span>
                <label class="switch">
                    <input type="checkbox" checked={settings.autoUpdate} onchange={(e) => setAutoUpdate((e.currentTarget as HTMLInputElement).checked)} />
                    <span>{settings.autoUpdate ? 'On' : 'Off'}</span>
                </label>
            </div>
            <div class="btn-row">
                {#if update.state === 'available'}
                    <button class="btn" onclick={() => window.hakuneko.updates.download()}>Download {update.version}</button>
                {:else if update.state === 'downloaded'}
                    <button class="btn" onclick={() => window.hakuneko.updates.install()}>Restart & install {update.version}</button>
                {:else}
                    <button class="btn ghost" onclick={() => window.hakuneko.updates.check()} disabled={update.state === 'checking' || update.state === 'downloading'}>Check now</button>
                {/if}
            </div>
        </section>

        <section>
            <h3>Diagnostics</h3>
            <p class="hint" style="margin: 0 0 var(--space-2)">Live log of what each source fetches and scrapes. If a source loads nothing, open it and watch here — a line like <em>"0 matched …"</em> means the template doesn't fit that site.</p>
            <DiagnosticsPanel />
        </section>

        <section>
            <h3>About</h3>
            {#if store.info}
                <dl class="paths">
                    <dt>Version</dt><dd>{store.info.version} · Electron {store.info.electron} · Chromium {store.info.chrome.split('.')[0]}</dd>
                    <dt>Sources</dt><dd class="mono">{store.info.paths.sources}</dd>
                    <dt>Downloads</dt><dd class="mono">{store.info.paths.downloads}</dd>
                    <dt>Cache</dt><dd class="mono">{store.info.paths.cache}</dd>
                    <dt>User data</dt><dd class="mono">{store.info.paths.userData}</dd>
                </dl>
            {/if}
        </section>
    {/if}
</div>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') showPluginWarning = false; }} />
{#if showPluginWarning}
    <!-- svelte-ignore a11y_click_events_have_key_events -- backdrop click is a convenience; Escape is the keyboard path -->
    <div class="backdrop" role="presentation" onclick={() => (showPluginWarning = false)}>
        <div class="warn-dialog" role="alertdialog" tabindex="-1" aria-modal="true" aria-labelledby="pw-title" onclick={(e) => e.stopPropagation()}>
            <div class="warn-mark" aria-hidden="true">⚠</div>
            <h2 id="pw-title">Install a code plugin?</h2>
            <p>Unlike normal sources (which are just data), a code plugin is a program that <strong>runs with full access to this app and your computer</strong>. A malicious plugin could read your files or your data.</p>
            <p class="confirm">Only continue if you wrote this plugin yourself or got it from someone you trust. HakuNeko never installs plugins from the internet automatically.</p>
            <div class="warn-actions">
                <button type="button" class="btn ghost" onclick={() => (showPluginWarning = false)} use:focusOnMount>Cancel</button>
                <button type="button" class="btn danger" onclick={confirmInstallPlugin}>I understand — choose file</button>
            </div>
        </div>
    </div>
{/if}

<style>
    .settings { padding: var(--space-4); max-width: 720px; height: 100%; overflow-y: auto; }
    h2 { margin: 0 0 var(--space-4); font-size: 20px; }
    section { margin-bottom: var(--space-4); padding-bottom: var(--space-4); border-bottom: 1px solid var(--color-border); }
    section:last-child { border-bottom: none; }
    h3 { margin: 0 0 var(--space-3); font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); }
    .field { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-3); }
    .label { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
    .hint { font-size: 12px; color: var(--color-text-muted); font-weight: 400; }
    .segmented { display: flex; border: 1px solid var(--color-border); border-radius: var(--radius-sm); overflow: hidden; }
    .segmented button { background: var(--color-surface); border: none; color: var(--color-text-muted); padding: var(--space-2) var(--space-3); font: inherit; font-size: 13px; cursor: pointer; text-transform: capitalize; }
    .segmented button.on { background: var(--color-accent); color: var(--color-accent-contrast); font-weight: 600; }
    .rate { display: flex; align-items: center; gap: var(--space-2); }
    .rate-val { min-width: 20px; text-align: right; font-variant-numeric: tabular-nums; }
    .switch { display: flex; align-items: center; gap: var(--space-2); font-size: 13px; cursor: pointer; }
    .btn-row { display: flex; gap: var(--space-2); }
    .btn { border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: transparent; color: var(--color-text); padding: var(--space-2) var(--space-3); font: inherit; font-size: 13px; cursor: pointer; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .ok { color: var(--color-success); font-size: 12px; margin: var(--space-2) 0 0; }
    .err { color: var(--color-danger); font-size: 12px; font-family: var(--font-mono); margin: var(--space-2) 0 0; }
    .paths { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-3); font-size: 12px; margin: 0; }
    .paths dt { color: var(--color-text-muted); }
    .paths dd { margin: 0; word-break: break-all; }
    .mono { font-family: var(--font-mono); }
    .btn.danger { background: var(--color-danger); color: var(--color-accent-contrast); border-color: var(--color-danger); font-weight: 600; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 20; }
    .warn-dialog { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-4); width: 440px; max-width: 92vw; text-align: center; }
    .warn-mark { width: 52px; height: 52px; margin: 0 auto var(--space-3); display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 26px; background: color-mix(in srgb, var(--color-danger) 20%, transparent); color: var(--color-danger); }
    .warn-dialog h2 { margin: 0 0 var(--space-2); font-size: 18px; }
    .warn-dialog p { color: var(--color-text-muted); font-size: 13px; margin: 0 0 var(--space-3); text-align: left; }
    .warn-dialog .confirm { color: var(--color-text); }
    .warn-actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }
</style>

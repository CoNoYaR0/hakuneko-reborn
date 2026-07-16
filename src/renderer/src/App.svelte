<script lang="ts">
    import type { SourceSummary } from '@shared/ipc';
    import { store } from './store.svelte';
    import SourcesView from './views/SourcesView.svelte';
    import LibraryView from './views/LibraryView.svelte';
    import DownloadsView from './views/DownloadsView.svelte';
    import SettingsView from './views/SettingsView.svelte';
    import SourceStudio from './lib/SourceStudio.svelte';
    import AgeGateDialog from './lib/AgeGateDialog.svelte';

    type View = 'sources' | 'library' | 'downloads' | 'settings';
    let view = $state<View>('sources');

    let ready = $state(false);
    void store.init().then(() => { ready = true; });

    // Source Studio (add / edit / duplicate)
    let studioOpen = $state(false);
    let editTarget = $state<SourceSummary | undefined>(undefined);
    let studioMode = $state<'edit' | 'duplicate'>('edit');
    function openAdd(): void { editTarget = undefined; studioMode = 'edit'; studioOpen = true; }
    function openEdit(source: SourceSummary): void { editTarget = source; studioMode = 'edit'; studioOpen = true; }
    function openDuplicate(source: SourceSummary): void { editTarget = source; studioMode = 'duplicate'; studioOpen = true; }

    // Age gate
    let showAgeGate = $state(false);
    function toggleAdult(): void {
        if (store.adultUnlocked) {
            void store.updateSettings({ adultUnlocked: false });
        } else {
            showAgeGate = true;
        }
    }
    function confirmAge(): void {
        showAgeGate = false;
        void store.updateSettings({ adultUnlocked: true });
    }

    const activeJobs = $derived(store.jobs.filter(j => j.status === 'running' || j.status === 'queued').length);
    const newInLibrary = $derived(store.bookmarks.length);

    const nav: Array<{ id: View; label: string; icon: string }> = [
        { id: 'sources', label: 'Sources', icon: '⌘' },
        { id: 'library', label: 'Library', icon: '★' },
        { id: 'downloads', label: 'Downloads', icon: '⭳' },
        { id: 'settings', label: 'Settings', icon: '⚙' }
    ];
</script>

<div class="app">
    <nav class="rail">
        <div class="brand" title="HakuNeko Reborn">狐</div>
        {#each nav as item (item.id)}
            <button class="nav-item" class:active={view === item.id} onclick={() => (view = item.id)}>
                <span class="icon">{item.icon}</span>
                <span class="nav-label">{item.label}</span>
                {#if item.id === 'downloads' && activeJobs > 0}<span class="dot">{activeJobs}</span>{/if}
                {#if item.id === 'library' && newInLibrary > 0}<span class="dot subtle">{newInLibrary}</span>{/if}
            </button>
        {/each}
        <div class="spacer"></div>
        {#if store.info}<div class="ver" title="Electron {store.info.electron}">v{store.info.version}</div>{/if}
    </nav>

    <main>
        {#if !ready}
            <div class="loading">Loading…</div>
        {:else if view === 'sources'}
            <SourcesView onAddSource={openAdd} onEditSource={openEdit} onDuplicateSource={openDuplicate} onToggleAdult={toggleAdult} />
        {:else if view === 'library'}
            <LibraryView />
        {:else if view === 'downloads'}
            <DownloadsView />
        {:else if view === 'settings'}
            <SettingsView onToggleAdult={toggleAdult} />
        {/if}
    </main>
</div>

{#if studioOpen}
    <SourceStudio
        templates={store.templates}
        editSource={editTarget}
        mode={studioMode}
        onclose={() => (studioOpen = false)}
        onadded={() => store.refreshSources()}
    />
{/if}
{#if showAgeGate}
    <AgeGateDialog onconfirm={confirmAge} oncancel={() => (showAgeGate = false)} />
{/if}

<style>
    .app { display: grid; grid-template-columns: 76px 1fr; height: 100vh; }
    .rail { display: flex; flex-direction: column; align-items: stretch; gap: 4px; background: var(--color-surface); border-right: 1px solid var(--color-border); padding: var(--space-3) var(--space-2); }
    .brand { text-align: center; font-size: 22px; margin-bottom: var(--space-3); color: var(--color-accent); }
    .nav-item { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; background: none; border: none; border-radius: var(--radius-sm); color: var(--color-text-muted); padding: var(--space-2) 0; cursor: pointer; font: inherit; }
    .nav-item:hover { background: var(--color-surface-raised); color: var(--color-text); }
    .nav-item.active { background: color-mix(in srgb, var(--color-accent) 16%, transparent); color: var(--color-accent); }
    .icon { font-size: 18px; line-height: 1; }
    .nav-label { font-size: 10px; }
    .dot { position: absolute; top: 4px; right: 12px; background: var(--color-accent); color: var(--color-accent-contrast); font-size: 9px; font-weight: 700; min-width: 15px; height: 15px; border-radius: 8px; display: flex; align-items: center; justify-content: center; padding: 0 3px; }
    .dot.subtle { background: var(--color-border); color: var(--color-text-muted); }
    .spacer { flex: 1; }
    .ver { text-align: center; font-size: 10px; color: var(--color-text-muted); }
    main { min-height: 0; overflow: hidden; }
    .loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-muted); }
</style>

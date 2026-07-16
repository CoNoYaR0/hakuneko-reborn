<script lang="ts">
    import { store } from '../store.svelte';
    import DownloadsPanel from '../lib/DownloadsPanel.svelte';
</script>

<div class="downloads">
    <header>
        <h2>Downloads</h2>
        <span class="muted">saved to {store.info?.paths.downloads ?? '…'}</span>
    </header>
    <div class="panel-wrap">
        <DownloadsPanel jobs={store.jobs} full />
    </div>
</div>

<style>
    .downloads { padding: var(--space-4); height: 100%; display: flex; flex-direction: column; min-height: 0; max-width: 820px; }
    header { display: flex; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-3); }
    h2 { margin: 0; font-size: 18px; }
    .muted { color: var(--color-text-muted); font-size: 12px; font-family: var(--font-mono); }
    .panel-wrap { flex: 1; min-height: 0; overflow: hidden; }
</style>

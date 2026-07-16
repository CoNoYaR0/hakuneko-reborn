<script lang="ts">
    import type { SourceSummary } from '@shared/ipc';
    import { store } from '../store.svelte';
    import SourceList from '../lib/SourceList.svelte';
    import SourceBrowser from '../lib/SourceBrowser.svelte';

    interface Props {
        onAddSource: () => void;
        onEditSource: (source: SourceSummary) => void;
        onDuplicateSource: (source: SourceSummary) => void;
        onToggleAdult: () => void;
    }
    let { onAddSource, onEditSource, onDuplicateSource, onToggleAdult }: Props = $props();

    let selected = $state<SourceSummary | undefined>(undefined);

    // Clear selection if the selected source is hidden (age gate) or removed.
    $effect(() => {
        if (selected && !store.visibleSources.some(s => s.id === selected!.id)) {
            selected = undefined;
        }
    });

    async function removeSource(source: SourceSummary): Promise<void> {
        await window.hakuneko.sources.remove(source.id);
        await store.refreshSources();
    }
</script>

<div class="sources">
    <div class="rail">
        <div class="rail-head">
            <h2>Sources</h2>
            <button class="add" onclick={onAddSource}>+ Add</button>
        </div>
        <SourceList
            sources={store.visibleSources}
            selectedId={selected?.id}
            onselect={(s) => (selected = s)}
            onremove={removeSource}
            onedit={onEditSource}
            onduplicate={onDuplicateSource}
        />
        {#if store.adultCount > 0}
            <label class="adult-toggle" title="Adult sources are marked 18+">
                <input type="checkbox" checked={store.adultUnlocked} onchange={onToggleAdult} />
                <span>Show adult sources <span class="count">{store.adultCount} · 18+</span></span>
            </label>
        {/if}
    </div>

    <div class="content">
        {#if selected}
            <SourceBrowser source={selected} />
        {:else}
            <div class="placeholder">
                <h3>{store.visibleSources.length} sources ready</h3>
                <p>Pick a source to browse its manga, chapters and pages — or add a new one with a click. No coding required.</p>
            </div>
        {/if}
    </div>
</div>

<style>
    .sources { display: grid; grid-template-columns: 300px 1fr; height: 100%; min-height: 0; }
    .rail { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--color-border); background: var(--color-surface); padding: var(--space-3); }
    .rail-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
    .rail-head h2 { margin: 0; font-size: 16px; }
    .add { background: var(--color-accent); color: var(--color-accent-contrast); border: none; border-radius: var(--radius-sm); padding: 6px var(--space-3); font: inherit; font-weight: 600; cursor: pointer; }
    .adult-toggle { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-1); margin-top: var(--space-2); border-top: 1px solid var(--color-border); font-size: 12px; color: var(--color-text-muted); cursor: pointer; }
    .adult-toggle input { cursor: pointer; }
    .adult-toggle .count { color: var(--color-danger); font-weight: 700; margin-left: 2px; }
    .content { padding: var(--space-4); min-height: 0; overflow: hidden; }
    .placeholder { max-width: 440px; margin: 12vh auto 0; text-align: center; }
    .placeholder h3 { margin: 0 0 var(--space-2); font-size: 20px; }
    .placeholder p { color: var(--color-text-muted); }
</style>

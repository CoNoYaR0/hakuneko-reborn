<script lang="ts">
    import type { SourceSummary } from '@shared/ipc';
    import { sourceLanguages, availableLanguages } from './languages';

    interface Props {
        sources: SourceSummary[];
        selectedId: string | undefined;
        onselect: (source: SourceSummary) => void;
        onremove: (source: SourceSummary) => void;
        onedit?: (source: SourceSummary) => void;
        onduplicate?: (source: SourceSummary) => void;
    }
    let { sources, selectedId, onselect, onremove, onedit, onduplicate }: Props = $props();

    let query = $state('');
    let language = $state('');

    const languages = $derived(availableLanguages(sources));
    // Reset the language filter if the chosen language leaves the list.
    $effect(() => {
        if (language && !languages.some(l => l.name === language)) {
            language = '';
        }
    });

    const filtered = $derived(
        sources.filter(s => {
            const matchesQuery = query.trim() === ''
                || s.label.toLowerCase().includes(query.toLowerCase())
                || s.tags.some(t => t.includes(query.toLowerCase()));
            const matchesLanguage = language === '' || sourceLanguages(s).includes(language);
            return matchesQuery && matchesLanguage;
        })
    );
</script>

<div class="list">
    <input
        class="search"
        type="search"
        placeholder="Search {sources.length} sources…"
        bind:value={query}
        aria-label="Search sources"
    />
    {#if languages.length > 1}
        <select class="lang" bind:value={language} aria-label="Filter sources by language">
            <option value="">All languages ({sources.length})</option>
            {#each languages as lang (lang.name)}
                <option value={lang.name}>{lang.name} ({lang.count})</option>
            {/each}
        </select>
    {/if}

    {#if filtered.length === 0}
        <p class="empty">No sources match{query ? ` "${query}"` : ''}{language ? ` in ${language}` : ''}. Try a different filter, or add a new source.</p>
    {:else}
        <ul>
            {#each filtered as source (source.id)}
                <li class:selected={source.id === selectedId}>
                    <button class="row" onclick={() => onselect(source)} title={source.url}>
                        <span class="label">{source.label}</span>
                        <span class="meta">
                            {source.template.replace('wordpress-', 'wp-')}
                            {#if source.nsfw}<span class="badge adult">18+</span>{/if}
                            {#if source.origin === 'user'}<span class="badge user">user</span>{/if}
                            {#if !source.usable}<span class="badge warn">no template</span>{/if}
                        </span>
                    </button>
                    <div class="row-actions">
                        {#if onedit}
                            <button class="act" title="Edit {source.label}" aria-label="Edit {source.label}" onclick={() => onedit?.(source)}>✎</button>
                        {/if}
                        {#if onduplicate}
                            <button class="act" title="Duplicate {source.label}" aria-label="Duplicate {source.label}" onclick={() => onduplicate?.(source)}>⧉</button>
                        {/if}
                        <button class="act remove" title="Remove {source.label}" aria-label="Remove {source.label}" onclick={() => onremove(source)}>✕</button>
                    </div>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .list { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .search {
        margin: 0 0 var(--space-2);
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text);
        padding: var(--space-2) var(--space-3);
        font: inherit;
    }
    .lang {
        margin: 0 0 var(--space-2);
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text);
        padding: 6px var(--space-2);
        font: inherit;
        font-size: 13px;
    }
    ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
    li { display: flex; align-items: stretch; border-radius: var(--radius-sm); }
    li.selected { background: var(--color-surface-raised); }
    li:hover { background: var(--color-surface-raised); }
    .row {
        flex: 1; display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
        background: none; border: none; color: var(--color-text);
        padding: var(--space-2) var(--space-3); cursor: pointer; text-align: left; font: inherit;
    }
    .label { font-weight: 500; }
    .meta { color: var(--color-text-muted); font-size: 12px; display: flex; gap: var(--space-2); align-items: center; }
    .badge { border-radius: 4px; padding: 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
    .badge.user { background: color-mix(in srgb, var(--color-accent) 22%, transparent); color: var(--color-accent); }
    .badge.warn { background: color-mix(in srgb, var(--color-danger) 22%, transparent); color: var(--color-danger); }
    .badge.adult { background: var(--color-danger); color: var(--color-accent-contrast); font-weight: 700; }
    .row-actions { display: flex; align-items: center; opacity: 0; }
    li:hover .row-actions { opacity: 1; }
    .act {
        background: none; border: none; color: var(--color-text-muted);
        cursor: pointer; padding: 0 var(--space-2); font-size: 13px;
    }
    .act:hover { color: var(--color-accent); }
    .act.remove:hover { color: var(--color-danger); }
    .empty { color: var(--color-text-muted); padding: var(--space-3); }
</style>

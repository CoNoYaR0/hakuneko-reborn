<script lang="ts">
    import type { SourceSummary, SourceTestResult, StepResult, TemplateCandidate } from '@shared/ipc';

    interface Props {
        templates: string[];
        /** When set, opens prefilled with this source. */
        editSource?: SourceSummary;
        /** 'edit' keeps the id; 'duplicate' prefills but mints a new id. */
        mode?: 'edit' | 'duplicate';
        onclose: () => void;
        onadded: () => void;
    }
    let { templates, editSource, mode = 'edit', onclose, onadded }: Props = $props();

    type Stage = 'url' | 'configure';
    let stage = $state<Stage>('url');
    let editing = $state(false); // true = updating an existing source (id fixed)

    // Step 1 — URL
    let detecting = $state(false);
    let detectError = $state('');

    // Configure fields (standalone so edit mode doesn't need a detection result)
    let siteUrl = $state('https://');
    let icon = $state<string | undefined>(undefined);
    let candidates = $state<TemplateCandidate[]>([]);
    let label = $state('');
    let template = $state('');
    let tags = $state('manga');
    let language = $state('');
    let nsfw = $state(false);
    let overridesText = $state('');
    let showOverrides = $state(false);

    // Live test
    let testing = $state(false);
    let test = $state<SourceTestResult | undefined>(undefined);
    let saving = $state(false);
    let saveError = $state('');

    // Element picker
    let picking = $state(false);
    let pickKey = $state('queryChapters');
    const OVERRIDE_KEYS = ['queryMangas', 'queryChapters', 'queryPages', 'queryChaptersTitle'];

    async function pickElement(): Promise<void> {
        picking = true;
        try {
            const selector = await window.hakuneko.sources.pickElement(siteUrl);
            if (!selector) return;
            let obj: Record<string, unknown> = {};
            if (overridesText.trim()) {
                try { obj = JSON.parse(overridesText); } catch { obj = {}; }
            }
            obj[pickKey] = selector;
            overridesText = JSON.stringify(obj, null, 2);
            showOverrides = true;
        } finally {
            picking = false;
        }
    }

    function slugify(value: string): string {
        return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
    }

    function focusOnMount(node: HTMLElement): void {
        node.focus();
    }

    // Edit/duplicate: load the full definition and jump straight to configure.
    let loaded = $state(false);
    $effect(() => {
        if (editSource && !loaded && stage === 'url') {
            loaded = true;
            editing = mode === 'edit';
            void window.hakuneko.sources.definition(editSource.id).then(def => {
                if (!def) return;
                siteUrl = def.url;
                label = mode === 'duplicate' ? `${def.label} (copy)` : def.label;
                template = def.template;
                tags = (def.tags ?? []).join(', ');
                language = def.language ?? '';
                nsfw = def.nsfw ?? false;
                icon = def.icon;
                overridesText = def.overrides ? JSON.stringify(def.overrides, null, 2) : '';
                showOverrides = Boolean(def.overrides);
                stage = 'configure';
            });
        }
    });

    async function detect(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        detecting = true;
        detectError = '';
        try {
            const result = await window.hakuneko.sources.detect(siteUrl);
            if (!result.reachable) {
                detectError = result.error ?? 'Could not reach that site.';
                return;
            }
            siteUrl = result.url;
            icon = result.suggested.icon;
            candidates = result.candidates;
            label = result.suggested.label;
            language = result.suggested.language ?? '';
            nsfw = result.suggested.nsfw;
            template = result.candidates[0]?.template ?? templates[0] ?? '';
            test = undefined;
            stage = 'configure';
        } catch (caught) {
            detectError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            detecting = false;
        }
    }

    function currentDefinition(): Record<string, unknown> {
        let overrides: Record<string, unknown> | undefined;
        if (overridesText.trim()) {
            try {
                overrides = JSON.parse(overridesText);
            } catch {
                overrides = undefined;
            }
        }
        const candidate = candidates.find(c => c.template === template);
        return {
            // Edit keeps the original id; add derives one from the name/host.
            id: editing && editSource ? editSource.id : slugify(label || new URL(siteUrl).hostname),
            label: label.trim(),
            url: siteUrl.replace(/\/+$/, ''),
            template,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            ...(candidate?.path ? { path: candidate.path } : {}),
            ...(language ? { language } : {}),
            ...(icon ? { icon } : {}),
            nsfw,
            ...(overrides ? { overrides } : {})
        };
    }

    async function runTest(): Promise<void> {
        testing = true;
        test = undefined;
        try {
            test = await window.hakuneko.sources.test(currentDefinition());
        } catch (caught) {
            test = {
                ok: false,
                mangas: { ok: false, count: 0, ms: 0, error: caught instanceof Error ? caught.message : String(caught) },
                chapters: { ok: false, count: 0, ms: 0 },
                pages: { ok: false, count: 0, ms: 0 }
            };
        } finally {
            testing = false;
        }
    }

    async function save(): Promise<void> {
        saving = true;
        saveError = '';
        const result = await window.hakuneko.sources.add(currentDefinition());
        saving = false;
        if (result.ok) {
            onadded();
            onclose();
        } else {
            saveError = result.error ?? 'Failed to save source.';
        }
    }

    const bestCandidate = $derived(candidates[0]);
    const testSteps = $derived<Array<{ name: string; step: StepResult }>>(
        test
            ? [
                { name: 'Manga list', step: test.mangas },
                { name: 'Chapters', step: test.chapters },
                { name: 'Pages', step: test.pages }
            ]
            : []
    );
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />
<!-- svelte-ignore a11y_click_events_have_key_events -- backdrop click is a convenience; Escape (above) is the keyboard path -->
<div class="backdrop" role="presentation" onclick={onclose}>
    <div class="dialog" role="dialog" tabindex="-1" aria-modal="true" aria-label="Add source" onclick={(e) => e.stopPropagation()}>
        <header>
            <h2>{editing ? 'Edit source' : editSource ? 'Duplicate source' : 'Add source'}</h2>
            <p class="sub">{editing ? 'Adjust and re-test this source.' : editSource ? 'Tweak this copy, then save it as a new source.' : 'Paste a manga site URL — HakuNeko figures out the rest.'}</p>
        </header>

        {#if stage === 'url'}
            <form onsubmit={detect}>
                <label>Website URL
                    <input type="url" bind:value={siteUrl} placeholder="https://example.com" required use:focusOnMount />
                </label>
                {#if detectError}<p class="error">{detectError}</p>{/if}
                <div class="actions">
                    <button type="button" class="ghost" onclick={onclose}>Cancel</button>
                    <button type="submit" disabled={detecting}>{detecting ? 'Detecting…' : 'Detect'}</button>
                </div>
            </form>
        {:else}
            <div class="detected">
                {#if icon}
                    <img class="favicon" src={icon} alt="" />
                {/if}
                <div class="detected-info">
                    {#if editing}
                        <span class="pill ok">Editing {label || siteUrl}</span>
                    {:else if bestCandidate}
                        <span class="pill ok">Detected: {bestCandidate.template.replace('wordpress-', 'wp-')}
                            · {Math.round(bestCandidate.confidence * 100)}%</span>
                    {:else}
                        <span class="pill warn">No template auto-detected — pick one below</span>
                    {/if}
                    {#if !editing && bestCandidate}<span class="reasons">{bestCandidate.reasons.join(' · ')}</span>{/if}
                </div>
            </div>

            <div class="fields">
                <label>Name<input bind:value={label} required /></label>
                <label>Template
                    <select bind:value={template}>
                        {#each templates as t (t)}
                            <option value={t}>{t}{candidates.some(c => c.template === t) ? ' ✓' : ''}</option>
                        {/each}
                    </select>
                </label>
                <div class="row2">
                    <label>Language<input bind:value={language} placeholder="en" /></label>
                    <label class="check"><input type="checkbox" bind:checked={nsfw} /> Adult (18+)</label>
                </div>
                <label>Tags<input bind:value={tags} placeholder="manga, english" /></label>

                <button type="button" class="disclose" onclick={() => (showOverrides = !showOverrides)}>
                    {showOverrides ? '▾' : '▸'} Advanced: selector overrides (JSON)
                </button>
                {#if showOverrides}
                    <textarea bind:value={overridesText} rows="4" placeholder={'{ "queryChapters": "div.chapter-list a" }'}></textarea>
                    <div class="picker">
                        <span>Pick on page:</span>
                        <select bind:value={pickKey}>
                            {#each OVERRIDE_KEYS as k (k)}<option value={k}>{k}</option>{/each}
                        </select>
                        <button type="button" class="ghost small" onclick={pickElement} disabled={picking}>
                            {picking ? 'Opening…' : '⌖ Pick element'}
                        </button>
                    </div>
                    <p class="hint">Only needed if the live test below misses chapters/pages. Use “Pick element” to click the item on the real site and capture its selector — no coding.</p>
                {/if}
            </div>

            <div class="test">
                <div class="test-head">
                    <strong>Live test</strong>
                    <button type="button" class="ghost small" onclick={runTest} disabled={testing}>
                        {testing ? 'Testing…' : test ? 'Re-test' : 'Run test'}
                    </button>
                </div>
                {#if test}
                    <ul class="steps">
                        {#each testSteps as { name, step } (name)}
                            <li class:ok={step.ok} class:fail={!step.ok && (step.error || step.count === 0)}>
                                <span class="mark">{step.ok ? '✓' : (step.error || step.count === 0 ? '✕' : '·')}</span>
                                <span class="step-name">{name}</span>
                                <span class="step-detail">
                                    {#if step.error}{step.error}
                                    {:else if step.count}{step.count}{step.sample ? ` · ${step.sample}` : ''}
                                    {:else}—{/if}
                                </span>
                            </li>
                        {/each}
                    </ul>
                    {#if test.thumbnailUrl}
                        <p class="proof">First page: <span class="thumb-url">{test.thumbnailUrl}</span></p>
                    {/if}
                    {#if test.ok}
                        <p class="verdict ok">This source works. Save it below.</p>
                    {:else}
                        <p class="verdict fail">The test didn't fully pass. Try another template or add selector overrides.</p>
                    {/if}
                {:else}
                    <p class="hint">Run the test to confirm this source actually returns manga, chapters and pages before saving.</p>
                {/if}
            </div>

            {#if saveError}<p class="error">{saveError}</p>{/if}
            <div class="actions">
                {#if editing}
                    <button type="button" class="ghost" onclick={onclose}>Cancel</button>
                {:else}
                    <button type="button" class="ghost" onclick={() => (stage = 'url')}>Back</button>
                {/if}
                <button type="button" onclick={save} disabled={saving || !label.trim()} class:recommended={test?.ok}>
                    {saving ? 'Saving…' : editing ? 'Save changes' : 'Save source'}
                </button>
            </div>
        {/if}
    </div>
</div>

<style>
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 10; }
    .dialog { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-4); width: 480px; max-width: 94vw; max-height: 92vh; overflow-y: auto; }
    header { margin-bottom: var(--space-3); }
    h2 { margin: 0; font-size: 18px; }
    .sub { margin: 4px 0 0; color: var(--color-text-muted); font-size: 13px; }
    form, .fields { display: flex; flex-direction: column; gap: var(--space-3); }
    label { display: flex; flex-direction: column; gap: var(--space-1); font-size: 12px; color: var(--color-text-muted); }
    label.check { flex-direction: row; align-items: center; gap: var(--space-2); color: var(--color-text); }
    input, select, textarea { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); padding: var(--space-2) var(--space-3); font: inherit; font-size: 14px; }
    textarea { font-family: var(--font-mono); font-size: 12px; resize: vertical; }
    .row2 { display: grid; grid-template-columns: 1fr auto; gap: var(--space-3); align-items: end; }
    .detected { display: flex; gap: var(--space-3); align-items: center; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); margin-bottom: var(--space-3); }
    .favicon { width: 32px; height: 32px; border-radius: 6px; }
    .detected-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pill { font-size: 12px; font-weight: 600; }
    .pill.ok { color: var(--color-success); }
    .pill.warn { color: var(--color-danger); }
    .reasons { font-size: 11px; color: var(--color-text-muted); }
    .disclose { background: none; border: none; color: var(--color-text-muted); text-align: left; cursor: pointer; font: inherit; font-size: 12px; padding: 0; }
    .picker { display: flex; align-items: center; gap: var(--space-2); font-size: 12px; color: var(--color-text-muted); }
    .picker select { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); padding: 3px var(--space-2); font: inherit; font-size: 12px; }
    .hint { color: var(--color-text-muted); font-size: 12px; margin: 0; }
    .test { margin: var(--space-3) 0; border-top: 1px solid var(--color-border); padding-top: var(--space-3); }
    .test-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2); }
    .steps { list-style: none; margin: 0 0 var(--space-2); padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .steps li { display: grid; grid-template-columns: 20px 90px 1fr; align-items: center; gap: var(--space-2); font-size: 12px; }
    .steps .mark { text-align: center; font-weight: 700; color: var(--color-text-muted); }
    .steps li.ok .mark { color: var(--color-success); }
    .steps li.fail .mark { color: var(--color-danger); }
    .step-name { color: var(--color-text-muted); }
    .step-detail { color: var(--color-text); word-break: break-word; }
    .proof { font-size: 11px; color: var(--color-text-muted); margin: 0 0 var(--space-2); }
    .thumb-url { font-family: var(--font-mono); word-break: break-all; }
    .verdict { font-size: 13px; font-weight: 600; margin: 0; }
    .verdict.ok { color: var(--color-success); }
    .verdict.fail { color: var(--color-danger); }
    .actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }
    button { border: none; border-radius: var(--radius-sm); padding: var(--space-2) var(--space-4); font: inherit; font-weight: 600; cursor: pointer; background: var(--color-accent); color: var(--color-accent-contrast); }
    button.small { padding: 4px var(--space-3); font-size: 12px; }
    button.ghost { background: transparent; color: var(--color-text-muted); border: 1px solid var(--color-border); }
    button.recommended { box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-success) 60%, transparent); }
    button:disabled { opacity: 0.6; cursor: wait; }
    .error { color: var(--color-danger); font-size: 12px; font-family: var(--font-mono); margin: 0; }
</style>

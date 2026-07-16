<script lang="ts">
    interface Props {
        onconfirm: () => void;
        oncancel: () => void;
    }
    let { onconfirm, oncancel }: Props = $props();

    // Focus the safe (non-destructive) choice on open, per modal focus guidance.
    function focusOnMount(node: HTMLElement): void {
        node.focus();
    }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') oncancel(); }} />
<!-- svelte-ignore a11y_click_events_have_key_events -- backdrop click is a convenience; Escape (above) is the keyboard path -->
<div class="backdrop" role="presentation" onclick={oncancel}>
    <div class="dialog" role="alertdialog" tabindex="-1" aria-modal="true" aria-labelledby="age-title" onclick={(e) => e.stopPropagation()}>
        <div class="mark" aria-hidden="true">18+</div>
        <h2 id="age-title">Adult content</h2>
        <p>
            Some sources contain sexually explicit or adult-only material
            (marked <strong>18+</strong>). These are hidden by default.
        </p>
        <p class="confirm">Are you 18 years of age or older?</p>
        <div class="actions">
            <button type="button" class="ghost" onclick={oncancel} use:focusOnMount>No, keep hidden</button>
            <button type="button" class="danger" onclick={onconfirm}>Yes, I am 18 or older</button>
        </div>
        <p class="fineprint">You can hide adult sources again anytime from the sidebar toggle.</p>
    </div>
</div>

<style>
    .backdrop {
        position: fixed; inset: 0; background: rgba(0, 0, 0, 0.65);
        display: flex; align-items: center; justify-content: center; z-index: 20;
    }
    .dialog {
        background: var(--color-surface); border: 1px solid var(--color-border);
        border-radius: var(--radius-md); padding: var(--space-4);
        width: 420px; max-width: 92vw; text-align: center;
    }
    .mark {
        width: 56px; height: 56px; margin: 0 auto var(--space-3);
        display: flex; align-items: center; justify-content: center;
        border-radius: 50%; font-weight: 800; font-size: 16px;
        color: var(--color-accent-contrast);
        background: var(--color-danger);
    }
    h2 { margin: 0 0 var(--space-2); font-size: 20px; }
    p { color: var(--color-text-muted); margin: 0 0 var(--space-3); }
    .confirm { color: var(--color-text); font-weight: 600; }
    .actions { display: flex; gap: var(--space-2); justify-content: center; margin-top: var(--space-3); }
    button {
        border: none; border-radius: var(--radius-sm); padding: var(--space-2) var(--space-4);
        font: inherit; font-weight: 600; cursor: pointer;
    }
    button.ghost { background: transparent; color: var(--color-text-muted); border: 1px solid var(--color-border); }
    button.danger { background: var(--color-danger); color: var(--color-accent-contrast); }
    .fineprint { font-size: 11px; margin: var(--space-3) 0 0; }
</style>

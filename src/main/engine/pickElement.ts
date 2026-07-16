import { BrowserWindow } from 'electron';

/**
 * Visual element picker for Source Studio overrides. Opens the site in a real
 * window with a banner; the user clicks an element and we return a CSS selector
 * for it — so a non-coder can fix a selector without reading HTML.
 *
 * Resolves to the selector string, or undefined if the user closes the window
 * without picking.
 */
export function pickElement(url: string, userAgent: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        const win = new BrowserWindow({
            width: 1100,
            height: 780,
            title: 'Pick an element — click the manga/chapter/page you want',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                // The picker only reads the clicked element's own DOM (same-origin),
                // so keep web security ON — no need to weaken it like scraping windows.
                webSecurity: true
            }
        });

        let settled = false;
        const finish = (value: string | undefined): void => {
            if (settled) return;
            settled = true;
            if (!win.isDestroyed()) win.destroy();
            resolve(value);
        };

        win.on('closed', () => finish(undefined));

        win.webContents.on('did-finish-load', () => {
            win.webContents.executeJavaScript(PICKER_SCRIPT)
                .then((selector: unknown) => {
                    if (typeof selector === 'string' && selector) {
                        finish(selector);
                    }
                })
                .catch(() => { /* navigation re-runs did-finish-load; ignore */ });
        });

        win.loadURL(url, { userAgent }).catch(() => finish(undefined));
    });
}

/**
 * Injected into the page: shows a banner, highlights hovered elements, and on
 * click resolves a stable CSS selector (id when present, else a tag + class +
 * :nth-of-type path). Runs in the page's isolated world.
 */
const PICKER_SCRIPT = `
new Promise((resolve) => {
    const banner = document.createElement('div');
    banner.textContent = 'Click the element you want to select · Esc to cancel';
    Object.assign(banner.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
        background: '#f2683c', color: '#fff', font: '600 14px system-ui, sans-serif',
        padding: '10px 16px', textAlign: 'center', pointerEvents: 'none'
    });
    document.documentElement.appendChild(banner);

    let hovered = null;
    const prevOutline = new WeakMap();
    function highlight(el) {
        if (hovered && prevOutline.has(hovered)) hovered.style.outline = prevOutline.get(hovered);
        hovered = el;
        if (el) { prevOutline.set(el, el.style.outline); el.style.outline = '2px solid #f2683c'; }
    }

    function cssPath(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        const parts = [];
        while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
            let sel = el.nodeName.toLowerCase();
            const classes = (typeof el.className === 'string' ? el.className : '')
                .trim().split(/\\s+/).filter(Boolean).slice(0, 3).map(c => '.' + CSS.escape(c)).join('');
            sel += classes;
            const parent = el.parentElement;
            if (parent) {
                const sameTag = [...parent.children].filter(c => c.nodeName === el.nodeName);
                if (sameTag.length > 1) sel += ':nth-of-type(' + (sameTag.indexOf(el) + 1) + ')';
            }
            parts.unshift(sel);
            el = el.parentElement;
        }
        return parts.join(' > ');
    }

    function onMove(e) { highlight(e.target); }
    function onClick(e) {
        e.preventDefault(); e.stopPropagation();
        cleanup();
        resolve(cssPath(e.target));
    }
    function onKey(e) { if (e.key === 'Escape') { cleanup(); resolve(''); } }
    function cleanup() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        highlight(null);
        banner.remove();
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
});
`;

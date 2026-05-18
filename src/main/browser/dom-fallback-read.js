/**
 * DOM + open-shadow-root scan fallback when the AX tree is sparse.
 * Runs in the guest page via webContents.executeJavaScript.
 */

const DOM_READ_SCRIPT = `
(() => {
    function collectFromRoot(root, items, state) {
        const selectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="tab"], [onclick], summary, [contenteditable="true"]';
        const allEls = root.querySelectorAll(selectors);
        for (const el of allEls) {
            if (state.items.length >= state.max) return;
            const rect = el.getBoundingClientRect();
            if (rect.width < 5 || rect.height < 5) continue;

            state.id++;
            const tag = el.tagName.toLowerCase();
            const type = el.type || '';
            const role = el.getAttribute('role') || tag;
            let label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || '').trim();
            label = label.replace(/\\n/g, ' ').substring(0, 60);

            let desc = '[' + state.id + '] ' + (role || tag);
            if (type) desc += '(' + type + ')';
            if (label) desc += ' "' + label + '"';
            if (el.href) desc += ' -> ' + el.href.substring(0, 80);
            if (rect.top > window.innerHeight || rect.bottom < 0) desc += ' (off-screen)';

            state.items.push({
                id: String(state.id),
                role: role || tag,
                name: label,
                selectorPath: buildPath(el),
                bbox: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height },
                description: desc,
            });
        }

        const allNodes = root.querySelectorAll('*');
        for (const host of allNodes) {
            if (host.shadowRoot) collectFromRoot(host.shadowRoot, items, state);
        }
    }

    function buildPath(el) {
        const parts = [];
        let cur = el;
        let depth = 0;
        while (cur && cur.nodeType === 1 && depth < 8) {
            let part = cur.tagName.toLowerCase();
            if (cur.id) part += '#' + cur.id;
            else if (cur.getAttribute('aria-label')) part += '[aria-label="' + cur.getAttribute('aria-label').substring(0, 40) + '"]';
            else {
                const parent = cur.parentElement;
                if (parent) {
                    const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
                    if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
                }
            }
            parts.unshift(part);
            cur = cur.parentElement;
            depth++;
        }
        return parts.join(' > ');
    }

    const state = { id: 0, items: [], max: 120 };
    collectFromRoot(document, state.items, state);

    const pageTitle = document.title || '';
    const pageUrl = window.location.href;
    const bodyText = document.body ? document.body.innerText.substring(0, 1500).replace(/\\n{3,}/g, '\\n\\n') : '';

    return JSON.stringify({
        title: pageTitle,
        url: pageUrl,
        elements: state.items,
        elementLines: state.items.map(i => i.description),
        text: bodyText,
    });
})();
`;

const DOM_RESOLVE_CLICK_SCRIPT = `function(descriptorJson) {
    const descriptor = JSON.parse(descriptorJson);
    function score(el, d) {
        let s = 0;
        const role = (el.getAttribute('role') || el.tagName.toLowerCase()).toLowerCase();
        const name = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').trim().toLowerCase();
        if (d.role && role.includes(d.role.toLowerCase())) s += 3;
        if (d.name && name.includes(d.name.toLowerCase().substring(0, 30))) s += 4;
        if (d.selectorPath) {
            try {
                const candidate = document.querySelector(d.selectorPath.split(' > ').pop());
                if (candidate === el) s += 5;
            } catch (e) {}
        }
        return s;
    }

    function findBest(d) {
        const selectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"]';
        const roots = [document];
        document.querySelectorAll('*').forEach(n => { if (n.shadowRoot) roots.push(n.shadowRoot); });
        let best = null;
        let bestScore = 0;
        for (const root of roots) {
            for (const el of root.querySelectorAll(selectors)) {
                const rect = el.getBoundingClientRect();
                if (rect.width < 5 || rect.height < 5) continue;
                const sc = score(el, d);
                if (sc > bestScore) { bestScore = sc; best = el; }
            }
        }
        return bestScore >= 3 ? best : null;
    }

    const el = findBest(descriptor);
    if (!el) return JSON.stringify({ error: 'Element [' + descriptor.id + '] not found. Call browser_read first.' });

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    try { el.click(); } catch (e) {}
    const label = (el.innerText || el.value || '').trim().substring(0, 40);
    return JSON.stringify({ status: 'clicked', element: label, tag: el.tagName, method: 'dom-fallback' });
}`;

const DOM_TYPE_SCRIPT = `function(descriptorJson, text, append) {
    const descriptor = JSON.parse(descriptorJson);
    function findBest(d) {
        const selectors = 'input, textarea, [role="textbox"], [contenteditable="true"]';
        const roots = [document];
        document.querySelectorAll('*').forEach(n => { if (n.shadowRoot) roots.push(n.shadowRoot); });
        let best = null;
        let bestScore = 0;
        for (const root of roots) {
            for (const el of root.querySelectorAll(selectors)) {
                const name = (el.getAttribute('aria-label') || el.placeholder || '').toLowerCase();
                let sc = 0;
                if (d.role && (el.getAttribute('role') || el.tagName.toLowerCase()).toLowerCase().includes(d.role)) sc += 2;
                if (d.name && name.includes(d.name.toLowerCase().substring(0, 20))) sc += 4;
                if (sc > bestScore) { bestScore = sc; best = el; }
            }
        }
        return bestScore >= 2 ? best : null;
    }
    const el = findBest(descriptor);
    if (!el) return JSON.stringify({ error: 'Element not found. Call browser_read first.' });
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.focus();
    const isCE = el.isContentEditable || el.hasAttribute('contenteditable');
    if (!append) {
        if (isCE) el.innerText = '';
        else el.value = '';
    }
    for (const ch of text) {
        if (isCE) el.innerText += ch;
        else el.value += ch;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ status: 'typed', text, tag: el.tagName, method: 'dom-fallback' });
}`;

const DOM_HOVER_SCRIPT = `function(descriptorJson) {
    const descriptor = JSON.parse(descriptorJson);
    function findBest(d) {
        const selectors = 'a, button, [role="button"], [role="menuitem"]';
        let best = null;
        let bestScore = 0;
        for (const el of document.querySelectorAll(selectors)) {
            const name = (el.innerText || el.getAttribute('aria-label') || '').toLowerCase();
            let sc = 0;
            if (d.name && name.includes(d.name.toLowerCase().substring(0, 30))) sc += 4;
            if (sc > bestScore) { bestScore = sc; best = el; }
        }
        return bestScore >= 3 ? best : null;
    }
    const el = findBest(descriptor);
    if (!el) return JSON.stringify({ error: 'Element not found.' });
    const rect = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    return JSON.stringify({ status: 'hovered', tag: el.tagName, method: 'dom-fallback' });
}`;

const WAIT_SETTLE_SCRIPT = `
new Promise(resolve => {
    let timeout = setTimeout(resolve, 800);
    let maxWait = setTimeout(resolve, 3500);
    if (!document.body) { resolve(); return; }
    const observer = new MutationObserver(() => {
        clearTimeout(timeout);
        timeout = setTimeout(() => { observer.disconnect(); resolve(); }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
});
`;

module.exports = {
    DOM_READ_SCRIPT,
    DOM_RESOLVE_CLICK_SCRIPT,
    DOM_TYPE_SCRIPT,
    DOM_HOVER_SCRIPT,
    WAIT_SETTLE_SCRIPT,
};

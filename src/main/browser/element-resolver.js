/**
 * Resolve snapshot elements and perform actions via CDP (preferred) or DOM fallback.
 */

const {
    DOM_RESOLVE_CLICK_SCRIPT,
    DOM_TYPE_SCRIPT,
    DOM_HOVER_SCRIPT,
    WAIT_SETTLE_SCRIPT,
} = require('./dom-fallback-read');

async function ensureDebugger(wc) {
    if (wc.debugger.isAttached()) return;
    try {
        wc.debugger.attach('1.3');
    } catch (e) {
        if (!e.message?.includes('Already attached')) throw e;
    }
}

async function getCenterFromBackendNode(wc, backendDOMNodeId) {
    const { object } = await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId: backendDOMNodeId });
    if (!object?.objectId) return null;
    const { model } = await wc.debugger.sendCommand('DOM.getBoxModel', { objectId: object.objectId });
    if (!model?.border || model.border.length < 8) return null;
    const b = model.border;
    const x = (b[0] + b[2] + b[4] + b[6]) / 4;
    const y = (b[1] + b[3] + b[5] + b[7]) / 4;
    return { x, y };
}

async function dispatchClick(wc, x, y) {
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, button: 'none', clickCount: 0,
    });
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    });
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
}

async function clickViaCdp(wc, element) {
    if (!element.backendDOMNodeId) return null;
    const center = await getCenterFromBackendNode(wc, element.backendDOMNodeId);
    if (!center) return null;
    await dispatchClick(wc, center.x, center.y);
    return { status: 'clicked', element: element.name, method: 'cdp-backendNodeId' };
}

async function clickViaDomFallback(wc, element) {
    const raw = await wc.executeJavaScript(
        `(${DOM_RESOLVE_CLICK_SCRIPT})(${JSON.stringify(JSON.stringify(element))})`
    );
    return JSON.parse(raw);
}

async function hoverViaCdp(wc, element) {
    if (!element.backendDOMNodeId) return null;
    const center = await getCenterFromBackendNode(wc, element.backendDOMNodeId);
    if (!center) return null;
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: center.x, y: center.y, button: 'none', clickCount: 0,
    });
    return { status: 'hovered', method: 'cdp-backendNodeId' };
}

async function typeViaCdp(wc, element, text, append) {
    if (!element.backendDOMNodeId) return null;
    const { object } = await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId: element.backendDOMNodeId });
    if (!object?.objectId) return null;
    await wc.debugger.sendCommand('DOM.focus', { objectId: object.objectId });
    if (!append) {
        await wc.executeJavaScript(`(() => {
            const el = document.activeElement;
            if (!el) return;
            if (el.isContentEditable) el.innerText = '';
            else if ('value' in el) el.value = '';
        })()`);
    }
    await wc.debugger.sendCommand('Input.insertText', { text });
    return { status: 'typed', text, method: 'cdp-insertText' };
}

async function waitForSettle(wc) {
    try {
        await wc.executeJavaScript(WAIT_SETTLE_SCRIPT);
    } catch (e) {
        await new Promise(r => setTimeout(r, 800));
    }
}

async function clickElement(wc, element) {
    await ensureDebugger(wc);
    try {
        const cdpResult = await clickViaCdp(wc, element);
        if (cdpResult) return cdpResult;
    } catch (e) {
        console.warn('[BrowserAutomation] CDP click failed:', e.message);
    }
    const domResult = await clickViaDomFallback(wc, element);
    if (domResult.error) throw new Error(domResult.error);
    return domResult;
}

async function hoverElement(wc, element) {
    await ensureDebugger(wc);
    try {
        const cdpResult = await hoverViaCdp(wc, element);
        if (cdpResult) return cdpResult;
    } catch (e) {
        console.warn('[BrowserAutomation] CDP hover failed:', e.message);
    }
    const raw = await wc.executeJavaScript(
        `(${DOM_HOVER_SCRIPT})(${JSON.stringify(JSON.stringify(element))})`
    );
    const result = JSON.parse(raw);
    if (result.error) throw new Error(result.error);
    return result;
}

async function typeIntoElement(wc, element, text, append) {
    await ensureDebugger(wc);
    try {
        const cdpResult = await typeViaCdp(wc, element, text, append);
        if (cdpResult) return cdpResult;
    } catch (e) {
        console.warn('[BrowserAutomation] CDP type failed:', e.message);
    }
    const raw = await wc.executeJavaScript(
        `(${DOM_TYPE_SCRIPT})(${JSON.stringify(JSON.stringify(element))}, ${JSON.stringify(text)}, ${append === true})`
    );
    const result = JSON.parse(raw);
    if (result.error) throw new Error(result.error);
    return result;
}

async function submitElement(wc, element) {
    await ensureDebugger(wc);
    try {
        if (element.backendDOMNodeId) {
            const { object } = await wc.debugger.sendCommand('DOM.resolveNode', {
                backendNodeId: element.backendDOMNodeId,
            });
            if (object?.objectId) {
                await wc.debugger.sendCommand('DOM.focus', { objectId: object.objectId });
            }
        }
    } catch (e) {
        console.warn('[BrowserAutomation] CDP focus for submit failed:', e.message);
    }
    await wc.executeJavaScript(`(() => {
        const active = document.activeElement;
        if (!active) return;
        const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        active.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
        active.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
        active.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
        const form = active.closest && active.closest('form');
        if (form) try { form.submit(); } catch (e) {}
    })()`);
    return { status: 'submitted' };
}

module.exports = {
    ensureDebugger,
    clickElement,
    hoverElement,
    typeIntoElement,
    submitElement,
    waitForSettle,
};

/**
 * Main-process browser automation via CDP Accessibility + DOM fallback.
 */

const { webContents } = require('electron');
const session = require('./browser-session');
const { flattenAxTree } = require('./ax-tree-flatten');
const { DOM_READ_SCRIPT } = require('./dom-fallback-read');
const {
    ensureDebugger,
    clickElement,
    hoverElement,
    typeIntoElement,
    submitElement,
    waitForSettle,
} = require('./element-resolver');

const AUTOMATION_ACTIONS = new Set([
    'browser_read',
    'browser_click',
    'browser_hover',
    'browser_type',
    'browser_submit',
]);

function createBrowserAutomation(getMainWindow) {
    function notifyUi(hint) {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('browser-ui-hint', hint);
        }
    }

    function getGuestWebContents(tabId) {
        const tab = session.getTab(tabId);
        if (!tab?.webContentsId) {
            throw new Error('Browser tab not registered. Open the mini-browser and navigate first.');
        }
        const wc = webContents.fromId(tab.webContentsId);
        if (!wc || wc.isDestroyed()) {
            throw new Error('Browser tab is no longer available. Try browser_navigate again.');
        }
        return { wc, tab };
    }

    function findElement(snapshot, elementId) {
        const eid = String(elementId);
        const el = snapshot.elements.find(e => e.id === eid);
        if (!el) {
            throw new Error(`Element [${eid}] not found in snapshot. Call browser_read first.`);
        }
        return el;
    }

    async function readViaAx(wc) {
        await ensureDebugger(wc);
        const { nodes } = await wc.debugger.sendCommand('Accessibility.getFullAXTree');
        const url = wc.getURL();
        const title = wc.getTitle();
        let bodyText = '';
        try {
            bodyText = await wc.executeJavaScript(
                `document.body ? document.body.innerText.substring(0, 1500) : ''`
            );
        } catch (e) { /* guest may not be ready */ }

        return flattenAxTree(nodes || [], { url, title, bodyText });
    }

    async function readViaDom(wc) {
        const raw = await wc.executeJavaScript(DOM_READ_SCRIPT);
        const parsed = JSON.parse(raw);
        return {
            snapshotId: `snap-${Date.now()}`,
            url: parsed.url,
            title: parsed.title,
            elements: parsed.elements,
            elementLines: parsed.elementLines,
            text: parsed.text,
            source: 'dom-fallback',
        };
    }

    async function browserRead(tabId) {
        notifyUi({ setOrbState: 'researching', statusText: 'Scanning page...', updateSubtitle: '[🔍 Scanning page elements...]' });

        const { wc, tab } = getGuestWebContents(tabId);
        let snapshot;

        try {
            snapshot = await readViaAx(wc);
            if (snapshot.elements.length < 3) {
                console.log('[BrowserAutomation] Sparse AX tree — using DOM fallback read');
                snapshot = await readViaDom(wc);
            } else {
                snapshot.source = 'accessibility';
            }
        } catch (axErr) {
            console.warn('[BrowserAutomation] AX read failed, DOM fallback:', axErr.message);
            snapshot = await readViaDom(wc);
        }

        session.setSnapshot(tab.tabId, snapshot);

        return {
            title: snapshot.title,
            url: snapshot.url,
            elements: snapshot.elementLines,
            text: snapshot.text,
            snapshotId: snapshot.snapshotId,
            source: snapshot.source,
            activeTabId: tab.tabId,
            openTabs: session.listTabs(),
        };
    }

    async function browserClick(tabId, elementId) {
        notifyUi({ setOrbState: 'researching', statusText: `Clicking [${elementId}]...`, updateSubtitle: `[🖱️ Clicking element ${elementId}]` });

        const { wc, tab } = getGuestWebContents(tabId);
        let snapshot = session.getSnapshot(tab.tabId);

        if (!snapshot) {
            snapshot = await readViaDom(wc).catch(() => readViaAx(wc));
            session.setSnapshot(tab.tabId, snapshot);
        }

        const element = findElement(snapshot, elementId);
        const result = await clickElement(wc, element);
        await waitForSettle(wc);
        return result;
    }

    async function browserHover(tabId, elementId) {
        notifyUi({ setOrbState: 'researching', statusText: `Hovering [${elementId}]...` });

        const { wc, tab } = getGuestWebContents(tabId);
        const snapshot = session.getSnapshot(tab.tabId);
        if (!snapshot) throw new Error('Call browser_read before browser_hover.');
        const element = findElement(snapshot, elementId);
        const result = await hoverElement(wc, element);
        await waitForSettle(wc);
        return result;
    }

    async function browserType(tabId, elementId, text, append) {
        notifyUi({ setOrbState: 'researching', statusText: 'Typing...', updateSubtitle: `[⌨️ Typing into element ${elementId}]` });

        const { wc, tab } = getGuestWebContents(tabId);
        const snapshot = session.getSnapshot(tab.tabId);
        if (!snapshot) throw new Error('Call browser_read before browser_type.');
        const element = findElement(snapshot, elementId);
        const result = await typeIntoElement(wc, element, text || '', append === true);
        await waitForSettle(wc);
        return result;
    }

    async function browserSubmit(tabId, elementId) {
        const { wc, tab } = getGuestWebContents(tabId);
        const snapshot = session.getSnapshot(tab.tabId);
        if (!snapshot) throw new Error('Call browser_read before browser_submit.');
        const element = findElement(snapshot, elementId);
        const result = await submitElement(wc, element);
        await waitForSettle(wc);
        return result;
    }

    async function execute(action, args = {}) {
        const tabId = args.tabId || session.getActiveTabId();

        switch (action) {
            case 'browser_read':
                return browserRead(tabId);
            case 'browser_click':
                return browserClick(tabId, args.elementId);
            case 'browser_hover':
                return browserHover(tabId, args.elementId);
            case 'browser_type':
                return browserType(tabId, args.elementId, args.text, args.append);
            case 'browser_submit':
                return browserSubmit(tabId, args.elementId);
            default:
                throw new Error(`Unknown automation action: ${action}`);
        }
    }

    return { execute, AUTOMATION_ACTIONS };
}

function registerBrowserTabIpc(ipcMain) {
    ipcMain.on('browser-register-tab', (event, payload) => {
        session.registerTab(payload);
        if (payload.isActive) session.setActiveTab(payload.tabId);
    });

    ipcMain.on('browser-set-active-tab', (event, tabId) => {
        session.setActiveTab(tabId);
    });

    ipcMain.on('browser-unregister-tab', (event, tabId) => {
        session.unregisterTab(tabId);
    });
}

module.exports = { createBrowserAutomation, registerBrowserTabIpc, AUTOMATION_ACTIONS };

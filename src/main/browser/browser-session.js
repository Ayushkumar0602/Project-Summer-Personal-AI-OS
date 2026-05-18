/**
 * Per-tab browser state: webContents registry and element snapshots.
 */

const tabs = new Map();
let activeTabId = 'tab-1';

function registerTab({ tabId, webContentsId, url, title }) {
    const existing = tabs.get(tabId) || {};
    tabs.set(tabId, {
        tabId,
        webContentsId,
        url: url || existing.url || '',
        title: title || existing.title || 'Tab',
        snapshot: existing.snapshot || null,
        updatedAt: Date.now(),
    });
}

function unregisterTab(tabId) {
    tabs.delete(tabId);
    if (activeTabId === tabId) {
        const remaining = [...tabs.keys()];
        activeTabId = remaining[0] || null;
    }
}

function setActiveTab(tabId) {
    if (tabs.has(tabId)) activeTabId = tabId;
}

function getActiveTabId() {
    return activeTabId;
}

function getTab(tabId) {
    return tabs.get(tabId || activeTabId) || null;
}

function getActiveTab() {
    return activeTabId ? tabs.get(activeTabId) : null;
}

function setSnapshot(tabId, snapshot) {
    const tab = tabs.get(tabId);
    if (!tab) return;
    tab.snapshot = snapshot;
    tab.updatedAt = Date.now();
}

function getSnapshot(tabId) {
    const tab = tabs.get(tabId || activeTabId);
    return tab?.snapshot || null;
}

function listTabs() {
    return [...tabs.values()].map(t => ({ id: t.tabId, title: t.title }));
}

module.exports = {
    registerTab,
    unregisterTab,
    setActiveTab,
    getActiveTabId,
    getTab,
    getActiveTab,
    setSnapshot,
    getSnapshot,
    listTabs,
};

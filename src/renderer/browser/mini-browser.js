__cjsRegister('renderer/browser/mini-browser.js', function (module, exports, require) {
let _deps = {};

function initMiniBrowser(deps) {
    _deps = deps;
    // ========== Mini Browser Controls ==========
    let webview = document.getElementById('miniBrowser');
    const browserViewport = document.getElementById('browserViewport');
    const browserTabsBar = document.getElementById('browserTabsBar');
    const urlInput      = document.getElementById('browserUrlInput');
    const goBtn         = document.getElementById('browserGoBtn');
    const backBtn       = document.getElementById('browserBackBtn');
    const reloadBtn     = document.getElementById('browserReloadBtn');
    const browserStatus = document.getElementById('browserStatus');
    const browserOverlay = document.getElementById('browserOverlay');

    let tabs = [{ id: 'tab-1', wv: webview, title: 'Main' }];
    let activeTabId = 'tab-1';
    let tabCounter = 1;

    function syncTabToMain(tab, isActive) {
        if (!window.liveAPI?.registerBrowserTab || !tab?.wv) return;
        try {
            const webContentsId = tab.wv.getWebContentsId();
            let url = '';
            try { url = typeof tab.wv.getURL === 'function' ? tab.wv.getURL() : (tab.wv.src || ''); } catch (e) {}
            window.liveAPI.registerBrowserTab({
                tabId: tab.id,
                webContentsId,
                url,
                title: tab.title,
                isActive: !!isActive,
            });
            if (isActive) window.liveAPI.setActiveBrowserTab(tab.id);
        } catch (e) {
            console.warn('[MiniBrowser] syncTabToMain:', e.message);
        }
    }

    function syncActiveTab() {
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) syncTabToMain(tab, true);
    }

    if (window.liveAPI?.onBrowserUiHint) {
        window.liveAPI.onBrowserUiHint((hint) => {
            if (hint.setOrbState) _deps.setOrbState(hint.setOrbState, hint.statusText);
            if (hint.updateSubtitle) _deps.updateSubtitle(hint.updateSubtitle);
        });
    }

    function updateTabsUI() {
        browserTabsBar.innerHTML = '';
        tabs.forEach(tab => {
            const t = document.createElement('div');
            t.className = 'browser-tab' + (tab.id === activeTabId ? ' active' : '');
            t.innerHTML = `<span class="tab-title">${tab.title}</span><span class="tab-close">×</span>`;
        
            t.querySelector('.tab-title').addEventListener('click', () => switchTab(tab.id));
            t.querySelector('.tab-close').addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(tab.id);
            });
            browserTabsBar.appendChild(t);
        });
    }

    function switchTab(tabId) {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;
    
        // Hide all webviews
        tabs.forEach(t => { t.wv.style.display = 'none'; });
    
        // Show active
        tab.wv.style.display = 'flex';
        webview = tab.wv;
        activeTabId = tabId;
    
        try { urlInput.value = typeof webview.getURL === 'function' ? webview.getURL() : ''; } catch(e) { urlInput.value = ''; }
        try { browserStatus.textContent = typeof webview.getTitle === 'function' ? webview.getTitle() : 'Ready'; } catch(e) { browserStatus.textContent = 'Ready'; }
        updateTabsUI();
        syncActiveTab();
    }

    function closeTab(tabId) {
        if (tabs.length === 1) {
            navigateBrowser('about:blank');
            return;
        }
    
        const index = tabs.findIndex(t => t.id === tabId);
        const tab = tabs[index];
        if (window.liveAPI?.unregisterBrowserTab) window.liveAPI.unregisterBrowserTab(tabId);
        tab.wv.remove();
        tabs.splice(index, 1);
    
        if (activeTabId === tabId) {
            switchTab(tabs[Math.max(0, index - 1)].id);
        } else {
            updateTabsUI();
        }
    }

    function attachWebviewEvents(wv, tabId) {
        wv.addEventListener('did-start-loading',  () => { if(activeTabId===tabId) browserStatus.textContent = 'Loading...'; });
        wv.addEventListener('did-stop-loading',   () => { if(activeTabId===tabId) browserStatus.textContent = 'Ready'; });
        wv.addEventListener('did-navigate',       (e) => { if (e.isMainFrame && activeTabId===tabId) urlInput.value = e.url; });
        wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame && activeTabId===tabId) urlInput.value = e.url; });
        wv.addEventListener('page-title-updated', (e) => { 
            const tab = tabs.find(t => t.id === tabId);
            if (tab) { tab.title = e.title; updateTabsUI(); }
            if (activeTabId===tabId) browserStatus.textContent = e.title; 
        });
        wv.addEventListener('did-fail-load',      ()  => { if(activeTabId===tabId) browserStatus.textContent = 'Failed to load'; });

        wv.addEventListener('dom-ready', () => {
            const tab = tabs.find(t => t.id === tabId);
            if (tab) syncTabToMain(tab, activeTabId === tabId);
        });
        wv.addEventListener('did-stop-loading', () => {
            const tab = tabs.find(t => t.id === tabId);
            if (tab) syncTabToMain(tab, activeTabId === tabId);
        });
    
        wv.addEventListener('new-window', (e) => {
            e.preventDefault();
            const { newWv, newTabId } = createNewTab('Loading...');
        
            // This connects the window.opener correctly for Google Login/OAuth
            if (e.newGuest) {
                e.newGuest = newWv;
            } else {
                newWv.src = e.url;
            }
        
            switchTab(newTabId);
        });
    }

    function createNewTab(title = 'New Tab') {
        tabCounter++;
        const newTabId = 'tab-' + tabCounter;
    
        const newWv = document.createElement('webview');
        newWv.setAttribute('allowpopups', 'true');
        newWv.className = 'mini-browser-webview';
        newWv.style.display = 'none';
        newWv.src = 'about:blank';
        browserViewport.appendChild(newWv);
    
        tabs.push({ id: newTabId, wv: newWv, title: title });
        attachWebviewEvents(newWv, newTabId);
    
        return { newWv, newTabId };
    }

    // Attach to initial
    webview.setAttribute('allowpopups', 'true');
    attachWebviewEvents(webview, 'tab-1');
    updateTabsUI();
    syncTabToMain(tabs[0], true);

    function navigateBrowser(url) {
        if (!url) return;
        if (!url.startsWith('http://') && !url.startsWith('https://') && url !== 'about:blank') {
            url = 'https://' + url;
        }
        urlInput.value = url;
        browserOverlay.classList.add('hidden');
        webview.src = url;
        if (activeTabId === 'tab-1') browserStatus.textContent = 'Loading...';
        const tab = tabs.find(t => t.wv === webview);
        if (tab) syncTabToMain(tab, activeTabId === tab.id);
    }

    goBtn.addEventListener('click', () => navigateBrowser(urlInput.value.trim()));
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') navigateBrowser(urlInput.value.trim());
    });
    backBtn.addEventListener('click',   () => webview.canGoBack()    && webview.goBack());
    reloadBtn.addEventListener('click', () => webview.reload());

    // Full browser control execution — coordinate-based, no selector guessing
    window.liveAPI.onBrowserControl(async (payload) => {
        const { id, action, args } = payload;
        let result = null;
        let error = null;

        try {
            if (action === 'toggle_browser') {
                const layout = document.getElementById('appLayout');
                if (args.visible) {
                    layout.classList.remove('browser-hidden');
                } else {
                    layout.classList.add('browser-hidden');
                }
                result = { status: "success", visible: args.visible };
            }

            else if (action === 'browser_navigate') {
                _deps.setOrbState('researching', 'Navigating...');
                navigateBrowser(args.url);
                await new Promise((resolve) => {
                    const onLoaded = () => { webview.removeEventListener('did-stop-loading', onLoaded); resolve(); };
                    webview.addEventListener('did-stop-loading', onLoaded);
                    setTimeout(resolve, 12000); // safety timeout
                });
                result = { status: "navigated", url: (typeof webview.getURL === 'function' ? webview.getURL() : webview.src) };
                syncActiveTab();
            }

            else if (action === 'browser_scroll') {
                _deps.setOrbState('researching', 'Scrolling ' + args.direction + '...');
                const pixels = args.pixels || 600;
                const dirMultiplier = args.direction === 'down' ? 1 : -1;
                await webview.executeJavaScript(`
                    window.scrollBy({ top: ${pixels} * ${dirMultiplier}, behavior: 'smooth' });
                `);
                result = { status: "scrolled", direction: args.direction, pixels: pixels };
            }

            else if (action === 'browser_switch_tab') {
                _deps.setOrbState('researching', 'Switching tab...');
                switchTab(args.tabId);
                result = { status: "tab_switched", activeTab: activeTabId };
            }

            else if (action === 'browser_open_tab') {
                _deps.setOrbState('researching', 'Opening new tab...');
                const { newTabId } = createNewTab('New Tab');
                switchTab(newTabId);
                if (args.url) {
                    navigateBrowser(args.url);
                    await new Promise((resolve) => {
                        const onLoaded = () => { webview.removeEventListener('did-stop-loading', onLoaded); resolve(); };
                        webview.addEventListener('did-stop-loading', onLoaded);
                        setTimeout(resolve, 12000); // safety timeout
                    });
                    result = { status: "tab_opened", activeTab: activeTabId, url: (typeof webview.getURL === 'function' ? webview.getURL() : webview.src) };
                } else {
                    result = { status: "tab_opened", activeTab: activeTabId };
                }
            }

            else if (action === 'browser_close_tab') {
                _deps.setOrbState('researching', 'Closing tab...');
                closeTab(args.tabId);
                result = { status: "tab_closed", activeTab: activeTabId };
            }

        } catch (e) {
            error = e.message;
        }

        // Revert orb state
        if (!document.getElementById('orb').classList.contains('state-speaking')) {
            _deps.setOrbState('listening', 'Listening...');
        }

        window.liveAPI.sendBrowserReply({ id, result, error });
    });
}

module.exports = { initMiniBrowser };
});

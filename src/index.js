const { app, BrowserWindow, ipcMain, systemPreferences, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const WebSocket = require('ws');
const dotenv = require('dotenv');
dotenv.config();

// pdf-parse v1.1.1 — exports a simple async function: pdfParse(buffer) → { text }
const pdfParse = require('pdf-parse');

const { loadGraph, saveGraph, mergeGraph, clearGraph: clearGraphStore, touchNodeAccess } = require('./knowledge/graph-store');
const { extractGraphFromText } = require('./knowledge/graph-extractor');
const { buildSystemInstruction } = require('./knowledge/graph-context');
const { searchMemory, getAllTags } = require('./knowledge/graph-search');
const { semanticChunk } = require('./knowledge/graph-chunker');
const { summariseSession, appendDiaryEntry, loadDiary } = require('./knowledge/session-diary');
const { searchWeb, scrapeWebpage, getNews, searchImages } = require('./tools/web-tools');
const { analyzeAndStoreImage, findMatchingImageNodes, extractKeywordsFromText, hasVisualIntent, isImageFile, IMAGE_STORE } = require('./knowledge/image-analyzer');
const { executeOsTool, isOsTool } = require('./tools/os-tools');
const { osToolDeclarations } = require('./tools/os-tool-declarations');
const { executeAppControlTool, isAppControlTool } = require('./tools/app-control-tools');
const { appControlDeclarations } = require('./tools/app-control-declarations');
const { loadPermissions, revokePermission, revokeAllPermissions } = require('./settings/permissions-store');
const { enhanceToolResponse, getSkillSummaries } = require('./skills/skill-loader');
const googleTools = require('./tools/google-tools');
const uiTools = require('./tools/ui-tools');
const { WakeWordEngine } = require('./wake-word/wake-word-engine');

// ── Wake Word Engine (singleton) ──
let wakeWordEngine = null;

const agentTools = [{
  functionDeclarations: [
    {
      name: "search_web",
      description: "Search the internet for current events, facts, or general knowledge.",
      parameters: {
        type: "OBJECT",
        properties: { query: { type: "STRING", description: "The search query" } },
        required: ["query"]
      }
    },
    {
      name: "scrape_webpage",
      description: "Read the textual content of a specific URL in the background.",
      parameters: {
        type: "OBJECT",
        properties: { url: { type: "STRING", description: "The exact URL to scrape" } },
        required: ["url"]
      }
    },
    {
      name: "get_news",
      description: "Get the latest news headlines from NewsAPI.org. You can optionally specify a topic.",
      parameters: {
        type: "OBJECT",
        properties: { topic: { type: "STRING", description: "Optional topic to search news for. If empty, gets top headlines." } },
        required: []
      }
    },
    {
      name: "toggle_browser",
      description: "Show or hide the visual browser on the user's screen. Call this with visible: true BEFORE using browser_navigate if you want the user to see the website. Call with visible: false to hide it during normal conversation.",
      parameters: { type: "OBJECT", properties: { visible: { type: "BOOLEAN" } }, required: ["visible"] }
    },
    {
      name: "browser_navigate",
      description: "Navigate the visible mini-browser to a specific URL. The page will load and you can then use browser_read to see what is on it.",
      parameters: { type: "OBJECT", properties: { url: { type: "STRING", description: "Full URL to navigate to" } }, required: ["url"] }
    },
    {
      name: "browser_read",
      description: "Read the current webpage. Returns the page text AND a numbered list of all clickable/interactive elements. You MUST call this before clicking or typing. Each element has a number like [1], [2] etc. Use that number with browser_click or browser_type.",
      parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
      name: "browser_click",
      description: "Click an interactive element on the page by its number. You MUST call browser_read first to get the element numbers. Pass the number of the element you want to click.",
      parameters: { type: "OBJECT", properties: { elementId: { type: "STRING", description: "The element number from browser_read, e.g. '3'" } }, required: ["elementId"] }
    },
    {
      name: "browser_hover",
      description: "Hover over an element by its number (useful for revealing CSS dropdown menus or tooltips). You MUST call browser_read first.",
      parameters: { type: "OBJECT", properties: { elementId: { type: "STRING", description: "The element number to hover over" } }, required: ["elementId"] }
    },
    {
      name: "browser_type",
      description: "Type text into an input field by its element number. Pass the number and the text to type.",
      parameters: { type: "OBJECT", properties: { elementId: { type: "STRING", description: "The element number from browser_read, e.g. '5'" }, text: { type: "STRING", description: "The text to type into the field" }, append: { type: "BOOLEAN", description: "Set to true to add text to the end instead of overwriting existing text." } }, required: ["elementId", "text"] }
    },
    {
      name: "browser_scroll",
      description: "Scroll the current webpage up or down. If pixels is omitted, scrolls by 600 pixels.",
      parameters: { type: "OBJECT", properties: { direction: { type: "STRING", description: "up or down" }, pixels: { type: "NUMBER", description: "Number of pixels to scroll (optional, defaults to 600)" } }, required: ["direction"] }
    },
    {
      name: "browser_switch_tab",
      description: "Switch to a different browser tab by its tab ID (e.g. 'tab-2'). You can find available tabs in the browser_read output.",
      parameters: { type: "OBJECT", properties: { tabId: { type: "STRING" } }, required: ["tabId"] }
    },
    {
      name: "browser_open_tab",
      description: "Open a brand new browser tab and optionally navigate to a URL immediately.",
      parameters: { type: "OBJECT", properties: { url: { type: "STRING", description: "Optional URL to load in the new tab" } }, required: [] }
    },
    {
      name: "browser_close_tab",
      description: "Close a specific browser tab by its tab ID.",
      parameters: { type: "OBJECT", properties: { tabId: { type: "STRING" } }, required: ["tabId"] }
    },
    {
      name: "browser_submit",
      description: "Press Enter/submit on a specific element, useful after typing into a search box.",
      parameters: { type: "OBJECT", properties: { elementId: { type: "STRING", description: "The element number from browser_read" } }, required: ["elementId"] }
    },
    // ── Image Search Tool ──
    {
      name: "search_images",
      description: "Search the internet for relevant images and DISPLAY them visually on screen as a HUD gallery. Use this when the user asks to SEE something — a place, person, product, concept, or event. This is your eyes for the internet. Always use this when you want to visually show something.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "What to search images of. Be specific for best results." },
          count: { type: "NUMBER", description: "Number of images to show (default 4, max 8)" }
        },
        required: ["query"]
      }
    },
    // ── Visual Memory Recall Tool ──
    {
      name: "show_visual_memory",
      description: "Search and DISPLAY images from the user's personal visual memory on the HUD screen. Use this when the user says 'show me my photo', 'show a picture of me', 'display my image', or refers to any photo they have uploaded. This searches stored personal photos by keyword and shows them on screen. Always use this FIRST before saying you cannot display personal images.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "What to search for in the user's personal photo library. E.g. 'ayush portrait', 'me', 'photo', 'graduation'" },
          count: { type: "NUMBER", description: "Max number of photos to show (default 4)" }
        },
        required: ["query"]
      }
    },
    // ── Memory Query Tool ──
    {
      name: "query_memory",
      description: "Search your persistent knowledge graph memory for facts about the user, their projects, skills, relationships, or any topic you've learned. Call this whenever the user asks about something personal, or when you need context you might have stored. Returns a structured summary of matching nodes and their connections.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "What to search for in memory. Be specific — e.g. 'user skills', 'Ayush projects', 'machine learning concepts'" },
          maxResults: { type: "NUMBER", description: "Max number of matching entities to return. Default 5, max 10." },
          filterTag: { type: "STRING", description: "Optional tag to restrict results, e.g. '#work', '#study', '#personal'" }
        },
        required: ["query"]
      }
    },
    // ── OS Control Tools (injected from os-tool-declarations.js) ──
    ...osToolDeclarations,
    // ── Deep App Control Tools (vision, UI, interaction, music, etc.) ──
    ...appControlDeclarations,
    // ── Google Workspace Tools ──
    ...googleTools.declarations,
    // ── UI / HUD Tools ──
    ...uiTools.declarations
  ]
}];

const pendingBrowserCalls = new Map();

ipcMain.on('browser-reply', (event, payload) => {
    const { id, result, error } = payload;
    if (pendingBrowserCalls.has(id)) {
        pendingBrowserCalls.get(id)(payload);
        pendingBrowserCalls.delete(id);
    }
});

function callBrowser(action, args) {
    return new Promise((resolve) => {
        const id = Math.random().toString(36).substring(7);
        pendingBrowserCalls.set(id, resolve);
        if (mainWindow) {
            mainWindow.webContents.send('browser-control', { id, action, args });
        } else {
            resolve({ error: "No window" });
        }
        
        setTimeout(() => {
            if (pendingBrowserCalls.has(id)) {
                pendingBrowserCalls.get(id)({ error: "Timeout waiting for browser" });
                pendingBrowserCalls.delete(id);
            }
        }, 15000); // 15s timeout
    });
}

if (require('electron-squirrel-startup')) app.quit();

let mainWindow;
let memoryWindow = null;
let settingsWindow = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    frame: false,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
  });
  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // mainWindow.webContents.openDevTools(); // Remove in production
};

const createMemoryWindow = () => {
  if (memoryWindow && !memoryWindow.isDestroyed()) {
    memoryWindow.focus();
    return;
  }
  memoryWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    title: 'Memory — Knowledge Graph',
    webPreferences: {
      preload: path.join(__dirname, 'memory/memory-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  memoryWindow.loadFile(path.join(__dirname, 'memory/memory.html'));
  memoryWindow.on('closed', () => { memoryWindow = null; });
};

const createSettingsWindow = () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 860,
    height: 680,
    title: 'Summer — Settings & Permissions',
    webPreferences: {
      preload: path.join(__dirname, 'settings/settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings/settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
};

app.commandLine.appendSwitch('remote-debugging-port', '9222');

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'not-determined') {
      await systemPreferences.askForMediaAccess('microphone');
    }
  }

  // Strip anti-framing headers so the webview can load ANY site
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const newHeaders = Object.fromEntries(
      Object.entries(details.responseHeaders).filter(([key]) => {
        const lower = key.toLowerCase();
        return lower !== 'x-frame-options' && lower !== 'content-security-policy';
      })
    );
    callback({ cancel: false, responseHeaders: newHeaders });
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // ── Wake Word Engine: Start always-on listener ──
  try {
    wakeWordEngine = new WakeWordEngine({
      modelDir: path.join(__dirname, 'models'),
      threshold: 0.85,
      cooldownMs: 2000,
      debounceMs: 3000
    });

    wakeWordEngine.on('detected', (score) => {
      console.log(`\n🎤 Wake word detected! Score: ${score.toFixed(4)}`);
      wakeWordEngine.pause(); // Pause while session is active
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wake-word-detected', { score });
      }
    });

    wakeWordEngine.on('error', (err) => {
      console.error('[WakeWord] Engine error:', err.message);
    });

    wakeWordEngine.on('unavailable', (reason) => {
      console.warn(`[WakeWord] Unavailable: ${reason}. Wake word feature disabled.`);
    });

    // Give the window a moment to load before starting mic capture
    setTimeout(() => wakeWordEngine.start(), 3000);
  } catch (err) {
    console.error('[WakeWord] Failed to initialize:', err.message);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Memory Window IPC ──
ipcMain.on('open-memory-window', () => {
  createMemoryWindow();
});

// ── Settings Window IPC ──
ipcMain.on('open-settings-window', () => {
  createSettingsWindow();
});

ipcMain.handle('get-permissions', () => {
  return loadPermissions();
});

ipcMain.handle('revoke-permission', (event, toolName) => {
  // Special case: open system preferences
  if (toolName === '__open_system_prefs__') {
    const { shell } = require('electron');
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy');
    return { success: true };
  }
  revokePermission(toolName);
  return { success: true };
});

ipcMain.handle('revoke-all-permissions', () => {
  revokeAllPermissions();
  return { success: true };
});

ipcMain.handle('get-audit-logs', () => {
  const LOG_DIR = path.join(app.getPath('userData'), 'os-audit-logs');
  try {
    if (!fs.existsSync(LOG_DIR)) return [];
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
    if (files.length === 0) return [];
    // Read the latest log file (today)
    const latestFile = path.join(LOG_DIR, files[0]);
    const content = fs.readFileSync(latestFile, 'utf-8');
    return content.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch (e) {
    console.error('[Settings] Failed to read audit logs:', e.message);
    return [];
  }
});

ipcMain.handle('get-graph', () => {
  return loadGraph();
});


ipcMain.handle('clear-graph', () => {
  clearGraphStore();
  return { success: true };
});

// ── Visual Memory: Serve local images as base64 data URLs ──
// The renderer cannot readFile directly (context isolation), so we bridge it here.
ipcMain.handle('read-local-image', (event, filename) => {
  try {
    const imgPath = path.join(IMAGE_STORE, filename);
    if (!fs.existsSync(imgPath)) {
      console.warn(`[ImageMemory] File not found: ${filename}`);
      return null;
    }
    const data = fs.readFileSync(imgPath);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/jpeg', heif: 'image/jpeg', avif: 'image/avif' };
    const mime = mimeMap[ext] || 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (e) {
    console.error('[ImageMemory] read-local-image error:', e.message);
    return null;
  }
});

ipcMain.handle('export-memory', async () => {
    const { dialog } = require('electron');
    const path = require('path');
    const fs = require('fs');

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Destination for Memory Export'
    });

    if (result.canceled) return { canceled: true };

    try {
        const destDir = result.filePaths[0];
        const graph = loadGraph();

        // 1. Export JSON
        fs.writeFileSync(path.join(destDir, 'memory-export.json'), JSON.stringify(graph, null, 2));

        // 2. Generate Markdown
        let md = `# Summer AI Memory Summary\n\n`;
        md += `*Exported on: ${new Date().toLocaleString()}*\n\n`;
        md += `This document outlines everything Summer currently knows based on your persistent knowledge graph.\n\n`;

        const nodesByType = {};
        graph.nodes.forEach(n => {
            if (!nodesByType[n.type]) nodesByType[n.type] = [];
            nodesByType[n.type].push(n);
        });

        for (const [type, nodes] of Object.entries(nodesByType)) {
            md += `## ${type}s\n`;
            nodes.forEach(n => {
                const tags = n.tags && n.tags.length ? ` [${n.tags.join(', ')}]` : '';
                md += `### ${n.label}${tags}\n`;
                md += `**Description**: ${n.description || 'No description'}\n\n`;
                
                // Find relations
                const outgoing = graph.edges.filter(e => e.from === n.id);
                const incoming = graph.edges.filter(e => e.to === n.id);
                
                if (outgoing.length > 0 || incoming.length > 0) {
                    md += `**Relations:**\n`;
                    outgoing.forEach(e => {
                        const target = graph.nodes.find(tn => tn.id === e.to);
                        if (target) md += `- ${e.label} ➡️ ${target.label}\n`;
                    });
                    incoming.forEach(e => {
                        const source = graph.nodes.find(sn => sn.id === e.from);
                        if (source) md += `- ⬅️ ${e.label} from ${source.label}\n`;
                    });
                    md += `\n`;
                }
            });
            md += `---\n\n`;
        }

        fs.writeFileSync(path.join(destDir, 'memory-summary.md'), md);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('import-memory', async () => {
    const { dialog } = require('electron');
    const fs = require('fs');

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        title: 'Select Memory JSON File'
    });

    if (result.canceled) return { canceled: true };

    try {
        const filePath = result.filePaths[0];
        const raw = fs.readFileSync(filePath, 'utf-8');
        const importedGraph = JSON.parse(raw);
        
        if (!importedGraph.nodes || !importedGraph.edges) {
            throw new Error("Invalid graph format. Expected 'nodes' and 'edges' arrays.");
        }

        saveGraph(importedGraph);
        return { success: true };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

// Update a specific node's label, description, and/or tags
ipcMain.handle('update-node', (event, nodeId, updates) => {
  const graph = loadGraph();
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return { error: `Node "${nodeId}" not found.` };
  if (updates.label) node.label = updates.label;
  if (updates.description !== undefined) node.description = updates.description;
  if (updates.tags !== undefined) node.tags = updates.tags;
  node.updatedAt = Date.now();
  saveGraph(graph);
  console.log(`[Memory] Node "${nodeId}" updated.`);
  return { success: true, node };
});

// Add edge manually
ipcMain.handle('add-edge', (event, fromId, toId, label) => {
  const graph = loadGraph();
  const existing = graph.edges.find(e => e.from === fromId && e.to === toId && e.label === label);
  if (!existing) {
    graph.edges.push({
      from: fromId,
      to: toId,
      label: label,
      source: 'user',
      confidence: 1.0,
      updatedAt: Date.now()
    });
    saveGraph(graph);
    console.log(`[Memory] Added edge: ${fromId} --${label}--> ${toId}`);
    return { success: true };
  }
  return { success: false, reason: 'Edge already exists' };
});

// Delete a specific node and all its edges
ipcMain.handle('delete-node', (event, nodeId) => {
  const graph = loadGraph();
  const before = graph.nodes.length;
  graph.nodes = graph.nodes.filter(n => n.id !== nodeId);
  graph.edges = graph.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
  saveGraph(graph);
  console.log(`[Memory] Deleted node "${nodeId}". Removed ${before - graph.nodes.length} nodes and cleaned edges.`);
  return { success: true };
});

// ── Graph Optimizer (AI) ──
const { autoConnectIslands, revertGraph, checkBackupExists, runMemoryCommand } = require('./knowledge/graph-optimizer');

ipcMain.handle('optimize-graph', async () => {
  try {
    return await autoConnectIslands();
  } catch (err) {
    console.error("Optimizer error:", err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('run-memory-command', async (event, commandText) => {
  try {
    return await runMemoryCommand(commandText);
  } catch (err) {
    console.error("Memory Command error:", err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('revert-graph', () => {
  return revertGraph();
});

ipcMain.handle('check-backup', () => {
  return checkBackupExists();
});

// ── Tag Management IPC ──
ipcMain.handle('get-tags', () => {
  return getAllTags();
});

ipcMain.handle('add-tag', (event, nodeId, tag) => {
  const graph = loadGraph();
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return { error: `Node "${nodeId}" not found.` };
  const normTag = tag.toLowerCase().startsWith('#') ? tag.toLowerCase() : `#${tag.toLowerCase()}`;
  if (!node.tags) node.tags = [];
  if (!node.tags.includes(normTag)) {
    node.tags.push(normTag);
    saveGraph(graph);
    console.log(`[Memory] Added tag "${normTag}" to "${nodeId}"`);
  }
  return { success: true, tags: node.tags };
});

ipcMain.handle('remove-tag', (event, nodeId, tag) => {
  const graph = loadGraph();
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return { error: `Node "${nodeId}" not found.` };
  const normTag = tag.toLowerCase().startsWith('#') ? tag.toLowerCase() : `#${tag.toLowerCase()}`;
  node.tags = (node.tags || []).filter(t => t !== normTag);
  saveGraph(graph);
  console.log(`[Memory] Removed tag "${normTag}" from "${nodeId}"`);
  return { success: true, tags: node.tags };
});

ipcMain.handle('resolve-conflict', (event, resolution) => {
    const graph = loadGraph();
    const { action, contradiction } = resolution;
    if (action === 'adopt_new') {
        graph.edges = graph.edges.filter(e => !(e.from === contradiction.from && e.to === contradiction.to && e.label === contradiction.oldLabel));
        graph.edges.push({
            from: contradiction.from,
            to: contradiction.to,
            label: contradiction.newLabel,
            confidence: 1.0,
            source: 'agent'
        });
        saveGraph(graph);
    }
    return { success: true };
});

// ── Diary IPC ──
ipcMain.handle('get-diary', () => {
  return loadDiary();
});

// ── Google Workspace IPC ──
const googleAuth = require('./auth/google-auth');
const googleService = require('./services/google-service');

ipcMain.handle('authenticate-google', async () => {
    try {
        await googleAuth.authenticate();
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('logout-google', () => {
    return googleAuth.logout();
});

ipcMain.handle('check-google-auth', async () => {
    return await googleAuth.isAuthenticated();
});

ipcMain.handle('get-google-context', async () => {
    return await googleService.getDailyBriefingContext();
});

// ── Pin / Importance IPC ──
ipcMain.handle('pin-node', (event, nodeId, pinned) => {
  const graph = loadGraph();
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return { error: `Node "${nodeId}" not found.` };
  node.pinned = pinned;
  if (pinned && (node.importance || 0) < 0.9) node.importance = 0.9;
  node.updatedAt = Date.now();
  saveGraph(graph);
  console.log(`[Memory] Node "${nodeId}" ${pinned ? 'PINNED' : 'unpinned'}.`);
  return { success: true, pinned: node.pinned, importance: node.importance };
});

ipcMain.handle('set-importance', (event, nodeId, importance) => {
  const graph = loadGraph();
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return { error: `Node "${nodeId}" not found.` };
  node.importance = Math.max(0, Math.min(1, parseFloat(importance)));
  node.updatedAt = Date.now();
  saveGraph(graph);
  console.log(`[Memory] Node "${nodeId}" importance set to ${node.importance.toFixed(2)}.`);
  return { success: true, importance: node.importance };
});


ipcMain.handle('upload-files', async (event, fileDataArray) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: 'GEMINI_API_KEY missing in .env' };

  let combinedGraph = { nodes: [], edges: [] };

    console.log(`\n📂 Processing ${fileDataArray.length} file(s)...`);

    for (let i = 0; i < fileDataArray.length; i++) {
    const file = fileDataArray[i];
    console.log(`\n[${i+1}/${fileDataArray.length}] Reading: ${file.name}`);
    event.sender.send('extraction-progress', `Reading: ${file.name} (${i + 1}/${fileDataArray.length})`);

    try {
      // ── IMAGE FILES: route to visual memory pipeline ──
      if (isImageFile(file)) {
        console.log(`  🖼️  Image detected — routing to Visual Memory pipeline...`);
        event.sender.send('extraction-progress', `Analyzing image: ${file.name} with Gemini Vision...`);
        try {
          const { node, edges, deduplicated } = await analyzeAndStoreImage(file);
          if (!deduplicated) {
            console.log(`  ✅ ImageMemory node: "${node.label}" | Tags: ${node.tags.join(', ')}`);
            combinedGraph.nodes.push(node);
            if (edges && edges.length) combinedGraph.edges.push(...edges);
          } else {
            console.log(`  ⚡ Skipped (duplicate image already in memory)`);
          }
        } catch (imgErr) {
          console.error(`  ❌ Image analysis failed for ${file.name}:`, imgErr.message);
        }
        continue; // skip text processing for image files
      }

      let textContent = '';
      const buffer = Buffer.from(file.buffer);

      if (file.name.endsWith('.pdf')) {
        console.log(`  📄 Parsing PDF...`);
        const parsed = await pdfParse(buffer);
        textContent = parsed.text;
        console.log(`  ✅ PDF parsed: ${textContent.length} chars extracted`);
      } else {
        textContent = buffer.toString('utf-8');
        console.log(`  ✅ Text read: ${textContent.length} chars`);
      }

      if (!textContent.trim()) {
        console.log(`  ⚠️  No text found in ${file.name}, skipping`);
        continue;
      }

      console.log(`  Sending to Gemini AI for deep document analysis...`);
      // ── Semantic Chunking Pipeline ──
      const chunks = semanticChunk(textContent, file.name);
      let allContradictions = [];

      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
          const chunkText = chunks[chunkIdx];
          console.log(`  🔄 Processing chunk ${chunkIdx + 1}/${chunks.length} (${chunkText.length} chars)...`);
          event.sender.send('extraction-progress', `AI deep-analyzing: ${file.name} (Part ${chunkIdx + 1}/${chunks.length})...`);
          
          // Provide both the persistent graph AND the current session's combined graph so far as context
          const currentContext = mergeGraph(loadGraph(), combinedGraph);
          
          const extracted = await extractGraphFromText(chunkText, apiKey, currentContext, {
              isDocument: true,
              fileName: file.name,
              chunkIndex: chunkIdx,
              totalChunks: chunks.length
          });
          console.log(`  ✅ Deep extracted: ${extracted.nodes.length} nodes, ${extracted.edges.length} edges`);
          if (extracted.nodes.length > 0) {
              console.log(`  Nodes: ${extracted.nodes.map(n => `${n.label} (${n.type})`).join(', ')}`);
          }
          if (extracted.contradictions && extracted.contradictions.length > 0) {
              allContradictions.push(...extracted.contradictions);
          }
          
          combinedGraph = mergeGraph(combinedGraph, extracted);
      }
      
      if (allContradictions.length > 0) {
          event.sender.send('memory-conflict', allContradictions);
      }

    } catch (err) {
      console.error(`  ❌ Failed to process ${file.name}:`, err.message);
    }
  }

  // Merge into existing persistent graph
  const existing = loadGraph();
  const finalGraph = mergeGraph(existing, combinedGraph);
  saveGraph(finalGraph);

  console.log(`\n💾 Graph saved! Total: ${finalGraph.nodes.length} nodes, ${finalGraph.edges.length} edges`);
  console.log(`📍 Saved to: ${require('./knowledge/graph-store').GRAPH_PATH}`);

  event.sender.send('extraction-done', finalGraph);
  return { graph: finalGraph };
});

// ── Web URL Knowledge Ingestion ──
ipcMain.handle('ingest-url', async (event, url) => {
  console.log(`\n🕸️  Web Ingestion Started: ${url}`);
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing in .env");

    event.sender.send('extraction-progress', 'Scraping webpage...');
    const scrapeResult = await scrapeWebpage(url);
    if (scrapeResult.startsWith("Error")) {
      throw new Error(scrapeResult);
    }
    
    // Scrape result comes back as "Content from URL:\n\nTEXT". Let's extract the text.
    const textContent = scrapeResult.replace(/^Content from [^:]+:\n\n/, '');
    
    console.log(`  Sending to Gemini AI for deep URL analysis...`);
    const chunks = semanticChunk(textContent, url);
    let combinedGraph = { nodes: [], edges: [] };
    let allContradictions = [];

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunkText = chunks[chunkIdx];
      event.sender.send('extraction-progress', `AI deep-analyzing web page (Part ${chunkIdx + 1}/${chunks.length})...`);
      
      const currentContext = mergeGraph(loadGraph(), combinedGraph);
      const extracted = await extractGraphFromText(chunkText, apiKey, currentContext, {
          isDocument: true,
          fileName: url,
          chunkIndex: chunkIdx,
          totalChunks: chunks.length
      });
      if (extracted.contradictions && extracted.contradictions.length > 0) {
          allContradictions.push(...extracted.contradictions);
      }
      combinedGraph = mergeGraph(combinedGraph, extracted);
    }
    
    if (allContradictions.length > 0) {
        event.sender.send('memory-conflict', allContradictions);
    }

    const existing = loadGraph();
    const finalGraph = mergeGraph(existing, combinedGraph);
    saveGraph(finalGraph);

    console.log(`\n💾 Web Graph saved! Total: ${finalGraph.nodes.length} nodes, ${finalGraph.edges.length} edges`);
    event.sender.send('extraction-done', finalGraph);
    return { success: true, graph: finalGraph };

  } catch (err) {
    console.error(`  ❌ Failed to ingest URL:`, err.message);
    event.sender.send('extraction-error', err.message);
    return { success: false, message: err.message };
  }
});


// ── Gemini Live WebSocket Backend ──
let ws = null;
let sessionTranscript = [];
let latestShadowContext = null;
let currentSessionContextPayload = null;
// Shadow image retrieval cooldown — prevents spam-showing the same images on every turn
let lastShadowImagePushTime = 0;
let lastShadowImageIds = new Set();

ipcMain.on('start-session', (event, contextPayload) => {
  if (ws) ws.close();
  sessionTranscript = []; // Reset transcript
  lastShadowImagePushTime = 0; // Reset image cooldown
  lastShadowImageIds = new Set();
  currentSessionContextPayload = contextPayload || {};

  // Pause wake word during active session to avoid dual-mic conflicts
  if (wakeWordEngine) wakeWordEngine.pause();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return event.reply('agent-error', "GEMINI_API_KEY is missing in .env");
  }

  // Build context-aware system instruction from knowledge graph
  let systemInstruction = buildSystemInstruction('', currentSessionContextPayload);
  // Inject available skill summaries (modular app-specific instructions)
  systemInstruction += getSkillSummaries();
  if (contextPayload && contextPayload.weatherContext) {
      systemInstruction += `\n\nCURRENT CONTEXT:\n${contextPayload.weatherContext}`;
  }
  if (contextPayload && contextPayload.googleContext) {
      systemInstruction += contextPayload.googleContext;
  }

  console.log("System instruction built. Node count:", loadGraph().nodes.length);
  if (contextPayload) console.log("Injected environmental/Google context.");

  const host = 'generativelanguage.googleapis.com';
  const model = 'models/gemini-3.1-flash-live-preview';
  const url = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log("WebSocket connected.");
    ws.send(JSON.stringify({
      setup: {
        model: model,
        system_instruction: {
          parts: [{ text: systemInstruction }]
        },
        tools: agentTools,
        generationConfig: {
          responseModalities: ["AUDIO"]
        },
        input_audio_transcription: {},
        output_audio_transcription: {}
      }
    }));
  });

  ws.on('message', (data) => {
    try {
      const response = JSON.parse(data.toString());

      if (response.setupComplete) {
        console.log("Setup complete received from Gemini.");
        event.reply('session-started');
      }

      if (response.toolCall) {
        const functionCalls = response.toolCall.functionCalls;
        if (functionCalls && functionCalls.length > 0) {
          for (const call of functionCalls) {
            const { id: callId, name, args } = call;
            console.log(`\n🛠️ Agent requested tool: ${name} with args:`, args);
            
            const executeTool = async () => {
              event.reply('agent-tool-call', { name, args });
              let result;
              try {
                if (isOsTool(name)) {
                  // ── OS Tools: secure, allowlisted system actions ──
                  console.log(`  🖥️  Executing OS tool: ${name}`);
                  result = await executeOsTool(name, args);
                } else if (isAppControlTool(name)) {
                  // ── Deep App Control: vision, UI, interaction, music ──
                  console.log(`  🎯 Executing app control: ${name}`);
                  result = await executeAppControlTool(name, args);
                } else if (name === 'query_memory') {
                  // Dynamic Knowledge Graph search with decay + tag filtering
                  const searchResult = searchMemory(
                    args.query || '',
                    Math.min(args.maxResults || 5, 10),
                    args.filterTag || null
                  );
                  console.log(`  🧠 Memory search for "${args.query}"${args.filterTag ? ` [${args.filterTag}]` : ''}: ${searchResult.nodes.length} results`);
                  result = {
                    query: args.query,
                    filterTag: args.filterTag || null,
                    found: searchResult.nodes.length,
                    summary: searchResult.summary,
                    nodes: searchResult.nodes.map(n => ({
                      id: n.id, label: n.label, type: n.type,
                      description: n.description,
                      tags: n.tags || [],
                      lastAccessed: n.lastAccessedAt ? new Date(n.lastAccessedAt).toLocaleDateString() : null
                    }))
                  };
                } else if (googleTools.handlers[name]) {
                  result = await googleTools.handlers[name](args);
                } else if (uiTools.handlers[name]) {
                  result = await uiTools.handlers[name](args);
                } else if (name === 'search_web') {
                  result = await searchWeb(args.query);
                } else if (name === 'scrape_webpage') {
                  result = await scrapeWebpage(args.url);
                } else if (name === 'get_news') {
                  result = await getNews(args.topic || '');
                } else if (name === 'search_images') {
                  const imgResult = await searchImages(args.query, args.count || 4);
                  result = imgResult;
                  if (imgResult.images && imgResult.images.length > 0 && mainWindow) {
                    mainWindow.webContents.send('show-hud-widget', {
                      type: 'image_gallery',
                      data: {
                        title: `🔍 ${args.query}`,
                        images: imgResult.images,
                        source: 'internet'
                      }
                    });
                  }
                } else if (name === 'show_visual_memory') {
                  // Search stored personal images and push to HUD
                  const graph = loadGraph();
                  const { findMatchingImageNodes, extractKeywordsFromText, hasVisualIntent } = require('./knowledge/image-analyzer');
                  const searchQ = (args.query || 'photo').toLowerCase();

                  // Determine if the query is asking for PERSONAL photos (about the user)
                  const personalKeywords = ['me', 'my', 'mine', 'ayush', 'myself', 'personal', 'i', 'photo', 'profile'];
                  const isPersonalQuery = personalKeywords.some(k => searchQ.split(/\s+/).includes(k));

                  const keywords = extractKeywordsFromText(searchQ);
                  const rawWords = searchQ.split(/\s+/).filter(w => w.length > 1);
                  const allKws = [...new Set([...keywords, ...rawWords])];

                  // First try: match by keywords with personalOnly=true for personal queries
                  let matches = findMatchingImageNodes(allKws, graph, args.count || 4, isPersonalQuery);

                  // Second try: if no keyword match but personal query, show all user_self-linked images
                  if (matches.length === 0 && isPersonalQuery) {
                    const userSelfImageIds = new Set(
                      (graph.edges || []).filter(e => e.to === 'user_self').map(e => e.from)
                    );
                    matches = graph.nodes
                      .filter(n => n.type === 'ImageMemory' && userSelfImageIds.has(n.id))
                      .slice(0, args.count || 4);
                  }

                  // Bug 4 fix: NEVER fall back to dumping ALL images — only matched or user_self-linked

                  if (matches.length > 0 && mainWindow) {
                    mainWindow.webContents.send('show-hud-widget', {
                      type: 'image_gallery',
                      data: {
                        title: '📸 Your Photos',
                        images: matches.map(n => ({
                          filename: n.imagePath,
                          label: n.label,
                          description: n.description,
                          source: 'memory'
                        }))
                      }
                    });
                    result = { shown: matches.length, labels: matches.map(n => n.label) };
                  } else {
                    result = {
                      shown: 0,
                      message: matches.length === 0 && !isPersonalQuery
                        ? `No images found matching "${searchQ}". Try a more specific term like an event name or tag.`
                        : 'No personal photos found in visual memory. Ask the user to upload photos via the Memory window (🧠 button).'
                    };
                  }
                } else if (name.startsWith('browser_') || name === 'toggle_browser') {
                  const res = await callBrowser(name, args);
                  if (res.error) throw new Error(res.error);
                  result = res.result;
                }
              } catch (e) {
                result = { error: e.message };
              }
              event.reply('agent-tool-complete', { name });
              return result;
            };

            executeTool().then(result => {
              ws.send(JSON.stringify({
                toolResponse: {
                  functionResponses: [{
                    id: callId,
                    name: name,
                    response: { result: enhanceToolResponse(name, result) }
                  }]
                }
              }));
            }).catch(err => {
              event.reply('agent-tool-complete', { name });
              console.error("Tool execution failed:", err);
              ws.send(JSON.stringify({
                toolResponse: {
                  functionResponses: [{
                    id: callId,
                    name: name,
                    response: { error: err.message || "An unknown error occurred while trying to access the internet." }
                  }]
                }
              }));
            });
          }
        }
      }

      if (response.serverContent) {
        if (response.serverContent.modelTurn) {
          const parts = response.serverContent.modelTurn.parts;
          for (const part of parts) {
            if (part.inlineData && part.inlineData.data) {
              event.reply('agent-audio', part.inlineData.data);
            }
            if (part.text) {
              event.reply('agent-text', part.text);
            }
          }
        }

        const inputTrans = response.serverContent.inputTranscription || response.serverContent.input_transcription;
        if (inputTrans && inputTrans.text) {
          const userText = inputTrans.text.trim();
          event.reply('user-text', userText);
          sessionTranscript.push({ role: 'user', text: userText });

          // ── PHASE 2: Shadow Retrieval (Auto-RAG) ──
          // Silently inject relevant memory context if the user's sentence is meaningful
          if (userText.length > 15) {
            const searchResult = searchMemory(userText, 3, null); // Top 3 relevant facts
            if (searchResult.nodes.length > 0) {
              const shadowFacts = searchResult.nodes.map(n => `Fact [${n.label}]: ${n.description}`).join(' | ');
              latestShadowContext = `[SYSTEM BACKGROUND CONTEXT: ${shadowFacts}]`;
              console.log(`\n🕵️‍♂️ Shadow Retrieval: Staged ${searchResult.nodes.length} nodes for next turn based on: "${userText.slice(0, 30)}..."`);
            }

            // ── Shadow Image Retrieval ──
            // Only triggered when the sentence has visual intent AND enough time has passed
            try {
              // Bug 3 fix: intent gate — only trigger for photo/image/person-related sentences
              if (hasVisualIntent(userText)) {
                const SHADOW_IMG_COOLDOWN_MS = 30000; // 30 seconds between auto-pushes
                const now = Date.now();
                const cooldownPassed = (now - lastShadowImagePushTime) > SHADOW_IMG_COOLDOWN_MS;

                if (cooldownPassed) {
                  const keywords = extractKeywordsFromText(userText);
                  if (keywords.length > 0) {
                    const graph = loadGraph();
                    const matchingImages = findMatchingImageNodes(keywords, graph, 4);

                    if (matchingImages.length > 0) {
                      // Bug 3 fix: dedup — don't re-show same images that were just displayed
                      const newImageIds = matchingImages.map(n => n.id);
                      const hasNewImages = newImageIds.some(id => !lastShadowImageIds.has(id));

                      if (hasNewImages && mainWindow) {
                        console.log(`\n📸 Shadow Image Retrieval: ${matchingImages.length} image(s) matched for "${userText.slice(0, 35)}..."`);
                        mainWindow.webContents.send('show-hud-widget', {
                          type: 'image_gallery',
                          data: {
                            title: '📸 Visual Memory',
                            images: matchingImages.map(n => ({
                              filename: n.imagePath,
                              label: n.label,
                              description: n.description,
                              source: 'memory'
                            }))
                          }
                        });
                        lastShadowImagePushTime = now;
                        lastShadowImageIds = new Set(newImageIds);
                      }
                    }
                  }
                }
              }
            } catch (imgErr) {
              // Non-critical — don't let image retrieval crash the conversation
            }
          }
        }

        const outputTrans = response.serverContent.outputTranscription || response.serverContent.output_transcription;
        if (outputTrans && outputTrans.text) {
          event.reply('agent-text', outputTrans.text);
          sessionTranscript.push({ role: 'agent', text: outputTrans.text });
        }

        if (response.serverContent.turnComplete) {
          event.reply('agent-turn-complete');
        }

        if (response.serverContent.interrupted) {
          event.reply('agent-interrupted');
        }
      }

    } catch (e) {
      console.error("Error parsing WS message:", e);
    }
  });

  ws.on('error', (err) => {
    console.error("WebSocket error:", err);
    event.reply('agent-error', err.message);
  });

  ws.on('close', async (code, reason) => {
    console.log(`WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    event.reply('session-ended');

    // AUTO-MEMORY LOOP: Extract knowledge from this session
    const transcriptText = sessionTranscript.map(t => `${t.role}: ${t.text}`).join('\n');
    if (transcriptText.length > 50) {
        console.log(`\n🧠 Auto-Memory: Analyzing session transcript (${transcriptText.length} chars)...`);

        // Run diary summarization and graph extraction IN PARALLEL
        const [diaryResult] = await Promise.allSettled([
            (async () => {
                const existingSummary = currentSessionContextPayload && currentSessionContextPayload.continueDiary ? currentSessionContextPayload.continueDiary.entry : null;
                const timestampToReplace = currentSessionContextPayload && currentSessionContextPayload.continueDiary ? currentSessionContextPayload.continueDiary.timestamp : null;
                
                const entry = await summariseSession(transcriptText, apiKey, existingSummary);
                
                if (!entry.includes('No significant facts learned')) {
                    appendDiaryEntry(entry, timestampToReplace);
                    console.log(`📓 Diary: "${entry.slice(0, 80)}..."`); 
                } else if (existingSummary && timestampToReplace) {
                    // if nothing new, just update the timestamp
                    appendDiaryEntry(existingSummary, timestampToReplace);
                    console.log('📓 Diary: Kept previous summary, updated timestamp.');
                } else {
                    console.log('📓 Diary: Nothing significant this session.');
                }
            })()
        ]);

        try {
            const existing = loadGraph();
            const extracted = await extractGraphFromText(transcriptText, apiKey, existing);
            if (extracted.nodes && extracted.nodes.length > 0) {
                extracted.nodes.forEach(n => n.source = 'agent');
            }
            if (extracted.contradictions && extracted.contradictions.length > 0) {
                event.sender.send('memory-conflict', extracted.contradictions);
            }
            if (extracted.nodes.length > 0 || extracted.edges.length > 0) {
                const finalGraph = mergeGraph(existing, extracted);
                saveGraph(finalGraph);
                console.log(`💾 Auto-Memory: Graph updated! Added ${extracted.nodes.length} nodes, ${extracted.edges.length} edges.`);
                // Notify memory window to refresh if open
                if (memoryWindow && !memoryWindow.isDestroyed()) {
                    memoryWindow.webContents.send('extraction-done', finalGraph);
                }
            } else {
                console.log(`🧠 Auto-Memory: No new facts learned in this session.`);
            }
        } catch (err) {
            console.error(`❌ Auto-Memory failed:`, err.message);
        }
    }

    // ── Resume wake word listening after session ends ──
    if (wakeWordEngine) {
      setTimeout(() => {
        if (wakeWordEngine && !ws) {
          wakeWordEngine.resume();
          console.log('[WakeWord] Resumed after WebSocket close (cooldown elapsed).');
        }
      }, wakeWordEngine.cooldownMs || 2000);
    }
  });
});

ipcMain.on('realtime-audio', (event, base64Audio) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    realtimeInput: {
      audio: {
        mimeType: "audio/pcm;rate=16000",
        data: base64Audio
      }
    }
  }));
});

ipcMain.on('turn-complete', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  const payload = {
    clientContent: {
      turns: [],
      turnComplete: true
    }
  };

  if (latestShadowContext) {
    payload.clientContent.turns.push({
      role: "user",
      parts: [{ text: latestShadowContext }]
    });
    console.log(`📤 Shadow Retrieval: Context injected into turnComplete.`);
    latestShadowContext = null; // Clear it after sending
  }

  ws.send(JSON.stringify(payload));
});

ipcMain.on('send-text-command', (event, text) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    clientContent: {
      turns: [{
        role: "user",
        parts: [{ text: text }]
      }],
      turnComplete: true
    }
  }));
  sessionTranscript.push({ role: 'user', text: `[TEXT COMMAND]: ${text}` });
  console.log(`💬 User Text Command: ${text}`);
});

ipcMain.on('stop-session', () => {
  if (ws) ws.close();
  ws = null;

  // ── Resume wake word listening after cooldown ──
  if (wakeWordEngine) {
    setTimeout(() => {
      if (wakeWordEngine && !ws) {
        wakeWordEngine.resume();
        console.log('[WakeWord] Resumed after session end (cooldown elapsed).');
      }
    }, wakeWordEngine.cooldownMs || 2000);
  }
});

// ── Wake Word IPC ──
ipcMain.handle('get-wake-word-status', () => {
  if (!wakeWordEngine) return { available: false, reason: 'Engine not initialized' };
  return { available: true, ...wakeWordEngine.getStatus() };
});

ipcMain.on('set-wake-word-enabled', (event, enabled) => {
  if (!wakeWordEngine) return;
  if (enabled) {
    wakeWordEngine.resume();
  } else {
    wakeWordEngine.pause();
  }
});

ipcMain.on('set-wake-word-threshold', (event, threshold) => {
  if (!wakeWordEngine) return;
  wakeWordEngine.setThreshold(threshold);
});

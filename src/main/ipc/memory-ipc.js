/**
 * Memory graph, diary, and ingestion IPC handlers.
 */

const { app, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { loadGraph, saveGraph, clearGraph: clearGraphStore } = require('../../knowledge/graph-store');
const { getAllTags } = require('../../knowledge/graph-search');
const { loadDiary } = require('../../knowledge/session-diary');
const { IMAGE_STORE } = require('../../knowledge/image-analyzer');
const { autoConnectIslands, revertGraph, checkBackupExists, runMemoryCommand } = require('../../knowledge/graph-optimizer');
const { processUploadedFiles, ingestUrl } = require('../../knowledge/ingestion-service');
const orchestrator = require('../../orchestration/orchestrator');

function registerMemoryIpc(ipcMain, { getMainWindow }) {
    ipcMain.handle('get-graph', () => loadGraph());

    ipcMain.handle('clear-graph', () => {
        clearGraphStore();
        return { success: true };
    });

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
        const mainWindow = getMainWindow();
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Select Destination for Memory Export'
        });

        if (result.canceled) return { canceled: true };

        try {
            const destDir = result.filePaths[0];
            const graph = loadGraph();

            fs.writeFileSync(path.join(destDir, 'memory-export.json'), JSON.stringify(graph, null, 2));

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
        const mainWindow = getMainWindow();
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

    ipcMain.handle('delete-node', (event, nodeId) => {
        const graph = loadGraph();
        const before = graph.nodes.length;
        graph.nodes = graph.nodes.filter(n => n.id !== nodeId);
        graph.edges = graph.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
        saveGraph(graph);
        console.log(`[Memory] Deleted node "${nodeId}". Removed ${before - graph.nodes.length} nodes and cleaned edges.`);
        return { success: true };
    });

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

    ipcMain.handle('revert-graph', () => revertGraph());
    ipcMain.handle('check-backup', () => checkBackupExists());

    ipcMain.handle('get-tags', () => getAllTags());

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

    ipcMain.handle('get-diary', () => loadDiary());

    ipcMain.handle('cancel-agents', () => {
        const canceledCount = orchestrator.cancelActiveAgents('user_cancel_hud');
        return { success: true, count: canceledCount };
    });

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

    ipcMain.handle('upload-files', (event, fileDataArray) => processUploadedFiles(event, fileDataArray));
    ipcMain.handle('ingest-url', (event, url) => ingestUrl(event, url));
}

module.exports = { registerMemoryIpc };

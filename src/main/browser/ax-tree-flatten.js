/**
 * Flatten CDP Accessibility tree nodes into numbered interactive elements.
 */

const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
    'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider',
    'spinbutton', 'listbox', 'option', 'treeitem', 'gridcell', 'cell',
    'summary', 'details', 'menu', 'menubar', 'navigation', 'form',
]);

const MAX_ELEMENTS = 120;
const MAX_BODY_TEXT = 1500;

function roleOf(node) {
    const r = node.role;
    if (!r) return '';
    return (typeof r === 'string' ? r : r.value || '').toLowerCase();
}

function nameOf(node) {
    const n = node.name;
    if (!n) return '';
    return (typeof n === 'string' ? n : n.value || '').trim();
}

function isIgnored(node) {
    if (node.ignored === true) return true;
    if (node.ignored && node.ignored.value === true) return true;
    return false;
}

function flattenAxTree(axNodes, pageMeta = {}) {
    const nodeById = new Map();
    for (const n of axNodes) {
        nodeById.set(n.nodeId, n);
    }

    const elements = [];
    let id = 0;

    for (const node of axNodes) {
        if (isIgnored(node)) continue;
        const role = roleOf(node);
        if (!INTERACTIVE_ROLES.has(role) && role !== 'statictext') continue;
        if (!node.backendDOMNodeId && !INTERACTIVE_ROLES.has(role)) continue;

        const name = nameOf(node);
        if (role === 'statictext' && (!name || name.length < 2)) continue;

        if (elements.length >= MAX_ELEMENTS) break;

        id++;
        let desc = `[${id}] ${role}`;
        if (name) desc += ` "${name.replace(/\n/g, ' ').substring(0, 60)}"`;

        const props = node.properties || [];
        const urlProp = props.find(p => p.name === 'url');
        if (urlProp?.value?.value) {
            desc += ` -> ${String(urlProp.value.value).substring(0, 80)}`;
        }

        elements.push({
            id: String(id),
            role,
            name,
            backendDOMNodeId: node.backendDOMNodeId,
            nodeId: node.nodeId,
            description: desc,
        });
    }

    const lines = elements.map(e => e.description);

    return {
        snapshotId: `snap-${Date.now()}`,
        url: pageMeta.url || '',
        title: pageMeta.title || '',
        elements,
        elementLines: lines,
        text: (pageMeta.bodyText || '').substring(0, MAX_BODY_TEXT),
    };
}

module.exports = { flattenAxTree, INTERACTIVE_ROLES, MAX_ELEMENTS };

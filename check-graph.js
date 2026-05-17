const fs = require('fs');
const os = require('os');
const path = require('path');

const graphPath = path.join(os.homedir(), 'Library', 'Application Support', 'project-summer', 'knowledge-graph.json');
const data = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

const whizanNode = data.nodes.find(n => n.id && n.id.toLowerCase().includes('whizan'));
console.log(JSON.stringify(whizanNode, null, 2));

const fs = require('fs');
const os = require('os');
const path = require('path');

const graphPath = path.join(os.homedir(), 'Library', 'Application Support', 'project-summer', 'knowledge-graph.json');
const data = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

// Add descriptions
for (const node of data.nodes) {
  if (node.id === 'whizan_ai') {
    node.description = "Technical documentation detailing the Whizan AI interview platform's proctoring modes, real-time feedback systems, and AI-driven interview flow mechanisms.";
  } else if (node.id === 'jarvis') {
    node.description = "An advanced AI-driven conversational agent that powers the Whizan platform.";
  } else if (node.id === 'ai_interviewer') {
    node.description = "A module that conducts dynamic, technical interviews and evaluates candidates based on System Design and DSA.";
  }
}

fs.writeFileSync(graphPath, JSON.stringify(data, null, 2));
console.log("Updated knowledge-graph.json with descriptions!");

const fs = require('node:fs');
const path = require('node:path');

const PLUGINS_DIR = path.join(__dirname, '..', '..', 'plugins');

/**
 * Scan plugins/ and load all skill.json manifests.
 * @returns {Map<string, object>} agent_id -> manifest
 */
function loadPluginManifests() {
  const manifests = new Map();
  if (!fs.existsSync(PLUGINS_DIR)) return manifests;

  for (const dir of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const skillPath = path.join(PLUGINS_DIR, dir.name, 'skill.json');
    if (!fs.existsSync(skillPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
      if (manifest.agent_id) {
        manifest._pluginDir = path.join(PLUGINS_DIR, dir.name);
        manifests.set(manifest.agent_id, manifest);
        console.log(`[Plugins] Loaded manifest: ${manifest.agent_id} (${dir.name})`);
      }
    } catch (e) {
      console.error(`[Plugins] Failed to parse ${skillPath}:`, e.message);
    }
  }
  return manifests;
}

function getPluginEntryPath(manifest) {
  return path.join(manifest._pluginDir, manifest.entry_point || 'index.js');
}

function listPluginSummaries(manifests) {
  return [...manifests.values()].map(m =>
    `- **${m.display_name || m.agent_id}** (\`${m.agent_id}\`): ${m.description}`
  );
}

module.exports = { PLUGINS_DIR, loadPluginManifests, getPluginEntryPath, listPluginSummaries };

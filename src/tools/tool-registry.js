/**
 * Facade: tool routing for Gemini setup + integration loader for execution.
 */

const loader = require('./integration-loader');
const router = require('./tool-router');

function getAgentTools(toolContext) {
    return router.getAgentTools(toolContext);
}

function getSmartAgentTools(toolContext, intentHint) {
    return router.getSmartAgentTools(toolContext, intentHint);
}

async function executeTool(name, args, ctx) {
    return loader.executeTool(name, args, ctx);
}

module.exports = {
    getAgentTools,
    getSmartAgentTools,
    executeTool,
    buildToolContext:             router.buildToolContext,
    getRouterStats:              router.getRouterStats,
    invalidateDeclarationCache:  router.invalidateDeclarationCache,
};

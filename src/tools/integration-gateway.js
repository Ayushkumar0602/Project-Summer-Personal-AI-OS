/**
 * Meta-tools for long-tail integrations (Spotify, Notion, Slack, …).
 * Keeps the live session tool list small as new packs are added.
 */

const gatewayDeclarations = [
    {
        name: 'list_integrations',
        description: 'List connected and available third-party integrations and what actions each supports. Call before integration_gateway when unsure which integration to use.',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
    },
    {
        name: 'integration_gateway',
        description: 'Run a specific action on a connected integration (e.g. spotify play, notion create page). Use list_integrations to discover integration ids and action names.',
        parameters: {
            type: 'OBJECT',
            properties: {
                integration: { type: 'STRING', description: 'Integration id, e.g. spotify, notion, slack' },
                action: { type: 'STRING', description: 'Action name within that integration' },
                params: { type: 'OBJECT', description: 'Action-specific parameters' },
            },
            required: ['integration', 'action'],
        },
    },
];

function createGatewayHandlers(getPackById, listPackCatalog) {
    return {
        list_integrations: async () => {
            const catalog = listPackCatalog();
            return {
                integrations: catalog.map(p => ({
                    id: p.id,
                    display_name: p.displayName,
                    description: p.description,
                    connected: p.available !== false,
                    actions: p.actions || [],
                    pinned: p.pinned === true,
                })),
            };
        },

        integration_gateway: async (args) => {
            const integrationId = (args.integration || '').toLowerCase().trim();
            const action = (args.action || '').trim();
            const params = args.params || {};

            if (!integrationId || !action) {
                return { error: 'integration and action are required.' };
            }

            const pack = getPackById(integrationId);
            if (!pack) {
                return {
                    error: `Unknown integration "${integrationId}". Call list_integrations for available services.`,
                };
            }

            if (pack.gatewayHandler) {
                return pack.gatewayHandler(action, params);
            }

            const handler = pack.handlers?.[action];
            if (!handler) {
                return {
                    error: `Action "${action}" is not available on ${integrationId}.`,
                    available_actions: Object.keys(pack.handlers || {}),
                };
            }

            return handler(params, {});
        },
    };
}

module.exports = { gatewayDeclarations, createGatewayHandlers };

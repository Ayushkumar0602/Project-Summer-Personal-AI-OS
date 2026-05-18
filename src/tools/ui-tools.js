/**
 * src/tools/ui-tools.js
 *
 * HUD & layout tools — ZERO Electron dependency.
 * All rendering goes through renderer-bridge → WebSocket → client.
 */

'use strict';

const { sendToRenderer, executeInRenderer } = require('../core/utils/renderer-bridge');

const declarations = [
    {
        name: "show_hologram_widget",
        description: "Displays a futuristic UI widget on the screen. Use this instead of reading out long lists of emails or events.",
        parameters: {
            type: "OBJECT",
            properties: {
                type: {
                    type: "STRING",
                    description: "The type of widget to show. Supported: 'calendar', 'emails', 'mermaid'"
                },
                data: {
                    type: "ARRAY",
                    description: "The array of items to display. For calendar: [{summary: 'Meeting', timeStr: '10:00 AM'}]. For emails: [{subject: 'Hello', from: 'John'}].",
                    items: {
                        type: "OBJECT",
                        properties: {
                            summary: { type: "STRING" },
                            timeStr: { type: "STRING" },
                            subject: { type: "STRING" },
                            from: { type: "STRING" },
                            content: { type: "STRING", description: "Raw content for mermaid diagram or other text content." }
                        }
                    }
                },
                append: {
                    type: "BOOLEAN",
                    description: "If true, adds this widget without removing the existing widgets. If false, clears the screen before showing this widget."
                },
                width: {
                    type: "INTEGER",
                    description: "Optional. The width of the widget in pixels."
                },
                height: {
                    type: "INTEGER",
                    description: "Optional. The height of the widget in pixels."
                }
            },
            required: ["type", "data"]
        }
    },
    {
        name: "clear_hologram_widget",
        description: "Removes or clears any currently displayed widget, map, or video from the user's HUD screen.",
        parameters: { type: "OBJECT", properties: {}, required: [] }
    },
    {
        name: "ui_control_window",
        description: "Resizes the main application window.",
        parameters: {
            type: "OBJECT",
            properties: {
                width: { type: "INTEGER", description: "The new width of the window." },
                height: { type: "INTEGER", description: "The new height of the window." }
            },
            required: ["width", "height"]
        }
    },
    {
        name: "ui_control_layout",
        description: "Controls the internal layout of the application (e.g. changing the width of the agent panel or showing/hiding the browser panel).",
        parameters: {
            type: "OBJECT",
            properties: {
                agentPanelWidth: { type: "INTEGER", description: "The width in pixels of the left agent panel (default is 440)." },
                showBrowser: { type: "BOOLEAN", description: "Whether the right-side browser panel should be visible." }
            },
            required: []
        }
    }
];

const handlers = {
    show_hologram_widget: async (args) => {
        sendToRenderer('show-hud-widget', {
            type:   args.type,
            data:   args.data || [],
            append: args.append || false,
            width:  args.width,
            height: args.height,
        });
        return `Successfully displayed ${args.type} widget on screen.`;
    },

    clear_hologram_widget: async () => {
        sendToRenderer('show-hud-widget', { type: 'clear' });
        return 'Successfully cleared the HUD screen.';
    },

    ui_control_window: async (args) => {
        // Resize via renderer script (only matters in Electron)
        executeInRenderer(
            `try { const { ipcRenderer } = require('electron'); ipcRenderer.send('resize-window', ${JSON.stringify({ width: args.width, height: args.height })}); } catch(e) {}`
        );
        return `Successfully resized window to ${args.width}x${args.height}.`;
    },

    ui_control_layout: async (args) => {
        let script = '';
        if (args.agentPanelWidth) {
            script += `const panel = document.querySelector('.agent-panel'); if (panel) panel.style.flex = '0 0 ${args.agentPanelWidth}px';\n`;
        }
        if (args.showBrowser !== undefined) {
            if (args.showBrowser) {
                script += `document.getElementById('appLayout')?.classList.remove('browser-hidden');\n`;
            } else {
                script += `document.getElementById('appLayout')?.classList.add('browser-hidden');\n`;
            }
        }
        if (script) executeInRenderer(script);
        return 'Successfully updated UI layout.';
    },
};

module.exports = { declarations, handlers };

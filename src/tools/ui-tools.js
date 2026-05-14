const { BrowserWindow } = require('electron');

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
                    description: "Optional. The width of the widget in pixels. Provide this if you want to control the size."
                },
                height: {
                    type: "INTEGER",
                    description: "Optional. The height of the widget in pixels. Provide this if you want to control the size."
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
        description: "Controls the internal layout of the application (e.g. changing the width of the agent panel).",
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
        try {
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
                // Send IPC to renderer
                windows[0].webContents.send('show-hud-widget', {
                    type: args.type,
                    data: args.data || [],
                    append: args.append || false,
                    width: args.width,
                    height: args.height
                });
                return `Successfully displayed ${args.type} widget on screen.`;
            }
            return "No active window found to display widget.";
        } catch (e) {
            return `Failed to show widget: ${e.message}`;
        }
    },
    clear_hologram_widget: async () => {
        try {
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
                windows[0].webContents.send('show-hud-widget', { type: 'clear' });
                return "Successfully cleared the HUD screen.";
            }
        } catch (e) {
            return `Failed to clear widget: ${e.message}`;
        }
    },
    ui_control_window: async (args) => {
        try {
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
                const win = windows[0];
                win.setSize(args.width, args.height);
                win.center();
                return `Successfully resized window to ${args.width}x${args.height}.`;
            }
            return "No active window found.";
        } catch (e) {
            return `Failed to resize window: ${e.message}`;
        }
    },
    ui_control_layout: async (args) => {
        try {
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
                const win = windows[0];
                let script = "";
                if (args.agentPanelWidth) {
                    script += `document.querySelector('.agent-panel').style.flex = '0 0 ${args.agentPanelWidth}px';\n`;
                }
                if (args.showBrowser !== undefined) {
                    if (args.showBrowser) {
                        script += `document.getElementById('appLayout').classList.remove('browser-hidden');\n`;
                    } else {
                        script += `document.getElementById('appLayout').classList.add('browser-hidden');\n`;
                    }
                }
                if (script) win.webContents.executeJavaScript(script);
                return `Successfully updated UI layout.`;
            }
            return "No active window found.";
        } catch (e) {
            return `Failed to update layout: ${e.message}`;
        }
    }
};

module.exports = { declarations, handlers };

/**
 * Gemini function declarations for the visual mini-browser.
 */

const browserToolDeclarations = [
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
    }
];

const BROWSER_TOOL_NAMES = new Set(browserToolDeclarations.map(d => d.name));

function isBrowserTool(name) {
    return BROWSER_TOOL_NAMES.has(name);
}

module.exports = { browserToolDeclarations, isBrowserTool };

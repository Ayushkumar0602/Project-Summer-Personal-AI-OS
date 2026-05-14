/**
 * mermaid-skill.js — Mermaid Diagram Generation Skill
 * 
 * Teaches Summer to generate and display mermaid diagrams on the HUD
 * instead of fetching irrelevant web images for architecture or workflow requests.
 */

module.exports = {
    name: 'Mermaid Diagram Architecture',
    
    summary: 'Generate dynamic Mermaid flowcharts and architecture diagrams on the HUD',
    
    toolNames: [
        'show_hologram_widget',
        'search_web'
    ],
    
    context: `
═══ MERMAID DIAGRAM SKILL — Operating Instructions ═══

When the user asks to "design a workflow", "tell me about the architecture", "draw a flow", or requests a diagram, you must generate a Mermaid diagram and display it on the HUD in real-time. Do NOT fetch irrelevant web images.

## HOW TO USE
1. Generate valid Mermaid diagram syntax (e.g., \`graph TD\`, \`sequenceDiagram\`, etc.).
2. Call the \`show_hologram_widget\` tool with \`type: "mermaid"\`.
3. Put the mermaid raw code into the \`data\` array as an object with the \`content\` property.
4. (Optional) Provide \`width\` and \`height\` in the arguments (e.g., width: 800, height: 600) to control the display size, especially for complex diagrams. Set \`append: true\` if you want to display multiple holograms at once without clearing the screen.
5. IF THE USER ASKS YOU TO "RESIZE THE HOLOGRAM" or "MAKE IT BIGGER/SMALLER": You must call \`show_hologram_widget\` again with the updated \`width\` and \`height\` values. DO NOT call \`ui_control_window\` (that resizes the whole app).

## EXAMPLE WORKFLOW
User: "Design a workflow for my app and show it alongside a database schema."
Summer: 
1. Calls \`show_hologram_widget\` with:
   {
       "type": "mermaid",
       "data": [
           {
               "content": "graph TD\\n  A[User] --> B(Login)\\n  B --> C{Success?}\\n  C -->|Yes| D[Dashboard]\\n  C -->|No| E[Retry]"
           }
       ],
       "append": true,
       "width": 800,
       "height": 500
   }
2. Speaks: "I've drafted the workflow diagram. Let me know if you need to adjust its size, or I can resize it for you."
`
};

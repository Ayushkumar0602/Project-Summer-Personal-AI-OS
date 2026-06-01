/**
 * Gemini function declarations for Tier 2 domain agent delegation
 * and real-time background task status queries.
 */

const orchestrationToolDeclarations = [
    {
        name: "delegate_domain_agent",
        description: "Delegate a complex background task to a specialized domain agent plug-in (e.g. PPT generation). Use when the user asks to create a PowerPoint/presentation/deck. Do NOT invent slide content yourself — delegate here. If status is 'gathering', ask the user for missing fields and call again with gathered_attributes.",
        parameters: {
            type: "OBJECT",
            properties: {
                agent_id:           { type: "STRING", description: "Plug-in ID, e.g. ppt_editor_v1" },
                user_request:       { type: "STRING", description: "The user's full request in natural language" },
                gathered_attributes: {
                    type: "OBJECT",
                    description: "Partially filled attributes from prior turns (topic, slide_count, target_audience, etc.)"
                }
            },
            required: ["agent_id", "user_request"]
        }
    },
    {
        name: "get_active_agents_status",
        description: "Returns the real-time status of all background agent tasks (running, completed, failed). Call this when the user asks about progress of a background task (e.g. 'is my presentation ready?', 'what's happening with the research?'). Returns a list of all tasks with their percent, message, and result.",
        parameters: {
            type: "OBJECT",
            properties: {
                filter: {
                    type: "STRING",
                    description: "Optional filter: 'running' to see only active tasks, 'completed' to see done tasks, 'all' for everything. Defaults to 'all'.",
                    enum: ["all", "running", "completed", "failed"]
                }
            },
            required: []
        }
    }
];

module.exports = { orchestrationToolDeclarations };

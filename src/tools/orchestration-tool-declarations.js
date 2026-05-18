/**
 * Gemini function declarations for Tier 2 domain agent delegation.
 */

const orchestrationToolDeclarations = [
    {
        name: "delegate_domain_agent",
        description: "Delegate a complex background task to a specialized domain agent plug-in (e.g. PPT generation). Use when the user asks to create a PowerPoint/presentation/deck. Do NOT invent slide content yourself — delegate here. If status is 'gathering', ask the user for missing fields and call again with gathered_attributes.",
        parameters: {
            type: "OBJECT",
            properties: {
                agent_id: { type: "STRING", description: "Plug-in ID, e.g. ppt_editor_v1" },
                user_request: { type: "STRING", description: "The user's full request in natural language" },
                gathered_attributes: {
                    type: "OBJECT",
                    description: "Partially filled attributes from prior turns (topic, slide_count, target_audience, etc.)"
                }
            },
            required: ["agent_id", "user_request"]
        }
    }
];

module.exports = { orchestrationToolDeclarations };

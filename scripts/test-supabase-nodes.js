require('dotenv').config();
const { supabase } = require('../src/services/supabase-client');

async function testSupabase() {
    if (!supabase) return console.error("No supabase");
    
    const testNode = {
        id: "test_node_1",
        type: "Concept",
        label: "memory_edges.confidence",
        description: "Test description",
        updatedAt: Date.now(),
        createdAt: Date.now(),
        importance: 0.5
    };

    const { data, error } = await supabase.from('memory_nodes').upsert([testNode]);
    
    if (error) {
        console.error("Supabase upsert error on memory_nodes:", error);
    } else {
        console.log("Supabase upsert success on memory_nodes");
    }
}
testSupabase();

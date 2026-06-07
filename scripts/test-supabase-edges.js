require('dotenv').config();
const { supabase } = require('../src/services/supabase-client');

async function testSupabase() {
    if (!supabase) return console.error("No supabase");
    
    const testEdge = {
        from: "test_node_1",
        to: "test_node_2",
        label: "test_label",
        confidence: 1.0,
        source: "test",
        updatedAt: Date.now()
    };

    const { data, error } = await supabase.from('memory_edges').upsert([testEdge], { onConflict: 'from,to,label' });
    
    if (error) {
        console.error("Supabase upsert error on memory_edges:", error);
    } else {
        console.log("Supabase upsert success on memory_edges");
    }
}
testSupabase();

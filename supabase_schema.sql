-- Summer AI Knowledge Base Schema
-- Run this in your Supabase SQL Editor

-- 1. Create the Nodes table (Graph memory)
CREATE TABLE IF NOT EXISTS memory_nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    "imagePath" TEXT,
    "publicUrl" TEXT,
    "imageHash" TEXT,
    entities JSONB,
    "faceIds" JSONB,
    tags JSONB,
    pinned BOOLEAN DEFAULT FALSE,
    importance NUMERIC DEFAULT 0.5,
    "updatedAt" BIGINT,
    source TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create the Edges table (Graph relationships)
CREATE TABLE IF NOT EXISTS memory_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "from" TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
    "to" TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    confidence NUMERIC DEFAULT 1.0,
    source TEXT,
    "updatedAt" BIGINT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE ("from", "to", label)
);

-- 3. Create the Session Diary table
CREATE TABLE IF NOT EXISTS memory_diary (
    timestamp BIGINT PRIMARY KEY,
    date TEXT NOT NULL,
    entry TEXT NOT NULL,
    "originalTimestamp" BIGINT
);

-- 4. Enable Row Level Security (RLS) but allow Service Key bypass
ALTER TABLE memory_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_diary ENABLE ROW LEVEL SECURITY;

-- Create policies to allow all access for authenticated service roles
CREATE POLICY "Enable all access for service role" ON memory_nodes FOR ALL USING (true);
CREATE POLICY "Enable all access for service role" ON memory_edges FOR ALL USING (true);
CREATE POLICY "Enable all access for service role" ON memory_diary FOR ALL USING (true);

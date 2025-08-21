-- Fix database schema to match application expectations
-- This migration ensures the database structure aligns with the updated types

-- 1. Create players table if it doesn't exist
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Ensure poker_tables has the correct structure
ALTER TABLE poker_tables ADD COLUMN IF NOT EXISTS admin_player_id TEXT;
ALTER TABLE poker_tables ADD COLUMN IF NOT EXISTS admin_user_id TEXT;

-- 3. Ensure table_players has both player_id and user_id for compatibility
ALTER TABLE table_players ADD COLUMN IF NOT EXISTS player_id TEXT;
ALTER TABLE table_players ADD COLUMN IF NOT EXISTS user_id TEXT;

-- 4. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_table_players_table_id ON table_players(table_id);
CREATE INDEX IF NOT EXISTS idx_table_players_player_id ON table_players(player_id);
CREATE INDEX IF NOT EXISTS idx_table_players_user_id ON table_players(user_id);
CREATE INDEX IF NOT EXISTS idx_poker_tables_admin_player_id ON poker_tables(admin_player_id);
CREATE INDEX IF NOT EXISTS idx_poker_tables_admin_user_id ON poker_tables(admin_user_id);

-- 5. Update RLS policies for players table
CREATE POLICY IF NOT EXISTS "Everyone can view players" ON players FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Everyone can insert players" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Everyone can update players" ON players FOR UPDATE USING (true);
CREATE POLICY IF NOT EXISTS "Everyone can delete players" ON players FOR DELETE USING (true);

-- 6. Enable realtime for players table
ALTER TABLE players REPLICA IDENTITY FULL;

-- 7. Add any missing columns to existing tables
ALTER TABLE buy_ins ADD COLUMN IF NOT EXISTS admin_id TEXT;
ALTER TABLE buy_ins ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE buy_ins ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP WITH TIME ZONE;
ALTER TABLE buy_ins ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 8. Create function to create anonymous tables (if not exists)
CREATE OR REPLACE FUNCTION create_anonymous_table(table_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  table_id TEXT;
BEGIN
  table_id := gen_random_uuid()::TEXT;
  
  INSERT INTO poker_tables (id, name, join_code, status, is_anonymous, original_admin_id)
  VALUES (table_id, table_name, floor(random() * 9000 + 1000), 'active', true, NULL);
  
  RETURN table_id;
END;
$$;

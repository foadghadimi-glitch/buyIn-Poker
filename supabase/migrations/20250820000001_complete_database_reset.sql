-- Complete Database Reset and Recreation
-- This script will drop all existing tables and recreate them with the correct schema
-- WARNING: This will delete ALL data in your database!

-- 1. Drop all existing tables and functions
DROP FUNCTION IF EXISTS create_anonymous_table(TEXT);
DROP TABLE IF EXISTS table_endups CASCADE;
DROP TABLE IF EXISTS buy_ins CASCADE;
DROP TABLE IF EXISTS buy_in_requests CASCADE;
DROP TABLE IF EXISTS join_requests CASCADE;
DROP TABLE IF EXISTS table_players CASCADE;
DROP TABLE IF EXISTS poker_tables CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 2. Create the players table (for user profiles)
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create the poker_tables table with correct structure
CREATE TABLE poker_tables (
  id TEXT PRIMARY KEY,
  name TEXT,
  join_code INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  admin_player_id TEXT,
  admin_user_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_anonymous BOOLEAN DEFAULT FALSE,
  original_admin_id TEXT
);

-- 4. Create the table_players table (junction table for players in tables)
CREATE TABLE table_players (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  table_id TEXT NOT NULL,
  player_id TEXT,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE CASCADE
);

-- 5. Create the buy_ins table
CREATE TABLE buy_ins (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  table_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  admin_id TEXT,
  notes TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE CASCADE
);

-- 6. Create the buy_in_requests table
CREATE TABLE buy_in_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  table_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE CASCADE
);

-- 7. Create the join_requests table
CREATE TABLE join_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  table_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE CASCADE
);

-- 8. Create the table_endups table
CREATE TABLE table_endups (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  table_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  endup DECIMAL(10,2) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE CASCADE
);

-- 9. Create the users table (legacy support)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT
);

-- 10. Create indexes for better performance
CREATE INDEX idx_poker_tables_join_code ON poker_tables(join_code);
CREATE INDEX idx_poker_tables_admin_player_id ON poker_tables(admin_player_id);
CREATE INDEX idx_poker_tables_admin_user_id ON poker_tables(admin_user_id);
CREATE INDEX idx_poker_tables_status ON poker_tables(status);

CREATE INDEX idx_table_players_table_id ON table_players(table_id);
CREATE INDEX idx_table_players_player_id ON table_players(player_id);
CREATE INDEX idx_table_players_user_id ON table_players(user_id);
CREATE INDEX idx_table_players_status ON table_players(status);

CREATE INDEX idx_buy_ins_table_id ON buy_ins(table_id);
CREATE INDEX idx_buy_ins_player_id ON buy_ins(player_id);
CREATE INDEX idx_buy_ins_status ON buy_ins(status);

CREATE INDEX idx_buy_in_requests_table_id ON buy_in_requests(table_id);
CREATE INDEX idx_buy_in_requests_player_id ON buy_in_requests(player_id);
CREATE INDEX idx_buy_in_requests_status ON buy_in_requests(status);

CREATE INDEX idx_join_requests_table_id ON join_requests(table_id);
CREATE INDEX idx_join_requests_player_id ON join_requests(player_id);
CREATE INDEX idx_join_requests_status ON join_requests(status);

CREATE INDEX idx_table_endups_table_id ON table_endups(table_id);
CREATE INDEX idx_table_endups_player_id ON table_endups(player_id);

-- 11. Create the create_anonymous_table function
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

-- 12. Enable Row Level Security (RLS)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE poker_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE buy_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE buy_in_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_endups ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 13. Create RLS policies for anonymous access (no authentication required)
-- Players table policies
CREATE POLICY "Everyone can view players" ON players FOR SELECT USING (true);
CREATE POLICY "Everyone can insert players" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update players" ON players FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete players" ON players FOR DELETE USING (true);

-- Poker tables policies
CREATE POLICY "Everyone can view tables" ON poker_tables FOR SELECT USING (true);
CREATE POLICY "Everyone can create tables" ON poker_tables FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update tables" ON poker_tables FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete tables" ON poker_tables FOR DELETE USING (true);

-- Table players policies
CREATE POLICY "Everyone can view table players" ON table_players FOR SELECT USING (true);
CREATE POLICY "Everyone can insert table players" ON table_players FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update table players" ON table_players FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete table players" ON table_players FOR DELETE USING (true);

-- Buy ins policies
CREATE POLICY "Everyone can view buy-ins" ON buy_ins FOR SELECT USING (true);
CREATE POLICY "Everyone can insert buy-ins" ON buy_ins FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update buy-ins" ON buy_ins FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete buy-ins" ON buy_ins FOR DELETE USING (true);

-- Buy in requests policies
CREATE POLICY "Everyone can view buy-in requests" ON buy_in_requests FOR SELECT USING (true);
CREATE POLICY "Everyone can create buy-in requests" ON buy_in_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update buy-in requests" ON buy_in_requests FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete buy-in requests" ON buy_in_requests FOR DELETE USING (true);

-- Join requests policies
CREATE POLICY "Everyone can view join requests" ON join_requests FOR SELECT USING (true);
CREATE POLICY "Everyone can create join requests" ON join_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update join requests" ON join_requests FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete join requests" ON join_requests FOR DELETE USING (true);

-- Table endups policies
CREATE POLICY "Everyone can view table endups" ON table_endups FOR SELECT USING (true);
CREATE POLICY "Everyone can insert table endups" ON table_endups FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update table endups" ON table_endups FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete table endups" ON table_endups FOR DELETE USING (true);

-- Users table policies
CREATE POLICY "Everyone can view users" ON users FOR SELECT USING (true);
CREATE POLICY "Everyone can insert users" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update users" ON users FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete users" ON users FOR DELETE USING (true);

-- 14. Enable realtime for all tables
ALTER TABLE players REPLICA IDENTITY FULL;
ALTER TABLE poker_tables REPLICA IDENTITY FULL;
ALTER TABLE table_players REPLICA IDENTITY FULL;
ALTER TABLE buy_ins REPLICA IDENTITY FULL;
ALTER TABLE buy_in_requests REPLICA IDENTITY FULL;
ALTER TABLE join_requests REPLICA IDENTITY FULL;
ALTER TABLE table_endups REPLICA IDENTITY FULL;
ALTER TABLE users REPLICA IDENTITY FULL;

-- 15. Insert some sample data for testing (optional)
-- You can comment out this section if you don't want sample data
INSERT INTO players (id, name, avatar) VALUES 
  ('sample-player-1', 'Alice', null),
  ('sample-player-2', 'Bob', null),
  ('sample-player-3', 'Charlie', null);

-- 16. Grant necessary permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- 17. Verify the setup
DO $$
BEGIN
  RAISE NOTICE 'Database reset completed successfully!';
  RAISE NOTICE 'Tables created: players, poker_tables, table_players, buy_ins, buy_in_requests, join_requests, table_endups, users';
  RAISE NOTICE 'RLS policies created for anonymous access';
  RAISE NOTICE 'Realtime enabled for all tables';
  RAISE NOTICE 'Indexes created for performance';
END $$;

-- SIMPLE DROP AND RECREATE - NO TRIGGER MANIPULATION
-- This script will drop all tables and recreate them cleanly
-- WARNING: This will delete ALL data in your database!

-- 1. DROP ALL TABLES (CASCADE will handle dependencies)
DROP TABLE IF EXISTS table_endups CASCADE;
DROP TABLE IF EXISTS buy_ins CASCADE;
DROP TABLE IF EXISTS buy_in_requests CASCADE;
DROP TABLE IF EXISTS join_requests CASCADE;
DROP TABLE IF EXISTS table_players CASCADE;
DROP TABLE IF EXISTS poker_tables CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 2. DROP FUNCTIONS
DROP FUNCTION IF EXISTS create_anonymous_table(TEXT);

-- 3. CREATE THE PLAYERS TABLE (User Profiles)
CREATE TABLE players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. CREATE THE POKER_TABLES TABLE (Game Tables)
CREATE TABLE poker_tables (
    id TEXT PRIMARY KEY,
    name TEXT,
    join_code INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    admin_player_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. CREATE THE TABLE_PLAYERS TABLE (Players in Tables)
CREATE TABLE table_players (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    table_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. CREATE THE BUY_INS TABLE (Buy-in Transactions)
CREATE TABLE buy_ins (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    table_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. CREATE THE BUY_IN_REQUESTS TABLE (Buy-in Requests)
CREATE TABLE buy_in_requests (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    table_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. CREATE THE JOIN_REQUESTS TABLE (Join Requests)
CREATE TABLE join_requests (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    table_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    player_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. CREATE THE TABLE_ENDUPS TABLE (Final Amounts)
CREATE TABLE table_endups (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    table_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    endup DECIMAL(10,2) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. CREATE ALL FOREIGN KEY CONSTRAINTS
ALTER TABLE table_players 
    ADD CONSTRAINT fk_table_players_table_id 
    FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE CASCADE;

ALTER TABLE buy_ins 
    ADD CONSTRAINT fk_buy_ins_table_id 
    FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE CASCADE;

ALTER TABLE buy_in_requests 
    ADD CONSTRAINT fk_buy_in_requests_table_id 
    FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE CASCADE;

ALTER TABLE join_requests 
    ADD CONSTRAINT fk_join_requests_table_id 
    FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE CASCADE;

ALTER TABLE table_endups 
    ADD CONSTRAINT fk_table_endups_table_id 
    FOREIGN KEY (table_id) REFERENCES poker_tables(id) ON DELETE CASCADE;

-- 11. CREATE ALL INDEXES FOR PERFORMANCE
CREATE INDEX idx_poker_tables_join_code ON poker_tables(join_code);
CREATE INDEX idx_poker_tables_admin_player_id ON poker_tables(admin_player_id);
CREATE INDEX idx_poker_tables_status ON poker_tables(status);

CREATE INDEX idx_table_players_table_id ON table_players(table_id);
CREATE INDEX idx_table_players_player_id ON table_players(player_id);
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

-- 12. CREATE THE ANONYMOUS TABLE FUNCTION
CREATE OR REPLACE FUNCTION create_anonymous_table(table_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    table_id TEXT;
BEGIN
    table_id := gen_random_uuid()::TEXT;
    
    INSERT INTO poker_tables (id, name, join_code, status)
    VALUES (table_id, table_name, floor(random() * 9000 + 1000), 'active');
    
    RETURN table_id;
END;
$$;

-- 13. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE poker_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE buy_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE buy_in_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_endups ENABLE ROW LEVEL SECURITY;

-- 14. CREATE RLS POLICIES FOR ANONYMOUS ACCESS
-- Players table
CREATE POLICY "players_select_policy" ON players FOR SELECT USING (true);
CREATE POLICY "players_insert_policy" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "players_update_policy" ON players FOR UPDATE USING (true);
CREATE POLICY "players_delete_policy" ON players FOR DELETE USING (true);

-- Poker tables
CREATE POLICY "poker_tables_select_policy" ON poker_tables FOR SELECT USING (true);
CREATE POLICY "poker_tables_insert_policy" ON poker_tables FOR INSERT WITH CHECK (true);
CREATE POLICY "poker_tables_update_policy" ON poker_tables FOR UPDATE USING (true);
CREATE POLICY "poker_tables_delete_policy" ON poker_tables FOR DELETE USING (true);

-- Table players
CREATE POLICY "table_players_select_policy" ON table_players FOR SELECT USING (true);
CREATE POLICY "table_players_insert_policy" ON table_players FOR INSERT WITH CHECK (true);
CREATE POLICY "table_players_update_policy" ON table_players FOR UPDATE USING (true);
CREATE POLICY "table_players_delete_policy" ON table_players FOR DELETE USING (true);

-- Buy ins
CREATE POLICY "buy_ins_select_policy" ON buy_ins FOR SELECT USING (true);
CREATE POLICY "buy_ins_insert_policy" ON buy_ins FOR INSERT WITH CHECK (true);
CREATE POLICY "buy_ins_update_policy" ON buy_ins FOR UPDATE USING (true);
CREATE POLICY "buy_ins_delete_policy" ON buy_ins FOR DELETE USING (true);

-- Buy in requests
CREATE POLICY "buy_in_requests_select_policy" ON buy_in_requests FOR SELECT USING (true);
CREATE POLICY "buy_in_requests_insert_policy" ON buy_in_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "buy_in_requests_update_policy" ON buy_in_requests FOR UPDATE USING (true);
CREATE POLICY "buy_in_requests_delete_policy" ON buy_in_requests FOR DELETE USING (true);

-- Join requests
CREATE POLICY "join_requests_select_policy" ON join_requests FOR SELECT USING (true);
CREATE POLICY "join_requests_insert_policy" ON join_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "join_requests_update_policy" ON join_requests FOR UPDATE USING (true);
CREATE POLICY "join_requests_delete_policy" ON join_requests FOR DELETE USING (true);

-- Table endups
CREATE POLICY "table_endups_select_policy" ON table_endups FOR SELECT USING (true);
CREATE POLICY "table_endups_insert_policy" ON table_endups FOR INSERT WITH CHECK (true);
CREATE POLICY "table_endups_update_policy" ON table_endups FOR UPDATE USING (true);
CREATE POLICY "table_endups_delete_policy" ON table_endups FOR DELETE USING (true);

-- 15. ENABLE REALTIME FOR ALL TABLES
ALTER TABLE players REPLICA IDENTITY FULL;
ALTER TABLE poker_tables REPLICA IDENTITY FULL;
ALTER TABLE table_players REPLICA IDENTITY FULL;
ALTER TABLE buy_ins REPLICA IDENTITY FULL;
ALTER TABLE buy_in_requests REPLICA IDENTITY FULL;
ALTER TABLE join_requests REPLICA IDENTITY FULL;
ALTER TABLE table_endups REPLICA IDENTITY FULL;

-- 15. Ensure tables are added to Realtime publication
DO $$
BEGIN
  BEGIN
    CREATE PUBLICATION supabase_realtime;
  EXCEPTION WHEN duplicate_object THEN
    -- publication already exists
    NULL;
  END;
END $$;

-- Add all tables to the publication (idempotent)
ALTER PUBLICATION supabase_realtime SET TABLE
  players,
  poker_tables,
  table_players,
  buy_ins,
  buy_in_requests,
  join_requests,
  table_endups;

-- 16. GRANT ALL PERMISSIONS
GRANT ALL ON SCHEMA public TO anon;
GRANT ALL ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- 17. INSERT SAMPLE DATA FOR TESTING
INSERT INTO players (id, name, avatar) VALUES 
    ('sample-player-1', 'Alice', null),
    ('sample-player-2', 'Bob', null),
    ('sample-player-3', 'Charlie', null);

-- 18. VERIFY THE SETUP
DO $$
BEGIN
    RAISE NOTICE '=== SIMPLE DROP AND RECREATE COMPLETED ===';
    RAISE NOTICE 'Tables created: players, poker_tables, table_players, buy_ins, buy_in_requests, join_requests, table_endups';
    RAISE NOTICE 'All foreign keys created';
    RAISE NOTICE 'All indexes created';
    RAISE NOTICE 'All RLS policies created';
    RAISE NOTICE 'Realtime enabled for all tables';
    RAISE NOTICE 'All permissions granted';
    RAISE NOTICE 'Sample data inserted';
    RAISE NOTICE '=== READY TO USE ===';
END $$;

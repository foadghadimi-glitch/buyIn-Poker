-- Remove authentication requirements and allow anonymous access
-- Update RLS policies to allow everyone to read/write

-- Update poker_tables policies
DROP POLICY IF EXISTS "Everyone can view all tables" ON poker_tables;
DROP POLICY IF EXISTS "Everyone can create tables" ON poker_tables;
DROP POLICY IF EXISTS "Table admin can update tables" ON poker_tables;

CREATE POLICY "Everyone can view tables" ON poker_tables FOR SELECT USING (true);
CREATE POLICY "Everyone can create tables" ON poker_tables FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update tables" ON poker_tables FOR UPDATE USING (true);

-- Update buy_in_requests policies
DROP POLICY IF EXISTS "Everyone can view buy-in requests" ON buy_in_requests;
DROP POLICY IF EXISTS "Users can create buy-in requests" ON buy_in_requests;

CREATE POLICY "Everyone can view buy-in requests" ON buy_in_requests FOR SELECT USING (true);
CREATE POLICY "Everyone can create buy-in requests" ON buy_in_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update buy-in requests" ON buy_in_requests FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete buy-in requests" ON buy_in_requests FOR DELETE USING (true);

-- Update buy_ins policies
DROP POLICY IF EXISTS "Everyone can view buy-ins" ON buy_ins;

CREATE POLICY "Everyone can view buy-ins" ON buy_ins FOR SELECT USING (true);
CREATE POLICY "Everyone can insert buy-ins" ON buy_ins FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update buy-ins" ON buy_ins FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete buy-ins" ON buy_ins FOR DELETE USING (true);

-- Update join_requests policies
DROP POLICY IF EXISTS "Everyone can view join requests" ON join_requests;
DROP POLICY IF EXISTS "Users can create join requests" ON join_requests;

CREATE POLICY "Everyone can view join requests" ON join_requests FOR SELECT USING (true);
CREATE POLICY "Everyone can create join requests" ON join_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update join requests" ON join_requests FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete join requests" ON join_requests FOR DELETE USING (true);

-- Update table_endups policies
DROP POLICY IF EXISTS "Everyone can view table endups" ON table_endups;

CREATE POLICY "Everyone can view table endups" ON table_endups FOR SELECT USING (true);
CREATE POLICY "Everyone can insert table endups" ON table_endups FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update table endups" ON table_endups For UPDATE USING (true);
CREATE POLICY "Everyone can delete table endups" ON table_endups FOR DELETE USING (true);

-- Update table_players policies
DROP POLICY IF EXISTS "Everyone can view table players" ON table_players;
DROP POLICY IF EXISTS "Users can join tables" ON table_players;

CREATE POLICY "Everyone can view table players" ON table_players FOR SELECT USING (true);
CREATE POLICY "Everyone can insert table players" ON table_players FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update table players" ON table_players FOR UPDATE USING (true);
CREATE POLICY "Everyone can delete table players" ON table_players FOR DELETE USING (true);

-- Update users policies
DROP POLICY IF EXISTS "Users are viewable by everyone" ON users;
DROP POLICY IF EXISTS "Users can insert their own profile" ON users;
DROP POLICY IF EXISTS "Users can update their own profile" ON users;

CREATE POLICY "Everyone can view users" ON users FOR SELECT USING (true);
CREATE POLICY "Everyone can insert users" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can update users" ON users For UPDATE USING (true);
CREATE POLICY "Everyone can delete users" ON users FOR DELETE USING (true);

-- Enable realtime for tables (skip if already enabled)
ALTER TABLE buy_in_requests REPLICA IDENTITY FULL;
ALTER TABLE buy_ins REPLICA IDENTITY FULL;
ALTER TABLE join_requests REPLICA IDENTITY FULL;
ALTER TABLE table_endups REPLICA IDENTITY FULL;
ALTER TABLE table_players REPLICA IDENTITY FULL;
ALTER TABLE users REPLICA IDENTITY FULL;

-- Add original_admin_id column to track the original admin of each table
ALTER TABLE poker_tables ADD COLUMN IF NOT EXISTS original_admin_id TEXT;
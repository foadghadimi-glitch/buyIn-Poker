-- =====================================================================
-- FULL RESET (no-auth version). Run only in dev.
-- =====================================================================

-- Extensions (uuid)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- DROP (order matters due to FKs)
-- =====================================================================
DROP TABLE IF EXISTS public.game_profits CASCADE;
DROP TABLE IF EXISTS public.games CASCADE;
DROP TABLE IF EXISTS public.buy_ins CASCADE;
DROP TABLE IF EXISTS public.buy_in_requests CASCADE;
DROP TABLE IF EXISTS public.join_requests CASCADE;
DROP TABLE IF EXISTS public.table_players CASCADE;
DROP TABLE IF EXISTS public.poker_tables CASCADE;
DROP TABLE IF EXISTS public.players CASCADE;

-- =====================================================================
-- TABLES
-- =====================================================================

-- Players (decoupled from auth.users)
CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  avatar text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.poker_tables (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  join_code integer NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  admin_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.table_players (
  id bigserial PRIMARY KEY,
  table_id uuid NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_players_table_id_player_id_key UNIQUE (table_id, player_id)
);

-- Join requests (only pending rows ever stored; approved = row removed)
CREATE TABLE public.join_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_id uuid NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Buy-in requests (pending until approved -> moved to buy_ins then deleted)
CREATE TABLE public.buy_in_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_id uuid NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Approved buy-ins (immutable ledger)
CREATE TABLE public.buy_ins (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_id uuid NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);

-- Games table - tracks individual games within a table
CREATE TABLE public.games (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_id uuid NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  game_number integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT games_table_game_number_unique UNIQUE (table_id, game_number)
);

-- Game profits table - tracks profit per player per game
CREATE TABLE public.game_profits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_id uuid NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  profit numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_profits_table_game_player_unique UNIQUE (table_id, game_id, player_id)
);

-- === NEW: Helper function to check active table membership (used in RLS) ===
CREATE OR REPLACE FUNCTION public.is_member_of_table(p_player_id uuid, p_table_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.table_players tp
    WHERE tp.table_id = p_table_id
      AND tp.player_id = p_player_id
      AND tp.status = 'active'
  );
END;
$$;

-- === Add broader membership helper (any status) ===
CREATE OR REPLACE FUNCTION public.is_participant_of_table(p_player_id uuid, p_table_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.table_players tp
    WHERE tp.table_id = p_table_id
      AND tp.player_id = p_player_id
      -- any status (active or inactive) qualifies
  );
END;
$$;

-- === Aggregated totals function (bypasses row filtering) ===
CREATE OR REPLACE FUNCTION public.get_table_totals(p_table_id uuid)
RETURNS TABLE (player_id uuid, total_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Removed auth.uid() membership gate (front-end already restricts context).
  RETURN QUERY
    SELECT b.player_id, SUM(b.amount)::numeric AS total_amount
    FROM public.buy_ins b
    WHERE b.table_id = p_table_id
    GROUP BY b.player_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_table_totals(uuid) TO authenticated;
-- (optional) GRANT EXECUTE ON FUNCTION public.get_table_totals(uuid) TO anon;

-- =====================================================================
-- INDEXES
-- =====================================================================
CREATE INDEX idx_table_players_table ON public.table_players(table_id);
CREATE INDEX idx_table_players_player ON public.table_players(player_id);

CREATE INDEX idx_join_requests_table_status ON public.join_requests(table_id, status);
CREATE INDEX idx_buy_in_requests_table_status ON public.buy_in_requests(table_id, status);

CREATE INDEX idx_buy_ins_table ON public.buy_ins(table_id);
CREATE INDEX idx_buy_ins_player ON public.buy_ins(player_id);

CREATE INDEX idx_games_table ON public.games(table_id);
CREATE INDEX idx_games_status ON public.games(status);
CREATE INDEX idx_game_profits_table ON public.game_profits(table_id);
CREATE INDEX idx_game_profits_game ON public.game_profits(game_id);
CREATE INDEX idx_game_profits_player ON public.game_profits(player_id);

-- =====================================================================
-- TIMESTAMP UPDATE TRIGGERS
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_players_updated_at
BEFORE UPDATE ON public.players
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_poker_tables_updated_at
BEFORE UPDATE ON public.poker_tables
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_table_players_updated_at
BEFORE UPDATE ON public.table_players
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_games_updated_at
BEFORE UPDATE ON public.games
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- AUTO-CREATE GAME 1 WHEN TABLE IS CREATED
-- =====================================================================

-- Function to create Game 1 when a table is created
CREATE OR REPLACE FUNCTION public.create_initial_game()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_game_id uuid := uuid_generate_v4();
BEGIN
  -- Create Game 1 for the new table
  INSERT INTO public.games (id, table_id, game_number, status)
  VALUES (v_game_id, NEW.id, 1, 'active');
  
  RETURN NEW;
END;
$$;

-- Trigger to auto-create Game 1 when a table is created
CREATE TRIGGER trg_create_initial_game
AFTER INSERT ON public.poker_tables
FOR EACH ROW
EXECUTE FUNCTION public.create_initial_game();

-- =====================================================================
-- RLS ENABLE
-- =====================================================================
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poker_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buy_in_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buy_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_profits ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- POLICIES
-- =====================================================================

-- Drop all existing policies to ensure clean state
DROP POLICY IF EXISTS pl_players_select ON public.players;
DROP POLICY IF EXISTS pl_players_insert ON public.players;
DROP POLICY IF EXISTS pl_players_update ON public.players;
DROP POLICY IF EXISTS pl_tables_select ON public.poker_tables;
DROP POLICY IF EXISTS pl_tables_insert ON public.poker_tables;
DROP POLICY IF EXISTS pl_tables_update ON public.poker_tables;
DROP POLICY IF EXISTS pl_tp_select ON public.table_players;
DROP POLICY IF EXISTS pl_tp_insert ON public.table_players;
DROP POLICY IF EXISTS pl_tp_update ON public.table_players;
DROP POLICY IF EXISTS pl_jr_select ON public.join_requests;
DROP POLICY IF EXISTS pl_jr_insert ON public.join_requests;
DROP POLICY IF EXISTS pl_jr_delete ON public.join_requests;
DROP POLICY IF EXISTS pl_bir_select ON public.buy_in_requests;
DROP POLICY IF EXISTS pl_bir_insert ON public.buy_in_requests;
DROP POLICY IF EXISTS pl_bir_delete ON public.buy_in_requests;
DROP POLICY IF EXISTS "Allow users to see their own join requests" ON public.join_requests;
DROP POLICY IF EXISTS "Allow users to create join requests" ON public.join_requests;
DROP POLICY IF EXISTS "Allow admin to delete join requests for their table" ON public.join_requests;
DROP POLICY IF EXISTS "Allow admin to see buy-in requests for their table" ON public.buy_in_requests;
DROP POLICY IF EXISTS "Allow users to see their own buy-in requests" ON public.buy_in_requests;
DROP POLICY IF EXISTS "Allow users to create buy-in requests" ON public.buy_in_requests;
DROP POLICY IF EXISTS "Allow admin to delete buy-in requests for their table" ON public.buy_in_requests;
DROP POLICY IF EXISTS "buy_ins_select_all" ON public.buy_ins;
DROP POLICY IF EXISTS "block direct inserts into buy_ins (use approve_buy_in)" ON public.buy_ins;
DROP POLICY IF EXISTS end_ups_select_all ON public.end_ups;
DROP POLICY IF EXISTS end_ups_manage_all ON public.end_ups;
DROP POLICY IF EXISTS games_select_all ON public.games;
DROP POLICY IF EXISTS games_insert_all ON public.games;
DROP POLICY IF EXISTS games_update_all ON public.games;
DROP POLICY IF EXISTS game_profits_select_all ON public.game_profits;
DROP POLICY IF EXISTS game_profits_insert_all ON public.game_profits;
DROP POLICY IF EXISTS game_profits_update_all ON public.game_profits;

-- Public (no-auth) policies: broad access (client enforces intent)
-- Players
CREATE POLICY pl_players_select ON public.players FOR SELECT USING (true);
CREATE POLICY pl_players_insert ON public.players FOR INSERT WITH CHECK (true);
CREATE POLICY pl_players_update ON public.players FOR UPDATE USING (true) WITH CHECK (true);

-- Poker tables
CREATE POLICY pl_tables_select ON public.poker_tables FOR SELECT USING (true);
CREATE POLICY pl_tables_insert ON public.poker_tables FOR INSERT WITH CHECK (true);
CREATE POLICY pl_tables_update ON public.poker_tables FOR UPDATE USING (true) WITH CHECK (true);

-- Table players
CREATE POLICY pl_tp_select ON public.table_players FOR SELECT USING (true);
CREATE POLICY pl_tp_insert ON public.table_players FOR INSERT WITH CHECK (true);
CREATE POLICY pl_tp_update ON public.table_players FOR UPDATE USING (true) WITH CHECK (true);

-- Join requests
CREATE POLICY pl_jr_select ON public.join_requests FOR SELECT USING (true);
CREATE POLICY pl_jr_insert ON public.join_requests FOR INSERT WITH CHECK (true);
CREATE POLICY pl_jr_delete ON public.join_requests FOR DELETE USING (true);

-- Buy-in requests
CREATE POLICY pl_bir_select ON public.buy_in_requests FOR SELECT USING (true);
CREATE POLICY pl_bir_insert ON public.buy_in_requests FOR INSERT WITH CHECK (true);
CREATE POLICY pl_bir_delete ON public.buy_in_requests FOR DELETE USING (true);

-- Buy-ins policies

CREATE POLICY "Allow active table members to see table buy-ins" ON public.buy_ins
  FOR SELECT USING (
    public.is_member_of_table((SELECT auth.uid()), table_id)
  );

CREATE POLICY "Allow admin to insert buy-ins for their table" ON public.buy_ins
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.poker_tables pt
      WHERE pt.id = buy_ins.table_id
        AND pt.admin_player_id = (SELECT auth.uid())
    )
  );

-- Authentication-based policies
CREATE POLICY "Allow users to see their own join requests" ON public.join_requests
  FOR SELECT USING ((SELECT auth.uid()) = player_id);

CREATE POLICY "Allow users to create join requests" ON public.join_requests
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = player_id);

CREATE POLICY "Allow admin to delete join requests for their table" ON public.join_requests
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.poker_tables pt
      WHERE pt.id = join_requests.table_id
        AND pt.admin_player_id = (SELECT auth.uid())
    )
  );

-- buy_in_requests
CREATE POLICY "Allow admin to see buy-in requests for their table" ON public.buy_in_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.poker_tables pt
      WHERE pt.id = buy_in_requests.table_id
        AND pt.admin_player_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Allow users to see their own buy-in requests" ON public.buy_in_requests
  FOR SELECT USING ((SELECT auth.uid()) = player_id);

CREATE POLICY "Allow users to create buy-in requests" ON public.buy_in_requests
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = player_id);

CREATE POLICY "Allow admin to delete buy-in requests for their table" ON public.buy_in_requests
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.poker_tables pt
      WHERE pt.id = buy_in_requests.table_id
        AND pt.admin_player_id = (SELECT auth.uid())
    )
  );

-- ===== Replace/upgrade buy_ins SELECT policy to include inactive participants =====

CREATE POLICY "Allow table participants (any status) to see table buy-ins"
ON public.buy_ins
FOR SELECT
USING (
  public.is_participant_of_table((SELECT auth.uid()), table_id)
);

-- (keep existing INSERT policy for admin unchanged)

-- === Secure approval function (bypasses mismatch between auth.uid() and players.id) ===
-- (Replaced to add extensions in search_path so uuid_generate_v4 is found)
CREATE OR REPLACE FUNCTION public.approve_buy_in(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp  -- added 'extensions'
AS $$
DECLARE
  v_req public.buy_in_requests%ROWTYPE;
  v_new_id uuid := uuid_generate_v4();
BEGIN
  SELECT * INTO v_req
  FROM public.buy_in_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buy-in request % not found', p_request_id;
  END IF;

  -- (Optional future hardening: verify caller is table admin once auth -> players mapping exists)

  INSERT INTO public.buy_ins(id, table_id, player_id, amount, timestamp)
  VALUES (v_new_id, v_req.table_id, v_req.player_id, v_req.amount, now());

  DELETE FROM public.buy_in_requests WHERE id = p_request_id;

  RETURN v_new_id;
END;
$$;

-- keep existing grant (re-issuing is safe / idempotent)
GRANT EXECUTE ON FUNCTION public.approve_buy_in(uuid) TO authenticated;

-- =====================================================================
-- GAME MANAGEMENT FUNCTIONS
-- =====================================================================

-- Drop existing functions to ensure clean state
DROP FUNCTION IF EXISTS public.create_new_game(uuid);
DROP FUNCTION IF EXISTS public.end_game_and_calculate_profits(uuid);
DROP FUNCTION IF EXISTS public.reset_table_for_new_game(uuid);

-- Create a new game for a table
CREATE OR REPLACE FUNCTION public.create_new_game(p_table_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_next_game_number integer;
  v_new_game_id uuid := uuid_generate_v4();
BEGIN
  -- Get the next game number for this table
  SELECT COALESCE(MAX(game_number), 0) + 1 INTO v_next_game_number
  FROM public.games
  WHERE table_id = p_table_id;
  
  -- Create the new game
  INSERT INTO public.games (id, table_id, game_number, status)
  VALUES (v_new_game_id, p_table_id, v_next_game_number, 'active');
  
  RETURN v_new_game_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_new_game(uuid) TO authenticated;

-- End current game and calculate profits
CREATE OR REPLACE FUNCTION public.end_game_and_calculate_profits(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_game_record public.games%ROWTYPE;
  v_table_id uuid;
  v_player_record RECORD;
  v_total_buy_ins numeric;
  v_end_up_value numeric;
  v_profit numeric;
BEGIN
  -- Get game details
  SELECT * INTO v_game_record
  FROM public.games
  WHERE id = p_game_id AND status = 'active';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active game % not found', p_game_id;
  END IF;
  
  v_table_id := v_game_record.table_id;
  
  -- Calculate profits for each player
  FOR v_player_record IN
    SELECT DISTINCT tp.player_id
    FROM public.table_players tp
    WHERE tp.table_id = v_table_id AND tp.status = 'active'
  LOOP
    -- Get total buy-ins for this player
    SELECT COALESCE(SUM(amount), 0) INTO v_total_buy_ins
    FROM public.buy_ins
    WHERE table_id = v_table_id AND player_id = v_player_record.player_id;
    
    -- Get end-up value for this player
    SELECT COALESCE(value, 0) INTO v_end_up_value
    FROM public.end_ups
    WHERE table_id = v_table_id AND player_id = v_player_record.player_id;
    
    -- Calculate profit (end_up - total_buy_ins)
    v_profit := v_end_up_value - v_total_buy_ins;
    
    -- Insert profit record
    INSERT INTO public.game_profits (table_id, game_id, player_id, profit)
    VALUES (v_table_id, p_game_id, v_player_record.player_id, v_profit)
    ON CONFLICT (table_id, game_id, player_id)
    DO UPDATE SET profit = EXCLUDED.profit;
  END LOOP;
  
  -- Mark game as completed
  UPDATE public.games
  SET status = 'completed', updated_at = now()
  WHERE id = p_game_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.end_game_and_calculate_profits(uuid) TO authenticated;

-- Reset table for new game (clear buy-ins and end-ups)
CREATE OR REPLACE FUNCTION public.reset_table_for_new_game(p_table_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Delete all buy-ins for this table
  DELETE FROM public.buy_ins WHERE table_id = p_table_id;
  
  -- Delete all end-ups for this table
  DELETE FROM public.end_ups WHERE table_id = p_table_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_table_for_new_game(uuid) TO authenticated;

-- Replace previous direct insert policy (enforce RPC usage)

CREATE POLICY "block direct inserts into buy_ins (use approve_buy_in)"
ON public.buy_ins
FOR INSERT
WITH CHECK (false);

-- UPDATE: simplify SELECT policy (remove auth.uid() mismatch); allow read-all (dev / no-auth mode).
CREATE POLICY "buy_ins_select_all" ON public.buy_ins
  FOR SELECT USING (true);

-- keep insert blocked (enforced via RPC approve_buy_in)

-- =====================================================================
-- END UPS: store the admin-provided "end up" values per player per table.
--
-- Columns:
--   - id: uuid primary key
--   - table_id: references poker_tables.id
--   - player_id: references players.id
--   - value: numeric (stored as numeric so totals/averages work)
--   - created_at, updated_at: timestamps
--   - unique(table_id, player_id) so upserts are simple
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.end_ups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  table_id uuid NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  value numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure a single row per (table, player)
CREATE UNIQUE INDEX IF NOT EXISTS end_ups_table_player_idx ON public.end_ups (table_id, player_id);

-- keep updated_at current on changes
CREATE OR REPLACE FUNCTION public.end_ups_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_end_ups_updated_at ON public.end_ups;
CREATE TRIGGER trg_end_ups_updated_at
BEFORE UPDATE ON public.end_ups
FOR EACH ROW
EXECUTE PROCEDURE public.end_ups_set_updated_at();

/*
  OPTIONAL: convenience upsert function that enforces "only table admin can set values".
  If you prefer to rely on RLS policies instead, skip this function and add policies below.
  Note: this function uses auth.uid() available in Postgres contexts when called from
  a Supabase client with a valid JWT. Marking SECURITY DEFINER allows the function to
  execute with the function owner's privileges — only enable if you understand the
  security implications and set proper owner/role.

  Usage from app (recommended): call this RPC instead of direct upsert.
    SELECT upsert_end_up(p_table_id := '...', p_player_id := '...', p_value := 30.52);
*/

-- CREATE OR REPLACE FUNCTION public.upsert_end_up(p_table_id uuid, p_player_id uuid, p_value numeric)
-- RETURNS void
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM public.poker_tables
--     WHERE id = p_table_id
--       AND admin_player_id = auth.uid()::uuid
--   ) THEN
--     INSERT INTO public.end_ups (table_id, player_id, value, updated_at)
--     VALUES (p_table_id, p_player_id, p_value, now())
--     ON CONFLICT (table_id, player_id)
--     DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--   ELSE
--     RAISE EXCEPTION 'only the table admin may set end_up values';
--   END IF;
-- END;
-- $$;

-- === REPLACE end_ups RLS POLICIES (use ONLY if you accept anonymous writes) ===
-- WARNING: This removes DB enforcement of "only admin may write". Any client can modify end_ups.
ALTER TABLE public.end_ups ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read end_up values
CREATE POLICY end_ups_select_all ON public.end_ups
  FOR SELECT USING (true);

-- Allow anyone to insert/update/delete end_up rows (UNSAFE)
CREATE POLICY end_ups_manage_all ON public.end_ups
  FOR ALL USING (true) WITH CHECK (true);

-- =====================================================================
-- GAMES AND GAME_PROFITS POLICIES
-- =====================================================================

-- Games policies - allow all operations for now (dev mode)
CREATE POLICY games_select_all ON public.games FOR SELECT USING (true);
CREATE POLICY games_insert_all ON public.games FOR INSERT WITH CHECK (true);
CREATE POLICY games_update_all ON public.games FOR UPDATE USING (true) WITH CHECK (true);

-- Game profits policies - allow all operations for now (dev mode)
CREATE POLICY game_profits_select_all ON public.game_profits FOR SELECT USING (true);
CREATE POLICY game_profits_insert_all ON public.game_profits FOR INSERT WITH CHECK (true);
CREATE POLICY game_profits_update_all ON public.game_profits FOR UPDATE USING (true) WITH CHECK (true);
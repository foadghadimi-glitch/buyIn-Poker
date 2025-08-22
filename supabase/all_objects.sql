-- =====================================================================
-- FULL RESET (no-auth version). Run only in dev.
-- =====================================================================

-- Extensions (uuid)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- DROP (order matters due to FKs)
-- =====================================================================
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

-- =====================================================================
-- RLS ENABLE
-- =====================================================================
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poker_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buy_in_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buy_ins ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- POLICIES
-- =====================================================================

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

-- Buy-ins (policies reset + recreated idempotently)
DROP POLICY IF EXISTS pl_bi_select ON public.buy_ins;
DROP POLICY IF EXISTS pl_bi_insert ON public.buy_ins;
DROP POLICY IF EXISTS "Allow players in a table to see all buy-ins for that table" ON public.buy_ins;
DROP POLICY IF EXISTS "Allow active table members to see table buy-ins" ON public.buy_ins;
DROP POLICY IF EXISTS "Allow admin to insert buy-ins for their table" ON public.buy_ins;

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
DROP POLICY IF EXISTS "Allow active table members to see table buy-ins" ON public.buy_ins;
DROP POLICY IF EXISTS "Allow table participants (any status) to see table buy-ins" ON public.buy_ins;

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

-- Replace previous direct insert policy (enforce RPC usage)
DROP POLICY IF EXISTS "Allow admin to insert buy-ins for their table" ON public.buy_ins;
DROP POLICY IF EXISTS "block direct inserts into buy_ins (use approve_buy_in)" ON public.buy_ins;

CREATE POLICY "block direct inserts into buy_ins (use approve_buy_in)"
ON public.buy_ins
FOR INSERT
WITH CHECK (false);

-- UPDATE: simplify SELECT policy (remove auth.uid() mismatch); allow read-all (dev / no-auth mode).
DROP POLICY IF EXISTS "Allow table participants (any status) to see table buy-ins" ON public.buy_ins;
CREATE POLICY "buy_ins_select_all" ON public.buy_ins
  FOR SELECT USING (true);

-- keep insert blocked (enforced via RPC approve_buy_in)
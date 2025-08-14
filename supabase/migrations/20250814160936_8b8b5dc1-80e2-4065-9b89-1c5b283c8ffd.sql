-- Allow anonymous usage: relax constraints and RLS to not require auth

-- 1) Make admin_user_id optional to support no-auth table creation
ALTER TABLE public.poker_tables ALTER COLUMN admin_user_id DROP NOT NULL;

-- 2) Update RLS policies to allow anonymous access
-- Poker tables
DROP POLICY IF EXISTS "Admins can delete their tables" ON public.poker_tables;
DROP POLICY IF EXISTS "Admins can insert their tables" ON public.poker_tables;
DROP POLICY IF EXISTS "Admins can update their tables" ON public.poker_tables;
DROP POLICY IF EXISTS "Admins can view their tables" ON public.poker_tables;

CREATE POLICY "Anyone can view tables"
  ON public.poker_tables
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert tables"
  ON public.poker_tables
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update tables"
  ON public.poker_tables
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete tables"
  ON public.poker_tables
  FOR DELETE
  USING (true);

-- Table players
DROP POLICY IF EXISTS "Admins can manage players for their tables" ON public.table_players;
DROP POLICY IF EXISTS "Admins can view players for their tables" ON public.table_players;

CREATE POLICY "Anyone can view players"
  ON public.table_players
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can manage players"
  ON public.table_players
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Buy-in requests
DROP POLICY IF EXISTS "Admins can manage requests for their tables" ON public.buy_in_requests;
DROP POLICY IF EXISTS "Admins can view requests for their tables" ON public.buy_in_requests;

CREATE POLICY "Anyone can view requests"
  ON public.buy_in_requests
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can manage requests"
  ON public.buy_in_requests
  FOR ALL
  USING (true)
  WITH CHECK (true);

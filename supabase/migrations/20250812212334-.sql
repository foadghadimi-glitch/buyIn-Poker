-- Enums
CREATE TYPE public.table_status AS ENUM ('active', 'ended');
CREATE TYPE public.buy_in_request_status AS ENUM ('pending', 'approved', 'rejected');

-- Timestamp update helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Poker tables
CREATE TABLE public.poker_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  join_code TEXT NOT NULL UNIQUE,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.table_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_poker_tables_updated_at
BEFORE UPDATE ON public.poker_tables
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Players within a table (not global users)
CREATE TABLE public.table_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  total_buy_ins NUMERIC(12,2) NOT NULL DEFAULT 0,
  final_amount NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_table_players_table_id ON public.table_players(table_id);

-- Buy-in requests
CREATE TABLE public.buy_in_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES public.poker_tables(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.table_players(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  status public.buy_in_request_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

CREATE INDEX idx_buy_in_requests_table_id ON public.buy_in_requests(table_id);
CREATE INDEX idx_buy_in_requests_player_id ON public.buy_in_requests(player_id);

-- Basic validation
ALTER TABLE public.buy_in_requests
  ADD CONSTRAINT chk_buy_in_requests_amount_positive CHECK (amount > 0);

-- Enable RLS
ALTER TABLE public.poker_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buy_in_requests ENABLE ROW LEVEL SECURITY;

-- Policies: only the admin (creator) of a table can manage its data
-- poker_tables
CREATE POLICY "Admins can view their tables"
ON public.poker_tables
FOR SELECT
TO authenticated
USING (admin_user_id = auth.uid());

CREATE POLICY "Admins can insert their tables"
ON public.poker_tables
FOR INSERT
TO authenticated
WITH CHECK (admin_user_id = auth.uid());

CREATE POLICY "Admins can update their tables"
ON public.poker_tables
FOR UPDATE
TO authenticated
USING (admin_user_id = auth.uid());

CREATE POLICY "Admins can delete their tables"
ON public.poker_tables
FOR DELETE
TO authenticated
USING (admin_user_id = auth.uid());

-- table_players
CREATE POLICY "Admins can view players for their tables"
ON public.table_players
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.poker_tables t
  WHERE t.id = table_players.table_id
    AND t.admin_user_id = auth.uid()
));

CREATE POLICY "Admins can manage players for their tables"
ON public.table_players
FOR ALL
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.poker_tables t
  WHERE t.id = table_players.table_id
    AND t.admin_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.poker_tables t
  WHERE t.id = table_players.table_id
    AND t.admin_user_id = auth.uid()
));

-- buy_in_requests
CREATE POLICY "Admins can view requests for their tables"
ON public.buy_in_requests
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.poker_tables t
  WHERE t.id = buy_in_requests.table_id
    AND t.admin_user_id = auth.uid()
));

CREATE POLICY "Admins can manage requests for their tables"
ON public.buy_in_requests
FOR ALL
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.poker_tables t
  WHERE t.id = buy_in_requests.table_id
    AND t.admin_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.poker_tables t
  WHERE t.id = buy_in_requests.table_id
    AND t.admin_user_id = auth.uid()
));
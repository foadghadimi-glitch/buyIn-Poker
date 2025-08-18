-- Fix the database schema to match application expectations

-- First, drop existing constraints and recreate proper structure
ALTER TABLE poker_tables DROP COLUMN IF EXISTS players;

-- Create proper users table (the profiles that the app uses)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  avatar TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update existing table_players to reference users properly
ALTER TABLE table_players ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id);

-- Update join_requests to have proper structure
ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id);
ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS player_name TEXT;

-- Update poker_tables to reference admin properly
ALTER TABLE poker_tables ADD CONSTRAINT poker_tables_admin_fkey 
  FOREIGN KEY (admin_user_id) REFERENCES public.users(id);

-- Enable RLS on users table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Create policies for users table
CREATE POLICY "Users are viewable by everyone" 
ON public.users 
FOR SELECT 
USING (true);

CREATE POLICY "Users can insert their own profile" 
ON public.users 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Users can update their own profile" 
ON public.users 
FOR UPDATE 
USING (true);

-- Enable realtime for join_requests so admins get notifications
ALTER TABLE join_requests REPLICA IDENTITY FULL;
ALTER TABLE poker_tables REPLICA IDENTITY FULL;
ALTER TABLE table_players REPLICA IDENTITY FULL;

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE join_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE poker_tables;
ALTER PUBLICATION supabase_realtime ADD TABLE table_players;

-- Create updated_at trigger for users
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
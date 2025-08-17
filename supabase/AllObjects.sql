
DROP TABLE IF EXISTS table_join_requests;

CREATE TABLE table_join_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  table_id text NOT NULL,
  player_id text NOT NULL,
  player_name text NOT NULL,
  avatar_url text,
  status text NOT NULL
);
-- Poker Table App: Full Schema Setup
-- Run this script to create all required tables and attributes for the app

-- ENUMS
CREATE TYPE buy_in_request_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE table_status AS ENUM ('open', 'closed', 'in_progress');

-- USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- POKER TABLES
CREATE TABLE IF NOT EXISTS poker_tables (
  id UUID PRIMARY KEY,
  name TEXT,
  join_code TEXT UNIQUE,
  admin_user_id UUID REFERENCES users(id),
  status table_status DEFAULT 'open',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- TABLE PLAYERS
CREATE TABLE IF NOT EXISTS table_players (
  id UUID PRIMARY KEY,
  table_id UUID REFERENCES poker_tables(id),
  user_id UUID REFERENCES users(id),
  joined_at TIMESTAMP DEFAULT NOW()
);

-- JOIN REQUESTS
CREATE TABLE IF NOT EXISTS join_requests (
  id UUID PRIMARY KEY,
  table_id UUID REFERENCES poker_tables(id),
  player_id UUID REFERENCES table_players(id),
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- BUY IN REQUESTS
CREATE TABLE IF NOT EXISTS buy_in_requests (
  id UUID PRIMARY KEY,
  table_id UUID REFERENCES poker_tables(id),
  player_id UUID REFERENCES table_players(id),
  amount NUMERIC NOT NULL,
  status buy_in_request_status DEFAULT 'pending',
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- BUY INS
CREATE TABLE IF NOT EXISTS buy_ins (
  id UUID PRIMARY KEY,
  table_id UUID REFERENCES poker_tables(id),
  player_id UUID REFERENCES table_players(id),
  amount NUMERIC NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- TABLE ENDUPS
CREATE TABLE IF NOT EXISTS table_endups (
  id UUID PRIMARY KEY,
  table_id UUID REFERENCES poker_tables(id),
  player_id UUID REFERENCES table_players(id),
  chips NUMERIC,
  created_at TIMESTAMP DEFAULT NOW()
);

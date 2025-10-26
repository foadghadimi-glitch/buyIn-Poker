-- Safe migration: Add game_number to game_profits without data loss

-- 1. Add game_number column if it doesn't exist
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'game_profits' 
        AND column_name = 'game_number'
    ) THEN
        ALTER TABLE public.game_profits 
        ADD COLUMN game_number integer;
    END IF;
END $$;

-- 2. Populate game_number from games table for existing rows
UPDATE public.game_profits gp
SET game_number = g.game_number
FROM public.games g
WHERE gp.game_id = g.id
AND gp.game_number IS NULL;

-- 3. Make game_number NOT NULL after populating
ALTER TABLE public.game_profits 
ALTER COLUMN game_number SET NOT NULL;

-- 4. Add index for game_number queries if it doesn't exist
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_game_profits_game_number'
    ) THEN
        CREATE INDEX idx_game_profits_game_number 
        ON public.game_profits(table_id, game_number);
    END IF;
END $$;

-- 5. Update end_game_and_calculate_profits function to include game_number
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
  -- Get game details including game_number
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
    WHERE tp.table_id = v_table_id
  LOOP
    -- Get total buy-ins for this player
    SELECT COALESCE(SUM(amount), 0) INTO v_total_buy_ins
    FROM public.buy_ins
    WHERE table_id = v_table_id AND player_id = v_player_record.player_id;
    
    -- Get end-up value for this player
    SELECT COALESCE(value, 0) INTO v_end_up_value
    FROM public.end_ups
    WHERE table_id = v_table_id AND player_id = v_player_record.player_id;
    
    -- Calculate profit (end_up - total_buy_ins) / 7
    v_profit := (v_end_up_value - v_total_buy_ins) / 7;
    
    -- Insert profit record with game_number
    INSERT INTO public.game_profits (
      table_id, 
      game_id, 
      game_number,
      player_id, 
      profit
    )
    VALUES (
      v_table_id, 
      p_game_id, 
      v_game_record.game_number,
      v_player_record.player_id, 
      v_profit
    )
    ON CONFLICT (table_id, game_id, player_id)
    DO UPDATE SET 
      profit = EXCLUDED.profit,
      game_number = v_game_record.game_number;
  END LOOP;
  
  -- Mark game as completed
  UPDATE public.games
  SET status = 'completed', updated_at = now()
  WHERE id = p_game_id;
END;
$$;

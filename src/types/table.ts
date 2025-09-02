import { PokerTable as SupabasePokerTable, Player } from '@/integrations/supabase/types';

export type TablePlayerLocal = {
  id: string;
  name: string;
  totalPoints?: number;
  active?: boolean;
  pending?: boolean;
};

export interface EnhancedPokerTable extends SupabasePokerTable {
  players: TablePlayerLocal[];
  adminName?: string;
  joinCode?: number;
  adminId?: string;
}

export interface StoragePokerTable {
  id: string;
  name: string;
  status: string;
  joinCode?: number;
  adminId?: string;
  players: any[];
  admin_player_id: string;
  join_code: number;
  created_at: string;
  updated_at: string;
  adminName?: string;
}
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      players: {
        Row: {
          id: string
          name: string
          avatar: string | null
          created_at?: string
          updated_at?: string
        }
        Insert: {
          id: string
          name: string
          avatar?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          avatar?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      buy_in_requests: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          player_id: string
          status: string
          table_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          player_id: string
          status?: string
          table_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          player_id?: string
          status?: string
          table_id?: string
        }
        Relationships: []
      }
      buy_ins: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          player_id: string
          table_id: string
          timestamp: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          player_id: string
          table_id: string
          timestamp?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          player_id?: string
          table_id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      join_requests: {
        Row: {
          created_at: string | null
          id: string
          player_id: string
          player_name: string | null
          status: string
          table_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          player_id: string
          player_name?: string | null
          status?: string
          table_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          player_id?: string
          player_name?: string | null
          status?: string
          table_id?: string
        }
        Relationships: []
      }
      poker_tables: {
        Row: {
          admin_player_id: string | null
          created_at: string | null
          id: string
          join_code: number
          name: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          admin_player_id?: string | null
          created_at?: string | null
          id?: string
          join_code: number
          name?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          admin_player_id?: string | null
          created_at?: string | null
          id?: string
          join_code?: number
          name?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      games: {
        Row: {
          id: string
          table_id: string
          game_number: number
          status: string
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          table_id: string
          game_number: number
          status?: string
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          table_id?: string
          game_number?: number
          status?: string
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      game_profits: {
        Row: {
          id: string
          game_id: string
          table_id: string
          player_id: string
          profit: number
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          game_id: string
          table_id: string
          player_id: string
          profit?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          game_id?: string
          table_id?: string
          player_id?: string
          profit?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      end_ups: {
        Row: {
          id: string
          table_id: string
          player_id: string
          value: number
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          table_id: string
          player_id: string
          value?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          table_id?: string
          player_id?: string
          value?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      table_endups: {
        Row: {
          endup: number
          id: string
          player_id: string
          table_id: string
          updated_at: string | null
        }
        Insert: {
          endup?: number
          id?: string
          player_id: string
          table_id: string
          updated_at?: string | null
        }
        Update: {
          endup?: number
          id?: string
          player_id?: string
          table_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      table_players: {
        Row: {
          created_at: string | null
          id: string
          player_id: string
          status: string
          table_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          player_id: string
          status?: string
          table_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          player_id?: string
          status?: string
          table_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_anonymous_table: {
        Args: { table_name: string }
        Returns: string
      }
      create_new_game: {
        Args: { p_table_id: string }
        Returns: string
      }
      end_game_and_calculate_profits: {
        Args: { p_game_id: string }
        Returns: void
      }
      reset_table_for_new_game: {
        Args: { p_table_id: string }
        Returns: void
      }
    }
    Enums: {
      buy_in_request_status: "pending" | "approved" | "rejected"
      request_status: "pending" | "approved" | "rejected"
      table_status: "active" | "ended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Simple type exports for common use cases
export type Player = Database["public"]["Tables"]["players"]["Row"]
export type PokerTable = Database["public"]["Tables"]["poker_tables"]["Row"]
export type TablePlayer = Database["public"]["Tables"]["table_players"]["Row"]
export type BuyInRequest = Database["public"]["Tables"]["buy_in_requests"]["Row"]
export type BuyIn = Database["public"]["Tables"]["buy_ins"]["Row"]
export type JoinRequest = Database["public"]["Tables"]["join_requests"]["Row"]
export type Game = Database["public"]["Tables"]["games"]["Row"]
export type GameProfit = Database["public"]["Tables"]["game_profits"]["Row"]
export type EndUp = Database["public"]["Tables"]["end_ups"]["Row"]
export type TableEndup = Database["public"]["Tables"]["table_endups"]["Row"]

export const Constants = {
  public: {
    Enums: {
      buy_in_request_status: ["pending", "approved", "rejected"],
      request_status: ["pending", "approved", "rejected"],
      table_status: ["active", "ended"],
    },
  },
} as const

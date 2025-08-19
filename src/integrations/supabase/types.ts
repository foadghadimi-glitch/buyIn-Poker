export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
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
        Relationships: [
          {
            foreignKeyName: "buy_in_requests_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      buy_ins: {
        Row: {
          admin_id: string | null
          amount: number
          created_at: string | null
          id: string
          notes: string | null
          player_id: string
          status: string
          table_id: string
          timestamp: string | null
          updated_at: string | null
        }
        Insert: {
          admin_id?: string | null
          amount: number
          created_at?: string | null
          id?: string
          notes?: string | null
          player_id: string
          status?: string
          table_id: string
          timestamp?: string | null
          updated_at?: string | null
        }
        Update: {
          admin_id?: string | null
          amount?: number
          created_at?: string | null
          id?: string
          notes?: string | null
          player_id?: string
          status?: string
          table_id?: string
          timestamp?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "buy_ins_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "poker_tables"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "join_requests_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_tables: {
        Row: {
          admin_user_id: string | null
          created_at: string | null
          id: string
          is_anonymous: boolean | null
          join_code: number
          name: string | null
          players: Json | null
          status: string
        }
        Insert: {
          admin_user_id?: string | null
          created_at?: string | null
          id?: string
          is_anonymous?: boolean | null
          join_code: number
          name?: string | null
          players?: Json | null
          status?: string
        }
        Update: {
          admin_user_id?: string | null
          created_at?: string | null
          id?: string
          is_anonymous?: boolean | null
          join_code?: number
          name?: string | null
          players?: Json | null
          status?: string
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
        Relationships: [
          {
            foreignKeyName: "table_endups_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      table_players: {
        Row: {
          created_at: string | null
          id: string
          status: string
          table_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          status?: string
          table_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          status?: string
          table_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_players_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar: string | null
          id: string
          name: string
        }
        Insert: {
          avatar?: string | null
          id: string
          name: string
        }
        Update: {
          avatar?: string | null
          id?: string
          name?: string
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      buy_in_request_status: ["pending", "approved", "rejected"],
      request_status: ["pending", "approved", "rejected"],
      table_status: ["active", "ended"],
    },
  },
} as const

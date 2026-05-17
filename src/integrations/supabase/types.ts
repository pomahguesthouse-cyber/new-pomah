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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_conversation_logs: {
        Row: {
          ai_response: string
          correction: string | null
          created_at: string
          id: string
          rating: string | null
          thread_id: string | null
          used: boolean
          user_message: string | null
        }
        Insert: {
          ai_response: string
          correction?: string | null
          created_at?: string
          id?: string
          rating?: string | null
          thread_id?: string | null
          used?: boolean
          user_message?: string | null
        }
        Update: {
          ai_response?: string
          correction?: string | null
          created_at?: string
          id?: string
          rating?: string | null
          thread_id?: string | null
          used?: boolean
          user_message?: string | null
        }
        Relationships: []
      }
      ai_suggestions: {
        Row: {
          action_payload: Json | null
          body: string
          created_at: string
          id: string
          kind: string
          status: Database["public"]["Enums"]["suggestion_status"]
          title: string
        }
        Insert: {
          action_payload?: Json | null
          body: string
          created_at?: string
          id?: string
          kind: string
          status?: Database["public"]["Enums"]["suggestion_status"]
          title: string
        }
        Update: {
          action_payload?: Json | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          status?: Database["public"]["Enums"]["suggestion_status"]
          title?: string
        }
        Relationships: []
      }
      booking_events: {
        Row: {
          actor_id: string | null
          booking_id: string
          created_at: string
          id: string
          payload: Json | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          booking_id: string
          created_at?: string
          id?: string
          payload?: Json | null
          type: string
        }
        Update: {
          actor_id?: string | null
          booking_id?: string
          created_at?: string
          id?: string
          payload?: Json | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_rooms: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          nightly_rate: number
          room_id: string | null
          room_type_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          nightly_rate?: number
          room_id?: string | null
          room_type_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          nightly_rate?: number
          room_id?: string | null
          room_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_rooms_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rooms_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rooms_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          adults: number
          check_in: string
          check_out: string
          children: number
          created_at: string
          guest_id: string
          id: string
          internal_notes: string | null
          nightly_rate: number | null
          paid_amount: number
          payment_status: Database["public"]["Enums"]["payment_status"]
          property_id: string
          reference_code: string
          room_id: string | null
          room_type_id: string | null
          source: Database["public"]["Enums"]["booking_source"]
          special_requests: string | null
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number
          updated_at: string
        }
        Insert: {
          adults?: number
          check_in: string
          check_out: string
          children?: number
          created_at?: string
          guest_id: string
          id?: string
          internal_notes?: string | null
          nightly_rate?: number | null
          paid_amount?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          property_id: string
          reference_code?: string
          room_id?: string | null
          room_type_id?: string | null
          source?: Database["public"]["Enums"]["booking_source"]
          special_requests?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount: number
          updated_at?: string
        }
        Update: {
          adults?: number
          check_in?: string
          check_out?: string
          children?: number
          created_at?: string
          guest_id?: string
          id?: string
          internal_notes?: string | null
          nightly_rate?: number | null
          paid_amount?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          property_id?: string
          reference_code?: string
          room_id?: string | null
          room_type_id?: string | null
          source?: Database["public"]["Enums"]["booking_source"]
          special_requests?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          country: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          updated_at: string
          whatsapp_id: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          whatsapp_id?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          whatsapp_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string
          currency: string
          description: string | null
          email: string | null
          hero_image_url: string | null
          id: string
          name: string
          phone: string | null
          public_domain: string | null
          tagline: string | null
          timezone: string
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          email?: string | null
          hero_image_url?: string | null
          id?: string
          name: string
          phone?: string | null
          public_domain?: string | null
          tagline?: string | null
          timezone?: string
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          email?: string | null
          hero_image_url?: string | null
          id?: string
          name?: string
          phone?: string | null
          public_domain?: string | null
          tagline?: string | null
          timezone?: string
          updated_at?: string
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      room_types: {
        Row: {
          amenities: string[] | null
          base_rate: number
          bed_type: string | null
          capacity: number
          created_at: string
          description: string | null
          hero_image_url: string | null
          id: string
          name: string
          property_id: string
          size_sqm: number | null
          slug: string
        }
        Insert: {
          amenities?: string[] | null
          base_rate?: number
          bed_type?: string | null
          capacity?: number
          created_at?: string
          description?: string | null
          hero_image_url?: string | null
          id?: string
          name: string
          property_id: string
          size_sqm?: number | null
          slug: string
        }
        Update: {
          amenities?: string[] | null
          base_rate?: number
          bed_type?: string | null
          capacity?: number
          created_at?: string
          description?: string | null
          hero_image_url?: string | null
          id?: string
          name?: string
          property_id?: string
          size_sqm?: number | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_types_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          number: string
          room_type_id: string
          status: Database["public"]["Enums"]["room_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          number: string
          room_type_id: string
          status?: Database["public"]["Enums"]["room_status"]
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          number?: string
          room_type_id?: string
          status?: Database["public"]["Enums"]["room_status"]
        }
        Relationships: [
          {
            foreignKeyName: "rooms_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      seasonal_rates: {
        Row: {
          created_at: string
          end_date: string
          id: string
          min_stay: number
          multiplier: number
          name: string
          nightly_rate: number | null
          room_type_id: string
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          min_stay?: number
          multiplier?: number
          name: string
          nightly_rate?: number | null
          room_type_id: string
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          min_stay?: number
          multiplier?: number
          name?: string
          nightly_rate?: number | null
          room_type_id?: string
          start_date?: string
        }
        Relationships: []
      }
      seo_pages: {
        Row: {
          description: string | null
          id: string
          og_image_url: string | null
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          description?: string | null
          id?: string
          og_image_url?: string | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          description?: string | null
          id?: string
          og_image_url?: string | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          ai_draft: boolean
          body: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          sent_at: string
          thread_id: string
        }
        Insert: {
          ai_draft?: boolean
          body: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          sent_at?: string
          thread_id: string
        }
        Update: {
          ai_draft?: boolean
          body?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          sent_at?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_threads: {
        Row: {
          assigned_to: string | null
          created_at: string
          display_name: string | null
          guest_id: string | null
          id: string
          intent: string | null
          last_message_at: string
          last_message_preview: string | null
          phone: string
          pinned: boolean
          status: Database["public"]["Enums"]["thread_status"]
          tags: string[] | null
          unread_count: number
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          display_name?: string | null
          guest_id?: string | null
          id?: string
          intent?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          phone: string
          pinned?: boolean
          status?: Database["public"]["Enums"]["thread_status"]
          tags?: string[] | null
          unread_count?: number
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          display_name?: string | null
          guest_id?: string | null
          id?: string
          intent?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          phone?: string
          pinned?: boolean
          status?: Database["public"]["Enums"]["thread_status"]
          tags?: string[] | null
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_threads_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_booking_reference: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "staff"
      booking_source: "direct" | "whatsapp" | "walk_in" | "website"
      booking_status:
        | "pending"
        | "confirmed"
        | "checked_in"
        | "checked_out"
        | "cancelled"
      message_direction: "in" | "out"
      payment_status: "unpaid" | "partial" | "paid"
      room_status: "clean" | "dirty" | "maintenance" | "out_of_order"
      suggestion_status: "new" | "accepted" | "dismissed"
      thread_status: "open" | "closed" | "snoozed"
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
      app_role: ["admin", "staff"],
      booking_source: ["direct", "whatsapp", "walk_in", "website"],
      booking_status: [
        "pending",
        "confirmed",
        "checked_in",
        "checked_out",
        "cancelled",
      ],
      message_direction: ["in", "out"],
      payment_status: ["unpaid", "partial", "paid"],
      room_status: ["clean", "dirty", "maintenance", "out_of_order"],
      suggestion_status: ["new", "accepted", "dismissed"],
      thread_status: ["open", "closed", "snoozed"],
    },
  },
} as const

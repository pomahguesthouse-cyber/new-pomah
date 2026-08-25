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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      ai_conversation_logs: {
        Row: {
          ai_response: string
          correction: string | null
          created_at: string
          effective_answer: string | null
          embedding: string | null
          embedding_updated_at: string | null
          id: string
          metadata: Json | null
          rating: string | null
          source: string | null
          thread_id: string | null
          title: string | null
          transcript: Json | null
          used: boolean
          user_message: string | null
        }
        Insert: {
          ai_response: string
          correction?: string | null
          created_at?: string
          effective_answer?: string | null
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          metadata?: Json | null
          rating?: string | null
          source?: string | null
          thread_id?: string | null
          title?: string | null
          transcript?: Json | null
          used?: boolean
          user_message?: string | null
        }
        Update: {
          ai_response?: string
          correction?: string | null
          created_at?: string
          effective_answer?: string | null
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          metadata?: Json | null
          rating?: string | null
          source?: string | null
          thread_id?: string | null
          title?: string | null
          transcript?: Json | null
          used?: boolean
          user_message?: string | null
        }
        Relationships: []
      }
      ai_intent_rules: {
        Row: {
          category: string
          created_at: string | null
          id: string
          patterns: string[]
          weight: number
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          patterns: string[]
          weight?: number
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          patterns?: string[]
          weight?: number
        }
        Relationships: []
      }
      ai_retry_audit: {
        Row: {
          agent_key: string
          attempt: number
          created_at: string
          id: string
          latency_ms: number | null
          model: string | null
          phone: string
          queue_entry_id: string | null
          reason: string
          resolved: boolean
          thread_id: string | null
        }
        Insert: {
          agent_key: string
          attempt: number
          created_at?: string
          id?: string
          latency_ms?: number | null
          model?: string | null
          phone: string
          queue_entry_id?: string | null
          reason: string
          resolved?: boolean
          thread_id?: string | null
        }
        Update: {
          agent_key?: string
          attempt?: number
          created_at?: string
          id?: string
          latency_ms?: number | null
          model?: string | null
          phone?: string
          queue_entry_id?: string | null
          reason?: string
          resolved?: boolean
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_retry_audit_queue_entry_id_fkey"
            columns: ["queue_entry_id"]
            isOneToOne: false
            referencedRelation: "wa_conversation_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_retry_audit_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_threads"
            referencedColumns: ["id"]
          },
        ]
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
      booking_form_send_logs: {
        Row: {
          attempts: number
          booking_id: string | null
          check_in: string | null
          check_out: string | null
          created_at: string
          failure_reason: string | null
          id: string
          metadata: Json
          phone: string
          property_id: string | null
          room_type_name: string | null
          sent_at: string | null
          status: string
          thread_id: string | null
          token: string
          updated_at: string
          url: string
        }
        Insert: {
          attempts?: number
          booking_id?: string | null
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          metadata?: Json
          phone: string
          property_id?: string | null
          room_type_name?: string | null
          sent_at?: string | null
          status?: string
          thread_id?: string | null
          token: string
          updated_at?: string
          url: string
        }
        Update: {
          attempts?: number
          booking_id?: string | null
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          metadata?: Json
          phone?: string
          property_id?: string | null
          room_type_name?: string | null
          sent_at?: string | null
          status?: string
          thread_id?: string | null
          token?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_form_send_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_form_send_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_form_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          phone: string
          prefill_data: Json
          property_id: string | null
          reminder_sent_at: string | null
          status: string
          submitted_at: string | null
          submitted_data: Json | null
          thread_id: string | null
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          phone: string
          prefill_data?: Json
          property_id?: string | null
          reminder_sent_at?: string | null
          status?: string
          submitted_at?: string | null
          submitted_data?: Json | null
          thread_id?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          prefill_data?: Json
          property_id?: string | null
          reminder_sent_at?: string | null
          status?: string
          submitted_at?: string | null
          submitted_data?: Json | null
          thread_id?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_form_tokens_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_rooms: {
        Row: {
          booking_id: string
          booking_status: string | null
          check_in: string | null
          check_out: string | null
          created_at: string
          extra_bed_count: number
          extra_bed_rate: number
          id: string
          nightly_rate: number
          room_id: string | null
          room_type_id: string
        }
        Insert: {
          booking_id: string
          booking_status?: string | null
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          extra_bed_count?: number
          extra_bed_rate?: number
          id?: string
          nightly_rate?: number
          room_id?: string | null
          room_type_id: string
        }
        Update: {
          booking_id?: string
          booking_status?: string | null
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          extra_bed_count?: number
          extra_bed_rate?: number
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
          check_in_time: string | null
          check_out: string
          check_out_time: string | null
          children: number
          created_at: string
          expires_at: string | null
          guest_id: string
          id: string
          idempotency_key: string | null
          internal_notes: string | null
          nightly_rate: number | null
          nights: number | null
          paid_amount: number
          payment_method: string | null
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
          check_in_time?: string | null
          check_out: string
          check_out_time?: string | null
          children?: number
          created_at?: string
          expires_at?: string | null
          guest_id: string
          id?: string
          idempotency_key?: string | null
          internal_notes?: string | null
          nightly_rate?: number | null
          nights?: number | null
          paid_amount?: number
          payment_method?: string | null
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
          check_in_time?: string | null
          check_out?: string
          check_out_time?: string | null
          children?: number
          created_at?: string
          expires_at?: string | null
          guest_id?: string
          id?: string
          idempotency_key?: string | null
          internal_notes?: string | null
          nightly_rate?: number | null
          nights?: number | null
          paid_amount?: number
          payment_method?: string | null
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
      channel_status: {
        Row: {
          channel: string
          fallback_enabled: boolean
          id: string
          last_error_at: string | null
          last_error_message: string | null
          last_ok_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          channel: string
          fallback_enabled?: boolean
          id?: string
          last_error_at?: string | null
          last_error_message?: string | null
          last_ok_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          channel?: string
          fallback_enabled?: boolean
          id?: string
          last_error_at?: string | null
          last_error_message?: string | null
          last_ok_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      chatbot_training_examples: {
        Row: {
          created_at: string | null
          embedding: string | null
          embedding_updated_at: string | null
          id: string
          ideal_assistant_response: string
          intent: string | null
          is_active: boolean | null
          language: string | null
          promoted_from_log_id: string | null
          slot_updates: Json | null
          source_file: string | null
          stage: string | null
          state_before: string | null
          training_type: string | null
          updated_at: string | null
          user_message: string
        }
        Insert: {
          created_at?: string | null
          embedding?: string | null
          embedding_updated_at?: string | null
          id: string
          ideal_assistant_response: string
          intent?: string | null
          is_active?: boolean | null
          language?: string | null
          promoted_from_log_id?: string | null
          slot_updates?: Json | null
          source_file?: string | null
          stage?: string | null
          state_before?: string | null
          training_type?: string | null
          updated_at?: string | null
          user_message: string
        }
        Update: {
          created_at?: string | null
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          ideal_assistant_response?: string
          intent?: string | null
          is_active?: boolean | null
          language?: string | null
          promoted_from_log_id?: string | null
          slot_updates?: Json | null
          source_file?: string | null
          stage?: string | null
          state_before?: string | null
          training_type?: string | null
          updated_at?: string | null
          user_message?: string
        }
        Relationships: []
      }
      competitor_prices: {
        Row: {
          city: string
          created_at: string
          currency: string
          fetched_at: string
          hotel_name: string
          id: string
          notes: string | null
          price_max: number | null
          price_min: number | null
          room_type: string | null
          source_provider: string | null
          source_url: string | null
          star_rating: number | null
        }
        Insert: {
          city?: string
          created_at?: string
          currency?: string
          fetched_at?: string
          hotel_name: string
          id?: string
          notes?: string | null
          price_max?: number | null
          price_min?: number | null
          room_type?: string | null
          source_provider?: string | null
          source_url?: string | null
          star_rating?: number | null
        }
        Update: {
          city?: string
          created_at?: string
          currency?: string
          fetched_at?: string
          hotel_name?: string
          id?: string
          notes?: string | null
          price_max?: number | null
          price_min?: number | null
          room_type?: string | null
          source_provider?: string | null
          source_url?: string | null
          star_rating?: number | null
        }
        Relationships: []
      }
      custom_google_reviews_audit: {
        Row: {
          actor: string | null
          created_at: string
          id: string
          mode: string
          next_rating: number | null
          next_reviews: Json | null
          next_total: number | null
          prev_rating: number | null
          prev_reviews: Json | null
          prev_total: number | null
          property_id: string
        }
        Insert: {
          actor?: string | null
          created_at?: string
          id?: string
          mode: string
          next_rating?: number | null
          next_reviews?: Json | null
          next_total?: number | null
          prev_rating?: number | null
          prev_reviews?: Json | null
          prev_total?: number | null
          property_id: string
        }
        Update: {
          actor?: string | null
          created_at?: string
          id?: string
          mode?: string
          next_rating?: number | null
          next_reviews?: Json | null
          next_total?: number | null
          prev_rating?: number | null
          prev_reviews?: Json | null
          prev_total?: number | null
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_google_reviews_audit_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      explore_items: {
        Row: {
          badge: string | null
          category: string
          created_at: string
          date_text: string | null
          description: string | null
          id: string
          image_url: string | null
          is_published: boolean
          location_text: string | null
          rating: number | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          badge?: string | null
          category: string
          created_at?: string
          date_text?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_published?: boolean
          location_text?: string | null
          rating?: number | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          badge?: string | null
          category?: string
          created_at?: string
          date_text?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_published?: boolean
          location_text?: string | null
          rating?: number | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      guest_complaints: {
        Row: {
          assigned_to: string | null
          booking_id: string | null
          category: string
          confidence: number | null
          created_at: string
          guest_name: string | null
          id: string
          message: string
          notes: string | null
          phone: string
          resolved_at: string | null
          status: string
          thread_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          booking_id?: string | null
          category: string
          confidence?: number | null
          created_at?: string
          guest_name?: string | null
          id?: string
          message: string
          notes?: string | null
          phone: string
          resolved_at?: string | null
          status?: string
          thread_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          booking_id?: string | null
          category?: string
          confidence?: number | null
          created_at?: string
          guest_name?: string | null
          id?: string
          message?: string
          notes?: string | null
          phone?: string
          resolved_at?: string | null
          status?: string
          thread_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      guest_structured_memory: {
        Row: {
          adults: number | null
          booking_status: string | null
          budget_note: string | null
          canonical_phone: string
          check_in: string | null
          check_out: string | null
          children: number | null
          complaint_active: boolean
          complaint_summary: string | null
          first_seen_at: string
          guest_count: number | null
          guest_name: string | null
          handoff_reason: string | null
          last_bot_message: string | null
          last_intent: string | null
          last_seen_at: string
          last_topic: string | null
          last_user_message: string | null
          needs_human: boolean
          next_action: string | null
          payment_status: string | null
          preference_notes: string | null
          raw_summary: Json
          room_type: string | null
          source_channel: string | null
          special_requests: string | null
          thread_id: string | null
          unresolved_question: string | null
          updated_at: string
        }
        Insert: {
          adults?: number | null
          booking_status?: string | null
          budget_note?: string | null
          canonical_phone: string
          check_in?: string | null
          check_out?: string | null
          children?: number | null
          complaint_active?: boolean
          complaint_summary?: string | null
          first_seen_at?: string
          guest_count?: number | null
          guest_name?: string | null
          handoff_reason?: string | null
          last_bot_message?: string | null
          last_intent?: string | null
          last_seen_at?: string
          last_topic?: string | null
          last_user_message?: string | null
          needs_human?: boolean
          next_action?: string | null
          payment_status?: string | null
          preference_notes?: string | null
          raw_summary?: Json
          room_type?: string | null
          source_channel?: string | null
          special_requests?: string | null
          thread_id?: string | null
          unresolved_question?: string | null
          updated_at?: string
        }
        Update: {
          adults?: number | null
          booking_status?: string | null
          budget_note?: string | null
          canonical_phone?: string
          check_in?: string | null
          check_out?: string | null
          children?: number | null
          complaint_active?: boolean
          complaint_summary?: string | null
          first_seen_at?: string
          guest_count?: number | null
          guest_name?: string | null
          handoff_reason?: string | null
          last_bot_message?: string | null
          last_intent?: string | null
          last_seen_at?: string
          last_topic?: string | null
          last_user_message?: string | null
          needs_human?: boolean
          next_action?: string | null
          payment_status?: string | null
          preference_notes?: string | null
          raw_summary?: Json
          room_type?: string | null
          source_channel?: string | null
          special_requests?: string | null
          thread_id?: string | null
          unresolved_question?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_structured_memory_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          avatar_url: string | null
          country: string | null
          created_at: string
          display_name: string | null
          email: string | null
          first_seen_at: string | null
          full_name: string
          id: string
          last_seen_at: string | null
          merged_into: string | null
          notes: string | null
          phone: string | null
          phone_normalized: string | null
          real_name: string | null
          source: string | null
          tags: string[] | null
          total_bookings: number
          total_spent: number
          updated_at: string
          whatsapp_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          first_seen_at?: string | null
          full_name: string
          id?: string
          last_seen_at?: string | null
          merged_into?: string | null
          notes?: string | null
          phone?: string | null
          phone_normalized?: string | null
          real_name?: string | null
          source?: string | null
          tags?: string[] | null
          total_bookings?: number
          total_spent?: number
          updated_at?: string
          whatsapp_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          first_seen_at?: string | null
          full_name?: string
          id?: string
          last_seen_at?: string | null
          merged_into?: string | null
          notes?: string | null
          phone?: string | null
          phone_normalized?: string | null
          real_name?: string | null
          source?: string | null
          tags?: string[] | null
          total_bookings?: number
          total_spent?: number
          updated_at?: string
          whatsapp_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guests_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      handoff_tickets: {
        Row: {
          assigned_to: string | null
          booking_code: string | null
          booking_context: Json
          booking_summary: string
          created_at: string
          frustration_kind: string
          frustration_score: number
          id: string
          phone: string
          resolution_note: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["handoff_ticket_status"]
          thread_id: string | null
          trigger_message: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          booking_code?: string | null
          booking_context?: Json
          booking_summary?: string
          created_at?: string
          frustration_kind: string
          frustration_score?: number
          id?: string
          phone: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["handoff_ticket_status"]
          thread_id?: string | null
          trigger_message?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          booking_code?: string | null
          booking_context?: Json
          booking_summary?: string
          created_at?: string
          frustration_kind?: string
          frustration_score?: number
          id?: string
          phone?: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["handoff_ticket_status"]
          thread_id?: string | null
          trigger_message?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          invoice_number: string
          issued_at: string
          payment_status_snapshot: string | null
          pdf_url: string | null
          regenerated_at: string | null
          wa_sent_at: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          invoice_number: string
          issued_at?: string
          payment_status_snapshot?: string | null
          pdf_url?: string | null
          regenerated_at?: string | null
          wa_sent_at?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          invoice_number?: string
          issued_at?: string
          payment_status_snapshot?: string | null
          pdf_url?: string | null
          regenerated_at?: string | null
          wa_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_page_versions: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          page_id: string
          version_number: number
        }
        Insert: {
          content: Json
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          page_id: string
          version_number: number
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          page_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "landing_page_versions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_pages: {
        Row: {
          canonical_url: string | null
          content: Json
          created_at: string
          created_by: string | null
          id: string
          noindex: boolean
          og_image_url: string | null
          published_at: string | null
          published_content: Json | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          canonical_url?: string | null
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          noindex?: boolean
          og_image_url?: string | null
          published_at?: string | null
          published_content?: Json | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          canonical_url?: string | null
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          noindex?: boolean
          og_image_url?: string | null
          published_at?: string | null
          published_content?: Json | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      manager_test_modes: {
        Row: {
          guest_mode: boolean
          phone: string
          updated_at: string
        }
        Insert: {
          guest_mode?: boolean
          phone: string
          updated_at?: string
        }
        Update: {
          guest_mode?: boolean
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      media_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          attachment_url: string | null
          attempts: number
          channel: string
          created_at: string
          dedupe_key: string | null
          error: string | null
          event_type: string
          id: string
          message: string
          recipient_phone: string
          recipient_role: string | null
          related_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          attachment_url?: string | null
          attempts?: number
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          event_type: string
          id?: string
          message: string
          recipient_phone: string
          recipient_role?: string | null
          related_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          attachment_url?: string | null
          attempts?: number
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          event_type?: string
          id?: string
          message?: string
          recipient_phone?: string
          recipient_role?: string | null
          related_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      page_elements: {
        Row: {
          content: Json
          created_at: string
          desktop_style: Json
          id: string
          mobile_style: Json
          page_id: string
          section_id: string
          sort_order: number
          type: string
          updated_at: string
        }
        Insert: {
          content?: Json
          created_at?: string
          desktop_style?: Json
          id?: string
          mobile_style?: Json
          page_id: string
          section_id: string
          sort_order?: number
          type: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          desktop_style?: Json
          id?: string
          mobile_style?: Json
          page_id?: string
          section_id?: string
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_elements_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "seo_landing_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_elements_section_page_fk"
            columns: ["page_id", "section_id"]
            isOneToOne: false
            referencedRelation: "page_sections"
            referencedColumns: ["page_id", "id"]
          },
        ]
      }
      page_sections: {
        Row: {
          created_at: string
          desktop_config: Json
          id: string
          is_mobile_custom: boolean
          mobile_config: Json
          page_id: string
          sort_order: number
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          desktop_config?: Json
          id?: string
          is_mobile_custom?: boolean
          mobile_config?: Json
          page_id: string
          sort_order?: number
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          desktop_config?: Json
          id?: string
          is_mobile_custom?: boolean
          mobile_config?: Json
          page_id?: string
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_sections_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "seo_landing_pages"
            referencedColumns: ["id"]
          },
        ]
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
          ai_api_key: string | null
          ai_base_url: string | null
          ai_lab_config: Json
          ai_model: string | null
          booking_form_enabled: boolean
          city: string | null
          competitor_hotels: Json
          country: string | null
          created_at: string
          currency: string
          custom_google_rating: number | null
          custom_google_reviews_json: Json | null
          custom_google_reviews_total: number | null
          description: string | null
          email: string | null
          explore_config: Json
          facebook_url: string | null
          favicon_url: string | null
          google_analytics_id: string | null
          google_place_id: string | null
          google_places_api_key: string | null
          google_search_console: string | null
          google_tag_manager_id: string | null
          hero_image_url: string | null
          homepage_config: Json
          hotel_policy: string | null
          id: string
          instagram_url: string | null
          invoice_logo_url: string | null
          logo_url: string | null
          name: string
          payment_account_holder: string | null
          payment_account_number: string | null
          payment_bank_name: string | null
          phone: string | null
          public_domain: string | null
          serper_api_key: string | null
          smart_delay_config: Json | null
          tagline: string | null
          tavily_api_key: string | null
          telegram_bot_token: string | null
          telegram_bot_username: string | null
          telegram_webhook_secret: string | null
          tiktok_url: string | null
          timezone: string
          updated_at: string
          whatsapp_number: string | null
          wpp_token: string | null
          youtube_url: string | null
        }
        Insert: {
          address?: string | null
          ai_api_key?: string | null
          ai_base_url?: string | null
          ai_lab_config?: Json
          ai_model?: string | null
          booking_form_enabled?: boolean
          city?: string | null
          competitor_hotels?: Json
          country?: string | null
          created_at?: string
          currency?: string
          custom_google_rating?: number | null
          custom_google_reviews_json?: Json | null
          custom_google_reviews_total?: number | null
          description?: string | null
          email?: string | null
          explore_config?: Json
          facebook_url?: string | null
          favicon_url?: string | null
          google_analytics_id?: string | null
          google_place_id?: string | null
          google_places_api_key?: string | null
          google_search_console?: string | null
          google_tag_manager_id?: string | null
          hero_image_url?: string | null
          homepage_config?: Json
          hotel_policy?: string | null
          id?: string
          instagram_url?: string | null
          invoice_logo_url?: string | null
          logo_url?: string | null
          name: string
          payment_account_holder?: string | null
          payment_account_number?: string | null
          payment_bank_name?: string | null
          phone?: string | null
          public_domain?: string | null
          serper_api_key?: string | null
          smart_delay_config?: Json | null
          tagline?: string | null
          tavily_api_key?: string | null
          telegram_bot_token?: string | null
          telegram_bot_username?: string | null
          telegram_webhook_secret?: string | null
          tiktok_url?: string | null
          timezone?: string
          updated_at?: string
          whatsapp_number?: string | null
          wpp_token?: string | null
          youtube_url?: string | null
        }
        Update: {
          address?: string | null
          ai_api_key?: string | null
          ai_base_url?: string | null
          ai_lab_config?: Json
          ai_model?: string | null
          booking_form_enabled?: boolean
          city?: string | null
          competitor_hotels?: Json
          country?: string | null
          created_at?: string
          currency?: string
          custom_google_rating?: number | null
          custom_google_reviews_json?: Json | null
          custom_google_reviews_total?: number | null
          description?: string | null
          email?: string | null
          explore_config?: Json
          facebook_url?: string | null
          favicon_url?: string | null
          google_analytics_id?: string | null
          google_place_id?: string | null
          google_places_api_key?: string | null
          google_search_console?: string | null
          google_tag_manager_id?: string | null
          hero_image_url?: string | null
          homepage_config?: Json
          hotel_policy?: string | null
          id?: string
          instagram_url?: string | null
          invoice_logo_url?: string | null
          logo_url?: string | null
          name?: string
          payment_account_holder?: string | null
          payment_account_number?: string | null
          payment_bank_name?: string | null
          phone?: string | null
          public_domain?: string | null
          serper_api_key?: string | null
          smart_delay_config?: Json | null
          tagline?: string | null
          tavily_api_key?: string | null
          telegram_bot_token?: string | null
          telegram_bot_username?: string | null
          telegram_webhook_secret?: string | null
          tiktok_url?: string | null
          timezone?: string
          updated_at?: string
          whatsapp_number?: string | null
          wpp_token?: string | null
          youtube_url?: string | null
        }
        Relationships: []
      }
      property_managers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_muted: boolean
          name: string
          phone: string
          property_id: string
          role: string
          telegram_chat_id: string | null
          telegram_link_token: string | null
          telegram_linked_at: string | null
          telegram_token_expires_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_muted?: boolean
          name: string
          phone: string
          property_id: string
          role: string
          telegram_chat_id?: string | null
          telegram_link_token?: string | null
          telegram_linked_at?: string | null
          telegram_token_expires_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_muted?: boolean
          name?: string
          phone?: string
          property_id?: string
          role?: string
          telegram_chat_id?: string | null
          telegram_link_token?: string | null
          telegram_linked_at?: string | null
          telegram_token_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_managers_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      room_blocks: {
        Row: {
          created_at: string | null
          created_by: string | null
          end_date: string
          id: string
          reason: string | null
          room_id: string | null
          start_date: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          end_date: string
          id?: string
          reason?: string | null
          room_id?: string | null
          start_date: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          end_date?: string
          id?: string
          reason?: string | null
          room_id?: string | null
          start_date?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_blocks_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_daily_rates: {
        Row: {
          created_at: string
          date: string
          extrabed_rate: number | null
          id: string
          min_stay: number
          note: string | null
          rate: number
          room_type_id: string
          stop_sell: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          extrabed_rate?: number | null
          id?: string
          min_stay?: number
          note?: string | null
          rate: number
          room_type_id: string
          stop_sell?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          extrabed_rate?: number | null
          id?: string
          min_stay?: number
          note?: string | null
          rate?: number
          room_type_id?: string
          stop_sell?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_daily_rates_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      room_types: {
        Row: {
          amenities: string[] | null
          base_rate: number
          bed_size: string | null
          bed_type: string | null
          capacity: number
          created_at: string
          description: string | null
          extrabed_capacity: number
          extrabed_rate: number
          floor_info: string | null
          hero_image_url: string | null
          id: string
          images: string[]
          is_active: boolean | null
          is_published: boolean | null
          max_occupancy: number | null
          name: string
          property_id: string
          short_description: string | null
          size_sqm: number | null
          slug: string
          total_units: number | null
          updated_at: string | null
        }
        Insert: {
          amenities?: string[] | null
          base_rate?: number
          bed_size?: string | null
          bed_type?: string | null
          capacity?: number
          created_at?: string
          description?: string | null
          extrabed_capacity?: number
          extrabed_rate?: number
          floor_info?: string | null
          hero_image_url?: string | null
          id?: string
          images?: string[]
          is_active?: boolean | null
          is_published?: boolean | null
          max_occupancy?: number | null
          name: string
          property_id: string
          short_description?: string | null
          size_sqm?: number | null
          slug: string
          total_units?: number | null
          updated_at?: string | null
        }
        Update: {
          amenities?: string[] | null
          base_rate?: number
          bed_size?: string | null
          bed_type?: string | null
          capacity?: number
          created_at?: string
          description?: string | null
          extrabed_capacity?: number
          extrabed_rate?: number
          floor_info?: string | null
          hero_image_url?: string | null
          id?: string
          images?: string[]
          is_active?: boolean | null
          is_published?: boolean | null
          max_occupancy?: number | null
          name?: string
          property_id?: string
          short_description?: string | null
          size_sqm?: number | null
          slug?: string
          total_units?: number | null
          updated_at?: string | null
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
      rpc_failure_events: {
        Row: {
          context: Json | null
          created_at: string
          error_message: string | null
          id: string
          rpc_name: string
        }
        Insert: {
          context?: Json | null
          created_at?: string
          error_message?: string | null
          id?: string
          rpc_name: string
        }
        Update: {
          context?: Json | null
          created_at?: string
          error_message?: string | null
          id?: string
          rpc_name?: string
        }
        Relationships: []
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
      seo_agent_logs: {
        Row: {
          agent_key: string
          created_at: string
          details: string | null
          id: string
          status: string
          task_description: string
        }
        Insert: {
          agent_key: string
          created_at?: string
          details?: string | null
          id?: string
          status: string
          task_description: string
        }
        Update: {
          agent_key?: string
          created_at?: string
          details?: string | null
          id?: string
          status?: string
          task_description?: string
        }
        Relationships: []
      }
      seo_ai_visibility: {
        Row: {
          engine: string
          id: string
          last_checked: string
          mention_count: number | null
          uncovered_topics: Json
          visibility_score: number | null
        }
        Insert: {
          engine: string
          id?: string
          last_checked?: string
          mention_count?: number | null
          uncovered_topics?: Json
          visibility_score?: number | null
        }
        Update: {
          engine?: string
          id?: string
          last_checked?: string
          mention_count?: number | null
          uncovered_topics?: Json
          visibility_score?: number | null
        }
        Relationships: []
      }
      seo_article_schedules: {
        Row: {
          category: string
          created_at: string
          day_of_month: number | null
          day_of_week: number | null
          enabled: boolean
          frequency: string
          hour: number
          id: string
          last_error: string | null
          last_run_at: string | null
          minute: number
          next_run_at: string
          topic: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          enabled?: boolean
          frequency: string
          hour: number
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          minute?: number
          next_run_at: string
          topic: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          enabled?: boolean
          frequency?: string
          hour?: number
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          minute?: number
          next_run_at?: string
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      seo_content_tasks: {
        Row: {
          content: string | null
          created_at: string
          id: string
          keyword_focus: string | null
          meta_description: string | null
          meta_title: string | null
          readability_score: number | null
          seo_score: number | null
          status: string | null
          title: string
          type: string | null
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          keyword_focus?: string | null
          meta_description?: string | null
          meta_title?: string | null
          readability_score?: number | null
          seo_score?: number | null
          status?: string | null
          title: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          keyword_focus?: string | null
          meta_description?: string | null
          meta_title?: string | null
          readability_score?: number | null
          seo_score?: number | null
          status?: string | null
          title?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      seo_faq_insights: {
        Row: {
          created_at: string
          id: string
          question: string
          recurring_count: number | null
          source_conversations: Json
          status: string | null
          suggested_answer: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          question: string
          recurring_count?: number | null
          source_conversations?: Json
          status?: string | null
          suggested_answer?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          question?: string
          recurring_count?: number | null
          source_conversations?: Json
          status?: string | null
          suggested_answer?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      seo_generated_articles: {
        Row: {
          category: string
          created_at: string
          event_date_label: string | null
          event_end_date: string | null
          event_location: string | null
          event_start_date: string | null
          id: string
          image_url: string | null
          meta_description: string | null
          paragraphs: Json
          schedule_id: string | null
          sources: Json
          status: string
          tags: Json
          title: string
          topic: string | null
        }
        Insert: {
          category: string
          created_at?: string
          event_date_label?: string | null
          event_end_date?: string | null
          event_location?: string | null
          event_start_date?: string | null
          id?: string
          image_url?: string | null
          meta_description?: string | null
          paragraphs?: Json
          schedule_id?: string | null
          sources?: Json
          status?: string
          tags?: Json
          title: string
          topic?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          event_date_label?: string | null
          event_end_date?: string | null
          event_location?: string | null
          event_start_date?: string | null
          id?: string
          image_url?: string | null
          meta_description?: string | null
          paragraphs?: Json
          schedule_id?: string | null
          sources?: Json
          status?: string
          tags?: Json
          title?: string
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seo_generated_articles_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "seo_article_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_generated_pages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          meta_description: string | null
          meta_title: string | null
          published: boolean | null
          schema_markup: Json
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          published?: boolean | null
          schema_markup?: Json
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          published?: boolean | null
          schema_markup?: Json
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      seo_internal_links: {
        Row: {
          anchor_text: string
          created_at: string
          id: string
          source_url: string
          status: string | null
          suggested_by_ai: boolean | null
          target_url: string
        }
        Insert: {
          anchor_text: string
          created_at?: string
          id?: string
          source_url: string
          status?: string | null
          suggested_by_ai?: boolean | null
          target_url: string
        }
        Update: {
          anchor_text?: string
          created_at?: string
          id?: string
          source_url?: string
          status?: string | null
          suggested_by_ai?: boolean | null
          target_url?: string
        }
        Relationships: []
      }
      seo_keywords: {
        Row: {
          created_at: string
          difficulty: number | null
          id: string
          intent: string | null
          keyword: string
          priority: string | null
          ranking_position: number | null
          search_volume: number | null
          traffic_opportunity: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          difficulty?: number | null
          id?: string
          intent?: string | null
          keyword: string
          priority?: string | null
          ranking_position?: number | null
          search_volume?: number | null
          traffic_opportunity?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          difficulty?: number | null
          id?: string
          intent?: string | null
          keyword?: string
          priority?: string | null
          ranking_position?: number | null
          search_volume?: number | null
          traffic_opportunity?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      seo_landing_pages: {
        Row: {
          body_content: string | null
          created_at: string
          custom_head: string | null
          custom_json_ld: string | null
          custom_robots: string | null
          hero_cta_text: string
          hero_cta_url: string
          hero_headline: string | null
          hero_subheadline: string | null
          homepage_config: Json | null
          id: string
          json_ld_enabled: boolean
          meta_description: string | null
          meta_title: string | null
          og_image_url: string | null
          property_id: string | null
          published: boolean
          sections: Json | null
          slug: string
          target_keyword: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body_content?: string | null
          created_at?: string
          custom_head?: string | null
          custom_json_ld?: string | null
          custom_robots?: string | null
          hero_cta_text?: string
          hero_cta_url?: string
          hero_headline?: string | null
          hero_subheadline?: string | null
          homepage_config?: Json | null
          id?: string
          json_ld_enabled?: boolean
          meta_description?: string | null
          meta_title?: string | null
          og_image_url?: string | null
          property_id?: string | null
          published?: boolean
          sections?: Json | null
          slug: string
          target_keyword?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body_content?: string | null
          created_at?: string
          custom_head?: string | null
          custom_json_ld?: string | null
          custom_robots?: string | null
          hero_cta_text?: string
          hero_cta_url?: string
          hero_headline?: string | null
          hero_subheadline?: string | null
          homepage_config?: Json | null
          id?: string
          json_ld_enabled?: boolean
          meta_description?: string | null
          meta_title?: string | null
          og_image_url?: string | null
          property_id?: string | null
          published?: boolean
          sections?: Json | null
          slug?: string
          target_keyword?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_landing_pages_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
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
      seo_review_analysis: {
        Row: {
          content: string | null
          created_at: string
          extracted_keywords: Json
          guest_name: string | null
          id: string
          rating: number | null
          review_source: string
          sentiment: string | null
          seo_suggestions: Json
        }
        Insert: {
          content?: string | null
          created_at?: string
          extracted_keywords?: Json
          guest_name?: string | null
          id?: string
          rating?: number | null
          review_source: string
          sentiment?: string | null
          seo_suggestions?: Json
        }
        Update: {
          content?: string | null
          created_at?: string
          extracted_keywords?: Json
          guest_name?: string | null
          id?: string
          rating?: number | null
          review_source?: string
          sentiment?: string | null
          seo_suggestions?: Json
        }
        Relationships: []
      }
      seo_schema_registry: {
        Row: {
          active: boolean | null
          created_at: string
          id: string
          json_ld: Json
          name: string
          schema_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          id?: string
          json_ld: Json
          name: string
          schema_type: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          created_at?: string
          id?: string
          json_ld?: Json
          name?: string
          schema_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      sop_chunks: {
        Row: {
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          source_url: string | null
        }
        Insert: {
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          source_url?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sop_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "sop_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_documents: {
        Row: {
          agent_key: string | null
          content: string | null
          created_at: string
          doc_category: string
          file_path: string | null
          file_type: string | null
          folder: string | null
          folder_id: string | null
          id: string
          name: string
          property_id: string | null
          source_url: string | null
          storage_bucket: string | null
        }
        Insert: {
          agent_key?: string | null
          content?: string | null
          created_at?: string
          doc_category?: string
          file_path?: string | null
          file_type?: string | null
          folder?: string | null
          folder_id?: string | null
          id?: string
          name: string
          property_id?: string | null
          source_url?: string | null
          storage_bucket?: string | null
        }
        Update: {
          agent_key?: string | null
          content?: string | null
          created_at?: string
          doc_category?: string
          file_path?: string | null
          file_type?: string | null
          folder?: string | null
          folder_id?: string | null
          id?: string
          name?: string
          property_id?: string | null
          source_url?: string | null
          storage_bucket?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sop_documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_documents_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_agent_bots: {
        Row: {
          agent_key: string
          bot_token: string
          bot_username: string | null
          is_active: boolean
          updated_at: string
          webhook_secret: string | null
          webhook_set_at: string | null
        }
        Insert: {
          agent_key: string
          bot_token: string
          bot_username?: string | null
          is_active?: boolean
          updated_at?: string
          webhook_secret?: string | null
          webhook_set_at?: string | null
        }
        Update: {
          agent_key?: string
          bot_token?: string
          bot_username?: string | null
          is_active?: boolean
          updated_at?: string
          webhook_secret?: string | null
          webhook_set_at?: string | null
        }
        Relationships: []
      }
      telegram_agent_channels: {
        Row: {
          agent_key: string
          chat_id: string
          chat_type: string | null
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          message_thread_id: string | null
        }
        Insert: {
          agent_key: string
          chat_id: string
          chat_type?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          message_thread_id?: string | null
        }
        Update: {
          agent_key?: string
          chat_id?: string
          chat_type?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          message_thread_id?: string | null
        }
        Relationships: []
      }
      telegram_agent_conversations: {
        Row: {
          agent_key: string
          chat_id: string
          created_at: string
          id: string
          message_thread_id: string | null
          messages: Json
          updated_at: string
        }
        Insert: {
          agent_key: string
          chat_id: string
          created_at?: string
          id?: string
          message_thread_id?: string | null
          messages?: Json
          updated_at?: string
        }
        Update: {
          agent_key?: string
          chat_id?: string
          created_at?: string
          id?: string
          message_thread_id?: string | null
          messages?: Json
          updated_at?: string
        }
        Relationships: []
      }
      user_modes: {
        Row: {
          mode: string
          phone: string
          updated_at: string | null
        }
        Insert: {
          mode: string
          phone: string
          updated_at?: string | null
        }
        Update: {
          mode?: string
          phone?: string
          updated_at?: string | null
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
      wa_booking_states: {
        Row: {
          context: Json
          last_entity: Json | null
          last_topic: string | null
          phone: string
          slots: Json
          state: string
          topic_updated_at: string | null
          updated_at: string
        }
        Insert: {
          context?: Json
          last_entity?: Json | null
          last_topic?: string | null
          phone: string
          slots?: Json
          state?: string
          topic_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          context?: Json
          last_entity?: Json | null
          last_topic?: string | null
          phone?: string
          slots?: Json
          state?: string
          topic_updated_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      wa_conversation_queue: {
        Row: {
          attempt: number
          completed_at: string | null
          created_at: string
          first_message_at: string
          heartbeat_at: string | null
          id: string
          last_error: string | null
          last_message_body: string
          last_message_id: string | null
          lock_expires_at: string | null
          locked_at: string | null
          max_attempts: number
          max_wait_until: string
          message_count: number
          next_retry_at: string | null
          phone: string
          process_after: string
          reply_text: string | null
          started_at: string | null
          status: string
          thread_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempt?: number
          completed_at?: string | null
          created_at?: string
          first_message_at?: string
          heartbeat_at?: string | null
          id?: string
          last_error?: string | null
          last_message_body?: string
          last_message_id?: string | null
          lock_expires_at?: string | null
          locked_at?: string | null
          max_attempts?: number
          max_wait_until?: string
          message_count?: number
          next_retry_at?: string | null
          phone: string
          process_after?: string
          reply_text?: string | null
          started_at?: string | null
          status?: string
          thread_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempt?: number
          completed_at?: string | null
          created_at?: string
          first_message_at?: string
          heartbeat_at?: string | null
          id?: string
          last_error?: string | null
          last_message_body?: string
          last_message_id?: string | null
          lock_expires_at?: string | null
          locked_at?: string | null
          max_attempts?: number
          max_wait_until?: string
          message_count?: number
          next_retry_at?: string | null
          phone?: string
          process_after?: string
          reply_text?: string | null
          started_at?: string | null
          status?: string
          thread_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_conversation_queue_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_correction_dataset: {
        Row: {
          bot_wrong_reply: string
          canonical_phone: string | null
          context_after: Json
          context_before: Json
          correct_agent: string | null
          correct_intent: string | null
          created_at: string
          created_by: string | null
          embedding: string | null
          embedding_updated_at: string | null
          error_type: string | null
          id: string
          ideal_reply: string
          notes: string | null
          session_id: string | null
          severity: string
          source: string
          status: string
          thread_id: string | null
          turn_index: number | null
          updated_at: string
          user_message: string
          user_message_id: string | null
          wrong_reply_message_id: string | null
        }
        Insert: {
          bot_wrong_reply: string
          canonical_phone?: string | null
          context_after?: Json
          context_before?: Json
          correct_agent?: string | null
          correct_intent?: string | null
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          embedding_updated_at?: string | null
          error_type?: string | null
          id?: string
          ideal_reply: string
          notes?: string | null
          session_id?: string | null
          severity?: string
          source?: string
          status?: string
          thread_id?: string | null
          turn_index?: number | null
          updated_at?: string
          user_message: string
          user_message_id?: string | null
          wrong_reply_message_id?: string | null
        }
        Update: {
          bot_wrong_reply?: string
          canonical_phone?: string | null
          context_after?: Json
          context_before?: Json
          correct_agent?: string | null
          correct_intent?: string | null
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          embedding_updated_at?: string | null
          error_type?: string | null
          id?: string
          ideal_reply?: string
          notes?: string | null
          session_id?: string | null
          severity?: string
          source?: string
          status?: string
          thread_id?: string | null
          turn_index?: number | null
          updated_at?: string
          user_message?: string
          user_message_id?: string | null
          wrong_reply_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_correction_dataset_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "wa_correction_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_correction_dataset_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_correction_dataset_user_message_id_fkey"
            columns: ["user_message_id"]
            isOneToOne: false
            referencedRelation: "ai_routing_audit"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "wa_correction_dataset_user_message_id_fkey"
            columns: ["user_message_id"]
            isOneToOne: false
            referencedRelation: "ai_routing_review"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "wa_correction_dataset_user_message_id_fkey"
            columns: ["user_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_correction_dataset_wrong_reply_message_id_fkey"
            columns: ["wrong_reply_message_id"]
            isOneToOne: false
            referencedRelation: "ai_routing_audit"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "wa_correction_dataset_wrong_reply_message_id_fkey"
            columns: ["wrong_reply_message_id"]
            isOneToOne: false
            referencedRelation: "ai_routing_review"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "wa_correction_dataset_wrong_reply_message_id_fkey"
            columns: ["wrong_reply_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_correction_sessions: {
        Row: {
          canonical_phone: string | null
          conversation_summary: string | null
          corrected_transcript: Json
          created_at: string
          created_by: string | null
          embedding: string | null
          embedding_updated_at: string | null
          full_transcript: Json
          guest_memory_snapshot: Json
          id: string
          source: string
          status: string
          thread_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          canonical_phone?: string | null
          conversation_summary?: string | null
          corrected_transcript?: Json
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          embedding_updated_at?: string | null
          full_transcript?: Json
          guest_memory_snapshot?: Json
          id?: string
          source?: string
          status?: string
          thread_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          canonical_phone?: string | null
          conversation_summary?: string | null
          corrected_transcript?: Json
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          embedding_updated_at?: string | null
          full_transcript?: Json
          guest_memory_snapshot?: Json
          id?: string
          source?: string
          status?: string
          thread_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_correction_sessions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_identity_aliases: {
        Row: {
          alias_type: string
          alias_value: string
          canonical_phone: string
          created_at: string
          display_name: string | null
          first_seen_at: string
          is_active: boolean
          last_seen_at: string
          metadata: Json
          role: string
          source: string | null
          updated_at: string
        }
        Insert: {
          alias_type?: string
          alias_value: string
          canonical_phone: string
          created_at?: string
          display_name?: string | null
          first_seen_at?: string
          is_active?: boolean
          last_seen_at?: string
          metadata?: Json
          role?: string
          source?: string | null
          updated_at?: string
        }
        Update: {
          alias_type?: string
          alias_value?: string
          canonical_phone?: string
          created_at?: string
          display_name?: string | null
          first_seen_at?: string
          is_active?: boolean
          last_seen_at?: string
          metadata?: Json
          role?: string
          source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      wa_message_queue: {
        Row: {
          body: string
          created_at: string
          delay_ms: number
          id: string
          message_id: string | null
          phone: string
          status: string
          thread_id: string | null
          updated_at: string
          winner_seq: number
        }
        Insert: {
          body: string
          created_at?: string
          delay_ms?: number
          id?: string
          message_id?: string | null
          phone: string
          status?: string
          thread_id?: string | null
          updated_at?: string
          winner_seq: number
        }
        Update: {
          body?: string
          created_at?: string
          delay_ms?: number
          id?: string
          message_id?: string | null
          phone?: string
          status?: string
          thread_id?: string | null
          updated_at?: string
          winner_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "wa_message_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "ai_routing_audit"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "wa_message_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "ai_routing_review"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "wa_message_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_message_queue_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_processing_queue: {
        Row: {
          attempts: number
          body: string
          created_at: string
          id: string
          last_error: string | null
          message_id: string | null
          phone: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          body: string
          created_at?: string
          id?: string
          last_error?: string | null
          message_id?: string | null
          phone: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          body?: string
          created_at?: string
          id?: string
          last_error?: string | null
          message_id?: string | null
          phone?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_processing_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "ai_routing_audit"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "wa_processing_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "ai_routing_review"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "wa_processing_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_training_ignored_threads: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          ignored_at: string
          ignored_by: string | null
          phone: string | null
          reason: string | null
          restored_at: string | null
          status: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          ignored_at?: string
          ignored_by?: string | null
          phone?: string | null
          reason?: string | null
          restored_at?: string | null
          status?: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          ignored_at?: string
          ignored_by?: string | null
          phone?: string | null
          reason?: string | null
          restored_at?: string | null
          status?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_training_ignored_threads_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_wpp_sync_state: {
        Row: {
          created_at: string
          error_message: string | null
          external_chat_id: string | null
          finished_at: string | null
          id: string
          imported_count: number
          last_cursor: string | null
          last_synced_at: string | null
          metadata: Json
          phone: string | null
          skipped_count: number
          started_at: string | null
          status: string
          sync_type: string
          thread_id: string | null
          updated_at: string
          updated_count: number
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          external_chat_id?: string | null
          finished_at?: string | null
          id?: string
          imported_count?: number
          last_cursor?: string | null
          last_synced_at?: string | null
          metadata?: Json
          phone?: string | null
          skipped_count?: number
          started_at?: string | null
          status?: string
          sync_type: string
          thread_id?: string | null
          updated_at?: string
          updated_count?: number
        }
        Update: {
          created_at?: string
          error_message?: string | null
          external_chat_id?: string | null
          finished_at?: string | null
          id?: string
          imported_count?: number
          last_cursor?: string | null
          last_synced_at?: string | null
          metadata?: Json
          phone?: string | null
          skipped_count?: number
          started_at?: string | null
          status?: string
          sync_type?: string
          thread_id?: string | null
          updated_at?: string
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "wa_wpp_sync_state_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      walkthrough_hotspots: {
        Row: {
          created_at: string
          id: string
          label: string | null
          label_mode: string
          pitch: number
          scene_id: string
          target_scene_id: string | null
          type: string
          yaw: number
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          label_mode?: string
          pitch?: number
          scene_id: string
          target_scene_id?: string | null
          type?: string
          yaw?: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          label_mode?: string
          pitch?: number
          scene_id?: string
          target_scene_id?: string | null
          type?: string
          yaw?: number
        }
        Relationships: [
          {
            foreignKeyName: "walkthrough_hotspots_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "walkthrough_scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkthrough_hotspots_target_scene_id_fkey"
            columns: ["target_scene_id"]
            isOneToOne: false
            referencedRelation: "walkthrough_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      walkthrough_scenes: {
        Row: {
          created_at: string
          id: string
          image_path: string
          image_url: string
          order_index: number
          title: string | null
          tour_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_path: string
          image_url: string
          order_index?: number
          title?: string | null
          tour_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_path?: string
          image_url?: string
          order_index?: number
          title?: string | null
          tour_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "walkthrough_scenes_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "walkthrough_tours"
            referencedColumns: ["id"]
          },
        ]
      }
      walkthrough_tours: {
        Row: {
          created_at: string
          default_scene_id: string | null
          id: string
          is_published: boolean
          property_id: string | null
          room_type_id: string
          slug: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_scene_id?: string | null
          id?: string
          is_published?: boolean
          property_id?: string | null
          room_type_id: string
          slug?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_scene_id?: string | null
          id?: string
          is_published?: boolean
          property_id?: string | null
          room_type_id?: string
          slug?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "walkthrough_tours_default_scene_fk"
            columns: ["default_scene_id"]
            isOneToOne: false
            referencedRelation: "walkthrough_scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkthrough_tours_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkthrough_tours_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: true
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      webchat_messages: {
        Row: {
          attachment_type: string | null
          attachment_url: string | null
          body: string | null
          created_at: string
          id: string
          metadata: Json
          property_id: string | null
          sender_name: string | null
          sender_type: string
          thread_id: string
        }
        Insert: {
          attachment_type?: string | null
          attachment_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          property_id?: string | null
          sender_name?: string | null
          sender_type: string
          thread_id: string
        }
        Update: {
          attachment_type?: string | null
          attachment_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          property_id?: string | null
          sender_name?: string | null
          sender_type?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webchat_messages_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webchat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "webchat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      webchat_threads: {
        Row: {
          booking_code: string | null
          booking_id: string | null
          context_summary: string
          context_summary_json: Json
          created_at: string
          guest_email: string | null
          guest_name: string | null
          guest_phone: string | null
          handoff_status: string
          handoff_until: string | null
          id: string
          last_message_at: string
          property_id: string | null
          source: string
          status: string
          updated_at: string
          whatsapp_thread_id: string | null
        }
        Insert: {
          booking_code?: string | null
          booking_id?: string | null
          context_summary?: string
          context_summary_json?: Json
          created_at?: string
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          handoff_status?: string
          handoff_until?: string | null
          id?: string
          last_message_at?: string
          property_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          whatsapp_thread_id?: string | null
        }
        Update: {
          booking_code?: string | null
          booking_id?: string | null
          context_summary?: string
          context_summary_json?: Json
          created_at?: string
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          handoff_status?: string
          handoff_until?: string | null
          id?: string
          last_message_at?: string
          property_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          whatsapp_thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webchat_threads_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webchat_threads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webchat_threads_whatsapp_thread_id_fkey"
            columns: ["whatsapp_thread_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          ai_draft: boolean
          body: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_chat_id: string | null
          external_message_id: string | null
          from_me: boolean | null
          id: string
          metadata: Json | null
          raw_payload: Json | null
          sent_at: string
          source: string
          sync_status: string
          synced_at: string | null
          thread_id: string
          wpp_id: string | null
        }
        Insert: {
          ai_draft?: boolean
          body: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_chat_id?: string | null
          external_message_id?: string | null
          from_me?: boolean | null
          id?: string
          metadata?: Json | null
          raw_payload?: Json | null
          sent_at?: string
          source?: string
          sync_status?: string
          synced_at?: string | null
          thread_id: string
          wpp_id?: string | null
        }
        Update: {
          ai_draft?: boolean
          body?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          external_chat_id?: string | null
          external_message_id?: string | null
          from_me?: boolean | null
          id?: string
          metadata?: Json | null
          raw_payload?: Json | null
          sent_at?: string
          source?: string
          sync_status?: string
          synced_at?: string | null
          thread_id?: string
          wpp_id?: string | null
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
          ai_analysis: Json | null
          ai_auto: boolean
          assigned_to: string | null
          canonical_phone: string | null
          chat_summary: string | null
          chat_summary_json: Json
          chat_summary_updated_at: string | null
          chat_summary_version: number
          created_at: string
          display_name: string | null
          external_chat_id: string | null
          guest_id: string | null
          id: string
          identity_type: string | null
          intent: string | null
          is_training_example: boolean
          last_message_at: string
          last_message_preview: string | null
          last_synced_at: string | null
          lid_alias: string | null
          phone: string
          pinned: boolean
          status: Database["public"]["Enums"]["thread_status"]
          sync_error: string | null
          sync_status: string
          tags: string[] | null
          unread_count: number
        }
        Insert: {
          ai_analysis?: Json | null
          ai_auto?: boolean
          assigned_to?: string | null
          canonical_phone?: string | null
          chat_summary?: string | null
          chat_summary_json?: Json
          chat_summary_updated_at?: string | null
          chat_summary_version?: number
          created_at?: string
          display_name?: string | null
          external_chat_id?: string | null
          guest_id?: string | null
          id?: string
          identity_type?: string | null
          intent?: string | null
          is_training_example?: boolean
          last_message_at?: string
          last_message_preview?: string | null
          last_synced_at?: string | null
          lid_alias?: string | null
          phone: string
          pinned?: boolean
          status?: Database["public"]["Enums"]["thread_status"]
          sync_error?: string | null
          sync_status?: string
          tags?: string[] | null
          unread_count?: number
        }
        Update: {
          ai_analysis?: Json | null
          ai_auto?: boolean
          assigned_to?: string | null
          canonical_phone?: string | null
          chat_summary?: string | null
          chat_summary_json?: Json
          chat_summary_updated_at?: string | null
          chat_summary_version?: number
          created_at?: string
          display_name?: string | null
          external_chat_id?: string | null
          guest_id?: string | null
          id?: string
          identity_type?: string | null
          intent?: string | null
          is_training_example?: boolean
          last_message_at?: string
          last_message_preview?: string | null
          last_synced_at?: string | null
          lid_alias?: string | null
          phone?: string
          pinned?: boolean
          status?: Database["public"]["Enums"]["thread_status"]
          sync_error?: string | null
          sync_status?: string
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
      active_public_events: {
        Row: {
          created_at: string | null
          description: string | null
          event_date_label: string | null
          event_end_date: string | null
          event_location: string | null
          event_start_date: string | null
          id: string | null
          image_url: string | null
          sources: Json | null
          tags: Json | null
          title: string | null
          topic: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          event_date_label?: string | null
          event_end_date?: string | null
          event_location?: string | null
          event_start_date?: string | null
          id?: string | null
          image_url?: string | null
          sources?: Json | null
          tags?: Json | null
          title?: string | null
          topic?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          event_date_label?: string | null
          event_end_date?: string | null
          event_location?: string | null
          event_start_date?: string | null
          id?: string | null
          image_url?: string | null
          sources?: Json | null
          tags?: Json | null
          title?: string | null
          topic?: string | null
        }
        Relationships: []
      }
      ai_retry_stats: {
        Row: {
          agent_key: string | null
          avg_latency_ms: number | null
          hour_wib: string | null
          reason: string | null
          resolved_count: number | null
          total: number | null
        }
        Relationships: []
      }
      ai_routing_audit: {
        Row: {
          agent_key: string | null
          escalated: boolean | null
          intent: string | null
          is_fallback: boolean | null
          message_id: string | null
          phone: string | null
          reply_body: string | null
          routing_confidence: number | null
          sent_at: string | null
          thread_id: string | null
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
      ai_routing_intent_stats: {
        Row: {
          agent_key: string | null
          avg_confidence: number | null
          escalated_count: number | null
          fallback_count: number | null
          intent: string | null
          low_confidence_count: number | null
          total: number | null
        }
        Relationships: []
      }
      ai_routing_review: {
        Row: {
          agent_key: string | null
          escalated: boolean | null
          intent: string | null
          is_fallback: boolean | null
          message_id: string | null
          phone: string | null
          reply_body: string | null
          routing_confidence: number | null
          sent_at: string | null
          thread_id: string | null
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
      wa_queue_stats: {
        Row: {
          avg_delay_ms: number | null
          avg_msgs_per_burst: number | null
          avg_total_response_ms: number | null
          failed: number | null
          hour_wib: string | null
          processing: number | null
          queued: number | null
          retrying: number | null
          sent: number | null
          total_bursts: number | null
        }
        Relationships: []
      }
      wa_queue_stats_today: {
        Row: {
          avg_delay_ms: number | null
          hour_wib: string | null
          replied: number | null
          still_pending: number | null
          superseded: number | null
          total: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _jsonb_bool: {
        Args: { p_default?: boolean; p_json: Json; p_key: string }
        Returns: boolean
      }
      _jsonb_date: { Args: { p_json: Json; p_key: string }; Returns: string }
      _jsonb_int: { Args: { p_json: Json; p_key: string }; Returns: number }
      _jsonb_text: { Args: { p_json: Json; p_key: string }; Returns: string }
      claim_queue_winner: {
        Args: {
          p_body: string
          p_delay_ms: number
          p_message_id: string
          p_phone: string
          p_thread_id: string
        }
        Returns: string
      }
      create_admin_booking_with_lock: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_guest_name: string
          p_nightly_rate: number
          p_room_id: string
          p_status?: string
        }
        Returns: string
      }
      create_wa_correction_from_messages: {
        Args: {
          p_correct_agent?: string
          p_correct_intent?: string
          p_error_type?: string
          p_ideal_reply: string
          p_notes?: string
          p_severity?: string
          p_status?: string
          p_user_message_id: string
          p_wrong_reply_message_id: string
        }
        Returns: string
      }
      create_wa_correction_session_from_thread: {
        Args: {
          p_conversation_summary?: string
          p_corrected_transcript?: Json
          p_status?: string
          p_thread_id: string
          p_title?: string
        }
        Returns: string
      }
      delete_past_city_guide_events: { Args: never; Returns: number }
      enqueue_processing_job: {
        Args: { p_body: string; p_message_id: string; p_phone: string }
        Returns: string
      }
      generate_booking_reference: { Args: never; Returns: string }
      get_active_booking_state: { Args: { p_phone: string }; Returns: Json }
      get_autoreply_context: { Args: { p_phone: string }; Returns: Json }
      get_google_reviews_config: {
        Args: never
        Returns: {
          custom_google_rating: number
          custom_google_reviews_json: Json
          custom_google_reviews_total: number
          google_place_id: string
          google_places_api_key: string
        }[]
      }
      get_guest_structured_memory: { Args: { p_phone: string }; Returns: Json }
      get_public_booking_invoice: { Args: { p_id: string }; Returns: Json }
      get_public_property: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_lid_identity: { Args: { p_raw: string }; Returns: boolean }
      is_newest_pending_for_phone: {
        Args: { p_phone: string; p_queue_id: string }
        Returns: boolean
      }
      is_public_wa_phone: { Args: { p_raw: string }; Returns: boolean }
      is_resolved_public_wa_phone: {
        Args: { p_identity: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      is_still_winner: { Args: { p_entry_id: string }; Returns: boolean }
      list_wa_correction_candidates: {
        Args: { p_limit?: number }
        Returns: {
          agent_key: string
          bot_sent_at: string
          bot_wrong_reply: string
          display_name: string
          intent: string
          phone: string
          thread_id: string
          tools_used: Json
          user_message: string
          user_message_id: string
          user_sent_at: string
          wrong_reply_message_id: string
        }[]
      }
      log_webchat_message: {
        Args: {
          p_ai_response: string
          p_metadata?: Json
          p_thread_id: string
          p_user_message: string
        }
        Returns: undefined
      }
      mark_queue_done: { Args: { p_entry_id: string }; Returns: undefined }
      match_bad_training_examples: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          bad_response: string
          correction: string
          id: string
          similarity: number
          user_message: string
        }[]
      }
      match_chatbot_training_examples: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          id: string
          ideal_assistant_response: string
          intent: string
          similarity: number
          stage: string
          user_message: string
        }[]
      }
      match_sop_chunks: {
        Args: {
          match_count: number
          match_threshold: number
          query_embedding: string
        }
        Returns: {
          content: string
          document_id: string
          id: string
          similarity: number
          source_url: string
        }[]
      }
      match_training_examples: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          effective_answer: string
          id: string
          similarity: number
          user_message: string
        }[]
      }
      match_wa_correction_examples: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          bad_response: string
          correct_agent: string
          correct_intent: string
          correction: string
          error_type: string
          id: string
          similarity: number
          user_message: string
        }[]
      }
      match_wa_correction_ideal_examples: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          id: string
          ideal_assistant_response: string
          intent: string
          similarity: number
          stage: string
          user_message: string
        }[]
      }
      match_wa_correction_session_examples: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          id: string
          ideal_assistant_response: string
          intent: string
          similarity: number
          stage: string
          user_message: string
        }[]
      }
      normalize_guest_booking_status: {
        Args: { p_value: string }
        Returns: string
      }
      normalize_guest_memory_topic: {
        Args: { p_value: string }
        Returns: string
      }
      normalize_guest_payment_status: {
        Args: { p_value: string }
        Returns: string
      }
      normalize_phone_id: { Args: { p_raw: string }; Returns: string }
      normalize_wa_identity: { Args: { p_raw: string }; Returns: string }
      receive_whatsapp_message:
        | {
            Args: { p_body: string; p_name: string; p_phone: string }
            Returns: {
              is_duplicate: boolean
              message_id: string
            }[]
          }
        | {
            Args: {
              p_body: string
              p_name: string
              p_phone: string
              p_wpp_id?: string
            }
            Returns: {
              is_duplicate: boolean
              message_id: string
            }[]
          }
        | {
            Args: {
              p_body: string
              p_external_chat_id: string
              p_name: string
              p_phone: string
              p_wpp_id: string
            }
            Returns: string
          }
      resolve_wa_canonical_phone: {
        Args: { p_identity: string }
        Returns: string
      }
      room_type_availability: {
        Args: { p_check_in: string; p_check_out: string }
        Returns: {
          available: boolean
          room_type_id: string
        }[]
      }
      room_type_availability_detail: {
        Args: { p_check_in: string; p_check_out: string }
        Returns: {
          available: number
          room_type_id: string
          taken: number
          total: number
        }[]
      }
      save_message_metadata: {
        Args: { p_message_id: string; p_metadata: Json }
        Returns: undefined
      }
      save_outbound_whatsapp: {
        Args: {
          p_body: string
          p_metadata?: Json
          p_thread_id: string
          p_wpp_id?: string
        }
        Returns: string
      }
      test_context_summary: { Args: never; Returns: string }
      update_booking_room_with_lock: {
        Args: {
          p_booking_id: string
          p_booking_room_id: string
          p_room_id: string
          p_status: string
        }
        Returns: undefined
      }
      update_booking_state: {
        Args: { p_context: Json; p_phone: string; p_state: string }
        Returns: undefined
      }
      update_conversation_topic: {
        Args: {
          p_last_entity: Json
          p_last_topic: string
          p_phone: string
          p_slots: Json
        }
        Returns: undefined
      }
      update_thread_autoreply_meta: {
        Args: { p_thread_id: string; p_tools_used: string[] }
        Returns: undefined
      }
      upsert_guest_structured_memory_from_summary: {
        Args: { p_phone: string; p_summary: Json; p_thread_id: string }
        Returns: Json
      }
      upsert_wa_identity_alias: {
        Args: {
          p_alias_type?: string
          p_alias_value: string
          p_canonical_phone: string
          p_display_name?: string
          p_metadata?: Json
          p_role?: string
          p_source?: string
        }
        Returns: string
      }
      wa_queue_claim: {
        Args: { p_entry_id: string; p_worker_id: string }
        Returns: {
          attempt: number
          claimed: boolean
          last_message_body: string
          message_count: number
        }[]
      }
      wa_queue_claim_next: {
        Args: { p_worker_id: string }
        Returns: {
          attempt: number
          entry_id: string
          last_message_body: string
          message_count: number
          phone: string
          thread_id: string
        }[]
      }
      wa_queue_claim_retry: {
        Args: { p_entry_id: string; p_worker_id: string }
        Returns: {
          attempt: number
          claimed: boolean
          last_message_body: string
          message_count: number
        }[]
      }
      wa_queue_cleanup_zombies: { Args: never; Returns: number }
      wa_queue_complete: {
        Args: { p_entry_id: string; p_reply: string; p_worker_id: string }
        Returns: undefined
      }
      wa_queue_fail: {
        Args: { p_entry_id: string; p_error: string; p_worker_id: string }
        Returns: string
      }
      wa_queue_get_retrying: {
        Args: { p_phone: string }
        Returns: {
          attempt: number
          entry_id: string
        }[]
      }
      wa_queue_heartbeat: {
        Args: { p_entry_id: string; p_worker_id: string }
        Returns: boolean
      }
      wa_queue_upsert: {
        Args: {
          p_body: string
          p_delay_ms: number
          p_max_wait_ms: number
          p_message_id: string
          p_phone: string
          p_thread_id: string
        }
        Returns: {
          entry_id: string
          is_new_burst: boolean
          sleep_ms: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "staff"
      booking_source:
        | "direct"
        | "whatsapp"
        | "walk_in"
        | "website"
        | "manager_chat"
      booking_status:
        | "pending"
        | "confirmed"
        | "checked_in"
        | "checked_out"
        | "cancelled"
        | "expired"
      handoff_ticket_status:
        | "open"
        | "approved"
        | "adjusted"
        | "cancelled"
        | "resolved"
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
      booking_source: [
        "direct",
        "whatsapp",
        "walk_in",
        "website",
        "manager_chat",
      ],
      booking_status: [
        "pending",
        "confirmed",
        "checked_in",
        "checked_out",
        "cancelled",
        "expired",
      ],
      handoff_ticket_status: [
        "open",
        "approved",
        "adjusted",
        "cancelled",
        "resolved",
      ],
      message_direction: ["in", "out"],
      payment_status: ["unpaid", "partial", "paid"],
      room_status: ["clean", "dirty", "maintenance", "out_of_order"],
      suggestion_status: ["new", "accepted", "dismissed"],
      thread_status: ["open", "closed", "snoozed"],
    },
  },
} as const

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
          metadata: Json | null
          rating: string | null
          source: string | null
          thread_id: string | null
          used: boolean
          user_message: string | null
        }
        Insert: {
          ai_response: string
          correction?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          rating?: string | null
          source?: string | null
          thread_id?: string | null
          used?: boolean
          user_message?: string | null
        }
        Update: {
          ai_response?: string
          correction?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          rating?: string | null
          source?: string | null
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
          check_in_time: string | null
          check_out: string
          check_out_time: string | null
          children: number
          created_at: string
          guest_id: string
          id: string
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
          guest_id: string
          id?: string
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
          guest_id?: string
          id?: string
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
          city: string | null
          country: string | null
          created_at: string
          currency: string
          description: string | null
          email: string | null
          favicon_url: string | null
          fonnte_token: string | null
          google_analytics_id: string | null
          google_place_id: string | null
          google_places_api_key: string | null
          google_search_console: string | null
          google_tag_manager_id: string | null
          hero_image_url: string | null
          homepage_config: Json
          hotel_policy: string | null
          id: string
          invoice_logo_url: string | null
          logo_url: string | null
          name: string
          payment_account_holder: string | null
          payment_account_number: string | null
          payment_bank_name: string | null
          phone: string | null
          public_domain: string | null
          smart_delay_config: Json | null
          tagline: string | null
          timezone: string
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          address?: string | null
          ai_api_key?: string | null
          ai_base_url?: string | null
          ai_lab_config?: Json
          ai_model?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          email?: string | null
          favicon_url?: string | null
          fonnte_token?: string | null
          google_analytics_id?: string | null
          google_place_id?: string | null
          google_places_api_key?: string | null
          google_search_console?: string | null
          google_tag_manager_id?: string | null
          hero_image_url?: string | null
          homepage_config?: Json
          hotel_policy?: string | null
          id?: string
          invoice_logo_url?: string | null
          logo_url?: string | null
          name: string
          payment_account_holder?: string | null
          payment_account_number?: string | null
          payment_bank_name?: string | null
          phone?: string | null
          public_domain?: string | null
          smart_delay_config?: Json | null
          tagline?: string | null
          timezone?: string
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          address?: string | null
          ai_api_key?: string | null
          ai_base_url?: string | null
          ai_lab_config?: Json
          ai_model?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          email?: string | null
          favicon_url?: string | null
          fonnte_token?: string | null
          google_analytics_id?: string | null
          google_place_id?: string | null
          google_places_api_key?: string | null
          google_search_console?: string | null
          google_tag_manager_id?: string | null
          hero_image_url?: string | null
          homepage_config?: Json
          hotel_policy?: string | null
          id?: string
          invoice_logo_url?: string | null
          logo_url?: string | null
          name?: string
          payment_account_holder?: string | null
          payment_account_number?: string | null
          payment_bank_name?: string | null
          phone?: string | null
          public_domain?: string | null
          smart_delay_config?: Json | null
          tagline?: string | null
          timezone?: string
          updated_at?: string
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      property_managers: {
        Row: {
          created_at: string
          id: string
          name: string
          phone: string
          property_id: string
          role: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          phone: string
          property_id: string
          role: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          phone?: string
          property_id?: string
          role?: string
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
      room_types: {
        Row: {
          amenities: string[] | null
          base_rate: number
          bed_type: string | null
          capacity: number
          created_at: string
          description: string | null
          extrabed_capacity: number
          hero_image_url: string | null
          id: string
          images: string[]
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
          extrabed_capacity?: number
          hero_image_url?: string | null
          id?: string
          images?: string[]
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
          extrabed_capacity?: number
          hero_image_url?: string | null
          id?: string
          images?: string[]
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
          id: string
          name: string
          property_id: string | null
          source_url: string | null
        }
        Insert: {
          agent_key?: string | null
          content?: string | null
          created_at?: string
          doc_category?: string
          file_path?: string | null
          file_type?: string | null
          id?: string
          name: string
          property_id?: string | null
          source_url?: string | null
        }
        Update: {
          agent_key?: string | null
          content?: string | null
          created_at?: string
          doc_category?: string
          file_path?: string | null
          file_type?: string | null
          id?: string
          name?: string
          property_id?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sop_documents_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
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
          phone: string
          state: string
          updated_at: string
        }
        Insert: {
          context?: Json
          phone: string
          state?: string
          updated_at?: string
        }
        Update: {
          context?: Json
          phone?: string
          state?: string
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
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          ai_draft: boolean
          body: string
          direction: Database["public"]["Enums"]["message_direction"]
          fonnte_id: string | null
          id: string
          metadata: Json | null
          sent_at: string
          thread_id: string
        }
        Insert: {
          ai_draft?: boolean
          body: string
          direction: Database["public"]["Enums"]["message_direction"]
          fonnte_id?: string | null
          id?: string
          metadata?: Json | null
          sent_at?: string
          thread_id: string
        }
        Update: {
          ai_draft?: boolean
          body?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          fonnte_id?: string | null
          id?: string
          metadata?: Json | null
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
          ai_analysis: Json | null
          ai_auto: boolean
          assigned_to: string | null
          created_at: string
          display_name: string | null
          guest_id: string | null
          id: string
          intent: string | null
          is_training_example: boolean
          last_message_at: string
          last_message_preview: string | null
          phone: string
          pinned: boolean
          status: Database["public"]["Enums"]["thread_status"]
          tags: string[] | null
          unread_count: number
        }
        Insert: {
          ai_analysis?: Json | null
          ai_auto?: boolean
          assigned_to?: string | null
          created_at?: string
          display_name?: string | null
          guest_id?: string | null
          id?: string
          intent?: string | null
          is_training_example?: boolean
          last_message_at?: string
          last_message_preview?: string | null
          phone: string
          pinned?: boolean
          status?: Database["public"]["Enums"]["thread_status"]
          tags?: string[] | null
          unread_count?: number
        }
        Update: {
          ai_analysis?: Json | null
          ai_auto?: boolean
          assigned_to?: string | null
          created_at?: string
          display_name?: string | null
          guest_id?: string | null
          id?: string
          intent?: string | null
          is_training_example?: boolean
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
      enqueue_processing_job: {
        Args: { p_body: string; p_message_id: string; p_phone: string }
        Returns: string
      }
      generate_booking_reference: { Args: never; Returns: string }
      get_active_booking_state: { Args: { p_phone: string }; Returns: Json }
      get_autoreply_context: { Args: { p_phone: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_newest_pending_for_phone: {
        Args: { p_phone: string; p_queue_id: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      is_still_winner: { Args: { p_entry_id: string }; Returns: boolean }
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
      receive_whatsapp_message: {
        Args: { p_body: string; p_name: string; p_phone: string }
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
          p_fonnte_id?: string
          p_metadata?: Json
          p_thread_id: string
        }
        Returns: string
      }
      update_booking_state: {
        Args: { p_context: Json; p_phone: string; p_state: string }
        Returns: undefined
      }
      update_thread_autoreply_meta: {
        Args: { p_thread_id: string; p_tools_used: string[] }
        Returns: undefined
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

// Generated-style TypeScript types for the Phase 2 shadow database.
//
// Mirrors supabase/migrations as of 20260719000500. Written in the shape
// produced by `supabase gen types typescript`; when a local Supabase stack is
// available, regenerate with:
//   npx supabase@$(cat supabase/cli-version) gen types typescript --local
// and replace this file. Keep it in sync with the migrations.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string;
          name: string;
          sku_prefix: string;
          last_sku_number: number;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          sku_prefix?: string;
          last_sku_number?: number;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          sku_prefix?: string;
          last_sku_number?: number;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      workspace_members: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role: Database['public']['Enums']['workspace_role'];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          role: Database['public']['Enums']['workspace_role'];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          user_id?: string;
          role?: Database['public']['Enums']['workspace_role'];
          created_at?: string;
          updated_at?: string;
        };
      };
      sessions: {
        Row: {
          id: string;
          workspace_id: string;
          public_id: string;
          label: string | null;
          status: string;
          opened_at: string;
          closed_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          public_id: string;
          label?: string | null;
          status?: string;
          opened_at?: string;
          closed_at?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          public_id?: string;
          label?: string | null;
          status?: string;
          opened_at?: string;
          closed_at?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      intake_groups: {
        Row: {
          id: string;
          workspace_id: string;
          session_id: string;
          public_id: string;
          label: string;
          quantity_expected: number;
          status: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          session_id: string;
          public_id: string;
          label: string;
          quantity_expected: number;
          status?: string;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          session_id?: string;
          public_id?: string;
          label?: string;
          quantity_expected?: number;
          status?: string;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      items: {
        Row: {
          id: string;
          workspace_id: string;
          session_id: string;
          intake_group_id: string | null;
          sku: string;
          name: string | null;
          status: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          session_id: string;
          intake_group_id?: string | null;
          sku: string;
          name?: string | null;
          status?: string;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          session_id?: string;
          intake_group_id?: string | null;
          sku?: string;
          name?: string | null;
          status?: string;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      photos: {
        Row: {
          id: string;
          workspace_id: string;
          item_id: string;
          storage_path: string;
          kind: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          item_id: string;
          storage_path: string;
          kind?: string;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          item_id?: string;
          storage_path?: string;
          kind?: string;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      photo_requirements: {
        Row: {
          id: string;
          workspace_id: string;
          code: string;
          label: string;
          min_count: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          code: string;
          label: string;
          min_count?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          code?: string;
          label?: string;
          min_count?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      field_registry: {
        Row: {
          id: string;
          workspace_id: string;
          field_key: string;
          label: string;
          data_type: string;
          reference_list_id: string | null;
          is_custom: boolean;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          field_key: string;
          label: string;
          data_type: string;
          reference_list_id?: string | null;
          is_custom?: boolean;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          field_key?: string;
          label?: string;
          data_type?: string;
          reference_list_id?: string | null;
          is_custom?: boolean;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      field_rules: {
        Row: {
          id: string;
          workspace_id: string;
          field_id: string;
          rule_type: string;
          rule_config: Json;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          field_id: string;
          rule_type: string;
          rule_config?: Json;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          field_id?: string;
          rule_type?: string;
          rule_config?: Json;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      reference_lists: {
        Row: {
          id: string;
          workspace_id: string;
          list_key: string;
          label: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          list_key: string;
          label: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          list_key?: string;
          label?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      reference_options: {
        Row: {
          id: string;
          workspace_id: string;
          list_id: string;
          value: string;
          label: string;
          sort_order: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          list_id: string;
          value: string;
          label: string;
          sort_order?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          list_id?: string;
          value?: string;
          label?: string;
          sort_order?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      schema_migrations_log: {
        Row: {
          id: number;
          migration_name: string;
          applied_at: string;
        };
        Insert: {
          migration_name: string;
          applied_at?: string;
        };
        Update: {
          migration_name?: string;
          applied_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      mint_sku: {
        Args: { p_workspace_id: string };
        Returns: string;
      };
      expand_intake_group: {
        Args: { p_group_id: string };
        Returns: string[];
      };
      delete_intake_group_safe: {
        Args: { p_group_id: string };
        Returns: undefined;
      };
      create_custom_field: {
        Args: {
          p_workspace_id: string;
          p_field_key: string;
          p_label: string;
          p_data_type: string;
          p_reference_list_id?: string | null;
        };
        Returns: string;
      };
    };
    Enums: {
      workspace_role: 'owner' | 'operator' | 'viewer';
    };
    CompositeTypes: Record<string, never>;
  };
}

export type WorkspaceRole = Database['public']['Enums']['workspace_role'];

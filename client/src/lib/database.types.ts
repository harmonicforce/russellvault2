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
          setup_completed_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          sku_prefix?: string;
          last_sku_number?: number;
          setup_completed_at?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          sku_prefix?: string;
          last_sku_number?: number;
          setup_completed_at?: string | null;
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
      // --- Phase 3 staging provenance (20260719000600-000900) ---------------
      // All rows below are STAGING and NON-AUTHORITATIVE. source_records and
      // audit_events are append-only in the database, so their Update types
      // are `never`: there is no legal update, and the type system says so.
      source_systems: {
        Row: {
          id: string;
          workspace_id: string;
          public_id: string;
          kind: SourceSystemKind;
          instance_label: string;
          description: string | null;
          active: boolean;
          config: Json;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          public_id: string;
          kind: SourceSystemKind;
          instance_label: string;
          description?: string | null;
          active?: boolean;
          config?: Json;
          created_by: string;
        };
        Update: {
          instance_label?: string;
          description?: string | null;
          active?: boolean;
          config?: Json;
        };
      };
      import_jobs: {
        Row: {
          id: string;
          workspace_id: string;
          public_id: string;
          source_system_id: string;
          source_label: string;
          file_sha256: string;
          content_sha256: string;
          parser_version: string;
          mapping_version: string;
          idempotency_key: string;
          mode: 'preview' | 'commit';
          status: ImportJobStatus;
          status_changed_at: string;
          started_at: string;
          completed_at: string | null;
          source_row_count: number;
          accepted_row_count: number;
          issue_row_count: number;
          source_totals: Json;
          actor_user_id: string | null;
          actor_process: string;
          failure_code: string | null;
          failure_detail: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          public_id: string;
          source_system_id: string;
          source_label: string;
          file_sha256: string;
          content_sha256: string;
          parser_version: string;
          mapping_version: string;
          idempotency_key: string;
          mode: 'preview' | 'commit';
          status?: ImportJobStatus;
          source_row_count?: number;
          accepted_row_count?: number;
          issue_row_count?: number;
          source_totals?: Json;
          actor_user_id?: string | null;
          actor_process: string;
        };
        // Identity, hashes, versions and the idempotency key are immutable.
        Update: {
          status?: ImportJobStatus;
          completed_at?: string | null;
          source_row_count?: number;
          accepted_row_count?: number;
          issue_row_count?: number;
          source_totals?: Json;
          failure_code?: string | null;
          failure_detail?: string | null;
        };
      };
      source_records: {
        Row: {
          id: string;
          workspace_id: string;
          import_job_id: string;
          source_row_index: number;
          source_row_key: string | null;
          raw_payload: Json;
          raw_text: string | null;
          normalized_hash: string;
          parse_status: SourceParseStatus;
          parser_output: Json | null;
          parser_version: string;
          mapping_version: string;
          errors: Json;
          warnings: Json;
          created_at: string;
          created_by: string | null;
          created_by_process: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          import_job_id: string;
          source_row_index: number;
          source_row_key?: string | null;
          raw_payload: Json;
          raw_text?: string | null;
          normalized_hash: string;
          parse_status: SourceParseStatus;
          parser_output?: Json | null;
          parser_version: string;
          mapping_version: string;
          errors?: Json;
          warnings?: Json;
          created_by?: string | null;
          created_by_process: string;
        };
        /** Append-only: the database refuses every UPDATE and DELETE. */
        Update: never;
      };
      external_identifiers: {
        Row: {
          id: string;
          workspace_id: string;
          source_system_id: string;
          scope: string;
          identifier_type: string;
          identifier_value: string;
          source_record_id: string | null;
          observation_count: number;
          active: boolean;
          first_seen_at: string;
          last_seen_at: string;
          created_at: string;
          updated_at: string;
          created_by_process: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          source_system_id: string;
          scope: string;
          identifier_type: string;
          identifier_value: string;
          source_record_id?: string | null;
          observation_count?: number;
          active?: boolean;
          created_by_process: string;
        };
        Update: {
          observation_count?: number;
          active?: boolean;
          last_seen_at?: string;
        };
      };
      source_crosswalks: {
        Row: {
          id: string;
          workspace_id: string;
          source_record_id: string;
          proposed_entity_type: string;
          proposed_entity_key: string;
          confidence: number | null;
          match_method: CrosswalkMethod;
          evidence: Json;
          review_state: CrosswalkState;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_note: string | null;
          superseded_by_id: string | null;
          superseded_at: string | null;
          supersedes_id: string | null;
          created_by_process: string;
          created_at: string;
          updated_at: string;
        };
        /**
         * review_state is intentionally absent: the database forces every new
         * crosswalk to 'candidate', so it cannot be supplied on insert.
         */
        Insert: {
          id?: string;
          workspace_id: string;
          source_record_id: string;
          proposed_entity_type: string;
          proposed_entity_key: string;
          confidence?: number | null;
          match_method: CrosswalkMethod;
          evidence?: Json;
          created_by_process: string;
        };
        /**
         * Review transitions go through the governed RPCs
         * (confirm/reject/supersede), never a direct table update.
         */
        Update: never;
      };
      audit_events: {
        Row: {
          id: string;
          workspace_id: string;
          event_seq: number;
          event_type: AuditEventType;
          subject_table: string;
          subject_id: string | null;
          import_job_id: string | null;
          source_record_id: string | null;
          crosswalk_id: string | null;
          actor_user_id: string | null;
          actor_process: string;
          detail: Json;
          occurred_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          event_type: AuditEventType;
          subject_table: string;
          subject_id?: string | null;
          import_job_id?: string | null;
          source_record_id?: string | null;
          crosswalk_id?: string | null;
          actor_user_id?: string | null;
          actor_process: string;
          detail?: Json;
        };
        /** Append-only: the database refuses every UPDATE and DELETE. */
        Update: never;
      };
      data_quality_issues: {
        Row: {
          id: string;
          workspace_id: string;
          import_job_id: string;
          source_record_id: string | null;
          issue_type: DataQualityIssueType;
          severity: 'info' | 'warning' | 'error';
          message: string;
          detail: Json;
          raw_payload_snapshot: Json | null;
          status: DataQualityStatus;
          resolved_by: string | null;
          resolved_at: string | null;
          resolution_note: string | null;
          created_at: string;
          updated_at: string;
          created_by_process: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          import_job_id: string;
          source_record_id?: string | null;
          issue_type: DataQualityIssueType;
          severity?: 'info' | 'warning' | 'error';
          message: string;
          detail?: Json;
          raw_payload_snapshot?: Json | null;
          created_by_process: string;
        };
        /** Resolution goes through the resolve_data_quality_issue RPC. */
        Update: never;
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
      // --- Phase 3 governed review entry points ---------------------------
      commit_import_job: {
        Args: { p_import_job_id: string; p_idempotency_key: string };
        Returns: string;
      };
      confirm_source_crosswalk: {
        Args: { p_crosswalk_id: string; p_note?: string | null };
        Returns: string;
      };
      reject_source_crosswalk: {
        Args: { p_crosswalk_id: string; p_note?: string | null };
        Returns: string;
      };
      supersede_source_crosswalk: {
        Args: { p_crosswalk_id: string; p_replacement_id: string; p_note?: string | null };
        Returns: string;
      };
      resolve_data_quality_issue: {
        Args: {
          p_issue_id: string;
          p_status: DataQualityStatus;
          p_note?: string | null;
        };
        Returns: string;
      };
    };
    Enums: {
      workspace_role: 'owner' | 'operator' | 'viewer';
      import_job_status: 'preview' | 'committed' | 'failed';
      source_parse_status: 'parsed' | 'malformed' | 'skipped';
      crosswalk_state: 'candidate' | 'confirmed' | 'rejected' | 'superseded';
      crosswalk_method:
        | 'exact_key'
        | 'content_hash'
        | 'normalized_text'
        | 'similarity'
        | 'manual';
      data_quality_status: 'open' | 'acknowledged' | 'resolved' | 'wont_fix';
    };
    CompositeTypes: Record<string, never>;
  };
}

export type WorkspaceRole = Database['public']['Enums']['workspace_role'];

// --- Phase 3 provenance aliases -------------------------------------------
export type ImportJobStatus = Database['public']['Enums']['import_job_status'];
export type SourceParseStatus = Database['public']['Enums']['source_parse_status'];
export type CrosswalkState = Database['public']['Enums']['crosswalk_state'];
export type CrosswalkMethod = Database['public']['Enums']['crosswalk_method'];
export type DataQualityStatus = Database['public']['Enums']['data_quality_status'];

export type SourceSystemKind =
  | 'repository_fixture'
  | 'sqlite_export'
  | 'excel_export'
  | 'legacy_supabase'
  | 'manual';

export type DataQualityIssueType =
  | 'malformed_row'
  | 'conflict'
  | 'duplicate_candidate'
  | 'count_discrepancy'
  | 'total_discrepancy'
  | 'blocked_mapping'
  | 'missing_required';

export type AuditEventType =
  | 'source_system_registered'
  | 'import_previewed'
  | 'import_committed'
  | 'import_failed'
  | 'source_record_ingested'
  | 'crosswalk_candidate_created'
  | 'crosswalk_confirmed'
  | 'crosswalk_rejected'
  | 'crosswalk_superseded'
  | 'issue_opened'
  | 'issue_acknowledged'
  | 'issue_resolved'
  | 'issue_wont_fix';

export type ImportJobRow = Database['public']['Tables']['import_jobs']['Row'];
export type SourceRecordRow = Database['public']['Tables']['source_records']['Row'];
export type SourceCrosswalkRow = Database['public']['Tables']['source_crosswalks']['Row'];
export type AuditEventRow = Database['public']['Tables']['audit_events']['Row'];
export type DataQualityIssueRow =
  Database['public']['Tables']['data_quality_issues']['Row'];
export type SourceSystemRow = Database['public']['Tables']['source_systems']['Row'];

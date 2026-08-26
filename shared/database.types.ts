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
      acquisition_classification_options: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          id: string
          key: string
          label: string
          origin: string
          public_id: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order: number
          id?: string
          key: string
          label: string
          origin: string
          public_id?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          key?: string
          label?: string
          origin?: string
          public_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_classification_options_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_cost_allocations: {
        Row: {
          amount_minor: number
          cost_component_id: string
          created_at: string
          created_by_process: string
          id: string
          line_item_id: string
          method: string
          public_id: string
          reversed_at: string | null
          reversed_by_id: string | null
          reverses_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state: Database["public"]["Enums"]["cost_allocation_state"]
          workspace_id: string
        }
        Insert: {
          amount_minor: number
          cost_component_id: string
          created_at?: string
          created_by_process: string
          id?: string
          line_item_id: string
          method: string
          public_id: string
          reversed_at?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: Database["public"]["Enums"]["cost_allocation_state"]
          workspace_id: string
        }
        Update: {
          amount_minor?: number
          cost_component_id?: string
          created_at?: string
          created_by_process?: string
          id?: string
          line_item_id?: string
          method?: string
          public_id?: string
          reversed_at?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: Database["public"]["Enums"]["cost_allocation_state"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_cost_allocations_cost_component_id_workspace_i_fkey"
            columns: ["cost_component_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_cost_components"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_allocations_line_item_id_workspace_id_fkey"
            columns: ["line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_allocations_line_item_id_workspace_id_fkey"
            columns: ["line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_overview"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_allocations_line_item_id_workspace_id_fkey"
            columns: ["line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "unresolved_inventory_cost_basis"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_allocations_reversed_by_id_workspace_id_fkey"
            columns: ["reversed_by_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_cost_allocations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_allocations_reverses_id_workspace_id_fkey"
            columns: ["reverses_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_cost_allocations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_allocations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_cost_components: {
        Row: {
          acquisition_import_job_id: string
          active_scope_key: string | null
          amount_minor: number | null
          amount_state: Database["public"]["Enums"]["cost_amount_state"]
          attribution_state: Database["public"]["Enums"]["cost_attribution_state"]
          component_type: Database["public"]["Enums"]["cost_component_type"]
          created_at: string
          created_by_process: string
          currency: string
          evidence_note: string | null
          id: string
          line_item_id: string | null
          lot_id: string | null
          order_id: string | null
          public_id: string
          reversed_at: string | null
          reversed_by_id: string | null
          reverses_id: string | null
          source_record_id: string | null
          workspace_id: string
        }
        Insert: {
          acquisition_import_job_id: string
          active_scope_key?: string | null
          amount_minor?: number | null
          amount_state: Database["public"]["Enums"]["cost_amount_state"]
          attribution_state: Database["public"]["Enums"]["cost_attribution_state"]
          component_type: Database["public"]["Enums"]["cost_component_type"]
          created_at?: string
          created_by_process: string
          currency: string
          evidence_note?: string | null
          id?: string
          line_item_id?: string | null
          lot_id?: string | null
          order_id?: string | null
          public_id: string
          reversed_at?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          source_record_id?: string | null
          workspace_id: string
        }
        Update: {
          acquisition_import_job_id?: string
          active_scope_key?: string | null
          amount_minor?: number | null
          amount_state?: Database["public"]["Enums"]["cost_amount_state"]
          attribution_state?: Database["public"]["Enums"]["cost_attribution_state"]
          component_type?: Database["public"]["Enums"]["cost_component_type"]
          created_at?: string
          created_by_process?: string
          currency?: string
          evidence_note?: string | null
          id?: string
          line_item_id?: string | null
          lot_id?: string | null
          order_id?: string | null
          public_id?: string
          reversed_at?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          source_record_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_cost_components_acquisition_import_job_id_work_fkey"
            columns: ["acquisition_import_job_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_import_jobs"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_components_line_item_id_workspace_id_fkey"
            columns: ["line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_components_line_item_id_workspace_id_fkey"
            columns: ["line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_overview"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_components_line_item_id_workspace_id_fkey"
            columns: ["line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "unresolved_inventory_cost_basis"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_components_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_components_order_id_workspace_id_fkey"
            columns: ["order_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_orders"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_components_reversed_by_id_workspace_id_fkey"
            columns: ["reversed_by_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_cost_components"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_components_reverses_id_workspace_id_fkey"
            columns: ["reverses_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_cost_components"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_components_source_record_id_workspace_id_fkey"
            columns: ["source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_cost_components_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_discrepancies: {
        Row: {
          acquisition_line_item_id: string | null
          acquisition_order_id: string
          acquisition_receipt_id: string | null
          acquisition_receipt_line_id: string | null
          actual_value_minor: number | null
          created_at: string
          created_by: string
          currency: string | null
          detail: string
          expected_value_minor: number | null
          id: string
          kind: Database["public"]["Enums"]["acquisition_discrepancy_kind"]
          public_id: string
          quantity_expected: number | null
          quantity_observed: number | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["acquisition_discrepancy_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          acquisition_line_item_id?: string | null
          acquisition_order_id: string
          acquisition_receipt_id?: string | null
          acquisition_receipt_line_id?: string | null
          actual_value_minor?: number | null
          created_at?: string
          created_by: string
          currency?: string | null
          detail: string
          expected_value_minor?: number | null
          id?: string
          kind: Database["public"]["Enums"]["acquisition_discrepancy_kind"]
          public_id?: string
          quantity_expected?: number | null
          quantity_observed?: number | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["acquisition_discrepancy_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          acquisition_line_item_id?: string | null
          acquisition_order_id?: string
          acquisition_receipt_id?: string | null
          acquisition_receipt_line_id?: string | null
          actual_value_minor?: number | null
          created_at?: string
          created_by?: string
          currency?: string | null
          detail?: string
          expected_value_minor?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["acquisition_discrepancy_kind"]
          public_id?: string
          quantity_expected?: number | null
          quantity_observed?: number | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["acquisition_discrepancy_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_discrepancies_acquisition_line_item_id_workspa_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_discrepancies_acquisition_line_item_id_workspa_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_overview"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_discrepancies_acquisition_line_item_id_workspa_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "unresolved_inventory_cost_basis"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_discrepancies_acquisition_order_id_workspace_i_fkey"
            columns: ["acquisition_order_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_orders"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_discrepancies_acquisition_receipt_id_acquisiti_fkey"
            columns: [
              "acquisition_receipt_id",
              "acquisition_order_id",
              "workspace_id",
            ]
            isOneToOne: false
            referencedRelation: "acquisition_receipts"
            referencedColumns: ["id", "acquisition_order_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_discrepancies_acquisition_receipt_line_id_acq_fkey1"
            columns: [
              "acquisition_receipt_line_id",
              "acquisition_line_item_id",
              "workspace_id",
            ]
            isOneToOne: false
            referencedRelation: "acquisition_receipt_lines"
            referencedColumns: [
              "id",
              "acquisition_line_item_id",
              "workspace_id",
            ]
          },
          {
            foreignKeyName: "acquisition_discrepancies_acquisition_receipt_line_id_acqu_fkey"
            columns: [
              "acquisition_receipt_line_id",
              "acquisition_receipt_id",
              "workspace_id",
            ]
            isOneToOne: false
            referencedRelation: "acquisition_receipt_lines"
            referencedColumns: ["id", "acquisition_receipt_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_discrepancies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_import_jobs: {
        Row: {
          actor_process: string
          actor_user_id: string | null
          channel_id: string
          committed_cost_components: number | null
          committed_line_items: number | null
          committed_lots: number | null
          committed_orders: number | null
          committed_unresolved_cost_components: number | null
          committed_unresolved_supplier_candidates: number | null
          completed_at: string | null
          created_at: string
          expected_line_count: number
          failure_code: string | null
          failure_detail: string | null
          id: string
          idempotency_key: string
          mapping_version: string
          mode: string
          plan_sha256: string
          source_import_job_id: string
          started_at: string
          status: Database["public"]["Enums"]["import_job_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actor_process: string
          actor_user_id?: string | null
          channel_id: string
          committed_cost_components?: number | null
          committed_line_items?: number | null
          committed_lots?: number | null
          committed_orders?: number | null
          committed_unresolved_cost_components?: number | null
          committed_unresolved_supplier_candidates?: number | null
          completed_at?: string | null
          created_at?: string
          expected_line_count: number
          failure_code?: string | null
          failure_detail?: string | null
          id?: string
          idempotency_key: string
          mapping_version: string
          mode: string
          plan_sha256: string
          source_import_job_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["import_job_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actor_process?: string
          actor_user_id?: string | null
          channel_id?: string
          committed_cost_components?: number | null
          committed_line_items?: number | null
          committed_lots?: number | null
          committed_orders?: number | null
          committed_unresolved_cost_components?: number | null
          committed_unresolved_supplier_candidates?: number | null
          completed_at?: string | null
          created_at?: string
          expected_line_count?: number
          failure_code?: string | null
          failure_detail?: string | null
          id?: string
          idempotency_key?: string
          mapping_version?: string
          mode?: string
          plan_sha256?: string
          source_import_job_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["import_job_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_import_jobs_channel_id_workspace_id_fkey"
            columns: ["channel_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_import_jobs_source_import_job_id_workspace_id_fkey"
            columns: ["source_import_job_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_import_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_line_classifications: {
        Row: {
          acquisition_line_item_id: string
          classification_option_id: string
          confidence: number
          created_at: string
          created_by: string | null
          evidence: Json
          id: string
          method: string
          public_id: string
          rule_id: string | null
          rule_version: number | null
          superseded_at: string | null
          supersedes_classification_id: string | null
          system_provenance: string | null
          workspace_id: string
        }
        Insert: {
          acquisition_line_item_id: string
          classification_option_id: string
          confidence: number
          created_at?: string
          created_by?: string | null
          evidence?: Json
          id?: string
          method: string
          public_id?: string
          rule_id?: string | null
          rule_version?: number | null
          superseded_at?: string | null
          supersedes_classification_id?: string | null
          system_provenance?: string | null
          workspace_id: string
        }
        Update: {
          acquisition_line_item_id?: string
          classification_option_id?: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          evidence?: Json
          id?: string
          method?: string
          public_id?: string
          rule_id?: string | null
          rule_version?: number | null
          superseded_at?: string | null
          supersedes_classification_id?: string | null
          system_provenance?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_line_classificati_acquisition_line_item_id_wor_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_classificati_acquisition_line_item_id_wor_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_overview"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_classificati_acquisition_line_item_id_wor_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "unresolved_inventory_cost_basis"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_classificati_classification_option_id_wor_fkey"
            columns: ["classification_option_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_classification_options"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_classificati_supersedes_classification_id_fkey"
            columns: ["supersedes_classification_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_classifications"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_classifications_rule_id_workspace_id_fkey"
            columns: ["rule_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "classification_rules"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_classifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_line_exclusions: {
        Row: {
          acquisition_line_item_id: string
          created_at: string
          created_by: string
          decision_state: Database["public"]["Enums"]["acquisition_line_exclusion_state"]
          id: string
          idempotency_key: string
          payload_fingerprint: string
          public_id: string
          reason: string
          superseded_at: string | null
          superseded_by_exclusion_id: string | null
          supersedes_exclusion_id: string | null
          workspace_id: string
        }
        Insert: {
          acquisition_line_item_id: string
          created_at?: string
          created_by: string
          decision_state: Database["public"]["Enums"]["acquisition_line_exclusion_state"]
          id?: string
          idempotency_key: string
          payload_fingerprint: string
          public_id?: string
          reason: string
          superseded_at?: string | null
          superseded_by_exclusion_id?: string | null
          supersedes_exclusion_id?: string | null
          workspace_id: string
        }
        Update: {
          acquisition_line_item_id?: string
          created_at?: string
          created_by?: string
          decision_state?: Database["public"]["Enums"]["acquisition_line_exclusion_state"]
          id?: string
          idempotency_key?: string
          payload_fingerprint?: string
          public_id?: string
          reason?: string
          superseded_at?: string | null
          superseded_by_exclusion_id?: string | null
          supersedes_exclusion_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_line_exclusions_acquisition_line_item_id_works_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_exclusions_acquisition_line_item_id_works_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_overview"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_exclusions_acquisition_line_item_id_works_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "unresolved_inventory_cost_basis"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_exclusions_superseded_by_exclusion_id_wor_fkey"
            columns: ["superseded_by_exclusion_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_exclusions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_exclusions_supersedes_exclusion_id_worksp_fkey"
            columns: ["supersedes_exclusion_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_exclusions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_exclusions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_line_items: {
        Row: {
          acquisition_import_job_id: string
          created_at: string
          created_by_process: string
          description: string | null
          external_identifier_id: string | null
          id: string
          public_id: string
          quantity: number
          reference_number: string | null
          source_detail: Json
          source_record_id: string
          source_system_id: string
          workspace_id: string
        }
        Insert: {
          acquisition_import_job_id: string
          created_at?: string
          created_by_process: string
          description?: string | null
          external_identifier_id?: string | null
          id?: string
          public_id: string
          quantity: number
          reference_number?: string | null
          source_detail?: Json
          source_record_id: string
          source_system_id: string
          workspace_id: string
        }
        Update: {
          acquisition_import_job_id?: string
          created_at?: string
          created_by_process?: string
          description?: string | null
          external_identifier_id?: string | null
          id?: string
          public_id?: string
          quantity?: number
          reference_number?: string | null
          source_detail?: Json
          source_record_id?: string
          source_system_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_line_items_acquisition_import_job_id_workspace_fkey"
            columns: ["acquisition_import_job_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_import_jobs"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_items_external_identifier_id_workspace_id_fkey"
            columns: ["external_identifier_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "external_identifiers"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_items_source_record_id_workspace_id_fkey"
            columns: ["source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_items_source_system_id_workspace_id_fkey"
            columns: ["source_system_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_systems"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_lot_lines: {
        Row: {
          active_line_item_id: string | null
          created_at: string
          created_by_process: string
          id: string
          line_item_id: string
          lot_id: string
          sequence_no: number
          state: Database["public"]["Enums"]["lot_line_state"]
          superseded_at: string | null
          superseded_by_id: string | null
          supersedes_id: string | null
          workspace_id: string
        }
        Insert: {
          active_line_item_id?: string | null
          created_at?: string
          created_by_process: string
          id?: string
          line_item_id: string
          lot_id: string
          sequence_no?: number
          state?: Database["public"]["Enums"]["lot_line_state"]
          superseded_at?: string | null
          superseded_by_id?: string | null
          supersedes_id?: string | null
          workspace_id: string
        }
        Update: {
          active_line_item_id?: string | null
          created_at?: string
          created_by_process?: string
          id?: string
          line_item_id?: string
          lot_id?: string
          sequence_no?: number
          state?: Database["public"]["Enums"]["lot_line_state"]
          superseded_at?: string | null
          superseded_by_id?: string | null
          supersedes_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_lot_lines_line_item_id_workspace_id_fkey"
            columns: ["line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_lot_lines_line_item_id_workspace_id_fkey"
            columns: ["line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_overview"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_lot_lines_line_item_id_workspace_id_fkey"
            columns: ["line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "unresolved_inventory_cost_basis"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_lot_lines_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_lot_lines_superseded_by_id_workspace_id_fkey"
            columns: ["superseded_by_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_lot_lines"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_lot_lines_supersedes_id_workspace_id_fkey"
            columns: ["supersedes_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_lot_lines"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_lot_lines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_lots: {
        Row: {
          created_at: string
          created_by_process: string
          id: string
          label: string | null
          order_id: string
          public_id: string
          sequence_no: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by_process: string
          id?: string
          label?: string | null
          order_id: string
          public_id: string
          sequence_no?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by_process?: string
          id?: string
          label?: string | null
          order_id?: string
          public_id?: string
          sequence_no?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_lots_order_id_workspace_id_fkey"
            columns: ["order_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_orders"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_lots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_orders: {
        Row: {
          acquisition_import_job_id: string
          channel_id: string
          created_at: string
          created_by_process: string
          currency: string | null
          first_source_record_id: string
          id: string
          occurred_at: string | null
          order_status: Database["public"]["Enums"]["acquisition_order_status"]
          public_id: string
          source_order_reference: string
          source_reported_status: string | null
          source_reported_total_minor: number | null
          source_system_id: string
          supplier_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          acquisition_import_job_id: string
          channel_id: string
          created_at?: string
          created_by_process: string
          currency?: string | null
          first_source_record_id: string
          id?: string
          occurred_at?: string | null
          order_status?: Database["public"]["Enums"]["acquisition_order_status"]
          public_id: string
          source_order_reference: string
          source_reported_status?: string | null
          source_reported_total_minor?: number | null
          source_system_id: string
          supplier_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          acquisition_import_job_id?: string
          channel_id?: string
          created_at?: string
          created_by_process?: string
          currency?: string | null
          first_source_record_id?: string
          id?: string
          occurred_at?: string | null
          order_status?: Database["public"]["Enums"]["acquisition_order_status"]
          public_id?: string
          source_order_reference?: string
          source_reported_status?: string | null
          source_reported_total_minor?: number | null
          source_system_id?: string
          supplier_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_orders_acquisition_import_job_id_workspace_id_fkey"
            columns: ["acquisition_import_job_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_import_jobs"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_orders_channel_id_workspace_id_fkey"
            columns: ["channel_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_orders_first_source_record_id_workspace_id_fkey"
            columns: ["first_source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_orders_source_system_id_workspace_id_fkey"
            columns: ["source_system_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_systems"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_orders_supplier_id_workspace_id_fkey"
            columns: ["supplier_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_orders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_payment_reversals: {
        Row: {
          acquisition_payment_id: string
          created_at: string
          id: string
          idempotency_key: string
          payload_fingerprint: string
          public_id: string
          reason: string
          reversed_at: string
          reversed_by: string
          workspace_id: string
        }
        Insert: {
          acquisition_payment_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          payload_fingerprint: string
          public_id?: string
          reason: string
          reversed_at?: string
          reversed_by: string
          workspace_id: string
        }
        Update: {
          acquisition_payment_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          payload_fingerprint?: string
          public_id?: string
          reason?: string
          reversed_at?: string
          reversed_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_payment_reversals_acquisition_payment_id_works_fkey"
            columns: ["acquisition_payment_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_payments"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_payment_reversals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_payments: {
        Row: {
          acquisition_order_id: string
          amount_minor: number
          created_at: string
          created_by: string
          currency: string
          evidence_note: string | null
          external_reference: string | null
          id: string
          idempotency_key: string
          instrument: Database["public"]["Enums"]["acquisition_payment_instrument"]
          paid_at: string
          payload_fingerprint: string
          public_id: string
          reversal_event_id: string | null
          reversal_idempotency_key: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          source_record_id: string | null
          workspace_id: string
        }
        Insert: {
          acquisition_order_id: string
          amount_minor: number
          created_at?: string
          created_by: string
          currency: string
          evidence_note?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key: string
          instrument: Database["public"]["Enums"]["acquisition_payment_instrument"]
          paid_at: string
          payload_fingerprint: string
          public_id?: string
          reversal_event_id?: string | null
          reversal_idempotency_key?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          source_record_id?: string | null
          workspace_id: string
        }
        Update: {
          acquisition_order_id?: string
          amount_minor?: number
          created_at?: string
          created_by?: string
          currency?: string
          evidence_note?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string
          instrument?: Database["public"]["Enums"]["acquisition_payment_instrument"]
          paid_at?: string
          payload_fingerprint?: string
          public_id?: string
          reversal_event_id?: string | null
          reversal_idempotency_key?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          source_record_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_payments_acquisition_order_id_workspace_id_fkey"
            columns: ["acquisition_order_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_orders"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_payments_reversal_event_fk"
            columns: ["reversal_event_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_payment_reversals"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_payments_source_record_id_workspace_id_fkey"
            columns: ["source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_receipt_line_inventory_links: {
        Row: {
          acquisition_receipt_line_id: string
          created_at: string
          created_by: string
          id: string
          inventory_item_id: string | null
          inventory_lot_id: string | null
          public_id: string
          quantity_linked: number
          workspace_id: string
        }
        Insert: {
          acquisition_receipt_line_id: string
          created_at?: string
          created_by: string
          id?: string
          inventory_item_id?: string | null
          inventory_lot_id?: string | null
          public_id?: string
          quantity_linked: number
          workspace_id: string
        }
        Update: {
          acquisition_receipt_line_id?: string
          created_at?: string
          created_by?: string
          id?: string
          inventory_item_id?: string | null
          inventory_lot_id?: string | null
          public_id?: string
          quantity_linked?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_receipt_line_inve_acquisition_receipt_line_id__fkey"
            columns: ["acquisition_receipt_line_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_receipt_lines"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipt_line_inve_inventory_item_id_workspace__fkey"
            columns: ["inventory_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipt_line_inve_inventory_item_id_workspace__fkey"
            columns: ["inventory_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipt_line_inve_inventory_lot_id_workspace_i_fkey"
            columns: ["inventory_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipt_line_inve_inventory_lot_id_workspace_i_fkey"
            columns: ["inventory_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipt_line_inventory_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_receipt_lines: {
        Row: {
          acquisition_line_item_id: string
          acquisition_receipt_id: string
          created_at: string
          created_by: string
          id: string
          note: string | null
          public_id: string
          quantity_received: number
          workspace_id: string
        }
        Insert: {
          acquisition_line_item_id: string
          acquisition_receipt_id: string
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          public_id?: string
          quantity_received: number
          workspace_id: string
        }
        Update: {
          acquisition_line_item_id?: string
          acquisition_receipt_id?: string
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          public_id?: string
          quantity_received?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_receipt_lines_acquisition_line_item_id_workspa_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipt_lines_acquisition_line_item_id_workspa_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_overview"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipt_lines_acquisition_line_item_id_workspa_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "unresolved_inventory_cost_basis"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipt_lines_acquisition_receipt_id_workspace_fkey"
            columns: ["acquisition_receipt_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_receipts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipt_lines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_receipts: {
        Row: {
          acquisition_order_id: string
          acquisition_shipment_id: string | null
          create_fingerprint: string
          create_idempotency_key: string
          created_at: string
          created_by: string
          id: string
          note: string | null
          public_id: string
          received_at: string | null
          status: Database["public"]["Enums"]["acquisition_receipt_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          acquisition_order_id: string
          acquisition_shipment_id?: string | null
          create_fingerprint: string
          create_idempotency_key: string
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          public_id?: string
          received_at?: string | null
          status?: Database["public"]["Enums"]["acquisition_receipt_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          acquisition_order_id?: string
          acquisition_shipment_id?: string | null
          create_fingerprint?: string
          create_idempotency_key?: string
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          public_id?: string
          received_at?: string | null
          status?: Database["public"]["Enums"]["acquisition_receipt_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_receipts_acquisition_order_id_workspace_id_fkey"
            columns: ["acquisition_order_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_orders"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipts_acquisition_shipment_id_acquisition_o_fkey"
            columns: [
              "acquisition_shipment_id",
              "acquisition_order_id",
              "workspace_id",
            ]
            isOneToOne: false
            referencedRelation: "acquisition_shipments"
            referencedColumns: ["id", "acquisition_order_id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_receipts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_shipment_transitions: {
        Row: {
          acquisition_shipment_id: string
          applied: boolean
          created_at: string
          from_status: Database["public"]["Enums"]["acquisition_shipment_status"]
          id: string
          idempotency_key: string
          payload_fingerprint: string
          public_id: string
          reason: string | null
          received_at: string | null
          to_status: Database["public"]["Enums"]["acquisition_shipment_status"]
          transitioned_by: string
          workspace_id: string
        }
        Insert: {
          acquisition_shipment_id: string
          applied: boolean
          created_at?: string
          from_status: Database["public"]["Enums"]["acquisition_shipment_status"]
          id?: string
          idempotency_key: string
          payload_fingerprint: string
          public_id?: string
          reason?: string | null
          received_at?: string | null
          to_status: Database["public"]["Enums"]["acquisition_shipment_status"]
          transitioned_by: string
          workspace_id: string
        }
        Update: {
          acquisition_shipment_id?: string
          applied?: boolean
          created_at?: string
          from_status?: Database["public"]["Enums"]["acquisition_shipment_status"]
          id?: string
          idempotency_key?: string
          payload_fingerprint?: string
          public_id?: string
          reason?: string | null
          received_at?: string | null
          to_status?: Database["public"]["Enums"]["acquisition_shipment_status"]
          transitioned_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_shipment_transiti_acquisition_shipment_id_work_fkey"
            columns: ["acquisition_shipment_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_shipments"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_shipment_transitions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      acquisition_shipments: {
        Row: {
          acquisition_order_id: string
          carrier: string | null
          create_fingerprint: string
          create_idempotency_key: string
          created_at: string
          created_by: string
          currency: string | null
          evidence_note: string | null
          expected_at: string | null
          id: string
          public_id: string
          received_at: string | null
          shipped_at: string | null
          shipping_cost_minor: number | null
          source_record_id: string | null
          status: Database["public"]["Enums"]["acquisition_shipment_status"]
          tracking_number: string | null
          transition_fingerprint: string | null
          transition_idempotency_key: string | null
          transition_reason: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          acquisition_order_id: string
          carrier?: string | null
          create_fingerprint: string
          create_idempotency_key: string
          created_at?: string
          created_by: string
          currency?: string | null
          evidence_note?: string | null
          expected_at?: string | null
          id?: string
          public_id?: string
          received_at?: string | null
          shipped_at?: string | null
          shipping_cost_minor?: number | null
          source_record_id?: string | null
          status?: Database["public"]["Enums"]["acquisition_shipment_status"]
          tracking_number?: string | null
          transition_fingerprint?: string | null
          transition_idempotency_key?: string | null
          transition_reason?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          acquisition_order_id?: string
          carrier?: string | null
          create_fingerprint?: string
          create_idempotency_key?: string
          created_at?: string
          created_by?: string
          currency?: string | null
          evidence_note?: string | null
          expected_at?: string | null
          id?: string
          public_id?: string
          received_at?: string | null
          shipped_at?: string | null
          shipping_cost_minor?: number | null
          source_record_id?: string | null
          status?: Database["public"]["Enums"]["acquisition_shipment_status"]
          tracking_number?: string | null
          transition_fingerprint?: string | null
          transition_idempotency_key?: string | null
          transition_reason?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_shipments_acquisition_order_id_workspace_id_fkey"
            columns: ["acquisition_order_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_orders"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_shipments_source_record_id_workspace_id_fkey"
            columns: ["source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_shipments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_process: string
          actor_user_id: string | null
          created_at: string
          crosswalk_id: string | null
          detail: Json
          event_seq: number
          event_type: string
          id: string
          import_job_id: string | null
          occurred_at: string
          source_record_id: string | null
          subject_id: string | null
          subject_table: string
          workspace_id: string
        }
        Insert: {
          actor_process: string
          actor_user_id?: string | null
          created_at?: string
          crosswalk_id?: string | null
          detail?: Json
          event_seq?: never
          event_type: string
          id?: string
          import_job_id?: string | null
          occurred_at?: string
          source_record_id?: string | null
          subject_id?: string | null
          subject_table: string
          workspace_id: string
        }
        Update: {
          actor_process?: string
          actor_user_id?: string | null
          created_at?: string
          crosswalk_id?: string | null
          detail?: Json
          event_seq?: never
          event_type?: string
          id?: string
          import_job_id?: string | null
          occurred_at?: string
          source_record_id?: string | null
          subject_id?: string | null
          subject_table?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_crosswalk_id_workspace_id_fkey"
            columns: ["crosswalk_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_crosswalks"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "audit_events_import_job_id_workspace_id_fkey"
            columns: ["import_job_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "audit_events_source_record_id_workspace_id_fkey"
            columns: ["source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "audit_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          description: string | null
          id: string
          kind: string
          name: string
          public_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          kind: string
          name: string
          public_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          kind?: string
          name?: string
          public_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_rules: {
        Row: {
          authored_by: string | null
          created_at: string
          exact_value: string | null
          id: string
          logical_key: string
          match_field: string
          matcher_kind: string
          pattern: string | null
          pattern_flags: string | null
          precedence: number
          public_id: string
          rationale: string
          rule_family: string
          source: string
          status: string
          supersedes_rule_id: string | null
          target_classification_option_id: string
          version: number
          workspace_id: string
        }
        Insert: {
          authored_by?: string | null
          created_at?: string
          exact_value?: string | null
          id?: string
          logical_key: string
          match_field: string
          matcher_kind: string
          pattern?: string | null
          pattern_flags?: string | null
          precedence: number
          public_id?: string
          rationale: string
          rule_family: string
          source: string
          status: string
          supersedes_rule_id?: string | null
          target_classification_option_id: string
          version: number
          workspace_id: string
        }
        Update: {
          authored_by?: string | null
          created_at?: string
          exact_value?: string | null
          id?: string
          logical_key?: string
          match_field?: string
          matcher_kind?: string
          pattern?: string | null
          pattern_flags?: string | null
          precedence?: number
          public_id?: string
          rationale?: string
          rule_family?: string
          source?: string
          status?: string
          supersedes_rule_id?: string | null
          target_classification_option_id?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classification_rules_supersedes_rule_id_workspace_id_fkey"
            columns: ["supersedes_rule_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "classification_rules"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "classification_rules_target_classification_option_id_works_fkey"
            columns: ["target_classification_option_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_classification_options"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "classification_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_discrepancies: {
        Row: {
          deferral_reason: string | null
          detected_at: string
          discrepancy_kind: Database["public"]["Enums"]["cycle_count_discrepancy_kind"]
          expected_item_id: string | null
          expected_location_id: string | null
          expected_lot_id: string | null
          expected_quantity: number | null
          id: string
          item_id: string | null
          lot_id: string | null
          observed_location_id: string | null
          observed_quantity: number | null
          public_id: string
          recount_outcome:
            | Database["public"]["Enums"]["cycle_count_round_result_classification"]
            | null
          recount_requested_at: string | null
          recount_requested_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          round_result_id: string | null
          session_id: string
          status: Database["public"]["Enums"]["cycle_count_discrepancy_status"]
          superseded_by_discrepancy_id: string | null
          workspace_id: string
        }
        Insert: {
          deferral_reason?: string | null
          detected_at?: string
          discrepancy_kind: Database["public"]["Enums"]["cycle_count_discrepancy_kind"]
          expected_item_id?: string | null
          expected_location_id?: string | null
          expected_lot_id?: string | null
          expected_quantity?: number | null
          id?: string
          item_id?: string | null
          lot_id?: string | null
          observed_location_id?: string | null
          observed_quantity?: number | null
          public_id: string
          recount_outcome?:
            | Database["public"]["Enums"]["cycle_count_round_result_classification"]
            | null
          recount_requested_at?: string | null
          recount_requested_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          round_result_id?: string | null
          session_id: string
          status?: Database["public"]["Enums"]["cycle_count_discrepancy_status"]
          superseded_by_discrepancy_id?: string | null
          workspace_id: string
        }
        Update: {
          deferral_reason?: string | null
          detected_at?: string
          discrepancy_kind?: Database["public"]["Enums"]["cycle_count_discrepancy_kind"]
          expected_item_id?: string | null
          expected_location_id?: string | null
          expected_lot_id?: string | null
          expected_quantity?: number | null
          id?: string
          item_id?: string | null
          lot_id?: string | null
          observed_location_id?: string | null
          observed_quantity?: number | null
          public_id?: string
          recount_outcome?:
            | Database["public"]["Enums"]["cycle_count_round_result_classification"]
            | null
          recount_requested_at?: string | null
          recount_requested_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          round_result_id?: string | null
          session_id?: string
          status?: Database["public"]["Enums"]["cycle_count_discrepancy_status"]
          superseded_by_discrepancy_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_discrepancies_expected_item_id_workspace_id_fkey"
            columns: ["expected_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_expected_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_expected_lot_id_workspace_id_fkey"
            columns: ["expected_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_expected_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_round_result_fk"
            columns: ["round_result_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_latest_round_results"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_round_result_fk"
            columns: ["round_result_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_round_results"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_successor_fk"
            columns: ["superseded_by_discrepancy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_discrepancies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_discrepancies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_expected_items: {
        Row: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          certificate_number: string | null
          display_name: string
          expected_location_code: string
          expected_location_id: string
          grading_company: string | null
          id: string
          inventory_subtype: Database["public"]["Enums"]["inventory_subtype"]
          item_id: string
          item_public_id: string
          item_state: Database["public"]["Enums"]["inventory_item_state"]
          product_id: string
          product_public_id: string
          scan_sku: string
          serial_number: string | null
          session_id: string
          sku_id: string
          sku_public_id: string
          snapshot_at: string
          workspace_id: string
        }
        Insert: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          certificate_number?: string | null
          display_name: string
          expected_location_code: string
          expected_location_id: string
          grading_company?: string | null
          id?: string
          inventory_subtype: Database["public"]["Enums"]["inventory_subtype"]
          item_id: string
          item_public_id: string
          item_state: Database["public"]["Enums"]["inventory_item_state"]
          product_id: string
          product_public_id: string
          scan_sku: string
          serial_number?: string | null
          session_id: string
          sku_id: string
          sku_public_id: string
          snapshot_at?: string
          workspace_id: string
        }
        Update: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          certificate_number?: string | null
          display_name?: string
          expected_location_code?: string
          expected_location_id?: string
          grading_company?: string | null
          id?: string
          inventory_subtype?: Database["public"]["Enums"]["inventory_subtype"]
          item_id?: string
          item_public_id?: string
          item_state?: Database["public"]["Enums"]["inventory_item_state"]
          product_id?: string
          product_public_id?: string
          scan_sku?: string
          serial_number?: string | null
          session_id?: string
          sku_id?: string
          sku_public_id?: string
          snapshot_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_expected_items_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_expected_items_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_expected_items_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_expected_items_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_expected_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_expected_lots: {
        Row: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          display_name: string
          expected_location_code: string
          expected_location_id: string
          expected_quantity: number
          id: string
          inventory_subtype: Database["public"]["Enums"]["inventory_subtype"]
          lot_id: string
          lot_public_id: string
          lot_state: Database["public"]["Enums"]["inventory_lot_state"]
          product_id: string
          product_public_id: string
          session_id: string
          sku_id: string
          sku_public_id: string
          snapshot_at: string
          workspace_id: string
        }
        Insert: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          display_name: string
          expected_location_code: string
          expected_location_id: string
          expected_quantity: number
          id?: string
          inventory_subtype: Database["public"]["Enums"]["inventory_subtype"]
          lot_id: string
          lot_public_id: string
          lot_state: Database["public"]["Enums"]["inventory_lot_state"]
          product_id: string
          product_public_id: string
          session_id: string
          sku_id: string
          sku_public_id: string
          snapshot_at?: string
          workspace_id: string
        }
        Update: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          display_name?: string
          expected_location_code?: string
          expected_location_id?: string
          expected_quantity?: number
          id?: string
          inventory_subtype?: Database["public"]["Enums"]["inventory_subtype"]
          lot_id?: string
          lot_public_id?: string
          lot_state?: Database["public"]["Enums"]["inventory_lot_state"]
          product_id?: string
          product_public_id?: string
          session_id?: string
          sku_id?: string
          sku_public_id?: string
          snapshot_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_expected_lots_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_expected_lots_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_expected_lots_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_expected_lots_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_expected_lots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_item_observations: {
        Row: {
          count_round: number
          expected_item_id: string | null
          id: string
          idempotency_key: string | null
          item_id: string
          note: string | null
          observation_kind: Database["public"]["Enums"]["cycle_count_item_observation_kind"]
          observed_at: string
          observed_by: string
          observed_location_id: string
          raw_identifier: string
          round_id: string | null
          session_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          workspace_id: string
        }
        Insert: {
          count_round?: number
          expected_item_id?: string | null
          id?: string
          idempotency_key?: string | null
          item_id: string
          note?: string | null
          observation_kind: Database["public"]["Enums"]["cycle_count_item_observation_kind"]
          observed_at?: string
          observed_by: string
          observed_location_id: string
          raw_identifier: string
          round_id?: string | null
          session_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          workspace_id: string
        }
        Update: {
          count_round?: number
          expected_item_id?: string | null
          id?: string
          idempotency_key?: string | null
          item_id?: string
          note?: string | null
          observation_kind?: Database["public"]["Enums"]["cycle_count_item_observation_kind"]
          observed_at?: string
          observed_by?: string
          observed_location_id?: string
          raw_identifier?: string
          round_id?: string | null
          session_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_item_observations_expected_item_id_workspace_i_fkey"
            columns: ["expected_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_expected_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_item_observations_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_item_observations_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_item_observations_observed_location_id_workspa_fkey"
            columns: ["observed_location_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_item_observations_round_fk"
            columns: ["round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_item_observations_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_item_observations_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_item_observations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_lot_observations: {
        Row: {
          count_round: number
          expected_lot_id: string
          expected_quantity: number
          id: string
          idempotency_key: string | null
          lot_id: string
          note: string | null
          observed_at: string
          observed_by: string
          observed_quantity: number
          round_id: string | null
          session_id: string
          variance: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          workspace_id: string
        }
        Insert: {
          count_round?: number
          expected_lot_id: string
          expected_quantity: number
          id?: string
          idempotency_key?: string | null
          lot_id: string
          note?: string | null
          observed_at?: string
          observed_by: string
          observed_quantity: number
          round_id?: string | null
          session_id: string
          variance: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          workspace_id: string
        }
        Update: {
          count_round?: number
          expected_lot_id?: string
          expected_quantity?: number
          id?: string
          idempotency_key?: string | null
          lot_id?: string
          note?: string | null
          observed_at?: string
          observed_by?: string
          observed_quantity?: number
          round_id?: string | null
          session_id?: string
          variance?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_lot_observations_expected_lot_id_workspace_id_fkey"
            columns: ["expected_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_expected_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_lot_observations_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_lot_observations_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_lot_observations_round_fk"
            columns: ["round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_lot_observations_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_lot_observations_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_lot_observations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_observation_attempts: {
        Row: {
          attempted_at: string
          attempted_by: string
          detail_code: string | null
          id: string
          idempotency_key: string
          item_observation_id: string | null
          lot_observation_id: string | null
          outcome: string
          payload_fingerprint: string
          round_id: string
          session_id: string
          subject_type: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id: string
        }
        Insert: {
          attempted_at?: string
          attempted_by: string
          detail_code?: string | null
          id?: string
          idempotency_key: string
          item_observation_id?: string | null
          lot_observation_id?: string | null
          outcome: string
          payload_fingerprint: string
          round_id: string
          session_id: string
          subject_type: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id: string
        }
        Update: {
          attempted_at?: string
          attempted_by?: string
          detail_code?: string | null
          id?: string
          idempotency_key?: string
          item_observation_id?: string | null
          lot_observation_id?: string | null
          outcome?: string
          payload_fingerprint?: string
          round_id?: string
          session_id?: string
          subject_type?: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_observation_attempts_round_id_workspace_id_fkey"
            columns: ["round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_observation_attempts_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_observation_attempts_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_observation_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_observation_idempotency: {
        Row: {
          canonical_outcome: string
          created_at: string
          idempotency_key: string
          item_observation_id: string | null
          lot_observation_id: string | null
          payload_fingerprint: string
          round_id: string
          session_id: string
          subject_type: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id: string
        }
        Insert: {
          canonical_outcome: string
          created_at?: string
          idempotency_key: string
          item_observation_id?: string | null
          lot_observation_id?: string | null
          payload_fingerprint: string
          round_id: string
          session_id: string
          subject_type: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id: string
        }
        Update: {
          canonical_outcome?: string
          created_at?: string
          idempotency_key?: string
          item_observation_id?: string | null
          lot_observation_id?: string | null
          payload_fingerprint?: string
          round_id?: string
          session_id?: string
          subject_type?: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_observation_idempotenc_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_observation_idempotenc_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_observation_idempotency_round_id_workspace_id_fkey"
            columns: ["round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_observation_idempotency_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_recount_selections: {
        Row: {
          assigned_round_id: string | null
          discrepancy_id: string
          id: string
          reason: string
          selected_at: string
          selected_by: string
          session_id: string
          workspace_id: string
        }
        Insert: {
          assigned_round_id?: string | null
          discrepancy_id: string
          id?: string
          reason: string
          selected_at?: string
          selected_by: string
          session_id: string
          workspace_id: string
        }
        Update: {
          assigned_round_id?: string | null
          discrepancy_id?: string
          id?: string
          reason?: string
          selected_at?: string
          selected_by?: string
          session_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_recount_selection_assigned_round_id_workspace__fkey"
            columns: ["assigned_round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_recount_selections_discrepancy_id_workspace_id_fkey"
            columns: ["discrepancy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_discrepancies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_recount_selections_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_recount_selections_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_recount_selections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_resolution_action_rules: {
        Row: {
          action: string
          approval_required: boolean
          completion_state: Database["public"]["Enums"]["cycle_count_discrepancy_status"]
          destination_mode: string
          discrepancy_kind: Database["public"]["Enums"]["cycle_count_discrepancy_kind"]
          downstream_function: string | null
          quantity_mode: string
          reason_required: boolean
          required_role: Database["public"]["Enums"]["workspace_role"]
        }
        Insert: {
          action: string
          approval_required?: boolean
          completion_state?: Database["public"]["Enums"]["cycle_count_discrepancy_status"]
          destination_mode: string
          discrepancy_kind: Database["public"]["Enums"]["cycle_count_discrepancy_kind"]
          downstream_function?: string | null
          quantity_mode: string
          reason_required?: boolean
          required_role?: Database["public"]["Enums"]["workspace_role"]
        }
        Update: {
          action?: string
          approval_required?: boolean
          completion_state?: Database["public"]["Enums"]["cycle_count_discrepancy_status"]
          destination_mode?: string
          discrepancy_kind?: Database["public"]["Enums"]["cycle_count_discrepancy_kind"]
          downstream_function?: string | null
          quantity_mode?: string
          reason_required?: boolean
          required_role?: Database["public"]["Enums"]["workspace_role"]
        }
        Relationships: []
      }
      cycle_count_resolution_approvals: {
        Row: {
          approved_at: string
          approved_by: string
          attempt_id: string
          id: string
          workspace_id: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          attempt_id: string
          id?: string
          workspace_id: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          attempt_id?: string
          id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_resolution_approvals_attempt_id_workspace_id_fkey"
            columns: ["attempt_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_resolution_attempts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_resolution_approvals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_resolution_attempt_events: {
        Row: {
          actor_id: string
          attempt_id: string
          event_type: string
          failure_classification: string | null
          id: string
          occurred_at: string
          workspace_id: string
        }
        Insert: {
          actor_id: string
          attempt_id: string
          event_type: string
          failure_classification?: string | null
          id?: string
          occurred_at?: string
          workspace_id: string
        }
        Update: {
          actor_id?: string
          attempt_id?: string
          event_type?: string
          failure_classification?: string | null
          id?: string
          occurred_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_resolution_attempt_eve_attempt_id_workspace_id_fkey"
            columns: ["attempt_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_resolution_attempts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_resolution_attempt_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_resolution_attempts: {
        Row: {
          action: string
          adjustment_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          discrepancy_id: string
          failure_classification: string | null
          id: string
          idempotency_key: string
          last_attempted_at: string | null
          movement_id: string | null
          reason: string | null
          reviewed_destination_code: string | null
          round_result_id: string
          session_id: string
          status: string
          workspace_id: string
        }
        Insert: {
          action: string
          adjustment_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          discrepancy_id: string
          failure_classification?: string | null
          id?: string
          idempotency_key: string
          last_attempted_at?: string | null
          movement_id?: string | null
          reason?: string | null
          reviewed_destination_code?: string | null
          round_result_id: string
          session_id: string
          status?: string
          workspace_id: string
        }
        Update: {
          action?: string
          adjustment_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          discrepancy_id?: string
          failure_classification?: string | null
          id?: string
          idempotency_key?: string
          last_attempted_at?: string | null
          movement_id?: string | null
          reason?: string | null
          reviewed_destination_code?: string | null
          round_result_id?: string
          session_id?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_resolution_attemp_round_result_id_workspace_id_fkey"
            columns: ["round_result_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_latest_round_results"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_resolution_attemp_round_result_id_workspace_id_fkey"
            columns: ["round_result_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_round_results"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_resolution_attempt_discrepancy_id_workspace_id_fkey"
            columns: ["discrepancy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_discrepancies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_resolution_attempts_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_resolution_attempts_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_resolution_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_resolutions: {
        Row: {
          action: Database["public"]["Enums"]["cycle_count_resolution_action"]
          adjustment_id: string | null
          affected_item_id: string | null
          affected_lot_id: string | null
          discrepancy_id: string
          expected_value: number | null
          failure_detail: string | null
          id: string
          movement_id: string | null
          note: string | null
          observed_value: number | null
          resolved_at: string
          resolved_by: string
          session_id: string
          succeeded: boolean
          workspace_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["cycle_count_resolution_action"]
          adjustment_id?: string | null
          affected_item_id?: string | null
          affected_lot_id?: string | null
          discrepancy_id: string
          expected_value?: number | null
          failure_detail?: string | null
          id?: string
          movement_id?: string | null
          note?: string | null
          observed_value?: number | null
          resolved_at?: string
          resolved_by: string
          session_id: string
          succeeded: boolean
          workspace_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["cycle_count_resolution_action"]
          adjustment_id?: string | null
          affected_item_id?: string | null
          affected_lot_id?: string | null
          discrepancy_id?: string
          expected_value?: number | null
          failure_detail?: string | null
          id?: string
          movement_id?: string | null
          note?: string | null
          observed_value?: number | null
          resolved_at?: string
          resolved_by?: string
          session_id?: string
          succeeded?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_resolutions_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "inventory_quantity_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_resolutions_discrepancy_id_workspace_id_fkey"
            columns: ["discrepancy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_discrepancies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_resolutions_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "inventory_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_resolutions_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_resolutions_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_resolutions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_round_item_attestations: {
        Row: {
          attestation: string
          attested_at: string
          attested_by: string
          id: string
          idempotency_key: string
          item_id: string
          reason: string
          round_id: string
          session_id: string
          workspace_id: string
        }
        Insert: {
          attestation: string
          attested_at?: string
          attested_by: string
          id?: string
          idempotency_key: string
          item_id: string
          reason: string
          round_id: string
          session_id: string
          workspace_id: string
        }
        Update: {
          attestation?: string
          attested_at?: string
          attested_by?: string
          id?: string
          idempotency_key?: string
          item_id?: string
          reason?: string
          round_id?: string
          session_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_round_item_attestation_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_item_attestation_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_item_attestations_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_item_attestations_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_item_attestations_round_id_workspace_id_fkey"
            columns: ["round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_item_attestations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_round_lifecycle_events: {
        Row: {
          actor_id: string
          from_status:
            | Database["public"]["Enums"]["cycle_count_round_status"]
            | null
          id: string
          occurred_at: string
          reason: string | null
          round_id: string
          session_id: string
          to_status: Database["public"]["Enums"]["cycle_count_round_status"]
          workspace_id: string
        }
        Insert: {
          actor_id: string
          from_status?:
            | Database["public"]["Enums"]["cycle_count_round_status"]
            | null
          id?: string
          occurred_at?: string
          reason?: string | null
          round_id: string
          session_id: string
          to_status: Database["public"]["Enums"]["cycle_count_round_status"]
          workspace_id: string
        }
        Update: {
          actor_id?: string
          from_status?:
            | Database["public"]["Enums"]["cycle_count_round_status"]
            | null
          id?: string
          occurred_at?: string
          reason?: string | null
          round_id?: string
          session_id?: string
          to_status?: Database["public"]["Enums"]["cycle_count_round_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_round_lifecycle_events_round_id_workspace_id_fkey"
            columns: ["round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_lifecycle_events_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_lifecycle_events_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_lifecycle_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_round_results: {
        Row: {
          classification: Database["public"]["Enums"]["cycle_count_round_result_classification"]
          computed_variance: number | null
          evaluated_at: string
          evaluation_version: number
          expected_item_id: string | null
          expected_location_id: string | null
          expected_lot_id: string | null
          expected_present: boolean | null
          expected_quantity: number | null
          id: string
          item_attestation_id: string | null
          item_id: string | null
          item_observation_id: string | null
          lot_id: string | null
          lot_observation_id: string | null
          observed_location_id: string | null
          observed_quantity: number | null
          post_snapshot_classification: Database["public"]["Enums"]["cycle_count_post_snapshot_classification"]
          predecessor_result_id: string | null
          round_id: string
          session_id: string
          subject_type: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id: string
        }
        Insert: {
          classification: Database["public"]["Enums"]["cycle_count_round_result_classification"]
          computed_variance?: number | null
          evaluated_at?: string
          evaluation_version?: number
          expected_item_id?: string | null
          expected_location_id?: string | null
          expected_lot_id?: string | null
          expected_present?: boolean | null
          expected_quantity?: number | null
          id?: string
          item_attestation_id?: string | null
          item_id?: string | null
          item_observation_id?: string | null
          lot_id?: string | null
          lot_observation_id?: string | null
          observed_location_id?: string | null
          observed_quantity?: number | null
          post_snapshot_classification?: Database["public"]["Enums"]["cycle_count_post_snapshot_classification"]
          predecessor_result_id?: string | null
          round_id: string
          session_id: string
          subject_type: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id: string
        }
        Update: {
          classification?: Database["public"]["Enums"]["cycle_count_round_result_classification"]
          computed_variance?: number | null
          evaluated_at?: string
          evaluation_version?: number
          expected_item_id?: string | null
          expected_location_id?: string | null
          expected_lot_id?: string | null
          expected_present?: boolean | null
          expected_quantity?: number | null
          id?: string
          item_attestation_id?: string | null
          item_id?: string | null
          item_observation_id?: string | null
          lot_id?: string | null
          lot_observation_id?: string | null
          observed_location_id?: string | null
          observed_quantity?: number | null
          post_snapshot_classification?: Database["public"]["Enums"]["cycle_count_post_snapshot_classification"]
          predecessor_result_id?: string | null
          round_id?: string
          session_id?: string
          subject_type?: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_round_results_attestation_fk"
            columns: ["item_attestation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_round_item_attestations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_item_observation_fk"
            columns: ["item_observation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_item_observations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_lot_observation_fk"
            columns: ["lot_observation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_lot_observations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_predecessor_result_id_workspace__fkey"
            columns: ["predecessor_result_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_latest_round_results"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_predecessor_result_id_workspace__fkey"
            columns: ["predecessor_result_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_round_results"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_round_id_workspace_id_fkey"
            columns: ["round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_round_subjects: {
        Row: {
          expected_item_id: string | null
          expected_lot_id: string | null
          frozen_at: string
          id: string
          item_id: string | null
          lot_id: string | null
          round_id: string
          session_id: string
          source_discrepancy_id: string | null
          subject_type: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id: string
        }
        Insert: {
          expected_item_id?: string | null
          expected_lot_id?: string | null
          frozen_at?: string
          id?: string
          item_id?: string | null
          lot_id?: string | null
          round_id: string
          session_id: string
          source_discrepancy_id?: string | null
          subject_type: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id: string
        }
        Update: {
          expected_item_id?: string | null
          expected_lot_id?: string | null
          frozen_at?: string
          id?: string
          item_id?: string | null
          lot_id?: string | null
          round_id?: string
          session_id?: string
          source_discrepancy_id?: string | null
          subject_type?: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_round_subjects_round_id_workspace_id_fkey"
            columns: ["round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_subjects_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_subjects_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_subjects_source_discrepancy_id_workspace_fkey"
            columns: ["source_discrepancy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_discrepancies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_subjects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_rounds: {
        Row: {
          created_at: string
          created_by: string
          id: string
          parent_round_id: string | null
          public_id: string
          reason: string | null
          round_number: number
          round_type: Database["public"]["Enums"]["cycle_count_round_type"]
          session_id: string
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["cycle_count_round_status"]
          submitted_at: string | null
          submitted_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          parent_round_id?: string | null
          public_id: string
          reason?: string | null
          round_number: number
          round_type: Database["public"]["Enums"]["cycle_count_round_type"]
          session_id: string
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["cycle_count_round_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          parent_round_id?: string | null
          public_id?: string
          reason?: string | null
          round_number?: number
          round_type?: Database["public"]["Enums"]["cycle_count_round_type"]
          session_id?: string
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["cycle_count_round_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_rounds_parent_round_id_workspace_id_fkey"
            columns: ["parent_round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_rounds_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_rounds_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_rounds_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_scope_locations: {
        Row: {
          depth: number
          location_code: string
          location_display_name: string | null
          location_id: string
          session_id: string
          workspace_id: string
        }
        Insert: {
          depth: number
          location_code: string
          location_display_name?: string | null
          location_id: string
          session_id: string
          workspace_id: string
        }
        Update: {
          depth?: number
          location_code?: string
          location_display_name?: string | null
          location_id?: string
          session_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_scope_locations_location_id_workspace_id_fkey"
            columns: ["location_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_scope_locations_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_scope_locations_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_scope_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_sessions: {
        Row: {
          blind_count: boolean
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          completion_note: string | null
          completion_summary: Json | null
          created_at: string
          created_by: string
          current_round_id: string | null
          id: string
          idempotency_fingerprint: string | null
          idempotency_key: string | null
          include_descendants: boolean
          notes: string | null
          public_id: string
          root_location_id: string
          scope_type: Database["public"]["Enums"]["cycle_count_scope_type"]
          snapshot_frozen_at: string | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["cycle_count_status"]
          submitted_at: string | null
          submitted_by: string | null
          subtype_filter:
            | Database["public"]["Enums"]["inventory_subtype"]
            | null
          updated_at: string
          vertical_filter:
            | Database["public"]["Enums"]["inventory_vertical"]
            | null
          workspace_id: string
        }
        Insert: {
          blind_count?: boolean
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string | null
          completion_summary?: Json | null
          created_at?: string
          created_by: string
          current_round_id?: string | null
          id?: string
          idempotency_fingerprint?: string | null
          idempotency_key?: string | null
          include_descendants?: boolean
          notes?: string | null
          public_id: string
          root_location_id: string
          scope_type: Database["public"]["Enums"]["cycle_count_scope_type"]
          snapshot_frozen_at?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["cycle_count_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          subtype_filter?:
            | Database["public"]["Enums"]["inventory_subtype"]
            | null
          updated_at?: string
          vertical_filter?:
            | Database["public"]["Enums"]["inventory_vertical"]
            | null
          workspace_id: string
        }
        Update: {
          blind_count?: boolean
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string | null
          completion_summary?: Json | null
          created_at?: string
          created_by?: string
          current_round_id?: string | null
          id?: string
          idempotency_fingerprint?: string | null
          idempotency_key?: string | null
          include_descendants?: boolean
          notes?: string | null
          public_id?: string
          root_location_id?: string
          scope_type?: Database["public"]["Enums"]["cycle_count_scope_type"]
          snapshot_frozen_at?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["cycle_count_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          subtype_filter?:
            | Database["public"]["Enums"]["inventory_subtype"]
            | null
          updated_at?: string
          vertical_filter?:
            | Database["public"]["Enums"]["inventory_vertical"]
            | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_sessions_current_round_fk"
            columns: ["current_round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_sessions_root_location_id_workspace_id_fkey"
            columns: ["root_location_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      data_quality_issues: {
        Row: {
          created_at: string
          created_by_process: string
          detail: Json
          id: string
          import_job_id: string
          issue_type: string
          message: string
          raw_payload_snapshot: Json | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source_record_id: string | null
          status: Database["public"]["Enums"]["data_quality_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by_process: string
          detail?: Json
          id?: string
          import_job_id: string
          issue_type: string
          message: string
          raw_payload_snapshot?: Json | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_record_id?: string | null
          status?: Database["public"]["Enums"]["data_quality_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by_process?: string
          detail?: Json
          id?: string
          import_job_id?: string
          issue_type?: string
          message?: string
          raw_payload_snapshot?: Json | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_record_id?: string | null
          status?: Database["public"]["Enums"]["data_quality_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_quality_issues_import_job_id_workspace_id_fkey"
            columns: ["import_job_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "data_quality_issues_source_record_id_workspace_id_fkey"
            columns: ["source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "data_quality_issues_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      external_identifiers: {
        Row: {
          active: boolean
          created_at: string
          created_by_process: string
          first_seen_at: string
          id: string
          identifier_type: string
          identifier_value: string
          last_seen_at: string
          observation_count: number
          scope: string
          source_record_id: string | null
          source_system_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by_process: string
          first_seen_at?: string
          id?: string
          identifier_type: string
          identifier_value: string
          last_seen_at?: string
          observation_count?: number
          scope: string
          source_record_id?: string | null
          source_system_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by_process?: string
          first_seen_at?: string
          id?: string
          identifier_type?: string
          identifier_value?: string
          last_seen_at?: string
          observation_count?: number
          scope?: string
          source_record_id?: string | null
          source_system_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_identifiers_source_record_id_workspace_id_fkey"
            columns: ["source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "external_identifiers_source_system_id_workspace_id_fkey"
            columns: ["source_system_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_systems"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "external_identifiers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      field_registry: {
        Row: {
          active: boolean
          created_at: string
          data_type: string
          field_key: string
          id: string
          is_custom: boolean
          label: string
          reference_list_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          data_type: string
          field_key: string
          id?: string
          is_custom?: boolean
          label: string
          reference_list_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          data_type?: string
          field_key?: string
          id?: string
          is_custom?: boolean
          label?: string
          reference_list_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_registry_reference_list_id_workspace_id_fkey"
            columns: ["reference_list_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "reference_lists"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "field_registry_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      field_rules: {
        Row: {
          active: boolean
          created_at: string
          field_id: string
          id: string
          rule_config: Json
          rule_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          field_id: string
          id?: string
          rule_config?: Json
          rule_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          field_id?: string
          id?: string
          rule_config?: Json
          rule_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_rules_field_id_workspace_id_fkey"
            columns: ["field_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "field_registry"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "field_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      footwear_product_attributes: {
        Row: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          colorway_name: string | null
          product_id: string
          silhouette: string | null
          style_code: string | null
          workspace_id: string
        }
        Insert: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          colorway_name?: string | null
          product_id: string
          silhouette?: string | null
          style_code?: string | null
          workspace_id: string
        }
        Update: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          colorway_name?: string | null
          product_id?: string
          silhouette?: string | null
          style_code?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "footwear_product_attributes_product_id_workspace_id_busine_fkey"
            columns: ["product_id", "workspace_id", "business_vertical"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["id", "workspace_id", "business_vertical"]
          },
          {
            foreignKeyName: "footwear_product_attributes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      footwear_sku_attributes: {
        Row: {
          apparel_size: string | null
          box_status: string | null
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          color: string | null
          condition_or_quality: string | null
          shoe_size: string | null
          size_system: string | null
          sku_id: string
          workspace_id: string
        }
        Insert: {
          apparel_size?: string | null
          box_status?: string | null
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          color?: string | null
          condition_or_quality?: string | null
          shoe_size?: string | null
          size_system?: string | null
          sku_id: string
          workspace_id: string
        }
        Update: {
          apparel_size?: string | null
          box_status?: string | null
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          color?: string | null
          condition_or_quality?: string | null
          shoe_size?: string | null
          size_system?: string | null
          sku_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "footwear_sku_attributes_sku_id_workspace_id_business_verti_fkey"
            columns: ["sku_id", "workspace_id", "business_vertical"]
            isOneToOne: false
            referencedRelation: "sellable_skus"
            referencedColumns: ["id", "workspace_id", "business_vertical"]
          },
          {
            foreignKeyName: "footwear_sku_attributes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          accepted_row_count: number
          actor_process: string
          actor_user_id: string | null
          completed_at: string | null
          content_sha256: string
          created_at: string
          failure_code: string | null
          failure_detail: string | null
          file_sha256: string
          id: string
          idempotency_key: string
          issue_row_count: number
          mapping_version: string
          mode: string
          parser_version: string
          public_id: string
          source_label: string
          source_row_count: number
          source_system_id: string
          source_totals: Json
          started_at: string
          status: Database["public"]["Enums"]["import_job_status"]
          status_changed_at: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_row_count?: number
          actor_process: string
          actor_user_id?: string | null
          completed_at?: string | null
          content_sha256: string
          created_at?: string
          failure_code?: string | null
          failure_detail?: string | null
          file_sha256: string
          id?: string
          idempotency_key: string
          issue_row_count?: number
          mapping_version: string
          mode: string
          parser_version: string
          public_id: string
          source_label: string
          source_row_count?: number
          source_system_id: string
          source_totals?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["import_job_status"]
          status_changed_at?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_row_count?: number
          actor_process?: string
          actor_user_id?: string | null
          completed_at?: string | null
          content_sha256?: string
          created_at?: string
          failure_code?: string | null
          failure_detail?: string | null
          file_sha256?: string
          id?: string
          idempotency_key?: string
          issue_row_count?: number
          mapping_version?: string
          mode?: string
          parser_version?: string
          public_id?: string
          source_label?: string
          source_row_count?: number
          source_system_id?: string
          source_totals?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["import_job_status"]
          status_changed_at?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_source_system_id_workspace_id_fkey"
            columns: ["source_system_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_systems"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "import_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_candidate_links: {
        Row: {
          acquisition_line_item_id: string
          confidence: string
          created_at: string
          created_by: string
          entry_id: string | null
          evidence: Json
          group_id: string
          id: string
          review_state: string
          source_state: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          acquisition_line_item_id: string
          confidence?: string
          created_at?: string
          created_by: string
          entry_id?: string | null
          evidence?: Json
          group_id: string
          id?: string
          review_state?: string
          source_state?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          acquisition_line_item_id?: string
          confidence?: string
          created_at?: string
          created_by?: string
          entry_id?: string | null
          evidence?: Json
          group_id?: string
          id?: string
          review_state?: string
          source_state?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_candidate_links_acquisition_line_item_id_workspace__fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_candidate_links_acquisition_line_item_id_workspace__fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_overview"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_candidate_links_acquisition_line_item_id_workspace__fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "unresolved_inventory_cost_basis"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_candidate_links_entry_id_group_id_fkey"
            columns: ["entry_id", "group_id"]
            isOneToOne: false
            referencedRelation: "intake_entries"
            referencedColumns: ["id", "group_id"]
          },
          {
            foreignKeyName: "intake_candidate_links_entry_id_workspace_id_fkey"
            columns: ["entry_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "intake_entries"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_candidate_links_group_id_workspace_id_fkey"
            columns: ["group_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "intake_draft_groups"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_candidate_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_commit_attempts: {
        Row: {
          actor_user_id: string
          applied_rule_version: string
          content_hash: string
          created_at: string
          group_id: string
          id: string
          idempotency_key: string
          next_action: Database["public"]["Enums"]["intake_next_action"]
          outcome: string
          receipt: Json
          session_id: string
          workspace_id: string
        }
        Insert: {
          actor_user_id: string
          applied_rule_version: string
          content_hash: string
          created_at?: string
          group_id: string
          id?: string
          idempotency_key: string
          next_action: Database["public"]["Enums"]["intake_next_action"]
          outcome: string
          receipt: Json
          session_id: string
          workspace_id: string
        }
        Update: {
          actor_user_id?: string
          applied_rule_version?: string
          content_hash?: string
          created_at?: string
          group_id?: string
          id?: string
          idempotency_key?: string
          next_action?: Database["public"]["Enums"]["intake_next_action"]
          outcome?: string
          receipt?: Json
          session_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_commit_attempts_group_id_workspace_id_fkey"
            columns: ["group_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "intake_draft_groups"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_commit_attempts_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_commit_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_draft_groups: {
        Row: {
          applied_rule_version: string | null
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          category: Database["public"]["Enums"]["intake_category"]
          committed_at: string | null
          committed_by: string | null
          committed_lot_id: string | null
          committed_product_id: string | null
          committed_sku_id: string | null
          condition_state: string | null
          created_at: string
          created_by: string
          display_name: string
          id: string
          location_code: string | null
          next_action: Database["public"]["Enums"]["intake_next_action"] | null
          owner_tagged: boolean
          product_attrs: Json
          public_id: string
          quantity: number
          requires_item_media: boolean
          security_sensitive: boolean
          serialized_child_count: number
          session_id: string
          sku_attrs: Json
          source_evidence: Json
          source_state: Database["public"]["Enums"]["intake_source_state"]
          state: Database["public"]["Enums"]["intake_group_state"]
          tracking_mode: Database["public"]["Enums"]["inventory_tracking_mode"]
          unique_condition: boolean
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          applied_rule_version?: string | null
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          category: Database["public"]["Enums"]["intake_category"]
          committed_at?: string | null
          committed_by?: string | null
          committed_lot_id?: string | null
          committed_product_id?: string | null
          committed_sku_id?: string | null
          condition_state?: string | null
          created_at?: string
          created_by: string
          display_name: string
          id?: string
          location_code?: string | null
          next_action?: Database["public"]["Enums"]["intake_next_action"] | null
          owner_tagged?: boolean
          product_attrs?: Json
          public_id: string
          quantity: number
          requires_item_media?: boolean
          security_sensitive?: boolean
          serialized_child_count?: number
          session_id: string
          sku_attrs?: Json
          source_evidence?: Json
          source_state?: Database["public"]["Enums"]["intake_source_state"]
          state?: Database["public"]["Enums"]["intake_group_state"]
          tracking_mode?: Database["public"]["Enums"]["inventory_tracking_mode"]
          unique_condition?: boolean
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          applied_rule_version?: string | null
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          category?: Database["public"]["Enums"]["intake_category"]
          committed_at?: string | null
          committed_by?: string | null
          committed_lot_id?: string | null
          committed_product_id?: string | null
          committed_sku_id?: string | null
          condition_state?: string | null
          created_at?: string
          created_by?: string
          display_name?: string
          id?: string
          location_code?: string | null
          next_action?: Database["public"]["Enums"]["intake_next_action"] | null
          owner_tagged?: boolean
          product_attrs?: Json
          public_id?: string
          quantity?: number
          requires_item_media?: boolean
          security_sensitive?: boolean
          serialized_child_count?: number
          session_id?: string
          sku_attrs?: Json
          source_evidence?: Json
          source_state?: Database["public"]["Enums"]["intake_source_state"]
          state?: Database["public"]["Enums"]["intake_group_state"]
          tracking_mode?: Database["public"]["Enums"]["inventory_tracking_mode"]
          unique_condition?: boolean
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_draft_groups_committed_lot_id_workspace_id_fkey"
            columns: ["committed_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_draft_groups_committed_lot_id_workspace_id_fkey"
            columns: ["committed_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_draft_groups_committed_product_id_workspace_id_fkey"
            columns: ["committed_product_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_draft_groups_committed_sku_id_workspace_id_fkey"
            columns: ["committed_sku_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "sellable_skus"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_draft_groups_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_draft_groups_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_entries: {
        Row: {
          certificate_number: string | null
          committed_item_id: string | null
          created_at: string
          created_by: string
          entry_attrs: Json
          entry_index: number
          grade_designation: string | null
          grading_company: string | null
          group_id: string
          id: string
          numeric_grade: string | null
          public_id: string
          serial_number: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          certificate_number?: string | null
          committed_item_id?: string | null
          created_at?: string
          created_by: string
          entry_attrs?: Json
          entry_index: number
          grade_designation?: string | null
          grading_company?: string | null
          group_id: string
          id?: string
          numeric_grade?: string | null
          public_id: string
          serial_number?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          certificate_number?: string | null
          committed_item_id?: string | null
          created_at?: string
          created_by?: string
          entry_attrs?: Json
          entry_index?: number
          grade_designation?: string | null
          grading_company?: string | null
          group_id?: string
          id?: string
          numeric_grade?: string | null
          public_id?: string
          serial_number?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_entries_committed_item_id_workspace_id_fkey"
            columns: ["committed_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_entries_committed_item_id_workspace_id_fkey"
            columns: ["committed_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_entries_group_id_workspace_id_fkey"
            columns: ["group_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "intake_draft_groups"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_field_registry: {
        Row: {
          attr_key: string
          business_vertical:
            | Database["public"]["Enums"]["inventory_vertical"]
            | null
          created_at: string
          data_type: string
          field_key: string
          id: string
          is_factual: boolean
          is_identity_driving: boolean
          label: string
          maps_to: string | null
          reference_list_key: string | null
          scope: string
        }
        Insert: {
          attr_key: string
          business_vertical?:
            | Database["public"]["Enums"]["inventory_vertical"]
            | null
          created_at?: string
          data_type: string
          field_key: string
          id?: string
          is_factual?: boolean
          is_identity_driving?: boolean
          label: string
          maps_to?: string | null
          reference_list_key?: string | null
          scope: string
        }
        Update: {
          attr_key?: string
          business_vertical?:
            | Database["public"]["Enums"]["inventory_vertical"]
            | null
          created_at?: string
          data_type?: string
          field_key?: string
          id?: string
          is_factual?: boolean
          is_identity_driving?: boolean
          label?: string
          maps_to?: string | null
          reference_list_key?: string | null
          scope?: string
        }
        Relationships: []
      }
      intake_field_rules: {
        Row: {
          applicability: string
          category: Database["public"]["Enums"]["intake_category"]
          condition: Json
          created_at: string
          field_key: string
          id: string
          is_commit_blocker: boolean
          is_required: boolean
          rule_version: string
        }
        Insert: {
          applicability?: string
          category: Database["public"]["Enums"]["intake_category"]
          condition?: Json
          created_at?: string
          field_key: string
          id?: string
          is_commit_blocker?: boolean
          is_required?: boolean
          rule_version?: string
        }
        Update: {
          applicability?: string
          category?: Database["public"]["Enums"]["intake_category"]
          condition?: Json
          created_at?: string
          field_key?: string
          id?: string
          is_commit_blocker?: boolean
          is_required?: boolean
          rule_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_field_rules_field_key_fkey"
            columns: ["field_key"]
            isOneToOne: false
            referencedRelation: "intake_field_registry"
            referencedColumns: ["field_key"]
          },
        ]
      }
      intake_groups: {
        Row: {
          created_at: string
          created_by: string
          id: string
          label: string
          public_id: string
          quantity_expected: number
          session_id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          label: string
          public_id: string
          quantity_expected: number
          session_id: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          public_id?: string
          quantity_expected?: number
          session_id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_groups_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "intake_groups_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_reference_lists: {
        Row: {
          created_at: string
          label: string
          list_key: string
        }
        Insert: {
          created_at?: string
          label: string
          list_key: string
        }
        Update: {
          created_at?: string
          label?: string
          list_key?: string
        }
        Relationships: []
      }
      intake_reference_options: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          list_key: string
          option_value: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          list_key: string
          option_value: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          list_key?: string
          option_value?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "intake_reference_options_list_key_fkey"
            columns: ["list_key"]
            isOneToOne: false
            referencedRelation: "intake_reference_lists"
            referencedColumns: ["list_key"]
          },
        ]
      }
      intake_sessions: {
        Row: {
          abandon_reason: string | null
          abandoned_at: string | null
          abandoned_by: string | null
          created_at: string
          id: string
          label: string | null
          opened_at: string
          opened_by: string
          public_id: string
          state: Database["public"]["Enums"]["intake_session_state"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          abandon_reason?: string | null
          abandoned_at?: string | null
          abandoned_by?: string | null
          created_at?: string
          id?: string
          label?: string | null
          opened_at?: string
          opened_by: string
          public_id: string
          state?: Database["public"]["Enums"]["intake_session_state"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          abandon_reason?: string | null
          abandoned_at?: string | null
          abandoned_by?: string | null
          created_at?: string
          id?: string
          label?: string | null
          opened_at?: string
          opened_by?: string
          public_id?: string
          state?: Database["public"]["Enums"]["intake_session_state"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_transition_events: {
        Row: {
          actor_process: string
          actor_user_id: string | null
          created_at: string
          event_seq: number
          event_type: string
          group_id: string | null
          id: string
          occurred_at: string
          prior_state: string | null
          reason: Json
          resulting_state: string | null
          session_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_process: string
          actor_user_id?: string | null
          created_at?: string
          event_seq?: never
          event_type: string
          group_id?: string | null
          id?: string
          occurred_at?: string
          prior_state?: string | null
          reason?: Json
          resulting_state?: string | null
          session_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_process?: string
          actor_user_id?: string | null
          created_at?: string
          event_seq?: never
          event_type?: string
          group_id?: string | null
          id?: string
          occurred_at?: string
          prior_state?: string | null
          reason?: Json
          resulting_state?: string | null
          session_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_transition_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_correction_requests: {
        Row: {
          explanation: string
          id: string
          issue_type: Database["public"]["Enums"]["correction_issue_type"]
          item_id: string | null
          lot_id: string | null
          proposed_values: Json
          public_id: string
          replacement_item_id: string | null
          replacement_lot_id: string | null
          requested_at: string
          requested_by: string
          resolution_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state: Database["public"]["Enums"]["correction_state"]
          subject_kind: string
          supporting_media_id: string | null
          workspace_id: string
        }
        Insert: {
          explanation: string
          id?: string
          issue_type: Database["public"]["Enums"]["correction_issue_type"]
          item_id?: string | null
          lot_id?: string | null
          proposed_values?: Json
          public_id: string
          replacement_item_id?: string | null
          replacement_lot_id?: string | null
          requested_at?: string
          requested_by: string
          resolution_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: Database["public"]["Enums"]["correction_state"]
          subject_kind: string
          supporting_media_id?: string | null
          workspace_id: string
        }
        Update: {
          explanation?: string
          id?: string
          issue_type?: Database["public"]["Enums"]["correction_issue_type"]
          item_id?: string | null
          lot_id?: string | null
          proposed_values?: Json
          public_id?: string
          replacement_item_id?: string | null
          replacement_lot_id?: string | null
          requested_at?: string
          requested_by?: string
          resolution_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: Database["public"]["Enums"]["correction_state"]
          subject_kind?: string
          supporting_media_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_correction_requests_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_correction_requests_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_correction_requests_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_correction_requests_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_correction_requests_replacement_item_id_workspac_fkey"
            columns: ["replacement_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_correction_requests_replacement_item_id_workspac_fkey"
            columns: ["replacement_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_correction_requests_replacement_lot_id_workspace_fkey"
            columns: ["replacement_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_correction_requests_replacement_lot_id_workspace_fkey"
            columns: ["replacement_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_correction_requests_supporting_media_id_fkey"
            columns: ["supporting_media_id"]
            isOneToOne: false
            referencedRelation: "inventory_media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_correction_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_cost_basis: {
        Row: {
          acquisition_line_item_id: string
          acquisition_receipt_line_inventory_link_id: string
          algorithm_version: string
          basis_method: Database["public"]["Enums"]["inventory_cost_basis_method"]
          currency: string
          derived_at: string
          id: string
          input_content_hash: string
          inventory_item_id: string | null
          inventory_lot_id: string | null
          layer_seq: number
          public_id: string
          quantity: number
          recompute_id: string
          source_unit_ordinal: number
          state: Database["public"]["Enums"]["inventory_cost_basis_state"]
          subject_kind: Database["public"]["Enums"]["inventory_cost_basis_subject_kind"]
          superseded_at: string | null
          superseded_by_recompute_id: string | null
          total_cost_minor: number | null
          workspace_id: string
        }
        Insert: {
          acquisition_line_item_id: string
          acquisition_receipt_line_inventory_link_id: string
          algorithm_version: string
          basis_method: Database["public"]["Enums"]["inventory_cost_basis_method"]
          currency: string
          derived_at?: string
          id?: string
          input_content_hash: string
          inventory_item_id?: string | null
          inventory_lot_id?: string | null
          layer_seq: number
          public_id?: string
          quantity?: number
          recompute_id: string
          source_unit_ordinal: number
          state: Database["public"]["Enums"]["inventory_cost_basis_state"]
          subject_kind: Database["public"]["Enums"]["inventory_cost_basis_subject_kind"]
          superseded_at?: string | null
          superseded_by_recompute_id?: string | null
          total_cost_minor?: number | null
          workspace_id: string
        }
        Update: {
          acquisition_line_item_id?: string
          acquisition_receipt_line_inventory_link_id?: string
          algorithm_version?: string
          basis_method?: Database["public"]["Enums"]["inventory_cost_basis_method"]
          currency?: string
          derived_at?: string
          id?: string
          input_content_hash?: string
          inventory_item_id?: string | null
          inventory_lot_id?: string | null
          layer_seq?: number
          public_id?: string
          quantity?: number
          recompute_id?: string
          source_unit_ordinal?: number
          state?: Database["public"]["Enums"]["inventory_cost_basis_state"]
          subject_kind?: Database["public"]["Enums"]["inventory_cost_basis_subject_kind"]
          superseded_at?: string | null
          superseded_by_recompute_id?: string | null
          total_cost_minor?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_cost_basis_acquisition_line_item_id_workspace_id_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_acquisition_line_item_id_workspace_id_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_overview"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_acquisition_line_item_id_workspace_id_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "unresolved_inventory_cost_basis"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_acquisition_receipt_line_inventory_li_fkey"
            columns: [
              "acquisition_receipt_line_inventory_link_id",
              "workspace_id",
            ]
            isOneToOne: false
            referencedRelation: "acquisition_receipt_line_inventory_links"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_inventory_item_id_workspace_id_fkey"
            columns: ["inventory_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_inventory_item_id_workspace_id_fkey"
            columns: ["inventory_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_inventory_lot_id_workspace_id_fkey"
            columns: ["inventory_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_inventory_lot_id_workspace_id_fkey"
            columns: ["inventory_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_cost_basis_contributions: {
        Row: {
          acquisition_cost_allocation_id: string | null
          acquisition_cost_component_id: string
          acquisition_receipt_line_id: string
          acquisition_receipt_line_inventory_link_id: string
          amount_minor: number
          component_type: Database["public"]["Enums"]["cost_component_type"]
          created_at: string
          currency: string
          id: string
          inventory_cost_basis_id: string
          workspace_id: string
        }
        Insert: {
          acquisition_cost_allocation_id?: string | null
          acquisition_cost_component_id: string
          acquisition_receipt_line_id: string
          acquisition_receipt_line_inventory_link_id: string
          amount_minor: number
          component_type: Database["public"]["Enums"]["cost_component_type"]
          created_at?: string
          currency: string
          id?: string
          inventory_cost_basis_id: string
          workspace_id: string
        }
        Update: {
          acquisition_cost_allocation_id?: string | null
          acquisition_cost_component_id?: string
          acquisition_receipt_line_id?: string
          acquisition_receipt_line_inventory_link_id?: string
          amount_minor?: number
          component_type?: Database["public"]["Enums"]["cost_component_type"]
          created_at?: string
          currency?: string
          id?: string
          inventory_cost_basis_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_cost_basis_contribu_acquisition_cost_allocation__fkey"
            columns: ["acquisition_cost_allocation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_cost_allocations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_contribu_acquisition_cost_component_i_fkey"
            columns: ["acquisition_cost_component_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_cost_components"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_contribu_acquisition_receipt_line_id__fkey"
            columns: ["acquisition_receipt_line_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_receipt_lines"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_contribu_acquisition_receipt_line_inv_fkey"
            columns: [
              "acquisition_receipt_line_inventory_link_id",
              "workspace_id",
            ]
            isOneToOne: false
            referencedRelation: "acquisition_receipt_line_inventory_links"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_contribu_inventory_cost_basis_id_work_fkey"
            columns: ["inventory_cost_basis_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_cost_basis"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_contribu_inventory_cost_basis_id_work_fkey"
            columns: ["inventory_cost_basis_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_cost_basis_current"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_contributions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_cost_basis_events: {
        Row: {
          actor_user_id: string
          algorithm_version: string
          created_at: string
          event_kind: Database["public"]["Enums"]["inventory_cost_basis_event_kind"]
          id: string
          input_content_hash: string
          inventory_cost_basis_id: string | null
          recompute_id: string
          workspace_id: string
        }
        Insert: {
          actor_user_id: string
          algorithm_version: string
          created_at?: string
          event_kind: Database["public"]["Enums"]["inventory_cost_basis_event_kind"]
          id?: string
          input_content_hash: string
          inventory_cost_basis_id?: string | null
          recompute_id: string
          workspace_id: string
        }
        Update: {
          actor_user_id?: string
          algorithm_version?: string
          created_at?: string
          event_kind?: Database["public"]["Enums"]["inventory_cost_basis_event_kind"]
          id?: string
          input_content_hash?: string
          inventory_cost_basis_id?: string | null
          recompute_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_cost_basis_events_inventory_cost_basis_id_worksp_fkey"
            columns: ["inventory_cost_basis_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_cost_basis"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_events_inventory_cost_basis_id_worksp_fkey"
            columns: ["inventory_cost_basis_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_cost_basis_current"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          certificate_number: string | null
          created_at: string
          created_by_process: string
          grading_company: string | null
          id: string
          item_state: Database["public"]["Enums"]["inventory_item_state"]
          location_id: string | null
          lot_id: string
          public_id: string
          retirement_reason: string | null
          scan_sku: string
          serial_number: string | null
          sku_id: string
          superseded_by_item_id: string | null
          updated_at: string
          void_reason: string | null
          workspace_id: string
        }
        Insert: {
          certificate_number?: string | null
          created_at?: string
          created_by_process: string
          grading_company?: string | null
          id?: string
          item_state?: Database["public"]["Enums"]["inventory_item_state"]
          location_id?: string | null
          lot_id: string
          public_id: string
          retirement_reason?: string | null
          scan_sku: string
          serial_number?: string | null
          sku_id: string
          superseded_by_item_id?: string | null
          updated_at?: string
          void_reason?: string | null
          workspace_id: string
        }
        Update: {
          certificate_number?: string | null
          created_at?: string
          created_by_process?: string
          grading_company?: string | null
          id?: string
          item_state?: Database["public"]["Enums"]["inventory_item_state"]
          location_id?: string | null
          lot_id?: string
          public_id?: string
          retirement_reason?: string | null
          scan_sku?: string
          serial_number?: string | null
          sku_id?: string
          superseded_by_item_id?: string | null
          updated_at?: string
          void_reason?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_lot_id_workspace_id_sku_id_fkey"
            columns: ["lot_id", "workspace_id", "sku_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id", "sku_id"]
          },
          {
            foreignKeyName: "inventory_items_superseded_by_fk"
            columns: ["superseded_by_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_items_superseded_by_fk"
            columns: ["superseded_by_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_loss_events: {
        Row: {
          actor_id: string
          cycle_count_session_id: string | null
          discrepancy_id: string | null
          governed_metadata: Json
          id: string
          idempotency_key: string
          item_id: string
          occurred_at: string
          prior_item_state: Database["public"]["Enums"]["inventory_item_state"]
          public_id: string
          reason: string
          resolution_attempt_id: string | null
          resulting_item_state: Database["public"]["Enums"]["inventory_item_state"]
          workspace_id: string
        }
        Insert: {
          actor_id: string
          cycle_count_session_id?: string | null
          discrepancy_id?: string | null
          governed_metadata?: Json
          id?: string
          idempotency_key: string
          item_id: string
          occurred_at?: string
          prior_item_state: Database["public"]["Enums"]["inventory_item_state"]
          public_id: string
          reason: string
          resolution_attempt_id?: string | null
          resulting_item_state: Database["public"]["Enums"]["inventory_item_state"]
          workspace_id: string
        }
        Update: {
          actor_id?: string
          cycle_count_session_id?: string | null
          discrepancy_id?: string | null
          governed_metadata?: Json
          id?: string
          idempotency_key?: string
          item_id?: string
          occurred_at?: string
          prior_item_state?: Database["public"]["Enums"]["inventory_item_state"]
          public_id?: string
          reason?: string
          resolution_attempt_id?: string | null
          resulting_item_state?: Database["public"]["Enums"]["inventory_item_state"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_loss_events_cycle_count_session_id_workspace_id_fkey"
            columns: ["cycle_count_session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_loss_events_cycle_count_session_id_workspace_id_fkey"
            columns: ["cycle_count_session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_loss_events_discrepancy_id_workspace_id_fkey"
            columns: ["discrepancy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_discrepancies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_loss_events_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_loss_events_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_loss_events_resolution_attempt_id_workspace_id_fkey"
            columns: ["resolution_attempt_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_resolution_attempts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_loss_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lot_lineage: {
        Row: {
          child_lot_id: string
          created_at: string
          created_by: string
          event_kind: string
          id: string
          note: string | null
          parent_lot_id: string
          public_id: string
          quantity: number
          workspace_id: string
        }
        Insert: {
          child_lot_id: string
          created_at?: string
          created_by: string
          event_kind: string
          id?: string
          note?: string | null
          parent_lot_id: string
          public_id: string
          quantity: number
          workspace_id: string
        }
        Update: {
          child_lot_id?: string
          created_at?: string
          created_by?: string
          event_kind?: string
          id?: string
          note?: string | null
          parent_lot_id?: string
          public_id?: string
          quantity?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lot_lineage_child_lot_id_workspace_id_fkey"
            columns: ["child_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lot_lineage_child_lot_id_workspace_id_fkey"
            columns: ["child_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lot_lineage_parent_lot_id_workspace_id_fkey"
            columns: ["parent_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lot_lineage_parent_lot_id_workspace_id_fkey"
            columns: ["parent_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lot_lineage_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lots: {
        Row: {
          created_at: string
          created_by_process: string
          fingerprint_inputs: Json | null
          id: string
          location_id: string | null
          lot_state: Database["public"]["Enums"]["inventory_lot_state"]
          mapping_version: string
          public_id: string
          quantity: number
          record_origin: string | null
          sku_id: string
          superseded_by_lot_id: string | null
          tracking_mode: Database["public"]["Enums"]["inventory_tracking_mode"]
          updated_at: string
          void_reason: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by_process: string
          fingerprint_inputs?: Json | null
          id?: string
          location_id?: string | null
          lot_state?: Database["public"]["Enums"]["inventory_lot_state"]
          mapping_version?: string
          public_id: string
          quantity: number
          record_origin?: string | null
          sku_id: string
          superseded_by_lot_id?: string | null
          tracking_mode?: Database["public"]["Enums"]["inventory_tracking_mode"]
          updated_at?: string
          void_reason?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by_process?: string
          fingerprint_inputs?: Json | null
          id?: string
          location_id?: string | null
          lot_state?: Database["public"]["Enums"]["inventory_lot_state"]
          mapping_version?: string
          public_id?: string
          quantity?: number
          record_origin?: string | null
          sku_id?: string
          superseded_by_lot_id?: string | null
          tracking_mode?: Database["public"]["Enums"]["inventory_tracking_mode"]
          updated_at?: string
          void_reason?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_location_id_workspace_id_fkey"
            columns: ["location_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lots_sku_id_workspace_id_fkey"
            columns: ["sku_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "sellable_skus"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lots_superseded_by_fk"
            columns: ["superseded_by_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lots_superseded_by_fk"
            columns: ["superseded_by_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_media: {
        Row: {
          byte_size: number
          committed_at: string | null
          content_hash: string | null
          content_type: string
          created_at: string
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          exif_orientation: number | null
          id: string
          idempotency_key: string | null
          is_primary: boolean
          item_id: string | null
          lifecycle: string
          lot_id: string | null
          original_filename: string | null
          purge_after: string | null
          purged_at: string | null
          reserved_at: string | null
          rotation_degrees: number
          slot_key: string | null
          slot_label: string | null
          sort_order: number
          storage_path: string
          subject_kind: string
          updated_at: string
          uploaded_by: string
          workspace_id: string
        }
        Insert: {
          byte_size: number
          committed_at?: string | null
          content_hash?: string | null
          content_type: string
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          exif_orientation?: number | null
          id?: string
          idempotency_key?: string | null
          is_primary?: boolean
          item_id?: string | null
          lifecycle?: string
          lot_id?: string | null
          original_filename?: string | null
          purge_after?: string | null
          purged_at?: string | null
          reserved_at?: string | null
          rotation_degrees?: number
          slot_key?: string | null
          slot_label?: string | null
          sort_order?: number
          storage_path: string
          subject_kind: string
          updated_at?: string
          uploaded_by: string
          workspace_id: string
        }
        Update: {
          byte_size?: number
          committed_at?: string | null
          content_hash?: string | null
          content_type?: string
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          exif_orientation?: number | null
          id?: string
          idempotency_key?: string | null
          is_primary?: boolean
          item_id?: string | null
          lifecycle?: string
          lot_id?: string | null
          original_filename?: string | null
          purge_after?: string | null
          purged_at?: string | null
          reserved_at?: string | null
          rotation_degrees?: number
          slot_key?: string | null
          slot_label?: string | null
          sort_order?: number
          storage_path?: string
          subject_kind?: string
          updated_at?: string
          uploaded_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_media_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "inventory_media_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_media_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "inventory_media_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "inventory_media_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_media_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_media_events: {
        Row: {
          actor_id: string
          created_at: string
          detail: Json
          event_type: string
          id: string
          item_id: string | null
          lot_id: string | null
          media_id: string | null
          subject_kind: string
          workspace_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          item_id?: string | null
          lot_id?: string | null
          media_id?: string | null
          subject_kind: string
          workspace_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          item_id?: string | null
          lot_id?: string | null
          media_id?: string | null
          subject_kind?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_media_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "inventory_media_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_media_events_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "inventory_media_events_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "inventory_media_events_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_media_events_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "inventory_media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_media_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_media_issues: {
        Row: {
          detail: Json
          detected_at: string
          id: string
          issue_kind: string
          media_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          state: string
          storage_path: string | null
          workspace_id: string
        }
        Insert: {
          detail?: Json
          detected_at?: string
          id?: string
          issue_kind: string
          media_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          state?: string
          storage_path?: string | null
          workspace_id: string
        }
        Update: {
          detail?: Json
          detected_at?: string
          id?: string
          issue_kind?: string
          media_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          state?: string
          storage_path?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_media_issues_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "inventory_media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_media_issues_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_media_requirements: {
        Row: {
          display_order: number
          is_required: boolean
          slot_key: string
          slot_kind: string
          slot_label: string
          subtype: Database["public"]["Enums"]["inventory_subtype"]
        }
        Insert: {
          display_order?: number
          is_required?: boolean
          slot_key: string
          slot_kind: string
          slot_label: string
          subtype: Database["public"]["Enums"]["inventory_subtype"]
        }
        Update: {
          display_order?: number
          is_required?: boolean
          slot_key?: string
          slot_kind?: string
          slot_label?: string
          subtype?: Database["public"]["Enums"]["inventory_subtype"]
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          from_location_id: string | null
          id: string
          item_id: string | null
          lot_id: string | null
          moved_at: string
          moved_by: string
          note: string | null
          public_id: string
          subject_kind: string
          to_location_id: string
          workspace_id: string
        }
        Insert: {
          from_location_id?: string | null
          id?: string
          item_id?: string | null
          lot_id?: string | null
          moved_at?: string
          moved_by: string
          note?: string | null
          public_id: string
          subject_kind: string
          to_location_id: string
          workspace_id: string
        }
        Update: {
          from_location_id?: string | null
          id?: string
          item_id?: string | null
          lot_id?: string | null
          moved_at?: string
          moved_by?: string
          note?: string | null
          public_id?: string
          subject_kind?: string
          to_location_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "inventory_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "inventory_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_quantity_adjustments: {
        Row: {
          adjusted_at: string
          adjusted_by: string
          change_amount: number
          id: string
          lot_id: string
          note: string | null
          previous_quantity: number
          public_id: string
          reason: Database["public"]["Enums"]["quantity_adjustment_reason"]
          resulting_quantity: number
          source_reference: string | null
          workspace_id: string
        }
        Insert: {
          adjusted_at?: string
          adjusted_by: string
          change_amount: number
          id?: string
          lot_id: string
          note?: string | null
          previous_quantity: number
          public_id: string
          reason: Database["public"]["Enums"]["quantity_adjustment_reason"]
          resulting_quantity: number
          source_reference?: string | null
          workspace_id: string
        }
        Update: {
          adjusted_at?: string
          adjusted_by?: string
          change_amount?: number
          id?: string
          lot_id?: string
          note?: string | null
          previous_quantity?: number
          public_id?: string
          reason?: Database["public"]["Enums"]["quantity_adjustment_reason"]
          resulting_quantity?: number
          source_reference?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_quantity_adjustments_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_quantity_adjustments_lot_id_workspace_id_fkey"
            columns: ["lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_quantity_adjustments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          created_at: string
          created_by: string
          id: string
          intake_group_id: string | null
          name: string | null
          session_id: string
          sku: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          intake_group_id?: string | null
          name?: string | null
          session_id: string
          sku: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          intake_group_id?: string | null
          name?: string | null
          session_id?: string
          sku?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_intake_group_id_workspace_id_fkey"
            columns: ["intake_group_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "intake_groups"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "items_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_package_presets: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          package_height_mm: number | null
          package_length_mm: number | null
          package_weight_grams: number | null
          package_width_mm: number | null
          retired_at: string | null
          return_policy_ref: string | null
          shipping_policy_ref: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          package_height_mm?: number | null
          package_length_mm?: number | null
          package_weight_grams?: number | null
          package_width_mm?: number | null
          retired_at?: string | null
          return_policy_ref?: string | null
          shipping_policy_ref?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          package_height_mm?: number | null
          package_length_mm?: number | null
          package_weight_grams?: number | null
          package_width_mm?: number | null
          retired_at?: string | null
          return_policy_ref?: string | null
          shipping_policy_ref?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_package_presets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_prep: {
        Row: {
          asking_price_minor: number | null
          assigned_to: string | null
          blocked_reason: string | null
          condition_summary: string | null
          created_at: string
          created_by: string
          currency: string | null
          defects_disclosures: string | null
          description_notes: string | null
          external_listing_ref: string | null
          id: string
          included_items: string | null
          item_id: string | null
          listed_at: string | null
          listing_format: string | null
          lot_id: string | null
          minimum_price_minor: number | null
          owner_notes: string | null
          package_height_mm: number | null
          package_length_mm: number | null
          package_weight_grams: number | null
          package_width_mm: number | null
          priority: Database["public"]["Enums"]["listing_prep_priority"]
          public_id: string
          quantity_to_list: number | null
          research_notes: string | null
          return_policy_ref: string | null
          shipping_policy_ref: string | null
          status: Database["public"]["Enums"]["listing_prep_status"]
          subject_kind: string
          updated_at: string
          working_title: string | null
          workspace_id: string
        }
        Insert: {
          asking_price_minor?: number | null
          assigned_to?: string | null
          blocked_reason?: string | null
          condition_summary?: string | null
          created_at?: string
          created_by: string
          currency?: string | null
          defects_disclosures?: string | null
          description_notes?: string | null
          external_listing_ref?: string | null
          id?: string
          included_items?: string | null
          item_id?: string | null
          listed_at?: string | null
          listing_format?: string | null
          lot_id?: string | null
          minimum_price_minor?: number | null
          owner_notes?: string | null
          package_height_mm?: number | null
          package_length_mm?: number | null
          package_weight_grams?: number | null
          package_width_mm?: number | null
          priority?: Database["public"]["Enums"]["listing_prep_priority"]
          public_id: string
          quantity_to_list?: number | null
          research_notes?: string | null
          return_policy_ref?: string | null
          shipping_policy_ref?: string | null
          status?: Database["public"]["Enums"]["listing_prep_status"]
          subject_kind: string
          updated_at?: string
          working_title?: string | null
          workspace_id: string
        }
        Update: {
          asking_price_minor?: number | null
          assigned_to?: string | null
          blocked_reason?: string | null
          condition_summary?: string | null
          created_at?: string
          created_by?: string
          currency?: string | null
          defects_disclosures?: string | null
          description_notes?: string | null
          external_listing_ref?: string | null
          id?: string
          included_items?: string | null
          item_id?: string | null
          listed_at?: string | null
          listing_format?: string | null
          lot_id?: string | null
          minimum_price_minor?: number | null
          owner_notes?: string | null
          package_height_mm?: number | null
          package_length_mm?: number | null
          package_weight_grams?: number | null
          package_width_mm?: number | null
          priority?: Database["public"]["Enums"]["listing_prep_priority"]
          public_id?: string
          quantity_to_list?: number | null
          research_notes?: string | null
          return_policy_ref?: string | null
          shipping_policy_ref?: string | null
          status?: Database["public"]["Enums"]["listing_prep_status"]
          subject_kind?: string
          updated_at?: string
          working_title?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_prep_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "listing_prep_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_prep_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "listing_prep_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "listing_prep_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_prep_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_prep_checks: {
        Row: {
          confirmed_by: string | null
          id: string
          note: string | null
          prep_id: string
          requirement_key: string
          state: Database["public"]["Enums"]["listing_prep_check_state"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          confirmed_by?: string | null
          id?: string
          note?: string | null
          prep_id: string
          requirement_key: string
          state?: Database["public"]["Enums"]["listing_prep_check_state"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          confirmed_by?: string | null
          id?: string
          note?: string | null
          prep_id?: string
          requirement_key?: string
          state?: Database["public"]["Enums"]["listing_prep_check_state"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_prep_checks_prep_id_fkey"
            columns: ["prep_id"]
            isOneToOne: false
            referencedRelation: "listing_prep"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_prep_checks_prep_id_fkey"
            columns: ["prep_id"]
            isOneToOne: false
            referencedRelation: "listing_prep_readiness"
            referencedColumns: ["prep_id"]
          },
          {
            foreignKeyName: "listing_prep_checks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_prep_events: {
        Row: {
          actor_id: string
          created_at: string
          detail: Json
          event_type: string
          from_status: Database["public"]["Enums"]["listing_prep_status"] | null
          id: string
          prep_id: string
          reason: string | null
          to_status: Database["public"]["Enums"]["listing_prep_status"] | null
          workspace_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          detail?: Json
          event_type: string
          from_status?:
            | Database["public"]["Enums"]["listing_prep_status"]
            | null
          id?: string
          prep_id: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["listing_prep_status"] | null
          workspace_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          detail?: Json
          event_type?: string
          from_status?:
            | Database["public"]["Enums"]["listing_prep_status"]
            | null
          id?: string
          prep_id?: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["listing_prep_status"] | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_prep_events_prep_id_fkey"
            columns: ["prep_id"]
            isOneToOne: false
            referencedRelation: "listing_prep"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_prep_events_prep_id_fkey"
            columns: ["prep_id"]
            isOneToOne: false
            referencedRelation: "listing_prep_readiness"
            referencedColumns: ["prep_id"]
          },
          {
            foreignKeyName: "listing_prep_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_prep_requirements: {
        Row: {
          display_order: number
          is_required: boolean
          label: string
          requirement_key: string
          requirement_kind: Database["public"]["Enums"]["listing_prep_requirement_kind"]
          subtype: Database["public"]["Enums"]["inventory_subtype"]
        }
        Insert: {
          display_order?: number
          is_required?: boolean
          label: string
          requirement_key: string
          requirement_kind: Database["public"]["Enums"]["listing_prep_requirement_kind"]
          subtype: Database["public"]["Enums"]["inventory_subtype"]
        }
        Update: {
          display_order?: number
          is_required?: boolean
          label?: string
          requirement_key?: string
          requirement_kind?: Database["public"]["Enums"]["listing_prep_requirement_kind"]
          subtype?: Database["public"]["Enums"]["inventory_subtype"]
        }
        Relationships: []
      }
      other_product_attributes: {
        Row: {
          brand: string | null
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          item_category: string | null
          model_number: string | null
          product_id: string
          product_line: string | null
          workspace_id: string
        }
        Insert: {
          brand?: string | null
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          item_category?: string | null
          model_number?: string | null
          product_id: string
          product_line?: string | null
          workspace_id: string
        }
        Update: {
          brand?: string | null
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          item_category?: string | null
          model_number?: string | null
          product_id?: string
          product_line?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "other_product_attributes_product_id_workspace_id_business__fkey"
            columns: ["product_id", "workspace_id", "business_vertical"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["id", "workspace_id", "business_vertical"]
          },
          {
            foreignKeyName: "other_product_attributes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      other_sku_attributes: {
        Row: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          color: string | null
          condition_or_quality: string | null
          size_label: string | null
          sku_id: string
          variant_label: string | null
          workspace_id: string
        }
        Insert: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          color?: string | null
          condition_or_quality?: string | null
          size_label?: string | null
          sku_id: string
          variant_label?: string | null
          workspace_id: string
        }
        Update: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          color?: string | null
          condition_or_quality?: string | null
          size_label?: string | null
          sku_id?: string
          variant_label?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "other_sku_attributes_sku_id_workspace_id_business_vertical_fkey"
            columns: ["sku_id", "workspace_id", "business_vertical"]
            isOneToOne: false
            referencedRelation: "sellable_skus"
            referencedColumns: ["id", "workspace_id", "business_vertical"]
          },
          {
            foreignKeyName: "other_sku_attributes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_requirements: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          label: string
          min_count: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          label: string
          min_count?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          label?: string
          min_count?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_requirements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          created_by: string
          id: string
          item_id: string
          kind: string
          storage_path: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          item_id: string
          kind?: string
          storage_path: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          item_id?: string
          kind?: string
          storage_path?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_item_id_workspace_id_fkey"
            columns: ["item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "photos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_catalog: {
        Row: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          created_at: string
          created_by_process: string
          display_name: string
          id: string
          identity_schema_version: string
          product_canonical_key: string
          public_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          created_at?: string
          created_by_process: string
          display_name: string
          id?: string
          identity_schema_version?: string
          product_canonical_key: string
          public_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          created_at?: string
          created_by_process?: string
          display_name?: string
          id?: string
          identity_schema_version?: string
          product_canonical_key?: string
          public_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_catalog_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_finding_adjudications: {
        Row: {
          actor_process: string
          adjudicated_at: string
          adjudicated_by: string
          created_at: string
          id: string
          idempotency_key: string
          note: string | null
          public_id: string
          reconciliation_finding_id: string
          request_fingerprint: string
          seq: number
          state: Database["public"]["Enums"]["reconciliation_adjudication_state"]
          workspace_id: string
        }
        Insert: {
          actor_process: string
          adjudicated_at?: string
          adjudicated_by: string
          created_at?: string
          id?: string
          idempotency_key: string
          note?: string | null
          public_id: string
          reconciliation_finding_id: string
          request_fingerprint: string
          seq?: never
          state: Database["public"]["Enums"]["reconciliation_adjudication_state"]
          workspace_id: string
        }
        Update: {
          actor_process?: string
          adjudicated_at?: string
          adjudicated_by?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          note?: string | null
          public_id?: string
          reconciliation_finding_id?: string
          request_fingerprint?: string
          seq?: never
          state?: Database["public"]["Enums"]["reconciliation_adjudication_state"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_finding_adjudi_reconciliation_finding_id_wo_fkey"
            columns: ["reconciliation_finding_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_findings"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "reconciliation_finding_adjudications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_findings: {
        Row: {
          actor_process: string
          comparison_key_value: string
          created_at: string
          evidence: Json
          field_differences: Json
          id: string
          materiality: Database["public"]["Enums"]["reconciliation_materiality"]
          public_id: string
          reconciliation_run_id: string
          recorded_by: string
          verdict: Database["public"]["Enums"]["reconciliation_verdict"]
          workspace_id: string
        }
        Insert: {
          actor_process: string
          comparison_key_value: string
          created_at?: string
          evidence?: Json
          field_differences?: Json
          id?: string
          materiality: Database["public"]["Enums"]["reconciliation_materiality"]
          public_id: string
          reconciliation_run_id: string
          recorded_by: string
          verdict: Database["public"]["Enums"]["reconciliation_verdict"]
          workspace_id: string
        }
        Update: {
          actor_process?: string
          comparison_key_value?: string
          created_at?: string
          evidence?: Json
          field_differences?: Json
          id?: string
          materiality?: Database["public"]["Enums"]["reconciliation_materiality"]
          public_id?: string
          reconciliation_run_id?: string
          recorded_by?: string
          verdict?: Database["public"]["Enums"]["reconciliation_verdict"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_findings_reconciliation_run_id_workspace_id_fkey"
            columns: ["reconciliation_run_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "reconciliation_findings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          actor_process: string
          comparison_key: string
          completed_at: string | null
          created_at: string
          domain: string
          failure_note: string | null
          id: string
          idempotency_key: string
          l1_result: Json
          public_id: string
          request_fingerprint: string
          run_by: string
          seq: number
          source_label: string
          source_sha256: string | null
          started_at: string
          state: Database["public"]["Enums"]["reconciliation_run_state"]
          target_scope: string
          tool_version: string
          workspace_id: string
        }
        Insert: {
          actor_process: string
          comparison_key: string
          completed_at?: string | null
          created_at?: string
          domain: string
          failure_note?: string | null
          id?: string
          idempotency_key: string
          l1_result?: Json
          public_id: string
          request_fingerprint: string
          run_by: string
          seq?: never
          source_label: string
          source_sha256?: string | null
          started_at?: string
          state?: Database["public"]["Enums"]["reconciliation_run_state"]
          target_scope: string
          tool_version: string
          workspace_id: string
        }
        Update: {
          actor_process?: string
          comparison_key?: string
          completed_at?: string | null
          created_at?: string
          domain?: string
          failure_note?: string | null
          id?: string
          idempotency_key?: string
          l1_result?: Json
          public_id?: string
          request_fingerprint?: string
          run_by?: string
          seq?: never
          source_label?: string
          source_sha256?: string | null
          started_at?: string
          state?: Database["public"]["Enums"]["reconciliation_run_state"]
          target_scope?: string
          tool_version?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_lists: {
        Row: {
          created_at: string
          id: string
          label: string
          list_key: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          list_key: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          list_key?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_lists_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_options: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          list_id: string
          sort_order: number
          updated_at: string
          value: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          list_id: string
          sort_order?: number
          updated_at?: string
          value: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          list_id?: string
          sort_order?: number
          updated_at?: string
          value?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_options_list_id_workspace_id_fkey"
            columns: ["list_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "reference_lists"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "reference_options_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_migrations_log: {
        Row: {
          applied_at: string
          id: number
          migration_name: string
        }
        Insert: {
          applied_at?: string
          id?: never
          migration_name: string
        }
        Update: {
          applied_at?: string
          id?: never
          migration_name?: string
        }
        Relationships: []
      }
      sellable_skus: {
        Row: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          created_at: string
          created_by_process: string
          fingerprint: string
          id: string
          identity_schema_version: string
          inventory_subtype: Database["public"]["Enums"]["inventory_subtype"]
          is_active: boolean
          product_id: string
          public_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          created_at?: string
          created_by_process: string
          fingerprint: string
          id?: string
          identity_schema_version?: string
          inventory_subtype?: Database["public"]["Enums"]["inventory_subtype"]
          is_active?: boolean
          product_id: string
          public_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          created_at?: string
          created_by_process?: string
          fingerprint?: string
          id?: string
          identity_schema_version?: string
          inventory_subtype?: Database["public"]["Enums"]["inventory_subtype"]
          is_active?: boolean
          product_id?: string
          public_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sellable_skus_product_id_workspace_id_business_vertical_fkey"
            columns: ["product_id", "workspace_id", "business_vertical"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["id", "workspace_id", "business_vertical"]
          },
          {
            foreignKeyName: "sellable_skus_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string
          id: string
          label: string | null
          opened_at: string
          public_id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          label?: string | null
          opened_at?: string
          public_id: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          label?: string | null
          opened_at?: string
          public_id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_crosswalks: {
        Row: {
          confidence: number | null
          created_at: string
          created_by_process: string
          evidence: Json
          id: string
          match_method: Database["public"]["Enums"]["crosswalk_method"]
          proposed_entity_key: string
          proposed_entity_type: string
          review_note: string | null
          review_state: Database["public"]["Enums"]["crosswalk_state"]
          reviewed_at: string | null
          reviewed_by: string | null
          source_record_id: string
          superseded_at: string | null
          superseded_by_id: string | null
          supersedes_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_by_process: string
          evidence?: Json
          id?: string
          match_method: Database["public"]["Enums"]["crosswalk_method"]
          proposed_entity_key: string
          proposed_entity_type: string
          review_note?: string | null
          review_state?: Database["public"]["Enums"]["crosswalk_state"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_record_id: string
          superseded_at?: string | null
          superseded_by_id?: string | null
          supersedes_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_by_process?: string
          evidence?: Json
          id?: string
          match_method?: Database["public"]["Enums"]["crosswalk_method"]
          proposed_entity_key?: string
          proposed_entity_type?: string
          review_note?: string | null
          review_state?: Database["public"]["Enums"]["crosswalk_state"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_record_id?: string
          superseded_at?: string | null
          superseded_by_id?: string | null
          supersedes_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_crosswalks_source_record_id_workspace_id_fkey"
            columns: ["source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "source_crosswalks_superseded_by_id_workspace_id_fkey"
            columns: ["superseded_by_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_crosswalks"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "source_crosswalks_supersedes_id_workspace_id_fkey"
            columns: ["supersedes_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_crosswalks"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "source_crosswalks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_records: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_process: string
          errors: Json
          id: string
          import_job_id: string
          mapping_version: string
          normalized_hash: string
          parse_status: Database["public"]["Enums"]["source_parse_status"]
          parser_output: Json | null
          parser_version: string
          raw_payload: Json
          raw_text: string | null
          source_row_index: number
          source_row_key: string | null
          warnings: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_process: string
          errors?: Json
          id?: string
          import_job_id: string
          mapping_version: string
          normalized_hash: string
          parse_status: Database["public"]["Enums"]["source_parse_status"]
          parser_output?: Json | null
          parser_version: string
          raw_payload: Json
          raw_text?: string | null
          source_row_index: number
          source_row_key?: string | null
          warnings?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_process?: string
          errors?: Json
          id?: string
          import_job_id?: string
          mapping_version?: string
          normalized_hash?: string
          parse_status?: Database["public"]["Enums"]["source_parse_status"]
          parser_output?: Json | null
          parser_version?: string
          raw_payload?: Json
          raw_text?: string | null
          source_row_index?: number
          source_row_key?: string | null
          warnings?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_records_import_job_id_workspace_id_fkey"
            columns: ["import_job_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "source_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_systems: {
        Row: {
          active: boolean
          config: Json
          created_at: string
          created_by: string
          description: string | null
          id: string
          instance_label: string
          kind: string
          public_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          config?: Json
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          instance_label: string
          kind: string
          public_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          config?: Json
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          instance_label?: string
          kind?: string
          public_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_systems_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_locations: {
        Row: {
          created_at: string
          created_by_process: string
          display_name: string | null
          id: string
          location_code: string
          parent_id: string | null
          public_id: string
          retired_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by_process: string
          display_name?: string | null
          id?: string
          location_code: string
          parent_id?: string | null
          public_id: string
          retired_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by_process?: string
          display_name?: string | null
          id?: string
          location_code?: string
          parent_id?: string | null
          public_id?: string
          retired_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_locations_parent_id_workspace_id_fkey"
            columns: ["parent_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "storage_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_aliases: {
        Row: {
          created_at: string
          created_by_process: string
          first_seen_source_record_id: string | null
          id: string
          normalized_handle: string
          raw_handle: string
          source_system_id: string
          supplier_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by_process: string
          first_seen_source_record_id?: string | null
          id?: string
          normalized_handle: string
          raw_handle: string
          source_system_id: string
          supplier_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by_process?: string
          first_seen_source_record_id?: string | null
          id?: string
          normalized_handle?: string
          raw_handle?: string
          source_system_id?: string
          supplier_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_aliases_first_seen_source_record_id_workspace_id_fkey"
            columns: ["first_seen_source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "supplier_aliases_source_system_id_workspace_id_fkey"
            columns: ["source_system_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_systems"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "supplier_aliases_supplier_id_workspace_id_fkey"
            columns: ["supplier_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "supplier_aliases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string
          created_by_process: string
          display_name: string
          id: string
          notes: string | null
          public_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by_process: string
          display_name: string
          id?: string
          notes?: string | null
          public_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by_process?: string
          display_name?: string
          id?: string
          notes?: string | null
          public_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tcg_product_attributes: {
        Row: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          card_number: string | null
          featured_subject: string | null
          language: string | null
          product_id: string
          set_name: string | null
          workspace_id: string
        }
        Insert: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          card_number?: string | null
          featured_subject?: string | null
          language?: string | null
          product_id: string
          set_name?: string | null
          workspace_id: string
        }
        Update: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          card_number?: string | null
          featured_subject?: string | null
          language?: string | null
          product_id?: string
          set_name?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tcg_product_attributes_product_id_workspace_id_business_ve_fkey"
            columns: ["product_id", "workspace_id", "business_vertical"]
            isOneToOne: false
            referencedRelation: "product_catalog"
            referencedColumns: ["id", "workspace_id", "business_vertical"]
          },
          {
            foreignKeyName: "tcg_product_attributes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tcg_sku_attributes: {
        Row: {
          business_vertical: Database["public"]["Enums"]["inventory_vertical"]
          condition_or_quality: string | null
          grade_designation: string | null
          grading_company: string | null
          numeric_grade: string | null
          product_format: string | null
          seal_or_packaging_condition: string | null
          sku_id: string
          variant_or_printing: string | null
          workspace_id: string
        }
        Insert: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          condition_or_quality?: string | null
          grade_designation?: string | null
          grading_company?: string | null
          numeric_grade?: string | null
          product_format?: string | null
          seal_or_packaging_condition?: string | null
          sku_id: string
          variant_or_printing?: string | null
          workspace_id: string
        }
        Update: {
          business_vertical?: Database["public"]["Enums"]["inventory_vertical"]
          condition_or_quality?: string | null
          grade_designation?: string | null
          grading_company?: string | null
          numeric_grade?: string | null
          product_format?: string | null
          seal_or_packaging_condition?: string | null
          sku_id?: string
          variant_or_printing?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tcg_sku_attributes_sku_id_workspace_id_business_vertical_fkey"
            columns: ["sku_id", "workspace_id", "business_vertical"]
            isOneToOne: false
            referencedRelation: "sellable_skus"
            referencedColumns: ["id", "workspace_id", "business_vertical"]
          },
          {
            foreignKeyName: "tcg_sku_attributes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string
          id: string
          last_sku_number: number
          name: string
          setup_completed_at: string | null
          sku_prefix: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          last_sku_number?: number
          name: string
          setup_completed_at?: string | null
          sku_prefix?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          last_sku_number?: number
          name?: string
          setup_completed_at?: string | null
          sku_prefix?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      acquisition_line_overview: {
        Row: {
          acquisition_import_job_id: string | null
          acquisition_line_item_id: string | null
          acquisition_line_public_id: string | null
          acquisition_order_id: string | null
          acquisition_order_public_id: string | null
          business_vertical: string | null
          classification_created_at: string | null
          classification_id: string | null
          classification_key: string | null
          classification_label: string | null
          classification_method: string | null
          classification_option_id: string | null
          classification_public_id: string | null
          classification_state: string | null
          confidence: number | null
          created_at: string | null
          current_exclusion_public_id: string | null
          current_exclusion_reason: string | null
          delivered_item_title: string | null
          description: string | null
          excluded_at: string | null
          exclusion_actor_id: string | null
          exclusion_state: string | null
          full_title: string | null
          occurred_at: string | null
          order_status: string | null
          quantity: number | null
          reference_number: string | null
          rule_id: string | null
          rule_logical_key: string | null
          rule_public_id: string | null
          rule_version: number | null
          search_text: string | null
          seller_normalized: string | null
          source_detail: Json | null
          source_import_job_id: string | null
          source_order_reference: string | null
          source_record_id: string | null
          source_reported_status: string | null
          source_system_id: string | null
          source_system_kind: string | null
          source_system_public_id: string | null
          supplier_id: string | null
          supplier_public_id: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_line_items_acquisition_import_job_id_workspace_fkey"
            columns: ["acquisition_import_job_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_import_jobs"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_items_source_record_id_workspace_id_fkey"
            columns: ["source_record_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_items_source_system_id_workspace_id_fkey"
            columns: ["source_system_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_systems"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "acquisition_line_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_latest_round_results: {
        Row: {
          classification:
            | Database["public"]["Enums"]["cycle_count_round_result_classification"]
            | null
          computed_variance: number | null
          evaluated_at: string | null
          evaluation_version: number | null
          expected_item_id: string | null
          expected_location_id: string | null
          expected_lot_id: string | null
          expected_present: boolean | null
          expected_quantity: number | null
          id: string | null
          item_attestation_id: string | null
          item_id: string | null
          item_observation_id: string | null
          lot_id: string | null
          lot_observation_id: string | null
          observed_location_id: string | null
          observed_quantity: number | null
          post_snapshot_classification:
            | Database["public"]["Enums"]["cycle_count_post_snapshot_classification"]
            | null
          predecessor_result_id: string | null
          round_id: string | null
          session_id: string | null
          subject_type:
            | Database["public"]["Enums"]["cycle_count_subject_type"]
            | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_round_results_attestation_fk"
            columns: ["item_attestation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_round_item_attestations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_item_observation_fk"
            columns: ["item_observation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_item_observations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_lot_observation_fk"
            columns: ["lot_observation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_lot_observations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_predecessor_result_id_workspace__fkey"
            columns: ["predecessor_result_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_latest_round_results"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_predecessor_result_id_workspace__fkey"
            columns: ["predecessor_result_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_round_results"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_round_id_workspace_id_fkey"
            columns: ["round_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_rounds"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_session_overview"
            referencedColumns: ["session_id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_session_id_workspace_id_fkey"
            columns: ["session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cycle_count_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cycle_count_round_results_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_post_snapshot_activity: {
        Row: {
          activity_kind: string | null
          activity_public_id: string | null
          detail: string | null
          discrepancy_id: string | null
          occurred_at: string | null
          session_id: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      cycle_count_session_overview: {
        Row: {
          blind_count: boolean | null
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          completion_summary: Json | null
          created_at: string | null
          expected_item_count: number | null
          expected_lot_count: number | null
          include_descendants: boolean | null
          notes: string | null
          observed_item_count: number | null
          observed_lot_count: number | null
          open_discrepancy_count: number | null
          public_id: string | null
          root_location_code: string | null
          root_location_display_name: string | null
          scope_location_count: number | null
          scope_type:
            | Database["public"]["Enums"]["cycle_count_scope_type"]
            | null
          session_id: string | null
          snapshot_frozen_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["cycle_count_status"] | null
          submitted_at: string | null
          subtype_filter:
            | Database["public"]["Enums"]["inventory_subtype"]
            | null
          total_discrepancy_count: number | null
          vertical_filter:
            | Database["public"]["Enums"]["inventory_vertical"]
            | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_correction_overview: {
        Row: {
          explanation: string | null
          id: string | null
          issue_type:
            | Database["public"]["Enums"]["correction_issue_type"]
            | null
          proposed_values: Json | null
          public_id: string | null
          replacement_id: string | null
          replacement_public_id: string | null
          requested_at: string | null
          resolution_note: string | null
          reviewed_at: string | null
          state: Database["public"]["Enums"]["correction_state"] | null
          subject_display_name: string | null
          subject_id: string | null
          subject_kind: string | null
          subject_public_id: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_correction_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_cost_basis_current: {
        Row: {
          acquisition_line_item_id: string | null
          acquisition_receipt_line_inventory_link_id: string | null
          algorithm_version: string | null
          basis_method:
            | Database["public"]["Enums"]["inventory_cost_basis_method"]
            | null
          currency: string | null
          derived_at: string | null
          id: string | null
          input_content_hash: string | null
          inventory_item_id: string | null
          inventory_item_public_id: string | null
          inventory_lot_id: string | null
          inventory_lot_public_id: string | null
          layer_seq: number | null
          public_id: string | null
          quantity: number | null
          recompute_id: string | null
          source_unit_ordinal: number | null
          state:
            | Database["public"]["Enums"]["inventory_cost_basis_state"]
            | null
          subject_kind:
            | Database["public"]["Enums"]["inventory_cost_basis_subject_kind"]
            | null
          superseded_at: string | null
          superseded_by_recompute_id: string | null
          total_cost_minor: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_cost_basis_acquisition_line_item_id_workspace_id_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_acquisition_line_item_id_workspace_id_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "acquisition_line_overview"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_acquisition_line_item_id_workspace_id_fkey"
            columns: ["acquisition_line_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "unresolved_inventory_cost_basis"
            referencedColumns: ["acquisition_line_item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_acquisition_receipt_line_inventory_li_fkey"
            columns: [
              "acquisition_receipt_line_inventory_link_id",
              "workspace_id",
            ]
            isOneToOne: false
            referencedRelation: "acquisition_receipt_line_inventory_links"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_inventory_item_id_workspace_id_fkey"
            columns: ["inventory_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_inventory_item_id_workspace_id_fkey"
            columns: ["inventory_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_inventory_lot_id_workspace_id_fkey"
            columns: ["inventory_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_inventory_lot_id_workspace_id_fkey"
            columns: ["inventory_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_cost_basis_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_item_overview: {
        Row: {
          active_media_count: number | null
          business_vertical:
            | Database["public"]["Enums"]["inventory_vertical"]
            | null
          certificate_number: string | null
          condition_or_quality: string | null
          grade_designation: string | null
          grading_company: string | null
          inventory_subtype:
            | Database["public"]["Enums"]["inventory_subtype"]
            | null
          is_available: boolean | null
          item_created_at: string | null
          item_id: string | null
          item_public_id: string | null
          item_state: Database["public"]["Enums"]["inventory_item_state"] | null
          last_moved_at: string | null
          location_code: string | null
          location_display_name: string | null
          location_id: string | null
          location_public_id: string | null
          location_retired_at: string | null
          lot_id: string | null
          lot_public_id: string | null
          lot_quantity: number | null
          media_count: number | null
          needs_condition_details: boolean | null
          needs_location: boolean | null
          needs_photos: boolean | null
          numeric_grade: string | null
          open_correction_count: number | null
          primary_media_path: string | null
          product_display_name: string | null
          product_format: string | null
          product_id: string | null
          product_public_id: string | null
          scan_sku: string | null
          search_text: string | null
          serial_number: string | null
          shoe_size: string | null
          size_label: string | null
          size_system: string | null
          sku_id: string | null
          sku_public_id: string | null
          superseded_by_item_id: string | null
          superseded_by_public_id: string | null
          tracking_mode:
            | Database["public"]["Enums"]["inventory_tracking_mode"]
            | null
          void_reason: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_superseded_by_fk"
            columns: ["superseded_by_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_overview"
            referencedColumns: ["item_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_items_superseded_by_fk"
            columns: ["superseded_by_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_location_balances: {
        Row: {
          location_id: string | null
          lot_count: number | null
          lot_managed_quantity: number | null
          serialized_unit_count: number | null
          sku_id: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_location_id_workspace_id_fkey"
            columns: ["location_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lots_sku_id_workspace_id_fkey"
            columns: ["sku_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "sellable_skus"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lot_lineage_view: {
        Row: {
          child_lot_id: string | null
          child_public_id: string | null
          created_at: string | null
          event_kind: string | null
          id: string | null
          note: string | null
          parent_lot_id: string | null
          parent_public_id: string | null
          public_id: string | null
          quantity: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lot_lineage_child_lot_id_workspace_id_fkey"
            columns: ["child_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lot_lineage_child_lot_id_workspace_id_fkey"
            columns: ["child_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lot_lineage_parent_lot_id_workspace_id_fkey"
            columns: ["parent_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lot_lineage_parent_lot_id_workspace_id_fkey"
            columns: ["parent_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lot_lineage_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lot_overview: {
        Row: {
          active_media_count: number | null
          business_vertical:
            | Database["public"]["Enums"]["inventory_vertical"]
            | null
          condition_or_quality: string | null
          inventory_subtype:
            | Database["public"]["Enums"]["inventory_subtype"]
            | null
          is_available: boolean | null
          last_moved_at: string | null
          location_code: string | null
          location_display_name: string | null
          location_id: string | null
          location_public_id: string | null
          location_retired_at: string | null
          lot_created_at: string | null
          lot_id: string | null
          lot_public_id: string | null
          lot_state: Database["public"]["Enums"]["inventory_lot_state"] | null
          media_count: number | null
          needs_condition_details: boolean | null
          needs_location: boolean | null
          needs_photos: boolean | null
          open_correction_count: number | null
          primary_media_path: string | null
          product_display_name: string | null
          product_format: string | null
          product_id: string | null
          product_public_id: string | null
          quantity: number | null
          seal_or_packaging_condition: string | null
          search_text: string | null
          serialized_child_count: number | null
          shoe_size: string | null
          size_label: string | null
          sku_id: string | null
          sku_public_id: string | null
          superseded_by_lot_id: string | null
          superseded_by_public_id: string | null
          tracking_mode:
            | Database["public"]["Enums"]["inventory_tracking_mode"]
            | null
          void_reason: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_location_id_workspace_id_fkey"
            columns: ["location_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lots_superseded_by_fk"
            columns: ["superseded_by_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lot_overview"
            referencedColumns: ["lot_id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lots_superseded_by_fk"
            columns: ["superseded_by_lot_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "inventory_lots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_media_readiness: {
        Row: {
          active_count: number | null
          missing_required_angles: string[] | null
          missing_required_defect_photos: string[] | null
          open_issue_count: number | null
          readiness_status: string | null
          recoverable_count: number | null
          reserved_count: number | null
          subject_id: string | null
          subject_kind: string | null
          subtype: Database["public"]["Enums"]["inventory_subtype"] | null
          workspace_id: string | null
        }
        Relationships: []
      }
      inventory_media_readiness_current: {
        Row: {
          active_count: number | null
          missing_required_angles: string[] | null
          missing_required_defect_photos: string[] | null
          open_issue_count: number | null
          readiness_status: string | null
          recoverable_count: number | null
          reserved_count: number | null
          subject_id: string | null
          subject_kind: string | null
          subtype: Database["public"]["Enums"]["inventory_subtype"] | null
          workspace_id: string | null
        }
        Relationships: []
      }
      inventory_record_overview: {
        Row: {
          active_media_count: number | null
          business_vertical:
            | Database["public"]["Enums"]["inventory_vertical"]
            | null
          condition_or_grade: string | null
          condition_or_quality: string | null
          created_at: string | null
          detail_line: string | null
          grading_company: string | null
          inventory_subtype:
            | Database["public"]["Enums"]["inventory_subtype"]
            | null
          is_available: boolean | null
          last_moved_at: string | null
          location_code: string | null
          location_display_name: string | null
          location_id: string | null
          location_retired_at: string | null
          media_count: number | null
          needs_condition_details: boolean | null
          needs_location: boolean | null
          needs_photos: boolean | null
          open_correction_count: number | null
          parent_lot_id: string | null
          primary_media_path: string | null
          product_display_name: string | null
          quantity: number | null
          record_id: string | null
          record_kind: string | null
          record_public_id: string | null
          record_state: string | null
          scan_identifier: string | null
          search_text: string | null
          tracking_mode:
            | Database["public"]["Enums"]["inventory_tracking_mode"]
            | null
          workspace_id: string | null
        }
        Relationships: []
      }
      inventory_work_queue: {
        Row: {
          created_at: string | null
          display_name: string | null
          needs_location: boolean | null
          needs_photos: boolean | null
          subject_id: string | null
          subject_kind: string | null
          subject_public_id: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      listing_prep_candidates: {
        Row: {
          created_at: string | null
          detail_line: string | null
          inventory_subtype:
            | Database["public"]["Enums"]["inventory_subtype"]
            | null
          needs_photos: boolean | null
          product_display_name: string | null
          quantity: number | null
          record_public_id: string | null
          search_text: string | null
          subject_id: string | null
          subject_kind: string | null
          tracking_mode:
            | Database["public"]["Enums"]["inventory_tracking_mode"]
            | null
          workspace_id: string | null
        }
        Relationships: []
      }
      listing_prep_readiness: {
        Row: {
          blocker_count: number | null
          blockers: Json | null
          prep_id: string | null
          readiness_status: string | null
          status: Database["public"]["Enums"]["listing_prep_status"] | null
          subject_id: string | null
          subject_kind: string | null
          subject_state: string | null
          subtype: Database["public"]["Enums"]["inventory_subtype"] | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_prep_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      unresolved_inventory_cost_basis: {
        Row: {
          acquisition_line_item_id: string | null
          acquisition_line_public_id: string | null
          expected_quantity: number | null
          has_unresolved_cost_evidence: boolean | null
          overage_quantity: number | null
          pending_expected_quantity: number | null
          reconciled_quantity: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_line_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      abandon_intake_session: {
        Args: {
          p_reason?: string
          p_session_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      abandon_inventory_media: {
        Args: { p_media_id: string; p_reason?: string; p_workspace_id: string }
        Returns: Json
      }
      adjudicate_reconciliation_finding: {
        Args: {
          p_actor_process?: string
          p_finding_public_id: string
          p_idempotency_key: string
          p_note: string
          p_state: Database["public"]["Enums"]["reconciliation_adjudication_state"]
          p_workspace_id: string
        }
        Returns: Json
      }
      adjust_lot_quantity: {
        Args: {
          p_change: number
          p_expected_quantity?: number
          p_lot_id: string
          p_note?: string
          p_reason: Database["public"]["Enums"]["quantity_adjustment_reason"]
          p_source_reference?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      apply_listing_package_preset: {
        Args: { p_prep_id: string; p_preset_id: string; p_workspace_id: string }
        Returns: Json
      }
      approve_cycle_count_resolution_attempt: {
        Args: { p_attempt_id: string; p_workspace_id: string }
        Returns: Json
      }
      assign_listing_prep: {
        Args: { p_assignee?: string; p_prep_id: string; p_workspace_id: string }
        Returns: Json
      }
      attach_intake_candidate: {
        Args: {
          p_acquisition_line_item_id: string
          p_confidence?: string
          p_entry_id?: string
          p_evidence?: Json
          p_expected_version: number
          p_group_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      attest_cycle_count_item_absence: {
        Args: {
          p_attestation: string
          p_idempotency_key: string
          p_item_public_id: string
          p_reason: string
          p_session_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      begin_acquisition_import_job: {
        Args: {
          p_channel_id: string
          p_expected_line_count: number
          p_idempotency_key: string
          p_mapping_version: string
          p_plan_sha256: string
          p_source_import_job_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      begin_cycle_count_recount: {
        Args: { p_reason: string; p_session_id: string; p_workspace_id: string }
        Returns: Json
      }
      begin_import_job: {
        Args: {
          p_content_sha256: string
          p_file_sha256: string
          p_idempotency_key: string
          p_mapping_version: string
          p_parser_version: string
          p_public_id?: string
          p_source_label: string
          p_source_row_count: number
          p_source_system_id: string
          p_source_totals?: Json
          p_workspace_id: string
        }
        Returns: Json
      }
      begin_reconciliation_run: {
        Args: {
          p_actor_process: string
          p_comparison_key: string
          p_domain: string
          p_idempotency_key: string
          p_source_label: string
          p_source_sha256: string
          p_target_scope: string
          p_tool_version: string
          p_workspace_id: string
        }
        Returns: Json
      }
      bulk_listing_prep_action: {
        Args: {
          p_action: string
          p_params?: Json
          p_prep_ids: string[]
          p_workspace_id: string
        }
        Returns: Json
      }
      cancel_acquisition_receipt: {
        Args: {
          p_reason: string
          p_receipt_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      cancel_cycle_count: {
        Args: { p_reason: string; p_session_id: string; p_workspace_id: string }
        Returns: Json
      }
      classify_acquisition_line: {
        Args: { p_acquisition_line_item_id: string }
        Returns: Json
      }
      classify_acquisition_line_by_public_id: {
        Args: { p_acquisition_line_public_id: string; p_workspace_id: string }
        Returns: Json
      }
      classify_acquisition_line_by_source: {
        Args: {
          p_acquisition_line_public_id: string
          p_source_system_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      commit_intake_group: {
        Args: {
          p_content_hash: string
          p_expected_version: number
          p_group_id: string
          p_idempotency_key: string
          p_workspace_id: string
        }
        Returns: Json
      }
      commit_inventory_media: {
        Args: { p_media_id: string; p_workspace_id: string }
        Returns: Json
      }
      complete_cycle_count: {
        Args: {
          p_allow_deferred?: boolean
          p_note?: string
          p_session_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      complete_cycle_count_latest: {
        Args: {
          p_allow_deferred: boolean
          p_note: string
          p_session_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      complete_reconciliation_run: {
        Args: {
          p_l1_result: Json
          p_run_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      confirm_cost_allocation: {
        Args: { p_cost_component_id: string; p_expected_total_minor: number }
        Returns: Json
      }
      confirm_source_crosswalk: {
        Args: { p_crosswalk_id: string; p_note?: string }
        Returns: string
      }
      correct_acquisition_receipt_line: {
        Args: {
          p_desired_quantity: number
          p_expected_quantity: number
          p_reason: string
          p_receipt_line_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_acquisition_shipment: {
        Args: {
          p_acquisition_order_public_id: string
          p_carrier?: string
          p_currency?: string
          p_evidence_note?: string
          p_expected_at?: string
          p_idempotency_key?: string
          p_shipped_at?: string
          p_shipping_cost_minor?: number
          p_source_record_id?: string
          p_status?: string
          p_tracking_number?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_classification_rule: {
        Args: {
          p_exact_value: string
          p_logical_key: string
          p_match_field: string
          p_matcher_kind: string
          p_pattern: string
          p_pattern_flags: string
          p_precedence: number
          p_rationale: string
          p_rule_family: string
          p_target_classification_option_key: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_custom_field: {
        Args: {
          p_data_type: string
          p_field_key: string
          p_label: string
          p_reference_list_id?: string
          p_workspace_id: string
        }
        Returns: string
      }
      create_cycle_count: {
        Args: {
          p_blind_count?: boolean
          p_include_descendants?: boolean
          p_notes?: string
          p_root_location_code: string
          p_subtype_filter?: Database["public"]["Enums"]["inventory_subtype"]
          p_vertical_filter?: Database["public"]["Enums"]["inventory_vertical"]
          p_workspace_id: string
        }
        Returns: Json
      }
      create_cycle_count_resolution_attempt: {
        Args: {
          p_action: string
          p_discrepancy_id: string
          p_idempotency_key: string
          p_reason: string
          p_reviewed_destination_code: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_cycle_count_session: {
        Args: {
          p_blind_count?: boolean
          p_idempotency_key: string
          p_include_descendants?: boolean
          p_notes?: string
          p_root_location_code: string
          p_subtype_filter?: Database["public"]["Enums"]["inventory_subtype"]
          p_vertical_filter?: Database["public"]["Enums"]["inventory_vertical"]
          p_workspace_id: string
        }
        Returns: Json
      }
      create_intake_session: {
        Args: { p_label?: string; p_workspace_id: string }
        Returns: Json
      }
      create_listing_package_preset: {
        Args: {
          p_name: string
          p_package_height_mm?: number
          p_package_length_mm?: number
          p_package_weight_grams?: number
          p_package_width_mm?: number
          p_return_policy_ref?: string
          p_shipping_policy_ref?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      delete_intake_group_safe: {
        Args: { p_group_id: string }
        Returns: undefined
      }
      evaluate_intake_field_rules: {
        Args: { p_group_id: string; p_workspace_id: string }
        Returns: Json
      }
      evaluate_listing_prep_readiness: {
        Args: { p_prep_id: string; p_workspace_id: string }
        Returns: Json
      }
      exclude_acquisition_line_by_source: {
        Args: {
          p_acquisition_line_public_id: string
          p_idempotency_key: string
          p_reason: string
          p_source_system_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      execute_cycle_count_resolution_attempt: {
        Args: { p_attempt_id: string; p_workspace_id: string }
        Returns: Json
      }
      expand_intake_group: { Args: { p_group_id: string }; Returns: string[] }
      fail_acquisition_import_job: {
        Args: {
          p_failure_code: string
          p_failure_detail?: string
          p_import_job_id: string
        }
        Returns: string
      }
      fail_import_job: {
        Args: {
          p_failure_code: string
          p_failure_detail?: string
          p_import_job_id: string
        }
        Returns: string
      }
      fail_reconciliation_run: {
        Args: {
          p_failure_note: string
          p_l1_result: Json
          p_run_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      finalize_acquisition_import_job: {
        Args: {
          p_expected_cost_components: number
          p_expected_line_items: number
          p_expected_lots: number
          p_expected_orders: number
          p_expected_unresolved_cost_components: number
          p_expected_unresolved_supplier_candidates: number
          p_idempotency_key: string
          p_import_job_id: string
        }
        Returns: Json
      }
      finalize_import_job: {
        Args: {
          p_expected_accepted_rows: number
          p_expected_crosswalks: number
          p_expected_external_identifiers: number
          p_expected_issue_rows: number
          p_expected_source_rows: number
          p_expected_total_issues: number
          p_idempotency_key: string
          p_import_job_id: string
        }
        Returns: Json
      }
      get_acquisition_facets: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      get_acquisition_line_detail: {
        Args: { p_acquisition_line_public_id: string; p_workspace_id: string }
        Returns: Json
      }
      get_acquisition_line_detail_by_source: {
        Args: {
          p_acquisition_line_public_id: string
          p_source_system_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      get_committed_acquisition_summary: {
        Args: {
          p_channel_id: string
          p_expected_line_count: number
          p_idempotency_key: string
          p_import_job_id: string
          p_mapping_version: string
          p_plan_sha256: string
          p_source_import_job_id: string
        }
        Returns: Json
      }
      get_cycle_count_round_progress: {
        Args: { p_session_id: string; p_workspace_id: string }
        Returns: Json
      }
      get_intake_commit_receipt: {
        Args: { p_group_id: string; p_workspace_id: string }
        Returns: Json
      }
      get_inventory_media_readiness: {
        Args: {
          p_subject_id: string
          p_subject_kind: string
          p_workspace_id: string
        }
        Returns: Json
      }
      get_listing_prep: {
        Args: { p_prep_id: string; p_workspace_id: string }
        Returns: Json
      }
      get_listing_prep_for_subject: {
        Args: {
          p_subject_id: string
          p_subject_kind: string
          p_workspace_id: string
        }
        Returns: Json
      }
      get_listing_prep_summary: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      get_media_readiness_summary: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      get_operations_inventory_health: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      get_operations_media_backlog: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      link_acquisition_receipt_inventory: {
        Args: {
          p_inventory_item_public_id?: string
          p_inventory_lot_public_id?: string
          p_quantity?: number
          p_receipt_line_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      list_acquisition_lines:
        | {
            Args: {
              p_business_vertical?: string
              p_classification_key?: string
              p_classification_state?: string
              p_limit?: number
              p_method?: string
              p_offset?: number
              p_order?: string
              p_query?: string
              p_seller_normalized?: string
              p_sort?: string
              p_workspace_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_business_vertical: string
              p_classification_key: string
              p_classification_state: string
              p_exclusion_state: string
              p_limit: number
              p_method: string
              p_offset: number
              p_order: string
              p_query: string
              p_seller_normalized: string
              p_sort: string
              p_workspace_id: string
            }
            Returns: Json
          }
      list_current_cycle_count_discrepancies: {
        Args: { p_session_id: string; p_workspace_id: string }
        Returns: Json
      }
      list_current_cycle_count_observations: {
        Args: { p_session_id: string; p_workspace_id: string }
        Returns: Json
      }
      list_current_media_readiness: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_statuses?: string[]
          p_workspace_id: string
        }
        Returns: Json
      }
      list_cycle_count_history: {
        Args: { p_session_id: string; p_workspace_id: string }
        Returns: Json
      }
      list_cycle_count_resolution_attempts: {
        Args: { p_session_id: string; p_workspace_id: string }
        Returns: Json
      }
      list_cycle_count_round_results: {
        Args: {
          p_round_id?: string
          p_session_id: string
          p_workspace_id: string
        }
        Returns: {
          classification: Database["public"]["Enums"]["cycle_count_round_result_classification"]
          computed_variance: number | null
          evaluated_at: string
          evaluation_version: number
          expected_item_id: string | null
          expected_location_id: string | null
          expected_lot_id: string | null
          expected_present: boolean | null
          expected_quantity: number | null
          id: string
          item_attestation_id: string | null
          item_id: string | null
          item_observation_id: string | null
          lot_id: string | null
          lot_observation_id: string | null
          observed_location_id: string | null
          observed_quantity: number | null
          post_snapshot_classification: Database["public"]["Enums"]["cycle_count_post_snapshot_classification"]
          predecessor_result_id: string | null
          round_id: string
          session_id: string
          subject_type: Database["public"]["Enums"]["cycle_count_subject_type"]
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "cycle_count_round_results"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_inventory_media: {
        Args: {
          p_include_deleted?: boolean
          p_subject_id: string
          p_subject_kind: string
          p_workspace_id: string
        }
        Returns: Json
      }
      list_inventory_media_issues: {
        Args: { p_state?: string; p_workspace_id: string }
        Returns: Json
      }
      list_listing_package_presets: {
        Args: { p_include_retired?: boolean; p_workspace_id: string }
        Returns: Json
      }
      list_listing_prep_candidates: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_subject_kind?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      list_listing_prep_queue: {
        Args: {
          p_assigned_to?: string
          p_limit?: number
          p_offset?: number
          p_priorities?: string[]
          p_readiness?: string[]
          p_search?: string
          p_statuses?: string[]
          p_subject_kind?: string
          p_subtypes?: string[]
          p_unassigned_only?: boolean
          p_workspace_id: string
        }
        Returns: Json
      }
      lot_merge_compatibility: {
        Args: {
          p_absorbed_lot_id: string
          p_survivor_lot_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      mark_cycle_count_discrepancies_for_recount: {
        Args: {
          p_discrepancy_ids: string[]
          p_reason: string
          p_session_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      mark_listing_prep_listed: {
        Args: {
          p_external_listing_ref: string
          p_listed_at?: string
          p_prep_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      merge_inventory_lots: {
        Args: {
          p_absorbed_lot_ids: string[]
          p_note?: string
          p_survivor_lot_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      mint_serialized_item: {
        Args: {
          p_certificate_number?: string
          p_grading_company?: string
          p_lot_id: string
          p_serial_number?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      mint_sku: { Args: { p_workspace_id: string }; Returns: string }
      move_inventory_item: {
        Args: {
          p_item_id: string
          p_note?: string
          p_to_location_code: string
          p_workspace_id: string
        }
        Returns: Json
      }
      move_inventory_lot: {
        Args: {
          p_lot_id: string
          p_note?: string
          p_to_location_code: string
          p_workspace_id: string
        }
        Returns: Json
      }
      observe_cycle_count_item:
        | {
            Args: {
              p_idempotency_key: string
              p_identifier: string
              p_note?: string
              p_observed_location_code: string
              p_session_id: string
              p_workspace_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_identifier: string
              p_note?: string
              p_observed_location_code: string
              p_session_id: string
              p_workspace_id: string
            }
            Returns: Json
          }
      observe_cycle_count_lot:
        | {
            Args: {
              p_idempotency_key: string
              p_lot_public_id: string
              p_note?: string
              p_observed_quantity: number
              p_session_id: string
              p_workspace_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_lot_public_id: string
              p_note?: string
              p_observed_quantity: number
              p_session_id: string
              p_workspace_id: string
            }
            Returns: Json
          }
      open_acquisition_receipt: {
        Args: {
          p_acquisition_order_public_id: string
          p_idempotency_key: string
          p_note: string
          p_received_at: string
          p_shipment_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      override_acquisition_line_classification: {
        Args: {
          p_acquisition_line_item_id: string
          p_classification_option_key: string
          p_reason: string
        }
        Returns: Json
      }
      override_acquisition_line_classification_by_public_id: {
        Args: {
          p_acquisition_line_public_id: string
          p_classification_option_key: string
          p_reason: string
          p_workspace_id: string
        }
        Returns: Json
      }
      override_acquisition_line_classification_by_source: {
        Args: {
          p_acquisition_line_public_id: string
          p_classification_option_key: string
          p_reason: string
          p_source_system_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      preview_cycle_count_scope: {
        Args: { p_session_id: string; p_workspace_id: string }
        Returns: Json
      }
      preview_intake_commit: {
        Args: { p_group_id: string; p_workspace_id: string }
        Returns: Json
      }
      propose_cost_allocation: {
        Args: {
          p_allocations: Json
          p_cost_component_id: string
          p_method: string
        }
        Returns: Json
      }
      purge_inventory_media: {
        Args: { p_media_id: string; p_workspace_id: string }
        Returns: Json
      }
      raise_acquisition_discrepancy: {
        Args: {
          p_detail: string
          p_kind: Database["public"]["Enums"]["acquisition_discrepancy_kind"]
          p_order_public_id: string
          p_quantity_expected: number
          p_quantity_observed: number
          p_receipt_line_public_id: string
          p_receipt_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      recompute_inventory_cost_basis: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      reconcile_acquisition_receipt: {
        Args: { p_receipt_public_id: string; p_workspace_id: string }
        Returns: Json
      }
      reconcile_inventory_media: {
        Args: {
          p_stale_upload_minutes?: number
          p_storage_paths?: string[]
          p_workspace_id: string
        }
        Returns: Json
      }
      reconciliation_cutover_eligibility: {
        Args: {
          p_domain?: string
          p_run_public_id?: string
          p_workspace_id: string
        }
        Returns: {
          blocking_finding_count: number
          domain: string
          eligible: boolean
          reason: string
          run_public_id: string
        }[]
      }
      record_acquisition_payment: {
        Args: {
          p_acquisition_order_public_id: string
          p_amount_minor: number
          p_currency: string
          p_evidence_note?: string
          p_external_reference?: string
          p_idempotency_key?: string
          p_instrument: string
          p_paid_at: string
          p_source_record_id?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      record_acquisition_receipt_line: {
        Args: {
          p_acquisition_line_public_id: string
          p_note?: string
          p_quantity: number
          p_receipt_public_id: string
          p_source_system_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      record_inventory_item_loss: {
        Args: {
          p_discrepancy_id?: string
          p_item_id: string
          p_reason: string
          p_session_id?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      record_inventory_item_loss_event: {
        Args: {
          p_idempotency_key: string
          p_item_id: string
          p_reason: string
          p_workspace_id: string
        }
        Returns: Json
      }
      record_reconciliation_finding: {
        Args: {
          p_actor_process?: string
          p_comparison_key_value: string
          p_evidence?: Json
          p_field_differences: Json
          p_materiality: Database["public"]["Enums"]["reconciliation_materiality"]
          p_run_public_id: string
          p_verdict: Database["public"]["Enums"]["reconciliation_verdict"]
          p_workspace_id: string
        }
        Returns: Json
      }
      recount_lot_quantity: {
        Args: {
          p_counted_quantity: number
          p_expected_quantity?: number
          p_lot_id: string
          p_note?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      register_channel: {
        Args: {
          p_description?: string
          p_kind: string
          p_name: string
          p_public_id?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      register_product: {
        Args: {
          p_attrs?: Json
          p_business_vertical: string
          p_display_name: string
          p_product_canonical_key: string
          p_workspace_id: string
        }
        Returns: Json
      }
      register_sellable_sku: {
        Args: { p_attrs?: Json; p_product_id: string; p_workspace_id: string }
        Returns: Json
      }
      register_source_system: {
        Args: {
          p_config?: Json
          p_description?: string
          p_instance_label: string
          p_kind: string
          p_public_id: string
          p_workspace_id: string
        }
        Returns: string
      }
      register_storage_location: {
        Args: {
          p_display_name?: string
          p_location_code: string
          p_parent_code?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      reject_source_crosswalk: {
        Args: { p_crosswalk_id: string; p_note?: string }
        Returns: string
      }
      remove_intake_candidate: {
        Args: {
          p_candidate_link_id: string
          p_expected_version: number
          p_workspace_id: string
        }
        Returns: Json
      }
      reorder_inventory_media: {
        Args: {
          p_media_ids: string[]
          p_subject_id: string
          p_subject_kind: string
          p_workspace_id: string
        }
        Returns: Json
      }
      request_cycle_count_recount: {
        Args: {
          p_discrepancy_id: string
          p_note?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      request_inventory_correction: {
        Args: {
          p_explanation: string
          p_issue_type: Database["public"]["Enums"]["correction_issue_type"]
          p_proposed_values?: Json
          p_subject_id: string
          p_subject_kind: string
          p_supporting_media_id?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      reserve_inventory_media: {
        Args: {
          p_byte_size: number
          p_content_hash?: string
          p_content_type: string
          p_exif_orientation?: number
          p_idempotency_key: string
          p_original_filename?: string
          p_slot_key?: string
          p_slot_label?: string
          p_subject_id: string
          p_subject_kind: string
          p_workspace_id: string
        }
        Returns: Json
      }
      resolve_cycle_count_discrepancy: {
        Args: {
          p_action: Database["public"]["Enums"]["cycle_count_resolution_action"]
          p_discrepancy_id: string
          p_note?: string
          p_to_location_code?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      resolve_data_quality_issue: {
        Args: {
          p_issue_id: string
          p_note?: string
          p_status: Database["public"]["Enums"]["data_quality_status"]
        }
        Returns: string
      }
      resolve_inventory_media_issue: {
        Args: {
          p_issue_id: string
          p_note?: string
          p_state: string
          p_workspace_id: string
        }
        Returns: Json
      }
      restore_acquisition_line_by_source: {
        Args: {
          p_acquisition_line_public_id: string
          p_idempotency_key: string
          p_reason: string
          p_source_system_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      restore_inventory_media: {
        Args: { p_media_id: string; p_workspace_id: string }
        Returns: Json
      }
      resume_intake_session: {
        Args: { p_session_id: string; p_workspace_id: string }
        Returns: Json
      }
      retire_listing_package_preset: {
        Args: { p_preset_id: string; p_workspace_id: string }
        Returns: Json
      }
      retire_storage_location: {
        Args: { p_location_code: string; p_workspace_id: string }
        Returns: Json
      }
      reverse_acquisition_payment: {
        Args: {
          p_idempotency_key: string
          p_payment_public_id: string
          p_reason: string
          p_workspace_id: string
        }
        Returns: Json
      }
      reverse_cost_allocation: {
        Args: { p_cost_component_id: string; p_reason?: string }
        Returns: Json
      }
      reverse_cost_component: {
        Args: {
          p_cost_component_id: string
          p_reason?: string
          p_replacement?: Json
        }
        Returns: Json
      }
      review_inventory_correction: {
        Args: {
          p_correction_id: string
          p_decision: string
          p_resolution_note?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      rotate_inventory_media: {
        Args: {
          p_delta_degrees: number
          p_media_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      set_listing_prep_check: {
        Args: {
          p_note?: string
          p_prep_id: string
          p_requirement_key: string
          p_state: Database["public"]["Enums"]["listing_prep_check_state"]
          p_workspace_id: string
        }
        Returns: Json
      }
      set_listing_prep_priority: {
        Args: {
          p_prep_id: string
          p_priority: Database["public"]["Enums"]["listing_prep_priority"]
          p_workspace_id: string
        }
        Returns: Json
      }
      set_primary_inventory_media: {
        Args: { p_media_id: string; p_workspace_id: string }
        Returns: Json
      }
      soft_delete_inventory_media: {
        Args: {
          p_media_id: string
          p_reason?: string
          p_recovery_days?: number
          p_workspace_id: string
        }
        Returns: Json
      }
      split_inventory_lot: {
        Args: {
          p_lot_id: string
          p_note?: string
          p_quantity: number
          p_to_location_code: string
          p_workspace_id: string
        }
        Returns: Json
      }
      stage_acquisition_cost_components: {
        Args: { p_components: Json; p_import_job_id: string }
        Returns: Json
      }
      stage_acquisition_line_items: {
        Args: { p_import_job_id: string; p_lines: Json }
        Returns: Json
      }
      stage_acquisition_lots: {
        Args: { p_import_job_id: string; p_lots: Json }
        Returns: Json
      }
      stage_acquisition_orders: {
        Args: { p_import_job_id: string; p_orders: Json }
        Returns: Json
      }
      stage_external_identifiers: {
        Args: { p_identifiers: Json; p_import_job_id: string }
        Returns: Json
      }
      stage_import_derivatives: {
        Args: { p_crosswalks?: Json; p_import_job_id: string; p_issues?: Json }
        Returns: Json
      }
      stage_inventory_lot: {
        Args: {
          p_fingerprint_inputs?: Json
          p_location_code?: string
          p_mapping_version?: string
          p_public_id: string
          p_quantity: number
          p_record_origin?: string
          p_sku_id: string
          p_tracking_mode: string
          p_workspace_id: string
        }
        Returns: Json
      }
      stage_source_records: {
        Args: { p_import_job_id: string; p_records: Json }
        Returns: Json
      }
      start_cycle_count: {
        Args: { p_session_id: string; p_workspace_id: string }
        Returns: Json
      }
      start_listing_prep: {
        Args: {
          p_assigned_to?: string
          p_priority?: Database["public"]["Enums"]["listing_prep_priority"]
          p_subject_id: string
          p_subject_kind: string
          p_workspace_id: string
        }
        Returns: Json
      }
      submit_acquisition_receipt: {
        Args: { p_receipt_public_id: string; p_workspace_id: string }
        Returns: Json
      }
      submit_cycle_count_for_review: {
        Args: {
          p_confirm_uncounted?: boolean
          p_session_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      submit_cycle_count_round: {
        Args: {
          p_confirm_uncounted?: boolean
          p_session_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      supersede_classification_rule: {
        Args: {
          p_exact_value: string
          p_expected_current_version: number
          p_match_field: string
          p_matcher_kind: string
          p_pattern: string
          p_pattern_flags: string
          p_precedence: number
          p_rationale: string
          p_rule_id: string
          p_target_classification_option_key: string
        }
        Returns: Json
      }
      supersede_inventory_record: {
        Args: {
          p_correction_id?: string
          p_reason: string
          p_replacement_id: string
          p_subject_id: string
          p_subject_kind: string
          p_workspace_id: string
        }
        Returns: Json
      }
      supersede_lot_line: {
        Args: { p_lot_line_id: string; p_new_lot_id: string; p_note?: string }
        Returns: Json
      }
      supersede_source_crosswalk: {
        Args: {
          p_crosswalk_id: string
          p_note?: string
          p_replacement_id: string
        }
        Returns: string
      }
      transition_acquisition_discrepancy: {
        Args: {
          p_discrepancy_public_id: string
          p_resolution_note?: string
          p_target: Database["public"]["Enums"]["acquisition_discrepancy_status"]
          p_workspace_id: string
        }
        Returns: Json
      }
      transition_acquisition_shipment: {
        Args: {
          p_expected_status: string
          p_idempotency_key?: string
          p_new_status: string
          p_reason?: string
          p_received_at?: string
          p_shipment_public_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      transition_intake_group: {
        Args: {
          p_group_id: string
          p_reason?: Json
          p_target_state: string
          p_workspace_id: string
        }
        Returns: Json
      }
      transition_listing_prep: {
        Args: {
          p_prep_id: string
          p_reason?: string
          p_to_status: Database["public"]["Enums"]["listing_prep_status"]
          p_workspace_id: string
        }
        Returns: Json
      }
      unlink_acquisition_receipt_inventory: {
        Args: {
          p_inventory_link_public_id: string
          p_reason: string
          p_workspace_id: string
        }
        Returns: Json
      }
      update_listing_prep_content: {
        Args: { p_patch: Json; p_prep_id: string; p_workspace_id: string }
        Returns: Json
      }
      upsert_intake_entry: {
        Args: {
          p_certificate_number?: string
          p_entry_attrs?: Json
          p_entry_index: number
          p_expected_version: number
          p_grade_designation?: string
          p_grading_company?: string
          p_group_id: string
          p_numeric_grade?: string
          p_serial_number?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      upsert_intake_group: {
        Args: {
          p_category: string
          p_condition_state?: string
          p_display_name: string
          p_expected_version: number
          p_group_id: string
          p_location_code?: string
          p_owner_tagged?: boolean
          p_product_attrs?: Json
          p_quantity: number
          p_requires_item_media?: boolean
          p_security_sensitive?: boolean
          p_serialized_child_count: number
          p_session_id: string
          p_sku_attrs?: Json
          p_source_evidence?: Json
          p_tracking_mode: string
          p_unique_condition?: boolean
          p_workspace_id: string
        }
        Returns: Json
      }
      validate_intake_readiness: {
        Args: { p_group_id: string; p_workspace_id: string }
        Returns: Json
      }
      void_cycle_count_observation:
        | {
            Args: {
              p_observation_id: string
              p_reason?: string
              p_subject_kind: string
              p_workspace_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_idempotency_key: string
              p_observation_id: string
              p_reason: string
              p_session_id: string
              p_subject_kind: string
              p_workspace_id: string
            }
            Returns: Json
          }
      withdraw_cost_allocation: {
        Args: { p_cost_component_id: string; p_reason: string }
        Returns: Json
      }
    }
    Enums: {
      acquisition_discrepancy_kind:
        | "short_shipped"
        | "over_shipped"
        | "damaged"
        | "wrong_item"
        | "not_as_described"
        | "price_mismatch"
        | "never_arrived"
      acquisition_discrepancy_status:
        | "open"
        | "claimed"
        | "resolved"
        | "written_off"
      acquisition_line_exclusion_state: "excluded" | "included"
      acquisition_order_status:
        | "open"
        | "completed"
        | "cancelled"
        | "refunded"
        | "unknown"
      acquisition_payment_instrument:
        | "card"
        | "bank"
        | "balance"
        | "credit"
        | "cash"
        | "other"
      acquisition_receipt_status:
        | "open"
        | "submitted"
        | "reconciled"
        | "cancelled"
      acquisition_shipment_status:
        | "expected"
        | "in_transit"
        | "delivered"
        | "lost"
        | "cancelled"
      correction_issue_type:
        | "wrong_category"
        | "wrong_product_name"
        | "wrong_set"
        | "wrong_card_number"
        | "wrong_grade"
        | "wrong_grader"
        | "wrong_certificate"
        | "wrong_serial"
        | "wrong_size"
        | "wrong_style_code"
        | "wrong_model"
        | "wrong_condition"
        | "wrong_product_format"
        | "wrong_quantity"
        | "duplicate_record"
        | "other"
      correction_state: "open" | "approved" | "rejected" | "resolved"
      cost_allocation_state:
        | "candidate"
        | "confirmed"
        | "reversed"
        | "withdrawn"
      cost_amount_state: "known" | "documented_free" | "unknown"
      cost_attribution_state: "direct" | "allocated" | "unresolved"
      cost_component_type:
        | "item_price"
        | "shipping"
        | "tax"
        | "fee"
        | "discount"
        | "other"
      crosswalk_method:
        | "exact_key"
        | "content_hash"
        | "normalized_text"
        | "similarity"
        | "manual"
      crosswalk_state: "candidate" | "confirmed" | "rejected" | "superseded"
      cycle_count_discrepancy_kind:
        | "item_missing"
        | "item_unexpected"
        | "item_wrong_location"
        | "lot_shortage"
        | "lot_overage"
        | "lot_uncounted"
      cycle_count_discrepancy_status:
        | "open"
        | "recount_requested"
        | "resolved"
        | "deferred"
      cycle_count_item_observation_kind:
        | "expected_found"
        | "wrong_location"
        | "unexpected_found"
      cycle_count_post_snapshot_classification:
        | "none"
        | "correction_requested"
        | "correction_approved"
        | "record_superseded"
        | "duplicate_voided"
        | "item_state_changed"
        | "quantity_changed"
        | "location_changed"
      cycle_count_resolution_action:
        | "recount_requested"
        | "item_moved_to_counted_location"
        | "item_loss_recorded"
        | "lot_quantity_adjusted"
        | "observation_mistaken"
        | "confirmed_system_location"
        | "routed_to_intake"
        | "explained_by_post_snapshot_activity"
        | "deferred"
      cycle_count_round_result_classification:
        | "matched"
        | "missing"
        | "unexpected"
        | "wrong_location"
        | "shortage"
        | "overage"
        | "uncounted"
        | "matched_after_recount"
        | "confirmed_after_recount"
        | "changed_after_recount"
        | "unresolved_after_recount"
        | "invalidated_by_post_snapshot_change"
      cycle_count_round_status:
        | "draft"
        | "counting"
        | "submitted"
        | "reviewed"
        | "closed"
        | "cancelled"
      cycle_count_round_type: "initial" | "recount"
      cycle_count_scope_type: "single_location" | "location_and_descendants"
      cycle_count_status:
        | "draft"
        | "in_progress"
        | "review"
        | "completed"
        | "cancelled"
      cycle_count_subject_type: "item" | "lot"
      data_quality_status: "open" | "acknowledged" | "resolved" | "wont_fix"
      import_job_status: "preview" | "committed" | "failed"
      intake_category:
        | "graded_tcg"
        | "raw_tcg"
        | "sealed_tcg"
        | "footwear"
        | "other"
      intake_group_state:
        | "draft"
        | "ready_to_commit"
        | "committed"
        | "abandoned"
      intake_next_action:
        | "CONDITION_DETAILS_NEEDED"
        | "LOCATION_ASSIGNMENT_NEEDED"
        | "PHOTOS_NEEDED"
        | "SOURCE_REVIEW_NEEDED"
        | "READY_FOR_FUTURE_LISTING_PREP"
        | "NO_IMMEDIATE_ACTION"
      intake_session_state: "open" | "abandoned"
      intake_source_state: "unknown" | "candidate" | "stated"
      inventory_cost_basis_event_kind: "created" | "superseded"
      inventory_cost_basis_method:
        | "fifo"
        | "source_observed_specific"
        | "deterministic_equal_attribution"
        | "unresolved"
      inventory_cost_basis_state: "current" | "superseded" | "unresolved"
      inventory_cost_basis_subject_kind: "lot" | "item"
      inventory_item_state: "active" | "superseded" | "void" | "lost"
      inventory_lot_state: "active" | "absorbed" | "void"
      inventory_subtype:
        | "graded_card"
        | "raw_card"
        | "sealed_tcg"
        | "footwear"
        | "apparel"
        | "electronics"
        | "other_collectible"
        | "unclassified"
      inventory_tracking_mode: "lot_managed" | "serialized"
      inventory_vertical: "tcg" | "footwear" | "other"
      listing_prep_check_state: "unknown" | "confirmed" | "not_applicable"
      listing_prep_priority: "low" | "normal" | "high" | "urgent"
      listing_prep_requirement_kind:
        | "identity"
        | "condition"
        | "measurements"
        | "package"
        | "price"
        | "quantity"
        | "disclosure"
        | "accessories"
        | "functionality"
      listing_prep_status:
        | "not_started"
        | "in_preparation"
        | "blocked"
        | "needs_review"
        | "ready_to_list"
        | "listed"
        | "cancelled"
      lot_line_state: "active" | "superseded"
      quantity_adjustment_reason:
        | "received"
        | "recount"
        | "damaged"
        | "lost"
        | "stolen"
        | "donated"
        | "internal_use"
        | "returned_to_supplier"
        | "sold_elsewhere"
        | "lot_split"
        | "lot_merge"
        | "other"
      reconciliation_adjudication_state:
        | "open"
        | "accepted"
        | "corrected"
        | "rejected"
        | "deferred"
      reconciliation_materiality: "none" | "cosmetic" | "material" | "financial"
      reconciliation_run_state: "running" | "completed" | "failed"
      reconciliation_verdict:
        | "matched_identical"
        | "matched_with_differences"
        | "source_only"
        | "target_only"
      source_parse_status: "parsed" | "malformed" | "skipped"
      workspace_role: "owner" | "operator" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
      acquisition_discrepancy_kind: [
        "short_shipped",
        "over_shipped",
        "damaged",
        "wrong_item",
        "not_as_described",
        "price_mismatch",
        "never_arrived",
      ],
      acquisition_discrepancy_status: [
        "open",
        "claimed",
        "resolved",
        "written_off",
      ],
      acquisition_line_exclusion_state: ["excluded", "included"],
      acquisition_order_status: [
        "open",
        "completed",
        "cancelled",
        "refunded",
        "unknown",
      ],
      acquisition_payment_instrument: [
        "card",
        "bank",
        "balance",
        "credit",
        "cash",
        "other",
      ],
      acquisition_receipt_status: [
        "open",
        "submitted",
        "reconciled",
        "cancelled",
      ],
      acquisition_shipment_status: [
        "expected",
        "in_transit",
        "delivered",
        "lost",
        "cancelled",
      ],
      correction_issue_type: [
        "wrong_category",
        "wrong_product_name",
        "wrong_set",
        "wrong_card_number",
        "wrong_grade",
        "wrong_grader",
        "wrong_certificate",
        "wrong_serial",
        "wrong_size",
        "wrong_style_code",
        "wrong_model",
        "wrong_condition",
        "wrong_product_format",
        "wrong_quantity",
        "duplicate_record",
        "other",
      ],
      correction_state: ["open", "approved", "rejected", "resolved"],
      cost_allocation_state: [
        "candidate",
        "confirmed",
        "reversed",
        "withdrawn",
      ],
      cost_amount_state: ["known", "documented_free", "unknown"],
      cost_attribution_state: ["direct", "allocated", "unresolved"],
      cost_component_type: [
        "item_price",
        "shipping",
        "tax",
        "fee",
        "discount",
        "other",
      ],
      crosswalk_method: [
        "exact_key",
        "content_hash",
        "normalized_text",
        "similarity",
        "manual",
      ],
      crosswalk_state: ["candidate", "confirmed", "rejected", "superseded"],
      cycle_count_discrepancy_kind: [
        "item_missing",
        "item_unexpected",
        "item_wrong_location",
        "lot_shortage",
        "lot_overage",
        "lot_uncounted",
      ],
      cycle_count_discrepancy_status: [
        "open",
        "recount_requested",
        "resolved",
        "deferred",
      ],
      cycle_count_item_observation_kind: [
        "expected_found",
        "wrong_location",
        "unexpected_found",
      ],
      cycle_count_post_snapshot_classification: [
        "none",
        "correction_requested",
        "correction_approved",
        "record_superseded",
        "duplicate_voided",
        "item_state_changed",
        "quantity_changed",
        "location_changed",
      ],
      cycle_count_resolution_action: [
        "recount_requested",
        "item_moved_to_counted_location",
        "item_loss_recorded",
        "lot_quantity_adjusted",
        "observation_mistaken",
        "confirmed_system_location",
        "routed_to_intake",
        "explained_by_post_snapshot_activity",
        "deferred",
      ],
      cycle_count_round_result_classification: [
        "matched",
        "missing",
        "unexpected",
        "wrong_location",
        "shortage",
        "overage",
        "uncounted",
        "matched_after_recount",
        "confirmed_after_recount",
        "changed_after_recount",
        "unresolved_after_recount",
        "invalidated_by_post_snapshot_change",
      ],
      cycle_count_round_status: [
        "draft",
        "counting",
        "submitted",
        "reviewed",
        "closed",
        "cancelled",
      ],
      cycle_count_round_type: ["initial", "recount"],
      cycle_count_scope_type: ["single_location", "location_and_descendants"],
      cycle_count_status: [
        "draft",
        "in_progress",
        "review",
        "completed",
        "cancelled",
      ],
      cycle_count_subject_type: ["item", "lot"],
      data_quality_status: ["open", "acknowledged", "resolved", "wont_fix"],
      import_job_status: ["preview", "committed", "failed"],
      intake_category: [
        "graded_tcg",
        "raw_tcg",
        "sealed_tcg",
        "footwear",
        "other",
      ],
      intake_group_state: [
        "draft",
        "ready_to_commit",
        "committed",
        "abandoned",
      ],
      intake_next_action: [
        "CONDITION_DETAILS_NEEDED",
        "LOCATION_ASSIGNMENT_NEEDED",
        "PHOTOS_NEEDED",
        "SOURCE_REVIEW_NEEDED",
        "READY_FOR_FUTURE_LISTING_PREP",
        "NO_IMMEDIATE_ACTION",
      ],
      intake_session_state: ["open", "abandoned"],
      intake_source_state: ["unknown", "candidate", "stated"],
      inventory_cost_basis_event_kind: ["created", "superseded"],
      inventory_cost_basis_method: [
        "fifo",
        "source_observed_specific",
        "deterministic_equal_attribution",
        "unresolved",
      ],
      inventory_cost_basis_state: ["current", "superseded", "unresolved"],
      inventory_cost_basis_subject_kind: ["lot", "item"],
      inventory_item_state: ["active", "superseded", "void", "lost"],
      inventory_lot_state: ["active", "absorbed", "void"],
      inventory_subtype: [
        "graded_card",
        "raw_card",
        "sealed_tcg",
        "footwear",
        "apparel",
        "electronics",
        "other_collectible",
        "unclassified",
      ],
      inventory_tracking_mode: ["lot_managed", "serialized"],
      inventory_vertical: ["tcg", "footwear", "other"],
      listing_prep_check_state: ["unknown", "confirmed", "not_applicable"],
      listing_prep_priority: ["low", "normal", "high", "urgent"],
      listing_prep_requirement_kind: [
        "identity",
        "condition",
        "measurements",
        "package",
        "price",
        "quantity",
        "disclosure",
        "accessories",
        "functionality",
      ],
      listing_prep_status: [
        "not_started",
        "in_preparation",
        "blocked",
        "needs_review",
        "ready_to_list",
        "listed",
        "cancelled",
      ],
      lot_line_state: ["active", "superseded"],
      quantity_adjustment_reason: [
        "received",
        "recount",
        "damaged",
        "lost",
        "stolen",
        "donated",
        "internal_use",
        "returned_to_supplier",
        "sold_elsewhere",
        "lot_split",
        "lot_merge",
        "other",
      ],
      reconciliation_adjudication_state: [
        "open",
        "accepted",
        "corrected",
        "rejected",
        "deferred",
      ],
      reconciliation_materiality: ["none", "cosmetic", "material", "financial"],
      reconciliation_run_state: ["running", "completed", "failed"],
      reconciliation_verdict: [
        "matched_identical",
        "matched_with_differences",
        "source_only",
        "target_only",
      ],
      source_parse_status: ["parsed", "malformed", "skipped"],
      workspace_role: ["owner", "operator", "viewer"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

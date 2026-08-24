// Hand-written aliases over the generated database contract.
//
// Why this file is separate from database.types.ts
// ------------------------------------------------
// database.types.ts is GENERATED and must stay that way: the drift guard
// regenerates it and fails on any difference, so anything hand-written there
// would be destroyed on the next regeneration (and, worse, would make the guard
// look broken). The previous snapshot mixed the two — schema shapes and
// hand-maintained domain unions in one file — which is part of why it was
// edited by hand and drifted 83 tables behind the schema.
//
// So: shapes are generated next door, meanings live here, and everything here
// is DERIVED from the generated contract except the few unions explicitly
// marked as having no database enum behind them.
//
// Both the client and the server import from this file. There is one contract,
// not one per package.

import type { Database } from './database.types.js';

export type { Database, Json } from './database.types.js';
export type { Tables, TablesInsert, TablesUpdate, Enums } from './database.types.js';

type PublicSchema = Database['public'];

// --- RPC helpers ------------------------------------------------------------
// The generator emits Tables/Enums helpers but none for functions, and the
// functions are where the untyped `client.rpc('name' as never, args as never)`
// calls were concentrated.

/** Every callable RPC name in the public schema. */
export type FunctionName = keyof PublicSchema['Functions'];

/** The argument object a given RPC expects. */
export type FunctionArgs<N extends FunctionName> = PublicSchema['Functions'][N]['Args'];

/** What a given RPC returns. */
export type FunctionReturns<N extends FunctionName> = PublicSchema['Functions'][N]['Returns'];

// --- Enum aliases -----------------------------------------------------------
// Named for how the application talks about them. Each resolves to a real
// database enum, so a renamed or removed enum breaks compilation here.

export type WorkspaceRole = Database['public']['Enums']['workspace_role'];
export type ImportJobStatus = Database['public']['Enums']['import_job_status'];
export type SourceParseStatus = Database['public']['Enums']['source_parse_status'];
export type CrosswalkState = Database['public']['Enums']['crosswalk_state'];
export type CrosswalkMethod = Database['public']['Enums']['crosswalk_method'];
export type DataQualityStatus = Database['public']['Enums']['data_quality_status'];

// --- Unions with NO database enum behind them -------------------------------
// These are stored as text with check constraints rather than as PostgreSQL
// enums, so the generator cannot produce them and nothing here can verify them
// against the schema. They are carried over verbatim from the previous
// hand-written snapshot.
//
// Treat them as unverified: a value added to a check constraint will NOT show
// up here, and TypeScript will not notice. Converting these columns to real
// enums would put them under the drift guard like everything else.

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

// --- Row aliases ------------------------------------------------------------

export type ImportJobRow = Database['public']['Tables']['import_jobs']['Row'];
export type SourceRecordRow = Database['public']['Tables']['source_records']['Row'];
export type SourceCrosswalkRow = Database['public']['Tables']['source_crosswalks']['Row'];
export type AuditEventRow = Database['public']['Tables']['audit_events']['Row'];
export type DataQualityIssueRow = Database['public']['Tables']['data_quality_issues']['Row'];
export type SourceSystemRow = Database['public']['Tables']['source_systems']['Row'];

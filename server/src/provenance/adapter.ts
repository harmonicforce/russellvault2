// Deterministic repository-fixture import adapter.
//
// Produces an IMPORT PLAN: the exact provenance rows that describe a fixture —
// job header, raw source records, data-quality issues, and crosswalk
// candidates. The plan is a pure function of the file's bytes plus the parser
// and mapping versions, so the same file always yields the same plan, the same
// hashes, and the same row count.
//
// Ordering guarantee: raw source records are built from the untransformed
// payload and both hashes are computed BEFORE any parser runs, so a record of
// exactly what arrived exists independently of whether interpretation
// succeeded.
//
// PREVIEW vs COMMIT
//   preview — mode 'preview'. Describes what an import WOULD record. A preview
//             job can never reach committed status (the database makes `mode`
//             immutable and requires mode='commit' for status='committed'), so
//             previewing cannot mutate committed provenance.
//   commit  — mode 'commit'. REQUIRES a caller-supplied idempotency key. The
//             database refuses a second committed job for the same
//             (workspace, source system, content hash, parser, mapping) tuple.
//
// This module performs NO database access, NO network access, and reads only
// allowlisted files already committed to this repository.

import { readFileSync } from 'node:fs';
import {
  findFixture,
  fixturePath,
  type FixtureDefinition,
} from './fixtures.js';
import { canonicalHash, sha256Bytes, type JsonValue } from './hash.js';
import {
  MAPPING_VERSION,
  PARSER_VERSION,
  normalizeName,
  parseRow,
  type ParseIssue,
} from './parsers.js';

export const IMPORT_PROCESS = 'provenance.fixture_adapter';

export interface PlannedSourceRecord {
  readonly sourceRowIndex: number;
  readonly sourceRowKey: string | null;
  readonly rawPayload: JsonValue;
  readonly normalizedHash: string;
  readonly parseStatus: 'parsed' | 'malformed';
  readonly parserOutput: Record<string, JsonValue> | null;
  readonly errors: ParseIssue[];
  readonly warnings: ParseIssue[];
}

export interface PlannedIssue {
  readonly sourceRowIndex: number | null;
  readonly issueType:
    | 'malformed_row'
    | 'conflict'
    | 'duplicate_candidate'
    | 'count_discrepancy'
    | 'total_discrepancy'
    | 'blocked_mapping'
    | 'missing_required';
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly detail: Record<string, JsonValue>;
  /** Retained inline when the issue is not tied to one stored record. */
  readonly rawPayloadSnapshot: JsonValue | null;
}

export interface PlannedCrosswalk {
  readonly sourceRowIndex: number;
  readonly proposedEntityType: string;
  readonly proposedEntityKey: string;
  readonly matchMethod: 'exact_key' | 'content_hash' | 'normalized_text' | 'similarity' | 'manual';
  readonly confidence: number;
  readonly evidence: Record<string, JsonValue>;
  /**
   * Always 'candidate'. Included explicitly so the value is visible at the call
   * site and in tests: the adapter has no code path that proposes any other
   * initial state, and the database refuses one regardless.
   */
  readonly reviewState: 'candidate';
}

export interface ImportPlan {
  readonly mode: 'preview' | 'commit';
  readonly sourceLabel: string;
  readonly fileSha256: string;
  readonly contentSha256: string;
  readonly parserVersion: string;
  readonly mappingVersion: string;
  readonly idempotencyKey: string | null;
  readonly sourceRowCount: number;
  readonly acceptedRowCount: number;
  readonly issueRowCount: number;
  readonly sourceTotals: Record<string, number>;
  readonly records: PlannedSourceRecord[];
  readonly issues: PlannedIssue[];
  readonly crosswalks: PlannedCrosswalk[];
  readonly actorProcess: string;
}

export class ProvenanceError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface BuildPlanOptions {
  readonly filename: string;
  readonly mode: 'preview' | 'commit';
  /** Required when mode is 'commit'. */
  readonly idempotencyKey?: string | null;
}

export function buildImportPlan(options: BuildPlanOptions): ImportPlan {
  const fixture = findFixture(options.filename);
  if (!fixture) {
    // Deliberately does not echo the requested name back: reflecting caller
    // input into an error is a needless reflection surface, and the
    // allowlist is already discoverable through GET /fixtures.
    throw new ProvenanceError('unknown fixture: not in the repository allowlist', 404);
  }

  // Commit REQUIRES an idempotency key. This is refused here, before a single
  // byte is read, and again by commit_import_job() in the database.
  let idempotencyKey: string | null = null;
  if (options.mode === 'commit') {
    const key = (options.idempotencyKey ?? '').trim();
    if (key.length < 8) {
      throw new ProvenanceError(
        'commit requires an idempotency key of at least 8 characters',
        400
      );
    }
    idempotencyKey = key;
  }

  // 1. Read raw bytes and hash them BEFORE any interpretation.
  const bytes = readFileSync(fixturePath(fixture));
  const fileSha256 = sha256Bytes(bytes);

  let parsedDocument: JsonValue;
  try {
    parsedDocument = JSON.parse(bytes.toString('utf8')) as JsonValue;
  } catch (err) {
    throw new ProvenanceError(
      `fixture ${fixture.filename} is not valid JSON: ${(err as Error).message}`,
      422
    );
  }

  const rows: JsonValue[] = Array.isArray(parsedDocument) ? parsedDocument : [parsedDocument];
  const contentSha256 = canonicalHash(rows as JsonValue);

  // 2. Build a raw source record for EVERY row, before transformation.
  const records: PlannedSourceRecord[] = rows.map((raw, index) => {
    const rowKey = readRowKey(fixture, raw);
    return {
      sourceRowIndex: index,
      sourceRowKey: rowKey,
      rawPayload: raw,
      normalizedHash: canonicalHash(raw),
      // Placeholders replaced below; the raw payload above is already final.
      parseStatus: 'parsed',
      parserOutput: null,
      errors: [],
      warnings: [],
    };
  });

  // 3. Only now interpret each row.
  const issues: PlannedIssue[] = [];
  const finalRecords: PlannedSourceRecord[] = records.map((record) => {
    const parsed = parseRow(fixture, record.rawPayload);
    if (parsed.status === 'malformed') {
      issues.push({
        sourceRowIndex: record.sourceRowIndex,
        issueType: 'malformed_row',
        severity: 'error',
        message: `row ${record.sourceRowIndex} could not be parsed`,
        detail: { errors: parsed.errors as unknown as JsonValue },
        // The exact payload is preserved on the source record itself; the
        // snapshot is a second, independent copy so the evidence survives even
        // if the record link is ever lost.
        rawPayloadSnapshot: record.rawPayload,
      });
    }
    return {
      ...record,
      parseStatus: parsed.status,
      parserOutput: parsed.output,
      errors: parsed.errors,
      warnings: parsed.warnings,
    };
  });

  // 4. Reconciliation totals, summed only over rows that actually parsed.
  const sourceTotals: Record<string, number> = {};
  for (const field of fixture.totalFields) {
    let sum = 0;
    for (const record of finalRecords) {
      const value = record.parserOutput?.[field];
      if (typeof value === 'number' && Number.isFinite(value)) sum += value;
    }
    // Round to cents so floating-point drift never turns into a phantom
    // total discrepancy on re-import.
    sourceTotals[field] = Math.round(sum * 100) / 100;
  }
  sourceTotals.row_count = rows.length;

  // 5. Duplicate and similarity candidates. These NEVER merge anything: each
  //    involved row keeps its own record and gets its own candidate row for a
  //    human to review.
  const crosswalks = buildCandidates(fixture, finalRecords, issues);

  const issueRowCount = new Set(
    issues.map((i) => i.sourceRowIndex).filter((i): i is number => i !== null)
  ).size;
  const acceptedRowCount = finalRecords.filter((r) => r.parseStatus === 'parsed').length;

  return {
    mode: options.mode,
    sourceLabel: fixture.filename,
    fileSha256,
    contentSha256,
    parserVersion: PARSER_VERSION,
    mappingVersion: MAPPING_VERSION,
    idempotencyKey,
    sourceRowCount: rows.length,
    acceptedRowCount,
    issueRowCount,
    sourceTotals,
    records: finalRecords,
    issues,
    crosswalks,
    actorProcess: IMPORT_PROCESS,
  };
}

function readRowKey(fixture: FixtureDefinition, raw: JsonValue): string | null {
  if (fixture.rowKeyField === null) return null;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = (raw as Record<string, JsonValue>)[fixture.rowKeyField];
  return typeof value === 'string' && value !== '' ? value : null;
}

// Proposes candidates only. Every returned crosswalk is 'candidate'; nothing
// here confirms a match, and two rows that look alike stay two rows.
function buildCandidates(
  fixture: FixtureDefinition,
  records: readonly PlannedSourceRecord[],
  issues: PlannedIssue[]
): PlannedCrosswalk[] {
  const crosswalks: PlannedCrosswalk[] = [];
  if (fixture.shape !== 'whatnot_purchase') return crosswalks;

  // Group by normalized seller name. A shared normalized form is a REASON TO
  // LOOK, never a reason to merge.
  const byNormalizedSeller = new Map<string, PlannedSourceRecord[]>();
  for (const record of records) {
    if (record.parseStatus !== 'parsed') continue;
    const seller = record.parserOutput?.seller;
    if (typeof seller !== 'string') continue;
    const key = normalizeName(seller);
    if (key === '') continue;
    const bucket = byNormalizedSeller.get(key);
    if (bucket) bucket.push(record);
    else byNormalizedSeller.set(key, [record]);
  }

  for (const [normalized, bucket] of byNormalizedSeller) {
    const distinctRawNames = new Set(
      bucket.map((r) => String(r.parserOutput?.seller ?? ''))
    );
    // Only interesting when the SPELLINGS differ but normalize together —
    // that is the case a human must adjudicate.
    if (distinctRawNames.size < 2) continue;

    for (const record of bucket) {
      crosswalks.push({
        sourceRowIndex: record.sourceRowIndex,
        proposedEntityType: 'party_candidate',
        proposedEntityKey: normalized,
        matchMethod: 'normalized_text',
        confidence: 0.5,
        evidence: {
          normalized_form: normalized,
          observed_spellings: Array.from(distinctRawNames).sort() as unknown as JsonValue,
          rationale:
            'these spellings normalize to the same form; a reviewer must decide whether they are the same party',
        },
        reviewState: 'candidate',
      });
    }

    issues.push({
      sourceRowIndex: null,
      issueType: 'duplicate_candidate',
      severity: 'warning',
      message: `${distinctRawNames.size} spellings normalize to "${normalized}" and were NOT merged`,
      detail: {
        normalized_form: normalized,
        observed_spellings: Array.from(distinctRawNames).sort() as unknown as JsonValue,
        affected_row_count: bucket.length,
      },
      rawPayloadSnapshot: {
        spellings: Array.from(distinctRawNames).sort() as unknown as JsonValue,
      },
    });
  }

  return crosswalks;
}

// A compact, UI-friendly summary. Excludes the raw records themselves so a
// listing response never ships thousands of payloads.
export function summarizePlan(plan: ImportPlan) {
  return {
    mode: plan.mode,
    sourceLabel: plan.sourceLabel,
    fileSha256: plan.fileSha256,
    contentSha256: plan.contentSha256,
    parserVersion: plan.parserVersion,
    mappingVersion: plan.mappingVersion,
    sourceRowCount: plan.sourceRowCount,
    acceptedRowCount: plan.acceptedRowCount,
    issueRowCount: plan.issueRowCount,
    sourceTotals: plan.sourceTotals,
    crosswalkCandidateCount: plan.crosswalks.length,
    issueCount: plan.issues.length,
    staging: true as const,
    authoritative: false as const,
  };
}

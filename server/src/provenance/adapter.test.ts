// Phase 3 provenance adapter tests.
//
// These assert the guarantees the phase exists to provide: deterministic
// hashes, intact raw row counts, preview/commit separation, mandatory
// idempotency keys, malformed rows that never lose their payload, similar
// names that are never auto-merged, and candidate-only crosswalk states.

import { describe, it, expect } from 'vitest';
import { buildImportPlan, ProvenanceError, summarizePlan } from './adapter.js';
import { canonicalize, canonicalHash, sha256Bytes } from './hash.js';
import { MAPPING_VERSION, PARSER_VERSION, normalizeName, parseRow } from './parsers.js';
import { findFixture, listFixtures } from './fixtures.js';
import { getProvenanceConfig, isProvenanceEnabled } from './config.js';
import { readFileSync } from 'node:fs';
import { fixturePath } from './fixtures.js';

// The exact repository fixtures, their raw row counts, and the SHA-256 of
// their bytes. These are pinned: a change to any of them must fail this test
// rather than pass silently, because the seed data is not ours to modify.
const EXPECTED = [
  {
    filename: 'whatnot_purchases.json',
    rows: 2149,
    fileSha256: '71c55d607191c8f0a4e3d6858ef6bbe1217880602ba96f92757e9dabca8367cd',
  },
  {
    filename: 'inventory.json',
    rows: 1487,
    fileSha256: '6e33893edc57ebd10463a804ef96a5bde7746e7b75049dbe11327c36fcc44f41',
  },
  {
    filename: 'cost_links.json',
    rows: 287,
    fileSha256: 'dd5cdad64b50afab0a9994088e2da9cf5079926d1a41f059cf7f39e1cfe5f45f',
  },
  {
    filename: 'ebay_listings.json',
    rows: 20,
    fileSha256: '05fac2b16a70a51d622630d07e452e26f9c1b982ab21813887d393053138ddee',
  },
  {
    filename: 'checks.json',
    rows: 7,
    fileSha256: '85def08a3b04798093e6c6a6e5d1dd99d1a4da1c2f3f73ea0fe8e077b0f3f419',
  },
  {
    filename: 'sales.json',
    rows: 0,
    fileSha256: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  },
] as const;

describe('feature gating', () => {
  const SHADOW_PROJECT = {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'anon-key',
  };

  it('is disabled by default', () => {
    expect(getProvenanceConfig({})).toBeNull();
    expect(isProvenanceEnabled({})).toBe(false);
  });

  it('stays disabled for a partial or wrong flag value', () => {
    expect(isProvenanceEnabled({ ...SHADOW_PROJECT, SHADOW_IMPORT: '' })).toBe(false);
    expect(isProvenanceEnabled({ ...SHADOW_PROJECT, SHADOW_IMPORT: 'true' })).toBe(false);
    expect(isProvenanceEnabled({ ...SHADOW_PROJECT, SHADOW_IMPORT: '1' })).toBe(false);
  });

  // The flag alone is not enough: without a shadow project there is no way to
  // authenticate anyone, so the surface stays closed rather than degrading.
  it('stays disabled without the shadow project settings', () => {
    expect(isProvenanceEnabled({ SHADOW_IMPORT: 'repository-fixtures' })).toBe(false);
    expect(isProvenanceEnabled({
      SHADOW_IMPORT: 'repository-fixtures',
      SUPABASE_URL: 'http://127.0.0.1:54321',
    })).toBe(false);
    expect(isProvenanceEnabled({
      SHADOW_IMPORT: 'repository-fixtures',
      SUPABASE_ANON_KEY: 'anon-key',
    })).toBe(false);
  });

  it('enables only on the explicit demo/import mode plus a shadow project', () => {
    expect(isProvenanceEnabled({
      ...SHADOW_PROJECT, SHADOW_IMPORT: 'repository-fixtures',
    })).toBe(true);
  });
});

describe('hashing', () => {
  it('canonicalizes object key order so formatting does not change the hash', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalHash({ b: 1, a: 2 })).toBe(canonicalHash({ a: 2, b: 1 }));
  });

  it('produces different hashes for different values', () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });

  it('hashes nested structures deterministically', () => {
    const v = { z: [1, { y: 2, x: 3 }], a: null };
    expect(canonicalHash(v)).toBe(canonicalHash(JSON.parse(JSON.stringify(v))));
  });
});

describe('repository fixtures import with expected counts and hashes', () => {
  for (const expected of EXPECTED) {
    it(`${expected.filename}: ${expected.rows} raw rows and a pinned file hash`, () => {
      const plan = buildImportPlan({ filename: expected.filename, mode: 'preview' });

      expect(plan.sourceRowCount).toBe(expected.rows);
      expect(plan.records).toHaveLength(expected.rows);
      expect(plan.fileSha256).toBe(expected.fileSha256);

      // The recorded file hash really is the hash of the bytes on disk.
      const fixture = findFixture(expected.filename)!;
      expect(plan.fileSha256).toBe(sha256Bytes(readFileSync(fixturePath(fixture))));
    });
  }

  it('keeps all 2,149 Whatnot source rows intact with their canonical IDs', () => {
    const plan = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });

    expect(plan.sourceRowCount).toBe(2149);
    expect(plan.acceptedRowCount).toBe(2149);
    expect(plan.records).toHaveLength(2149);

    // Row order and index are preserved exactly.
    expect(plan.records[0].sourceRowIndex).toBe(0);
    expect(plan.records[2148].sourceRowIndex).toBe(2148);

    // Canonical source IDs are carried through untouched, never renumbered.
    expect(plan.records[0].sourceRowKey).toBe('WN-A-000001');
    const keys = plan.records.map((r) => r.sourceRowKey);
    expect(new Set(keys).size).toBe(2149);

    // The raw payload is the original object, not a transformed one.
    const raw = plan.records[0].rawPayload as Record<string, unknown>;
    expect(raw.acquisition_line_id).toBe('WN-A-000001');
    expect(raw.order_id).toBe('mKsPQvjaxGowpfFB3tP6zU');
  });

  it('is byte-for-byte deterministic across runs', () => {
    const a = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
    const b = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });

    expect(a.fileSha256).toBe(b.fileSha256);
    expect(a.contentSha256).toBe(b.contentSha256);
    expect(a.records.map((r) => r.normalizedHash)).toEqual(
      b.records.map((r) => r.normalizedHash)
    );
    expect(a.sourceTotals).toEqual(b.sourceTotals);
  });

  it('records source totals for reconciliation', () => {
    const plan = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
    expect(plan.sourceTotals.row_count).toBe(2149);
    expect(plan.sourceTotals.total_paid).toBeCloseTo(33283.76, 2);
    expect(plan.sourceTotals.quantity_purchased).toBe(2155);
  });

  it('computes hashes before transformation, so every row has one', () => {
    const plan = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
    expect(plan.records.every((r) => /^[0-9a-f]{64}$/.test(r.normalizedHash))).toBe(true);
    // Even a row that failed to parse still carries its raw payload.
    expect(plan.records.every((r) => r.rawPayload !== undefined)).toBe(true);
  });
});

describe('preview versus commit', () => {
  it('preview produces no committed job and no idempotency key', () => {
    const plan = buildImportPlan({ filename: 'checks.json', mode: 'preview' });
    expect(plan.mode).toBe('preview');
    expect(plan.idempotencyKey).toBeNull();
    expect(summarizePlan(plan).authoritative).toBe(false);
  });

  it('commit requires an idempotency key', () => {
    expect(() => buildImportPlan({ filename: 'checks.json', mode: 'commit' })).toThrow(
      ProvenanceError
    );
    expect(() =>
      buildImportPlan({ filename: 'checks.json', mode: 'commit', idempotencyKey: null })
    ).toThrow(/idempotency key/i);
    expect(() =>
      buildImportPlan({ filename: 'checks.json', mode: 'commit', idempotencyKey: '   ' })
    ).toThrow(/idempotency key/i);
    expect(() =>
      buildImportPlan({ filename: 'checks.json', mode: 'commit', idempotencyKey: 'short' })
    ).toThrow(/idempotency key/i);
  });

  it('commit accepts a sufficient idempotency key and records it', () => {
    const plan = buildImportPlan({
      filename: 'checks.json',
      mode: 'commit',
      idempotencyKey: 'commit-key-0001',
    });
    expect(plan.mode).toBe('commit');
    expect(plan.idempotencyKey).toBe('commit-key-0001');
  });

  it('preview and commit of the same file agree on every provenance fact', () => {
    const preview = buildImportPlan({ filename: 'checks.json', mode: 'preview' });
    const commit = buildImportPlan({
      filename: 'checks.json',
      mode: 'commit',
      idempotencyKey: 'commit-key-0002',
    });
    // Identical identity => the database's committed-identity index is what
    // makes a repeat commit a no-op rather than a duplicate.
    expect(commit.fileSha256).toBe(preview.fileSha256);
    expect(commit.contentSha256).toBe(preview.contentSha256);
    expect(commit.sourceRowCount).toBe(preview.sourceRowCount);
    expect(commit.parserVersion).toBe(preview.parserVersion);
    expect(commit.mappingVersion).toBe(preview.mappingVersion);
  });
});

describe('malformed rows', () => {
  it('turns an unparseable row into an issue without losing the raw payload', () => {
    const fixture = findFixture('whatnot_purchases.json')!;
    const bad = {
      acquisition_line_id: 'WN-A-BAD',
      order_id: 'ORDER-BAD',
      seller: 'someone',
      quantity_purchased: 'not-a-number',
      total_paid: 'also-bad',
    };
    const parsed = parseRow(fixture, bad);

    expect(parsed.status).toBe('malformed');
    expect(parsed.output).toBeNull();
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.errors.map((e) => e.field)).toContain('quantity_purchased');
    expect(parsed.errors[0].code).toBe('not_numeric');
  });

  it('refuses to coerce a bad number into a silent zero', () => {
    const fixture = findFixture('checks.json')!;
    const parsed = parseRow(fixture, { check_id: 'OP-X', actual: 'oops' });
    expect(parsed.status).toBe('malformed');
    expect(parsed.errors.some((e) => e.code === 'not_numeric')).toBe(true);
  });

  it('flags a missing required field rather than inventing one', () => {
    const fixture = findFixture('whatnot_purchases.json')!;
    const parsed = parseRow(fixture, { order_id: 'X' });
    expect(parsed.status).toBe('malformed');
    expect(parsed.errors.some((e) => e.code === 'missing_required')).toBe(true);
  });

  it('treats a non-object row as malformed', () => {
    const fixture = findFixture('checks.json')!;
    const parsed = parseRow(fixture, 'not-an-object');
    expect(parsed.status).toBe('malformed');
    expect(parsed.errors[0].code).toBe('not_an_object');
  });
});

describe('similar names are never auto-merged', () => {
  it('normalizes only to propose, never to rewrite', () => {
    expect(normalizeName('west_coast_dealsRANDOM')).toBe(
      normalizeName('west_coast_dealsRandom')
    );
    expect(normalizeName('Acme Cards')).toBe('acme cards');
  });

  it('keeps every similarly-named row as its own record', () => {
    const plan = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
    // The real fixture contains two spellings of one seller.
    const issue = plan.issues.find((i) => i.issueType === 'duplicate_candidate');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/NOT merged/);

    const spellings = (issue!.detail.observed_spellings as unknown as string[]);
    expect(spellings.length).toBeGreaterThanOrEqual(2);

    // Crucially: no row was removed or collapsed.
    expect(plan.records).toHaveLength(2149);
    expect(plan.acceptedRowCount).toBe(2149);
  });

  it('emits a separate candidate per affected row, all in candidate state', () => {
    const plan = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
    expect(plan.crosswalks.length).toBeGreaterThan(0);
    expect(plan.crosswalks.every((c) => c.reviewState === 'candidate')).toBe(true);
    // Each candidate points at its own distinct source row.
    const rowIndexes = plan.crosswalks.map((c) => c.sourceRowIndex);
    expect(new Set(rowIndexes).size).toBe(rowIndexes.length);
  });

  it('never produces a confirmed, rejected, or superseded state', () => {
    for (const fixture of listFixtures()) {
      const plan = buildImportPlan({ filename: fixture.filename, mode: 'preview' });
      for (const c of plan.crosswalks) {
        expect(c.reviewState).toBe('candidate');
      }
    }
  });

  it('proposes candidates with sub-certain confidence, never a decision', () => {
    const plan = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
    expect(plan.crosswalks.every((c) => c.confidence < 1)).toBe(true);
  });
});

describe('fixture allowlist', () => {
  it('refuses an unknown fixture name', () => {
    expect(() => buildImportPlan({ filename: 'nope.json', mode: 'preview' })).toThrow(
      ProvenanceError
    );
  });

  it('refuses path traversal attempts outright', () => {
    for (const attempt of [
      '../../../etc/passwd',
      '../seed/whatnot_purchases.json',
      '/etc/passwd',
      'whatnot_purchases.json/../../secret',
    ]) {
      expect(() => buildImportPlan({ filename: attempt, mode: 'preview' })).toThrow(
        /unknown fixture/
      );
    }
  });

  it('exposes only repository seed fixtures', () => {
    for (const f of listFixtures()) {
      expect(f.filename.endsWith('.json')).toBe(true);
      expect(f.filename).not.toContain('/');
      expect(f.filename).not.toContain('..');
    }
  });
});

describe('governed versions', () => {
  it('pins parser and mapping versions on every plan and record', () => {
    const plan = buildImportPlan({ filename: 'checks.json', mode: 'preview' });
    expect(plan.parserVersion).toBe(PARSER_VERSION);
    expect(plan.mappingVersion).toBe(MAPPING_VERSION);
    expect(/^\d+\.\d+\.\d+$/.test(PARSER_VERSION)).toBe(true);
    expect(/^\d+\.\d+\.\d+$/.test(MAPPING_VERSION)).toBe(true);
  });
});

describe('no canonical business entity is produced', () => {
  it('emits only provenance rows, never an acquisition or inventory record', () => {
    const plan = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
    const keys = Object.keys(plan);
    // The plan's shape is the whole contract: job header + raw records +
    // issues + candidates. Nothing that could be a canonical entity.
    expect(keys).toContain('records');
    expect(keys).toContain('issues');
    expect(keys).toContain('crosswalks');
    expect(keys).not.toContain('acquisitions');
    expect(keys).not.toContain('inventory');
    expect(keys).not.toContain('listings');
    expect(keys).not.toContain('sales');

    // A crosswalk names a PROPOSED entity as loose text and creates nothing.
    for (const c of plan.crosswalks) {
      expect(typeof c.proposedEntityType).toBe('string');
      expect(typeof c.proposedEntityKey).toBe('string');
    }
  });
});

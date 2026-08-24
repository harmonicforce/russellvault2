// Compile-time negative proofs for the database contract.
//
// A guard that only checks the code we wrote proves nothing about the code we
// might write next. These cases assert that TypeScript REJECTS the specific
// mistakes the generated contract exists to prevent — and that it rejects them
// for the stated reason, not incidentally.
//
// Each case is compiled on its own. A case that compiles is a failure: it means
// the contract has stopped being load-bearing at that point.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Compiled inside server/ so `@supabase/supabase-js` resolves from its
// node_modules exactly as it does for real server code.
const SANDBOX = join(ROOT, 'server', '.type-negative');

const PREAMBLE = `
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../shared/databaseAliases.js';

const client = createClient<Database>('http://localhost:54321', 'anon-key');
export async function probe(): Promise<unknown> {
`;

function compile(body) {
  mkdirSync(SANDBOX, { recursive: true });
  const dir = mkdtempSync(join(SANDBOX, 'case-'));
  try {
    writeFileSync(join(dir, 'case.ts'), `${PREAMBLE}${body}\n}\n`);
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
      files: ['case.ts'],
    }));
    const result = spawnSync(join(ROOT, 'server', 'node_modules', '.bin', 'tsc'),
      ['-p', join(dir, 'tsconfig.json')],
      { encoding: 'utf8', timeout: 180_000 });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The contract must reject `body`, and the message must mention `expect`. */
function rejects(body, expect) {
  const { status, output } = compile(body);
  assert.notEqual(status, 0,
    `TypeScript ACCEPTED code the contract must reject:\n${body}\n\n${output}`);
  assert.match(output, expect,
    `rejected, but not for the expected reason:\n${output}`);
}

test('a nonexistent RPC name is rejected', () => {
  rejects(
    "  return client.rpc('no_such_function_at_all', { p_workspace_id: 'w' });",
    /no_such_function_at_all/,
  );
});

test('a missing required RPC argument is rejected', () => {
  // record_acquisition_payment requires p_paid_at, p_amount_minor,
  // p_currency, p_instrument and p_acquisition_order_public_id.
  rejects(
    "  return client.rpc('record_acquisition_payment', { p_workspace_id: 'w' });",
    /p_acquisition_order_public_id|p_amount_minor|is not assignable/,
  );
});

test('an RPC argument of the wrong type is rejected', () => {
  rejects(
    "  return client.rpc('confirm_cost_allocation', "
    + "{ p_cost_component_id: 'c', p_expected_total_minor: 'not-a-number' });",
    /not assignable to type 'number'|p_expected_total_minor/,
  );
});

test('an invalid generated enum value is rejected', () => {
  rejects(
    "  const state: Database['public']['Enums']['crosswalk_state'] = 'not_a_real_state';\n"
    + '  return state;',
    /not_a_real_state|not assignable/,
  );
});

test('a nonexistent table name is rejected', () => {
  rejects(
    "  return client.from('no_such_table_at_all').select('*');",
    /no_such_table_at_all|not assignable/,
  );
});

test('an incompatible RPC return assignment is rejected', () => {
  // open_acquisition_receipt returns jsonb, typed as Json — not a number.
  rejects(
    "  const { data } = await client.rpc('open_acquisition_receipt', "
    + "{ p_workspace_id: 'w', p_acquisition_order_public_id: 'o', p_shipment_public_id: 's', "
    + "p_received_at: 'now', p_note: 'n', p_idempotency_key: 'k12345678' });\n"
    + '  const total: number = data;\n  return total;',
    /not assignable to type 'number'/,
  );
});

test('the positive control compiles, so the cases above fail for the right reason', () => {
  // If this did not compile, every "rejects" above would pass vacuously.
  const { status, output } = compile(
    "  return client.rpc('confirm_cost_allocation', "
    + "{ p_cost_component_id: 'c', p_expected_total_minor: 1234 });",
  );
  assert.equal(status, 0, `a VALID contract call failed to compile:\n${output}`);
});

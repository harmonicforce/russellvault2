#!/usr/bin/env node
// Print the shadow-database diagnostics bundle on demand.
//
// The runner emits this itself on a stall or a failure. This CLI is the
// backstop for the case the runner cannot cover: the step being killed from
// outside before the runner reacted. CI invokes it with `if: failure()` so that
// even an unexpected outer kill leaves evidence behind, and a human debugging a
// local stack can run it directly.

import { collectDiagnostics, renderDiagnostics } from './diagnostics.mjs';
import { buildLocalConnection } from './guard.mjs';

const lane = process.env.SHADOW_DB_RUNNER === 'supabase-cli' ? 'supabase-cli' : 'psql';

let psqlConnection = null;
if (lane === 'psql') {
  // A guard refusal here is itself worth printing; it must not abort the bundle.
  try { psqlConnection = buildLocalConnection(process.env); }
  catch (error) { console.error(`db:diagnose — local connection unavailable: ${error.message}`); }
}

console.log(renderDiagnostics(
  collectDiagnostics({
    lane,
    phase: process.argv[2] ?? 'post-failure',
    reason: 'invoked after a failed step; the runner may not have reported',
    position: 'not known to this process — see the runner output above for the last progress record',
    elapsedMs: 0,
    psqlConnection,
  }),
  { heading: `db:diagnose (${lane})` },
));

// Legacy stop-loss: this Express/SQLite prototype is not the authoritative
// data model (see docs/architecture.md) and its direct writes are exactly the
// operations later target-model phases are replacing. In production, writes
// are OFF by default; an operator must explicitly opt in on the server. There
// is no client-side switch and no secret shipped to the browser — the client
// only ever learns the current boolean state via GET /api/health.
//
// This guard governs HTTP requests ONLY. It cannot govern writes that happen
// while modules are being imported, which is why startup/bootstrap writes are
// controlled separately by SEED_LEGACY_ON_EMPTY (see legacyBootstrapPolicy.ts).
// Neither flag implies the other.
import type { NextFunction, Request, Response } from 'express';
import { resolveLegacyWritesEnabled } from './legacy/accessConfig.js';

/**
 * The rule now lives in legacy/accessConfig.ts and is re-exported here so the
 * existing import sites keep working.
 *
 * The semantics CHANGED in Genome Repair Work Order 2. It used to read
 * `!isProduction || flag === 'true'`, so development and test were always
 * writable and only production was protected. Every environment now requires
 * the explicit flag. "Only production is guarded" is the wrong default for an
 * unauthoritative store: it makes the dangerous behaviour the one you get
 * without thinking, and it means local and CI runs exercise a path production
 * never takes.
 */
export { resolveLegacyWritesEnabled };

export const legacyWritesEnabled = resolveLegacyWritesEnabled(process.env);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function legacyWriteGuard(req: Request, res: Response, next: NextFunction) {
  if (legacyWritesEnabled || SAFE_METHODS.has(req.method)) return next();
  res.status(403).json({
    error:
      'This app is running read-only. Legacy direct-SQLite writes are disabled in every environment unless ' +
      'ALLOW_LEGACY_WRITES=true is explicitly set on the server (see docs/architecture.md).',
    readOnly: true,
  });
}

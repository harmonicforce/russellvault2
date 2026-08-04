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
import type { EnvLike } from './legacyBootstrapPolicy.js';

/**
 * The rule, extracted as a pure function so other modules can evaluate it
 * against an explicit environment instead of importing a value that was frozen
 * at this module's load time. The semantics are unchanged: outside production
 * writes are always on; in production only the exact string 'true' enables them.
 */
export function resolveLegacyWritesEnabled(env: EnvLike = process.env): boolean {
  const isProduction = env.NODE_ENV === 'production';
  return !isProduction || env.ALLOW_LEGACY_WRITES === 'true';
}

export const legacyWritesEnabled = resolveLegacyWritesEnabled(process.env);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function legacyWriteGuard(req: Request, res: Response, next: NextFunction) {
  if (legacyWritesEnabled || SAFE_METHODS.has(req.method)) return next();
  res.status(403).json({
    error:
      'This app is running read-only in production. Legacy direct-SQLite writes are disabled pending the ' +
      'relational shadow system (see docs/architecture.md). An owner-admin can set ALLOW_LEGACY_WRITES=true ' +
      'on the server to re-enable them.',
    readOnly: true,
  });
}

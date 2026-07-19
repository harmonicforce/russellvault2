// Phase 0 stop-loss: this Express/SQLite prototype is not the authoritative
// data model (see docs/architecture.md) and its direct writes are exactly the
// operations Phase 1+ is replacing. In production, writes are OFF by default;
// an operator must explicitly opt in on the server. There is no client-side
// switch and no secret shipped to the browser — the client only ever learns
// the current boolean state via GET /api/health.
import type { NextFunction, Request, Response } from 'express';

const isProduction = process.env.NODE_ENV === 'production';

export const legacyWritesEnabled = !isProduction || process.env.ALLOW_LEGACY_WRITES === 'true';

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

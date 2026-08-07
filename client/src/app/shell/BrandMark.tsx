// Russell Vault identity in the shell.
//
// The 75/25 hybrid applies here as restraint. This is the chrome an operator
// sees for eight hours; it carries identity through typography, a single gold
// structural accent, and geometry — not through ornament.
//
// Deliberately NOT here:
//   - the detailed crest, which is illegible at chrome size and is reserved
//     for large branded moments;
//   - the mascot, which has no place in a serious operational workflow;
//   - the CURATED / PACKED / TRUSTED slogan, which is a brand moment and not
//     routine navigation furniture;
//   - any newly invented permanent logo.
//
// The existing Vault glyph and wordmark are preserved as-is. Inventing
// permanent artwork is not something this slice is entitled to do.

import { Vault } from 'lucide-react';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Vault className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate font-display text-sm font-semibold leading-tight tracking-wide text-ink">
          The Russell Vault
        </span>
        {!compact && (
          <span className="block truncate text-xs leading-tight text-ink-muted">Operations</span>
        )}
      </span>
    </span>
  );
}

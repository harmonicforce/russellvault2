// The operator's theme choice.
//
// A radio group rather than a menu: the three modes are mutually exclusive, all
// three fit, and a radio group states the CURRENT choice in the accessibility
// tree without the operator having to open anything to find out what is
// selected.
//
// This component knows nothing about storage. It is handed the current
// preference and a setter; the ThemeStore adapter is wired above it.

import { THEME_MODES, type ThemePreference } from '../../lib/theme';

export interface ThemeControlProps {
  readonly preference: ThemePreference;
  readonly onChange: (next: ThemePreference) => void;
  /** Distinguishes the sidebar instance from the drawer instance. */
  readonly idPrefix?: string;
}

export function ThemeControl({ preference, onChange, idPrefix = 'theme' }: ThemeControlProps) {
  const labelId = `${idPrefix}-label`;
  return (
    <div className="px-2 py-2">
      <div id={labelId} className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Appearance
      </div>
      {/*
        Native radio inputs. A custom widget would have to reimplement arrow-key
        roving, and getting that subtly wrong is worse than not styling it.
      */}
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-0.5">
        {THEME_MODES.map((mode) => {
          const id = `${idPrefix}-${mode.value}`;
          const selected = preference === mode.value;
          return (
            <label
              key={mode.value}
              htmlFor={id}
              className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control px-3 py-2 text-sm transition-colors ${
                selected
                  ? 'bg-accent/12 font-semibold text-accent-strong'
                  : 'text-ink-secondary hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <input
                id={id}
                type="radio"
                name={`${idPrefix}-preference`}
                value={mode.value}
                checked={selected}
                onChange={() => onChange(mode.value)}
                className="h-4 w-4 shrink-0 accent-[var(--brand-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              />
              <span className="min-w-0 truncate">{mode.label}</span>
            </label>
          );
        })}
      </div>
      {/*
        The scope disclosure. This preference lives in this browser on this
        device; claiming otherwise would be a promise the shell cannot keep.
      */}
      <p className="px-3 pt-1.5 text-xs leading-snug text-ink-muted">
        Saved on this device only.
      </p>
    </div>
  );
}

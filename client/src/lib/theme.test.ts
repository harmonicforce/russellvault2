/// <reference types="node" />
// @vitest-environment jsdom
//
// The theme contract: presentation only, explicit choice always wins, and the
// two Dark Vault declaration blocks cannot drift apart.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// theme.ts comes through Vite's ?raw import. The stylesheet cannot: vitest
// stubs CSS modules to empty by default, so ?raw on a .css file yields ''.
// It is read from disk instead, with a file-local Node type reference rather
// than widening the whole browser-targeted project's types.
import themeSource from './theme?raw';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
import {
  THEME_MODES,
  applyThemePreference,
  createMemoryThemeStore,
  isThemePreference,
  readThemePreference,
  resolveTheme,
} from './theme';

describe('theme preference', () => {
  it('offers exactly the three approved modes with their Russell Vault labels', () => {
    expect(THEME_MODES.map((m) => m.value)).toEqual(['system', 'light', 'dark']);
    expect(THEME_MODES.map((m) => m.label)).toEqual(['System', 'Light Vault Ledger', 'Dark Vault']);
  });

  it.each([['system'], ['light'], ['dark']])('accepts %s as a stored preference', (value) => {
    expect(isThemePreference(value)).toBe(true);
  });

  it.each([['banana'], [''], [null], [undefined], [1], [{}]])('rejects %s as a stored preference', (value) => {
    expect(isThemePreference(value)).toBe(false);
  });

  it('falls back to following the system for unrecognized stored input', () => {
    expect(readThemePreference('banana')).toBe('system');
    expect(readThemePreference(null)).toBe('system');
    expect(readThemePreference('dark')).toBe('dark');
  });
});

describe('theme resolution', () => {
  it('follows the operating system when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  // An explicit choice is a decision, not a hint.
  it('lets explicit light override an operating system set to dark', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('lets explicit dark override an operating system set to light', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('theme application', () => {
  it('marks the root for an explicit choice', () => {
    const root = document.createElement('html');
    applyThemePreference(root, 'dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyThemePreference(root, 'light');
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  // Writing a resolved snapshot would freeze the theme at the value the OS had
  // when the page loaded; removing the attribute keeps the stylesheet's
  // prefers-color-scheme block live so it keeps following.
  it('removes the marker for system rather than freezing a resolved value', () => {
    const root = document.createElement('html');
    root.setAttribute('data-theme', 'dark');
    applyThemePreference(root, 'system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('theme storage port', () => {
  // The foundation must not reach for localStorage itself: it would be
  // untestable without a DOM and would couple a design concern to a browser
  // API. The shell injects the adapter.
  it('does not reference web storage in the foundation module', () => {
    // Comments are stripped first: the module's own doc comment explains that
    // it deliberately does not touch web storage, and matching that prose
    // would make this assertion pass or fail on wording rather than on code.
    const code = themeSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/localStorage|sessionStorage/);
  });

  it('round-trips a preference through an injected store', () => {
    const store = createMemoryThemeStore();
    expect(readThemePreference(store.read())).toBe('system');
    store.write('dark');
    expect(readThemePreference(store.read())).toBe('dark');
  });
});

describe('theme stylesheet', () => {
  const darkBlocks = () => {
    // Both Dark Vault blocks: the OS-preference one and the explicit opt-in.
    //
    // Anchored on each block's own OPENING SELECTOR rather than on
    // "@media (prefers-color-scheme: dark)". That media string also appears in
    // the `@custom-variant dark` definition near the top of the file, so
    // anchoring on it sliced the wrong region entirely and silently compared
    // two empty strings. These two selectors occur exactly once each.
    const MEDIA_SELECTOR = ':root:where(:not([data-theme="light"]))';
    const EXPLICIT_SELECTOR = ':root[data-theme="dark"] {';
    const declarations = (block: string) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('--'))
        .join('\n');
    // The media block is nested inside @media so it closes at one indent
    // level; the explicit block is top-level and closes at column zero.
    const body = (selector: string, closes: string) => {
      const start = css.indexOf(selector);
      expect(start, `${selector} should appear in index.css`).toBeGreaterThan(-1);
      const rest = css.slice(start + selector.length);
      const end = rest.indexOf(closes);
      expect(end, `${selector} should be a closed block`).toBeGreaterThan(-1);
      return declarations(rest.slice(0, end));
    };
    return [body(MEDIA_SELECTOR, '\n  }'), body(EXPLICIT_SELECTOR, '\n}')];
  };

  // Plain CSS has no mixin, so the values appear twice. If they ever drift,
  // an explicit "Dark Vault" would stop matching an OS-dark "System".
  it('keeps the two Dark Vault declaration blocks identical', () => {
    const [media, explicit] = darkBlocks();
    expect(media.length).toBeGreaterThan(0);
    expect(explicit).toBe(media);
  });

  it('requests no third-party font at runtime', () => {
    expect(css).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|@import\s+url\(/);
  });

  // Status colour is independent of brand: gold never means warning.
  it('maps status tokens to their own ramps, never to gold', () => {
    const statusLines = css.split('\n').filter((l: string) => /--status-(success|warning|serious|critical|information):/.test(l));
    expect(statusLines.length).toBeGreaterThanOrEqual(10);
    for (const line of statusLines) expect(line).not.toMatch(/gold/);
  });

  it('pairs a readable foreground with the brand fill in both themes', () => {
    // Light fills with a dark gold so the label is white; dark fills with a
    // bright gold so the label must be dark ink.
    expect(css).toMatch(/--on-accent:\s*var\(--rv-parchment-000\)/);
    expect(css).toMatch(/--on-accent:\s*var\(--rv-ink-900\)/);
  });
});

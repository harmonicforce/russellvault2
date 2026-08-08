// @vitest-environment jsdom
//
// Behavioral acceptance for the truth-state presentation, CoverageNotice and
// ProvenanceLabel.
//
// The property under test throughout: EVERY TRUTH STATE RENDERS A DISTINCT,
// TRUTHFUL REPRESENTATION. Two states that produce the same DOM text are two
// states an operator cannot tell apart, and the whole contract exists so that
// "there are none" and "we could not find out" are never the same screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  CoverageNotice,
  DependencyState,
  EmptyState,
  LoadingState,
  PartialState,
  ProvenanceLabel,
  StaleState,
  TRUTH_STATE_KINDS,
  failed,
  notConfigured,
  unauthorized,
  unavailable,
  type ProvenanceKind,
} from '../index';

afterEach(cleanup);

const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('every truth state is a distinct representation', () => {
  /** Renders each kind through the presentation the contract assigns it. */
  const renderKind = (kind: (typeof TRUTH_STATE_KINDS)[number]) => {
    switch (kind) {
      case 'loading':
        return render(<LoadingState />);
      case 'ready':
        // `ready` has no state component of its own: the value IS the render.
        return render(<p>RV-LOT-0001</p>);
      case 'empty':
        return render(<EmptyState title="No lots recorded" />);
      case 'partial':
        return render(
          <PartialState coverage={{ included: 'Governed lots', missing: 'Legacy lots', safeToAggregate: false }} />,
        );
      case 'stale':
        return render(<StaleState label="Cached copy." lastRefreshedAt="2026-08-08 09:14" canRefresh={false} />);
      case 'unavailable':
        return render(<DependencyState state={unavailable('The service did not respond.')} />);
      case 'unauthorized':
        return render(<DependencyState state={unauthorized('You are not a member of this workspace.')} />);
      case 'notConfigured':
        return render(<DependencyState state={notConfigured('Not enabled in this deployment.')} />);
      case 'error':
        return render(<DependencyState state={failed('LOT_READ_FAILED', 'The read failed.')} />);
    }
  };

  it('renders nine distinct texts for the nine kinds', () => {
    const rendered = new Map<string, string>();
    for (const kind of TRUTH_STATE_KINDS) {
      renderKind(kind);
      rendered.set(kind, text());
      cleanup();
    }
    expect(rendered.size).toBe(TRUTH_STATE_KINDS.length);
    // No two states may produce the same words.
    expect(new Set(rendered.values()).size).toBe(TRUTH_STATE_KINDS.length);
  });

  it('never lets a non-empty state borrow the empty presentation', () => {
    for (const kind of TRUTH_STATE_KINDS) {
      if (kind === 'empty') continue;
      renderKind(kind);
      expect(document.querySelector('[data-truth-state="empty"]')).toBeNull();
      expect(text()).not.toMatch(/confirmed result, not a failed request/i);
      cleanup();
    }
  });

  it('never renders a count or a zero for a state that established nothing', () => {
    for (const kind of ['loading', 'unavailable', 'unauthorized', 'notConfigured', 'error'] as const) {
      renderKind(kind);
      expect(text()).not.toMatch(/\b0\b/);
      expect(text()).not.toMatch(/\bno results\b/i);
      cleanup();
    }
  });
});

describe('LoadingState', () => {
  it('announces that work is in progress rather than sitting silently blank', () => {
    render(<LoadingState label="Reading governed lots…" />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.textContent).toBe('Reading governed lots…');
  });
});

describe('EmptyState', () => {
  it('states an authoritative zero and says it is confirmed', () => {
    render(<EmptyState title="No lots recorded" description="Add inventory to see lots here." />);
    expect(screen.getByText('No lots recorded')).toBeTruthy();
    expect(screen.getByText('Add inventory to see lots here.')).toBeTruthy();
    expect(text()).toMatch(/confirmed result, not a failed request/i);
  });

  it('renders a caller-supplied first-record action', () => {
    render(<EmptyState title="No lots recorded" action={<button type="button">Add inventory</button>} />);
    expect(screen.getByRole('button', { name: 'Add inventory' })).toBeTruthy();
  });
});

describe('DependencyState', () => {
  it('says an unavailable dependency is not a result of zero', () => {
    render(<DependencyState state={unavailable('The governed identity service did not respond.')} />);
    expect(text()).toMatch(/could not be loaded/i);
    expect(text()).toMatch(/The governed identity service did not respond\./);
    expect(text()).toMatch(/not a result of zero/i);
  });

  it('leaks no protected content for unauthorized, in either direction', () => {
    render(<DependencyState state={unauthorized('You are not a member of this workspace.')} />);
    const rendered = text();
    expect(rendered).toMatch(/do not have access/i);
    // Neither "there are none" nor "there are some you may not see": both are
    // disclosures about a record the caller may not know about.
    expect(rendered).not.toMatch(/\d+ record/i);
    expect(rendered).not.toMatch(/\bnone\b/i);
    expect(rendered).toMatch(/No part of the protected record is shown here/i);
  });

  it('explains a configuration gap without reporting a fault', () => {
    render(<DependencyState state={notConfigured('Governed identity is not enabled in this deployment.')} />);
    const rendered = text();
    expect(rendered).toMatch(/not configured in this deployment/i);
    expect(rendered).toMatch(/Nothing has failed/i);
    // Configuration is not breakage; saying so sends the operator hunting for
    // a fault that does not exist.
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names a bounded error with its reference code', () => {
    render(<DependencyState state={failed('LOT_READ_TIMEOUT', 'The lot read timed out.')} />);
    expect(text()).toMatch(/the request failed/i);
    expect(text()).toMatch(/LOT_READ_TIMEOUT/);
    expect(text()).toMatch(/no count has been assumed/i);
  });

  it('offers a retry only where retrying could change the answer', () => {
    const onRetry = vi.fn();
    render(<DependencyState state={unavailable('No response.')} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    cleanup();
    render(<DependencyState state={unauthorized('Not a member.')} onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('StaleState', () => {
  it('shows the data is old, when it was last confirmed, and offers a safe refresh', () => {
    const onRefresh = vi.fn();
    render(
      <StaleState
        label="The governed service is not responding; this is the last confirmed copy."
        lastRefreshedAt="2026-08-08 09:14"
        canRefresh
        onRefresh={onRefresh}
      />,
    );
    expect(text()).toMatch(/may be out of date/i);
    expect(text()).toMatch(/Last confirmed: 2026-08-08 09:14/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('says the age is not known rather than inventing one', () => {
    render(<StaleState label="Cached copy." lastRefreshedAt={null} canRefresh={false} />);
    expect(text()).toMatch(/Last confirmed: not known/i);
    expect(text()).not.toMatch(/just now/i);
  });

  it('says so when no safe refresh exists, instead of offering one that is not', () => {
    render(<StaleState label="Cached copy." lastRefreshedAt={null} canRefresh={false} />);
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(text()).toMatch(/safe refresh is not available/i);
  });
});

describe('CoverageNotice', () => {
  it('states what is included and what is missing', () => {
    render(
      <CoverageNotice
        coverage={{ included: 'Governed acquisitions', missing: 'Historical spreadsheet imports', safeToAggregate: true }}
      />,
    );
    expect(text()).toMatch(/Included\s*Governed acquisitions/);
    expect(text()).toMatch(/Missing\s*Historical spreadsheet imports/);
  });

  it('says missing coverage is not known rather than implying completeness', () => {
    render(<CoverageNotice coverage={{ included: 'Governed acquisitions', missing: null, safeToAggregate: true }} />);
    expect(text()).toMatch(/Missing\s*Not known/);
  });

  // The assertion this component exists for.
  it('states plainly when the subset must not be totalled', () => {
    render(
      <CoverageNotice coverage={{ included: 'Governed lines only', missing: 'Legacy lines', safeToAggregate: false }} />,
    );
    expect(text()).toMatch(/Do not total these figures/i);
    expect(text()).not.toMatch(/may be totalled/i);
  });

  it('says when totalling the included subset is safe', () => {
    render(<CoverageNotice coverage={{ included: 'All governed lines', missing: null, safeToAggregate: true }} />);
    expect(text()).toMatch(/may be totalled/i);
    expect(text()).not.toMatch(/Do not total/i);
  });

  it('reports an unavailable dependency when the caller knows of one', () => {
    render(
      <CoverageNotice
        coverage={{ included: 'Governed lines', missing: null, safeToAggregate: false }}
        dependencyUnavailable="The legacy database did not respond."
      />,
    );
    expect(text()).toMatch(/Dependency\s*The legacy database did not respond\./);
  });

  it('states the time basis only when the caller supplies one', () => {
    render(
      <CoverageNotice
        coverage={{ included: 'Governed lines', missing: null, safeToAggregate: true }}
        timeBasis="historical"
      />,
    );
    expect(text()).toMatch(/Basis\s*Historical records/);

    cleanup();
    render(<CoverageNotice coverage={{ included: 'Governed lines', missing: null, safeToAggregate: true }} />);
    // An unknown basis renders nothing: a surface that does not know whether it
    // is showing current or historical data must claim neither.
    expect(text()).not.toMatch(/Basis/);
  });

  it('renders the coverage action the caller attached', () => {
    render(
      <CoverageNotice
        coverage={{
          included: 'Governed lines',
          missing: 'Legacy lines',
          safeToAggregate: false,
          action: { label: 'Review the legacy import', href: '/import-review' },
        }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Review the legacy import' });
    expect(link.getAttribute('href')).toBe('/import-review');
  });
});

describe('PartialState', () => {
  it('renders the coverage notice for a partial answer', () => {
    render(<PartialState coverage={{ included: 'Governed lots', missing: null, safeToAggregate: false }} />);
    expect(document.querySelector('[data-truth-state="partial"]')).toBeTruthy();
    expect(text()).toMatch(/Coverage is partial/i);
  });
});

describe('ProvenanceLabel', () => {
  const KINDS: readonly ProvenanceKind[] = [
    'governed',
    'legacy',
    'imported',
    'marketplace',
    'current',
    'historical',
  ];

  it('carries every kind as words, never as colour alone', () => {
    const seen = new Set<string>();
    for (const kind of KINDS) {
      render(<ProvenanceLabel kind={kind} />);
      const rendered = text();
      expect(rendered.length).toBeGreaterThan(0);
      seen.add(rendered);
      cleanup();
    }
    // Six kinds, six distinct texts: no two authorities read the same.
    expect(seen.size).toBe(KINDS.length);
  });

  it('names the visible authority for each kind', () => {
    const expected: Record<ProvenanceKind, RegExp> = {
      governed: /Governed/,
      legacy: /Legacy, non-authoritative/,
      imported: /Imported source evidence/,
      marketplace: /Marketplace source/,
      current: /Current/,
      historical: /Historical/,
    };
    for (const kind of KINDS) {
      render(<ProvenanceLabel kind={kind} />);
      expect(text()).toMatch(expected[kind]);
      cleanup();
    }
  });

  it('puts the full meaning in the accessibility text by default', () => {
    render(<ProvenanceLabel kind="legacy" />);
    // Present in the DOM text and therefore in the accessible name, without
    // flooding a dense table with sentences.
    expect(text()).toMatch(/Not authoritative and not governed/i);
  });

  it('shows the meaning on screen when the caller asks for it', () => {
    render(<ProvenanceLabel kind="marketplace" meaningVisibility="full" />);
    expect(screen.getByText(/Not controlled or verified here/i)).toBeTruthy();
  });

  it('appends caller detail without inventing any', () => {
    render(<ProvenanceLabel kind="marketplace" detail="Source: Whatnot." meaningVisibility="full" />);
    expect(text()).toMatch(/Source: Whatnot\./);

    cleanup();
    render(<ProvenanceLabel kind="marketplace" meaningVisibility="full" />);
    expect(text()).not.toMatch(/Whatnot/);
  });

  it('exposes the kind for a caller to assert against', () => {
    render(<ProvenanceLabel kind="imported" />);
    expect(document.querySelector('[data-provenance="imported"]')).toBeTruthy();
  });

  it('never renders authority in brand gold', () => {
    for (const kind of KINDS) {
      render(<ProvenanceLabel kind={kind} />);
      const pill = document.querySelector('[data-tone]') as HTMLElement;
      expect(pill.className).not.toContain('accent');
      cleanup();
    }
  });
});

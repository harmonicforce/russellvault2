// The truth-state contract.
//
// The property under test throughout: a failed retrieval is never a zero.
import { describe, expect, it } from 'vitest';
import {
  TRUTH_STATE_KINDS,
  empty,
  failed,
  hasValue,
  isAggregationSafe,
  isIndeterminate,
  loading,
  notConfigured,
  partial,
  ready,
  stale,
  sumSameCurrency,
  unauthorized,
  unavailable,
  type TruthState,
} from './truthState';

describe('truth state — construction', () => {
  it('can construct every approved state', () => {
    const states: TruthState<number[]>[] = [
      loading(),
      ready([1]),
      empty(),
      partial([1], { included: 'governed lines', missing: 'legacy lines', safeToAggregate: false }),
      stale([1], { label: 'Last confirmed 10 minutes ago', lastRefreshedAt: '2026-08-07T10:00:00.000Z', canRefresh: true }),
      unavailable('The governed dependency did not answer.'),
      unauthorized('You do not have access to this workspace.'),
      notConfigured('Governed mode is not enabled for this deployment.'),
      failed('dependency_failed', 'The request could not be completed.'),
    ];
    expect(states.map((s) => s.kind)).toEqual([...TRUTH_STATE_KINDS]);
  });

  it('names exactly the nine approved states', () => {
    expect([...TRUTH_STATE_KINDS]).toEqual([
      'loading',
      'ready',
      'empty',
      'partial',
      'stale',
      'unavailable',
      'unauthorized',
      'notConfigured',
      'error',
    ]);
  });
});

describe('truth state — empty is not failure', () => {
  // The central distinction. `empty` is an authoritative "there are none";
  // everything indeterminate is "we could not find out". Rendering the second
  // as the first is how a dashboard confidently reports a wrong zero.
  it('treats empty as a successful answer, not an indeterminate one', () => {
    expect(isIndeterminate(empty())).toBe(false);
  });

  it.each([
    ['unavailable', unavailable('no answer')],
    ['unauthorized', unauthorized('not permitted')],
    ['notConfigured', notConfigured('not enabled')],
    ['error', failed('dependency_failed', 'failed')],
  ])('treats %s as indeterminate, distinct from empty', (_label, state) => {
    expect(isIndeterminate(state)).toBe(true);
    expect(state.kind).not.toBe('empty');
  });

  it('carries no value on empty, so nothing can read a count off it', () => {
    const state = empty();
    expect(hasValue(state)).toBe(false);
    expect('value' in state).toBe(false);
  });

  it.each([
    ['unavailable', unavailable('no answer')],
    ['unauthorized', unauthorized('not permitted')],
    ['notConfigured', notConfigured('not enabled')],
    ['error', failed('dependency_failed', 'failed')],
  ])('carries no value on %s, so failure cannot be read as zero', (_label, state) => {
    expect(hasValue(state)).toBe(false);
    expect('value' in state).toBe(false);
  });

  // The module must not ship the convenience that causes the bug: there is no
  // exported helper that takes a failure and hands back a number.
  it('exposes no helper that converts a failure into a count', async () => {
    const module = await import('./truthState');
    for (const state of [unavailable('x'), unauthorized('x'), notConfigured('x'), failed('c', 'm')]) {
      for (const [name, exported] of Object.entries(module)) {
        if (typeof exported !== 'function' || name === 'sumSameCurrency') continue;
        let result: unknown;
        try {
          result = (exported as (s: unknown) => unknown)(state);
        } catch {
          continue;
        }
        expect(typeof result).not.toBe('number');
      }
    }
  });
});

describe('truth state — value access', () => {
  it.each([
    ['ready', ready([1, 2])],
    ['partial', partial([1], { included: 'some', missing: null, safeToAggregate: true })],
    ['stale', stale([1], { label: 'stale' })],
  ])('reports that %s carries a value', (_label, state) => {
    expect(hasValue(state)).toBe(true);
  });

  it('reports that loading carries no value', () => {
    expect(hasValue(loading())).toBe(false);
  });
});

describe('truth state — partial coverage', () => {
  it('carries included coverage, missing coverage, and aggregation safety', () => {
    const state = partial([1], {
      included: 'committed governed-native lines',
      missing: 'historical legacy purchases',
      safeToAggregate: false,
    });
    if (state.kind !== 'partial') throw new Error('expected partial');
    expect(state.coverage.included).toBe('committed governed-native lines');
    expect(state.coverage.missing).toBe('historical legacy purchases');
    expect(state.coverage.safeToAggregate).toBe(false);
  });

  it('represents unknown missing coverage explicitly rather than as an empty string', () => {
    const state = partial([1], { included: 'what we have', missing: null, safeToAggregate: false });
    if (state.kind !== 'partial') throw new Error('expected partial');
    expect(state.coverage.missing).toBeNull();
  });

  it('can carry an operator action', () => {
    const state = partial([1], {
      included: 'governed',
      missing: 'legacy',
      safeToAggregate: false,
      action: { label: 'Review legacy purchases', href: '/legacy' },
    });
    if (state.kind !== 'partial') throw new Error('expected partial');
    expect(state.coverage.action).toEqual({ label: 'Review legacy purchases', href: '/legacy' });
  });
});

describe('truth state — stale', () => {
  it('carries the last successful refresh, a label, and a refresh affordance', () => {
    const state = stale([1], {
      lastRefreshedAt: '2026-08-07T10:00:00.000Z',
      label: 'Last confirmed 10 minutes ago',
      canRefresh: true,
    });
    if (state.kind !== 'stale') throw new Error('expected stale');
    expect(state.lastRefreshedAt).toBe('2026-08-07T10:00:00.000Z');
    expect(state.label).toBe('Last confirmed 10 minutes ago');
    expect(state.canRefresh).toBe(true);
  });

  it('represents an unknown last refresh as null rather than inventing a time', () => {
    const state = stale([1], { label: 'Possibly out of date' });
    if (state.kind !== 'stale') throw new Error('expected stale');
    expect(state.lastRefreshedAt).toBeNull();
    expect(state.canRefresh).toBe(false);
  });
});

describe('truth state — aggregation safety', () => {
  it('allows aggregation of a fully ready value', () => {
    expect(isAggregationSafe(ready([1, 2]))).toBe(true);
  });

  // Partial data that is silently summed becomes a confident wrong total.
  it('refuses aggregation of partial data unless coverage explicitly permits it', () => {
    expect(isAggregationSafe(partial([1], { included: 'some', missing: 'rest', safeToAggregate: false }))).toBe(false);
    expect(isAggregationSafe(partial([1], { included: 'all of one kind', missing: null, safeToAggregate: true }))).toBe(true);
  });

  it.each([
    ['loading', loading()],
    ['empty', empty()],
    ['stale', stale([1], { label: 'stale' })],
    ['unavailable', unavailable('x')],
    ['unauthorized', unauthorized('x')],
    ['notConfigured', notConfigured('x')],
    ['error', failed('c', 'm')],
  ])('refuses aggregation of %s', (_label, state) => {
    expect(isAggregationSafe(state)).toBe(false);
  });
});

describe('truth state — money', () => {
  it('totals a single currency exactly, in minor units', () => {
    expect(sumSameCurrency([{ amountMinor: 1500, currency: 'USD' }, { amountMinor: 2000, currency: 'USD' }])).toEqual({
      amountMinor: 3500,
      currency: 'USD',
    });
  });

  // There is no exchange rate here, and inventing one would fabricate a
  // financial fact.
  it('refuses to combine mixed currencies rather than returning a meaningless number', () => {
    expect(sumSameCurrency([{ amountMinor: 1000, currency: 'USD' }, { amountMinor: 900, currency: 'EUR' }])).toBeNull();
  });

  // Nothing to total is "no comparable total", which the caller renders as
  // such — never as a confident 0.
  it('returns null for nothing to total instead of zero', () => {
    expect(sumSameCurrency([])).toBeNull();
  });
});

// @vitest-environment jsdom
//
// Behavioral acceptance for ResponsiveRecordList.
//
// The defect this component exists to prevent is not "the table looks bad on a
// phone". It is that the columns pushed off the right-hand edge of a
// horizontally scrolling table are systematically the ones carrying the
// warnings — status, provenance, the marker saying a figure is not
// authoritative. So the assertions below are mostly about what must NOT
// disappear.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ResponsiveRecordList, type ResponsiveRecord, type ResponsiveRecordListProps } from './ResponsiveRecordList';
import { empty, failed, loading, partial, ready, stale, unavailable, type TruthState } from '../foundations/truthState';

afterEach(cleanup);

const RECORDS: readonly ResponsiveRecord[] = [
  {
    key: 'lot-1',
    identity: 'Charizard VMAX — graded',
    subheading: 'RV-LOT-0001',
    status: { tone: 'warning', label: 'Needs review' },
    provenance: { kind: 'legacy' },
    primaryFields: [
      { label: 'Quantity', value: 12, numeric: true },
      { label: 'Location', value: 'Shelf A3' },
    ],
    secondaryFields: [{ label: 'Recorded', value: '2026-07-02' }],
  },
  {
    key: 'lot-2',
    identity: 'Sealed booster box',
    subheading: 'RV-LOT-0002',
    status: { tone: 'success', label: 'Ready' },
    provenance: { kind: 'governed' },
    primaryFields: [{ label: 'Quantity', value: 4, numeric: true }],
  },
];

const renderList = (
  state: TruthState<readonly ResponsiveRecord[]> = ready(RECORDS),
  props: Partial<ResponsiveRecordListProps> = {},
) => render(<ResponsiveRecordList label="Lots" state={state} {...props} />);

const bodyText = () => (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ResponsiveRecordList — structure', () => {
  it('renders a named list so assistive technology can report position and count', () => {
    renderList();
    const list = screen.getByRole('list', { name: 'Lots' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders the primary identity of every record', () => {
    renderList();
    expect(screen.getByText('Charizard VMAX — graded')).toBeTruthy();
    expect(screen.getByText('Sealed booster box')).toBeTruthy();
  });

  it('keeps the record subheading visible', () => {
    renderList();
    expect(screen.getByText('RV-LOT-0001')).toBeTruthy();
  });
});

describe('ResponsiveRecordList — critical truth stays visible', () => {
  it('renders status as words, for every record', () => {
    renderList();
    expect(screen.getByText(/Needs review/)).toBeTruthy();
    expect(screen.getByText(/Ready/)).toBeTruthy();
  });

  it('renders provenance for every record that has it', () => {
    renderList();
    expect(document.querySelector('[data-provenance="legacy"]')).toBeTruthy();
    expect(document.querySelector('[data-provenance="governed"]')).toBeTruthy();
    expect(bodyText()).toMatch(/Legacy, non-authoritative/);
  });

  // The regression this file guards: nothing critical behind a disclosure.
  it('places status and provenance in the same region as the identity', () => {
    renderList();
    const card = document.querySelector('[data-record-key="lot-1"]') as HTMLElement;
    expect(within(card).getByText('Charizard VMAX — graded')).toBeTruthy();
    expect(within(card).getByText(/Needs review/)).toBeTruthy();
    expect(within(card).getByText(/Legacy, non-authoritative/)).toBeTruthy();
    // No <details>, no collapsed container hiding the warning.
    expect(card.querySelector('details')).toBeNull();
    expect(card.querySelector('[hidden]')).toBeNull();
  });

  it('renders every primary and secondary field with its label', () => {
    renderList();
    const card = document.querySelector('[data-record-key="lot-1"]') as HTMLElement;
    for (const label of ['Quantity', 'Location', 'Recorded']) {
      expect(within(card).getByText(label)).toBeTruthy();
    }
    expect(within(card).getByText('12')).toBeTruthy();
    expect(within(card).getByText('Shelf A3')).toBeTruthy();
    expect(within(card).getByText('2026-07-02')).toBeTruthy();
  });

  it('gives numeric fields tabular figures so columns of digits stay aligned', () => {
    renderList();
    const card = document.querySelector('[data-record-key="lot-1"]') as HTMLElement;
    expect(within(card).getByText('12').className).toContain('tabular-nums');
    expect(within(card).getByText('Shelf A3').className).not.toContain('tabular-nums');
  });
});

describe('ResponsiveRecordList — actions', () => {
  it('renders record actions as reachable controls', () => {
    const onOpen = vi.fn();
    render(
      <ResponsiveRecordList
        label="Lots"
        state={ready([
          {
            ...RECORDS[0],
            actions: (
              <button type="button" onClick={onOpen}>
                Open RV-LOT-0001
              </button>
            ),
          },
        ])}
      />,
    );
    const action = screen.getByRole('button', { name: 'Open RV-LOT-0001' });
    action.focus();
    expect(document.activeElement).toBe(action);
    fireEvent.click(action);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('ResponsiveRecordList — truth states', () => {
  it('renders loading rather than an empty list', () => {
    renderList(loading());
    expect(document.querySelector('[data-truth-state="loading"]')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(bodyText()).not.toMatch(/No records/);
  });

  it('renders an authoritative empty as a confirmed zero', () => {
    renderList(empty(), { empty: { title: 'No lots recorded' } });
    expect(screen.getByText('No lots recorded')).toBeTruthy();
    expect(bodyText()).toMatch(/confirmed result, not a failed request/i);
  });

  it('never renders the empty presentation for a failure', () => {
    renderList(failed('LOT_LIST_FAILED', 'The lot list could not be read.'));
    expect(document.querySelector('[data-truth-state="empty"]')).toBeNull();
    expect(bodyText()).toMatch(/The request failed/i);
    expect(bodyText()).toMatch(/LOT_LIST_FAILED/);
  });

  it('renders records with the coverage warning when partial', () => {
    renderList(
      partial(RECORDS, { included: 'Governed lots only', missing: 'Legacy lots', safeToAggregate: false }),
    );
    expect(screen.getByRole('list', { name: 'Lots' })).toBeTruthy();
    expect(bodyText()).toMatch(/Do not total these figures/i);
  });

  it('renders records with the stale warning when stale', () => {
    renderList(stale(RECORDS, { label: 'Cached copy.', lastRefreshedAt: null, canRefresh: false }));
    expect(screen.getByRole('list', { name: 'Lots' })).toBeTruthy();
    expect(bodyText()).toMatch(/may be out of date/i);
    expect(bodyText()).toMatch(/Last confirmed: not known/i);
  });

  it('offers a retry for a dependency failure', () => {
    const onRetry = vi.fn();
    renderList(unavailable('The identity service did not respond.'), { onRetry });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

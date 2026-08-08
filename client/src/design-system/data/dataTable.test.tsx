// @vitest-environment jsdom
//
// Behavioral acceptance for the governed DataTable.
//
// Every assertion renders the component and inspects the resulting DOM and
// accessibility tree. Nothing here reads module source: a table whose
// implementation mentions `aria-sort` but never puts one in the document must
// fail this file.
//
// The suite exists mainly to pin ONE property, which is the reason the table
// takes a TruthState at all:
//
//     A FAILED REQUEST NEVER RENDERS THE SAME UI AS ZERO RESULTS.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DataTable, type DataColumn } from './DataTable';
import {
  empty,
  failed,
  loading,
  notConfigured,
  partial,
  ready,
  stale,
  unauthorized,
  unavailable,
  type TruthState,
} from '../foundations/truthState';

afterEach(cleanup);

interface Lot {
  readonly id: string;
  readonly publicId: string;
  readonly quantity: number;
}

const LOTS: readonly Lot[] = [
  { id: '1', publicId: 'RV-LOT-0001', quantity: 12 },
  { id: '2', publicId: 'RV-LOT-0002', quantity: 4 },
];

const COLUMNS: DataColumn<Lot>[] = [
  { key: 'publicId', header: 'Lot', render: (row) => row.publicId, sortable: true },
  { key: 'quantity', header: 'Quantity', render: (row) => row.quantity, numeric: true, align: 'right' },
];

function renderTable(
  state: TruthState<readonly Lot[]>,
  props: Partial<Parameters<typeof DataTable<Lot>>[0]> = {},
) {
  return render(
    <DataTable<Lot>
      caption="Lots"
      columns={COLUMNS}
      state={state}
      rowKey={(row) => row.id}
      empty={{ title: 'No lots recorded' }}
      {...props}
    />,
  );
}

/** The rendered table's own text, whitespace-normalised. */
const bodyText = () => (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('DataTable — semantics', () => {
  it('renders a real table with an accessible name', () => {
    renderTable(ready(LOTS));
    expect(screen.getByRole('table', { name: 'Lots' })).toBeTruthy();
  });

  it('renders accessible column headers', () => {
    renderTable(ready(LOTS));
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent?.replace(/,.*/, '').trim())).toEqual(['Lot', 'Quantity']);
    // scope is what ties a header to its column for a screen reader reading a
    // cell in isolation.
    headers.forEach((header) => expect(header.getAttribute('scope')).toBe('col'));
  });

  it('renders ready rows', () => {
    renderTable(ready(LOTS));
    expect(screen.getByText('RV-LOT-0001')).toBeTruthy();
    expect(screen.getByText('RV-LOT-0002')).toBeTruthy();
    // Header row plus one row per record.
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});

describe('DataTable — a failure is never a zero', () => {
  it('renders loading as loading, not as empty', () => {
    renderTable(loading());
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('[data-truth-state="loading"]')).toBeTruthy();
    expect(document.querySelector('[data-truth-state="empty"]')).toBeNull();
    expect(bodyText()).not.toMatch(/No lots recorded/);
  });

  it('renders an authoritative empty as an explicit confirmed zero', () => {
    renderTable(empty());
    expect(document.querySelector('[data-truth-state="empty"]')).toBeTruthy();
    expect(screen.getByText('No lots recorded')).toBeTruthy();
    // The distinction stated on screen, not merely implied by a data attribute.
    expect(bodyText()).toMatch(/confirmed result, not a failed request/i);
  });

  it.each([
    ['unavailable', unavailable('The governed identity service did not respond.')],
    ['error', failed('IDENTITY_TIMEOUT', 'The lookup timed out.')],
    ['unauthorized', unauthorized('You are not a member of this workspace.')],
    ['notConfigured', notConfigured('Governed identity is not enabled in this deployment.')],
  ])('renders %s without ever showing the empty presentation', (_kind, state) => {
    renderTable(state as TruthState<readonly Lot[]>);
    expect(document.querySelector('[data-truth-state="empty"]')).toBeNull();
    const text = bodyText();
    expect(text).not.toMatch(/No lots recorded/);
    expect(text).not.toMatch(/\b0 results\b/);
  });

  it('gives each indeterminate state a distinct, truthful presentation', () => {
    const cases = [
      { state: unavailable('The service did not respond.'), kind: 'unavailable', text: /could not be loaded/i },
      { state: unauthorized('Not a member.'), kind: 'unauthorized', text: /do not have access/i },
      { state: notConfigured('Not enabled here.'), kind: 'notConfigured', text: /not configured in this deployment/i },
      { state: failed('E_CODE', 'It broke.'), kind: 'error', text: /the request failed/i },
    ] as const;

    for (const testCase of cases) {
      renderTable(testCase.state as TruthState<readonly Lot[]>);
      expect(document.querySelector(`[data-truth-state="${testCase.kind}"]`)).toBeTruthy();
      expect(bodyText()).toMatch(testCase.text);
      cleanup();
    }
  });

  it('renders no table at all for an indeterminate state', () => {
    // A header row above nothing reads as a table that merely happens to be
    // short — exactly the confusion the truth contract exists to prevent.
    renderTable(unavailable('The service did not respond.'));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('does not offer a retry for unauthorized, where retrying cannot change the answer', () => {
    const onRetry = vi.fn();
    renderTable(unauthorized('You are not a member of this workspace.'), { onRetry });
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();

    cleanup();
    renderTable(unavailable('The service did not respond.'), { onRetry });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows no protected content for unauthorized', () => {
    renderTable(unauthorized('You are not a member of this workspace.'));
    const text = bodyText();
    expect(text).not.toMatch(/RV-LOT-/);
    expect(text).toMatch(/No part of the protected record is shown here/i);
  });
});

describe('DataTable — partial and stale', () => {
  it('renders partial rows AND the coverage warning', () => {
    renderTable(
      partial(LOTS, {
        included: 'Governed lots only',
        missing: 'Legacy spreadsheet lots',
        safeToAggregate: false,
      }),
    );
    expect(screen.getByText('RV-LOT-0001')).toBeTruthy();
    expect(document.querySelector('[data-truth-state="partial"]')).toBeTruthy();
    expect(bodyText()).toMatch(/Governed lots only/);
    expect(bodyText()).toMatch(/Legacy spreadsheet lots/);
  });

  it('states that an unsafe subset must not be totalled', () => {
    renderTable(
      partial(LOTS, { included: 'Governed lots only', missing: null, safeToAggregate: false }),
    );
    expect(bodyText()).toMatch(/Do not total these figures/i);
  });

  it('renders stale rows AND the stale warning with the last refresh', () => {
    renderTable(
      stale(LOTS, { label: 'The identity service is not responding.', lastRefreshedAt: '2026-08-08 09:14', canRefresh: true }),
    );
    expect(screen.getByText('RV-LOT-0001')).toBeTruthy();
    expect(document.querySelector('[data-truth-state="stale"]')).toBeTruthy();
    expect(bodyText()).toMatch(/may be out of date/i);
    expect(bodyText()).toMatch(/2026-08-08 09:14/);
  });

  it('fires the caller-supplied refresh when a safe refresh exists', () => {
    const onRefresh = vi.fn();
    renderTable(stale(LOTS, { label: 'Cached.', lastRefreshedAt: null, canRefresh: true }), { onRefresh });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('DataTable — sorting', () => {
  it('exposes the sort direction on the column and in the control name', () => {
    renderTable(ready(LOTS), { sort: { key: 'publicId', direction: 'ascending' }, onSortChange: () => {} });
    const header = screen.getAllByRole('columnheader')[0];
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    // The direction reaches assistive technology as words, not only as a glyph.
    expect(screen.getByRole('button', { name: /Lot, sorted ascending/i })).toBeTruthy();
  });

  it('reports descending distinctly', () => {
    renderTable(ready(LOTS), { sort: { key: 'publicId', direction: 'descending' }, onSortChange: () => {} });
    expect(screen.getAllByRole('columnheader')[0].getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByRole('button', { name: /Lot, sorted descending/i })).toBeTruthy();
  });

  it('marks a sortable but inactive column as not sorted', () => {
    renderTable(ready(LOTS), { sort: null, onSortChange: () => {} });
    expect(screen.getAllByRole('columnheader')[0].getAttribute('aria-sort')).toBe('none');
    expect(screen.getByRole('button', { name: /Lot, not sorted/i })).toBeTruthy();
  });

  it('asks the caller to sort rather than sorting itself', () => {
    const onSortChange = vi.fn();
    renderTable(ready(LOTS), { sort: null, onSortChange });
    fireEvent.click(screen.getByRole('button', { name: /Lot, not sorted/i }));
    expect(onSortChange).toHaveBeenCalledWith('publicId');
    // The rendered order is unchanged: ordering is the domain's answer.
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[0]).toContain('RV-LOT-0001');
  });
});

describe('DataTable — pagination', () => {
  const pagination = { page: 2, pageSize: 10, total: 34, onPageChange: vi.fn() };

  it('renders reachable, named pagination controls', () => {
    renderTable(ready(LOTS), { pagination });
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy();
    expect(bodyText()).toMatch(/11–20 of 34/);
    expect(bodyText()).toMatch(/2 \/ 4/);
  });

  it('changes page through the caller', () => {
    const onPageChange = vi.fn();
    renderTable(ready(LOTS), { pagination: { ...pagination, onPageChange } });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('stops at the ends', () => {
    renderTable(ready(LOTS), { pagination: { ...pagination, page: 1 } });
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderTable(ready(LOTS), { pagination: { ...pagination, page: 4 } });
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // An unknown total is not zero, and no page count can be computed from it.
  it('says an unknown total is unknown rather than inventing one', () => {
    renderTable(ready(LOTS), {
      pagination: { page: 1, pageSize: 10, total: null, onPageChange: vi.fn(), hasNextPage: true },
    });
    const text = bodyText();
    expect(text).toMatch(/unknown total/i);
    expect(text).not.toMatch(/of 0\b/);
    expect(text).toMatch(/Page 1/);
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('remains usable alongside an authoritative empty', () => {
    renderTable(empty(), { pagination: { page: 1, pageSize: 10, total: 0, onPageChange: vi.fn() } });
    expect(bodyText()).toMatch(/0 results/);
    expect(screen.getByText('No lots recorded')).toBeTruthy();
  });

  it('renders no pagination for an indeterminate state', () => {
    // Paging through records we could not read is a control with nothing
    // behind it.
    renderTable(unavailable('The service did not respond.'), { pagination });
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });
});

describe('DataTable — row activation', () => {
  it('activates a row from the keyboard through a real button', () => {
    const onRowActivate = vi.fn();
    renderTable(ready(LOTS), {
      onRowActivate,
      rowActivationLabel: (row) => `Open lot ${row.publicId}`,
    });
    const control = screen.getByRole('button', { name: 'Open lot RV-LOT-0001' });
    expect(control.tagName).toBe('BUTTON');
    control.focus();
    expect(document.activeElement).toBe(control);
    // Enter on a focused button is a click in every browser and in jsdom.
    fireEvent.click(control);
    expect(onRowActivate).toHaveBeenCalledWith(LOTS[0]);
  });

  it('activates from a pointer click anywhere quiet in the row', () => {
    const onRowActivate = vi.fn();
    renderTable(ready(LOTS), { onRowActivate, rowActivationLabel: (row) => `Open lot ${row.publicId}` });
    const quietCell = screen.getAllByRole('cell').find((cell) => cell.textContent === '12')!;
    fireEvent.click(quietCell);
    expect(onRowActivate).toHaveBeenCalledWith(LOTS[0]);
  });

  // A button inside a button is invalid markup and unreachable by keyboard.
  it('never nests a row action inside the activation control', () => {
    const onRowActivate = vi.fn();
    render(
      <DataTable<Lot>
        caption="Lots"
        columns={[
          ...COLUMNS,
          {
            key: 'actions',
            header: 'Actions',
            render: (row) => <button type="button">Void {row.publicId}</button>,
          },
        ]}
        state={ready(LOTS)}
        rowKey={(row) => row.id}
        onRowActivate={onRowActivate}
        rowActivationLabel={(row) => `Open lot ${row.publicId}`}
      />,
    );
    const nested = screen.getByRole('button', { name: 'Void RV-LOT-0001' });
    expect(nested.parentElement?.closest('button')).toBeNull();
  });

  it('does not also activate the row when a nested action is used', () => {
    const onRowActivate = vi.fn();
    const onVoid = vi.fn();
    render(
      <DataTable<Lot>
        caption="Lots"
        columns={[
          ...COLUMNS,
          {
            key: 'actions',
            header: 'Actions',
            render: (row) => (
              <button type="button" onClick={onVoid}>
                Void {row.publicId}
              </button>
            ),
          },
        ]}
        state={ready(LOTS)}
        rowKey={(row) => row.id}
        onRowActivate={onRowActivate}
        rowActivationLabel={(row) => `Open lot ${row.publicId}`}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Void RV-LOT-0001' }));
    expect(onVoid).toHaveBeenCalledTimes(1);
    expect(onRowActivate).not.toHaveBeenCalled();
  });
});

describe('DataTable — selection and bulk actions', () => {
  const selectionProps = (onChange: (keys: readonly string[]) => void, selectedKeys: readonly string[] = []) => ({
    selection: { selectedKeys, onChange, rowLabel: (row: Lot) => `Select lot ${row.publicId}` },
  });

  it('names each row checkbox with the record it selects', () => {
    renderTable(ready(LOTS), selectionProps(() => {}));
    expect(screen.getByRole('checkbox', { name: 'Select lot RV-LOT-0001' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select all rows on this page' })).toBeTruthy();
  });

  it('reports selection changes to the caller', () => {
    const onChange = vi.fn();
    renderTable(ready(LOTS), selectionProps(onChange));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select lot RV-LOT-0002' }));
    expect(onChange).toHaveBeenCalledWith(['2']);
  });

  it('selects and clears every row on the page', () => {
    const onChange = vi.fn();
    renderTable(ready(LOTS), selectionProps(onChange));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    expect(onChange).toHaveBeenCalledWith(['1', '2']);

    cleanup();
    const clear = vi.fn();
    renderTable(ready(LOTS), selectionProps(clear, ['1', '2']));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    expect(clear).toHaveBeenCalledWith([]);
  });

  it('shows the bulk-action region only when something is selected', () => {
    renderTable(ready(LOTS), {
      ...selectionProps(() => {}),
      bulkActions: <button type="button">Move selected</button>,
    });
    expect(screen.queryByRole('group', { name: 'Bulk actions' })).toBeNull();

    cleanup();
    renderTable(ready(LOTS), {
      ...selectionProps(() => {}, ['1']),
      bulkActions: <button type="button">Move selected</button>,
    });
    const region = screen.getByRole('group', { name: 'Bulk actions' });
    expect(within(region).getByText('1 selected')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Move selected' })).toBeTruthy();
  });
});

describe('DataTable — search, filters, responsive handoff', () => {
  it('gives the search field a real label rather than only a placeholder', () => {
    renderTable(ready(LOTS), {
      search: { value: '', onChange: () => {}, label: 'Search lots', placeholder: 'RV-LOT-…' },
    });
    const field = screen.getByRole('searchbox', { name: 'Search lots' });
    expect((field as HTMLInputElement).placeholder).toBe('RV-LOT-…');
  });

  it('reports search input to the caller without filtering itself', () => {
    const onChange = vi.fn();
    renderTable(ready(LOTS), { search: { value: '', onChange, label: 'Search lots' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search lots' }), { target: { value: 'RV-LOT-0002' } });
    expect(onChange).toHaveBeenCalledWith('RV-LOT-0002');
    // Still both rows: filtering is the domain's job.
    expect(screen.getByText('RV-LOT-0001')).toBeTruthy();
  });

  it('renders caller-supplied filters', () => {
    renderTable(ready(LOTS), { filters: <button type="button">Location</button> });
    expect(screen.getByRole('button', { name: 'Location' })).toBeTruthy();
  });

  it('hands narrow viewports to the caller-supplied responsive presentation', () => {
    renderTable(ready(LOTS), { responsive: <div data-testid="records">records</div> });
    const responsive = screen.getByTestId('records').parentElement!;
    expect(responsive.className).toContain('md:hidden');
    // And the table is the wide-viewport arm of the same handoff.
    expect(screen.getByRole('table').closest('.hidden')).toBeTruthy();
  });
});

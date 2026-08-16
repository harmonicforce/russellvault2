// @vitest-environment jsdom
//
// S2.5 Batch 1 — the governed cost allocation workflow, driven through the DOM.
//
// Everything here is RENDERED and operated the way an owner operates it.
// Nothing greps a source file, and nothing asserts on an implementation detail
// that a refactor would break without changing what the owner sees.
//
// THE LOAD-BEARING TESTS
//
//   * a failed queue read is never an empty queue, and never a zero count;
//   * an amount the source never reported is shown as WORDS, never as 0.00;
//   * a proposal is never described as a cost basis;
//   * a split that does not add up is refused BEFORE it is sent, with the
//     exact difference stated;
//   * a lost proposal response locks proposing and never says "nothing was
//     sent"; verification distinguishes committed, foreign, absent and
//     still-unknown;
//   * the confirm call carries the total the owner was SHOWN;
//   * a viewer is offered no mutation control at all;
//   * no internal UUID is ever rendered.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Cost from './Cost';
import CostComponentWorkspace from './CostComponentWorkspace';
import {
  CostError,
  type AllocationPreview,
  type BasisImpact,
  type AllocationRecord,
  type CostComponentDetail,
  type CostComponentSummary,
  type CostComponentView,
  type CostQueue,
} from '../lib/costApi';

let role: 'owner' | 'operator' | 'viewer';
let workspaceId: string;
let queue: CostQueue | null;
let queueError: CostError | null;
let view: CostComponentView | null;
let viewError: CostError | null;
let preview: AllocationPreview | null;
let previewError: CostError | null;
let calls: Array<{ fn: string; args: unknown[] }>;
let outcomes: Record<string, Array<unknown | CostError>>;

vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({ workspace: workspaceId ? { id: workspaceId, name: 'Vault', role } : null }),
}));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));

function record(fn: string, ...args: unknown[]) {
  calls.push({ fn, args });
  const next = outcomes[fn]?.shift();
  if (next instanceof CostError) return Promise.reject(next);
  return Promise.resolve(next ?? {});
}

vi.mock('../lib/costApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createCostTransport: () => ({
    queue: () => (queueError ? Promise.reject(queueError) : Promise.resolve(queue)),
    component: (...a: unknown[]) => {
      calls.push({ fn: 'component', args: a });
      return viewError ? Promise.reject(viewError) : Promise.resolve(view);
    },
    previewAllocation: (...a: unknown[]) => {
      calls.push({ fn: 'previewAllocation', args: a });
      return previewError ? Promise.reject(previewError) : Promise.resolve(preview);
    },
    propose: (...a: unknown[]) => record('propose', ...a),
    confirm: (...a: unknown[]) => record('confirm', ...a),
    reverse: (...a: unknown[]) => record('reverse', ...a),
    withdraw: (...a: unknown[]) => record('withdraw', ...a),
  }),
}));

const METHODS = [
  { method: 'manual_equal' as const, description: 'Split evenly across the selected lines.' },
  { method: 'manual_quantity' as const, description: 'Split in proportion to acquired quantity.' },
  { method: 'manual_value' as const, description: 'Split in proportion to known direct cost.' },
  { method: 'manual_custom' as const, description: 'Each amount was entered by hand.' },
];

function makeSummary(over: Partial<CostComponentSummary> = {}): CostComponentSummary {
  return {
    componentPublicId: 'RV-ACOST-SHIP01',
    componentType: 'shipping',
    amount: { state: 'known', minor: '1000', currency: 'USD' },
    attributionState: 'unresolved',
    workflowState: 'awaiting_proposal',
    scopeKind: 'order',
    orderPublicId: 'RV-ACQ-AAA111',
    lotPublicId: null,
    directLinePublicId: null,
    evidenceNote: null,
    candidateCount: 0,
    confirmedCount: 0,
    createdAt: '2026-08-10T10:00:00.000Z',
    isReversed: false,
    ...over,
  };
}

function makeQueue(rows: CostComponentSummary[], over: Partial<CostQueue> = {}): CostQueue {
  return {
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    complete: true,
    role,
    methods: METHODS,
    rows,
    ...over,
  };
}

function makeAllocation(over: Partial<AllocationRecord> = {}): AllocationRecord {
  return {
    allocationPublicId: 'RV-ACALLOC-AAA111',
    sourceSystemPublicId: 'RV-SS-WHATNOT',
    acquisitionLinePublicId: 'RV-AL-AAA111',
    amountMinor: '750',
    method: 'manual_quantity',
    state: 'candidate',
    reviewedAt: null,
    reversedAt: null,
    createdAt: '2026-08-10T11:00:00.000Z',
    ...over,
  };
}

function makeDetail(over: Partial<CostComponentDetail> = {}): CostComponentDetail {
  return {
    ...makeSummary(),
    order: {
      publicId: 'RV-ACQ-AAA111',
      sourceOrderReference: 'WN-ORDER-1',
      orderStatus: 'completed',
      occurredAt: '2026-08-01T00:00:00.000Z',
    },
    scopeLines: [
      {
        sourceSystemPublicId: 'RV-SS-WHATNOT',
        acquisitionLinePublicId: 'RV-AL-AAA111',
        title: 'Vintage card lot A',
        quantity: 3,
        exclusionState: 'included',
        lotPublicId: 'RV-ALOT-AAA111',
        knownDirectCostMinor: '900',
      },
      {
        sourceSystemPublicId: 'RV-SS-WHATNOT',
        acquisitionLinePublicId: 'RV-AL-BBB222',
        title: null,
        quantity: 1,
        exclusionState: 'included',
        lotPublicId: 'RV-ALOT-BBB222',
        knownDirectCostMinor: null,
      },
    ],
    allocations: [],
    candidateTotalMinor: '0',
    conservationDeltaMinor: '-1000',
    ...over,
  };
}

const BASIS_METHODS = [
  { method: 'fifo' as const, description: 'First-in, first-out layering. An ACCOUNTING CONVENTION only; it does not assert which physical unit arrived first.' },
  { method: 'source_observed_specific' as const, description: 'The source reported a cost for this specific unit.' },
  { method: 'deterministic_equal_attribution' as const, description: 'Attributed equally by a deterministic rule.' },
  { method: 'unresolved' as const, description: 'The governed recompute could not establish a cost for this unit.' },
];

function makeBasisImpact(over: Partial<BasisImpact> = {}): BasisImpact {
  return {
    derived: true,
    lines: [
      {
        sourceSystemPublicId: 'RV-SS-WHATNOT',
        acquisitionLinePublicId: 'RV-AL-AAA111',
        title: 'Vintage card lot A',
        subjects: [{ subjectKind: 'item', publicId: 'RV-IITM-000001' }],
        currencies: [{
          currency: 'USD', knownTotalMinor: '6600', resolvedUnitCount: 2,
          unresolvedUnitCount: 0, methods: ['fifo'],
        }],
        unresolved: null,
        algorithmVersion: '1.1.0',
        derivedAt: '2026-08-15T10:00:00.000Z',
      },
      {
        sourceSystemPublicId: 'RV-SS-WHATNOT',
        acquisitionLinePublicId: 'RV-AL-BBB222',
        title: null,
        subjects: [{ subjectKind: 'lot', publicId: 'RV-ILOT-000002' }],
        currencies: [
          {
            currency: 'EUR', knownTotalMinor: '500', resolvedUnitCount: 1,
            unresolvedUnitCount: 0, methods: ['deterministic_equal_attribution'],
          },
          {
            currency: 'USD', knownTotalMinor: null, resolvedUnitCount: 0,
            unresolvedUnitCount: 1, methods: ['unresolved'],
          },
        ],
        unresolved: {
          expectedQuantity: 1, reconciledQuantity: 2, pendingExpectedQuantity: 0,
          overageQuantity: 1, hasUnresolvedCostEvidence: true,
        },
        algorithmVersion: '1.1.0',
        derivedAt: '2026-08-15T10:00:00.000Z',
      },
    ],
    ...over,
  };
}

function makeView(
  component: CostComponentDetail,
  basisImpact: BasisImpact = makeBasisImpact(),
): CostComponentView {
  return {
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    role,
    methods: METHODS,
    basisMethods: BASIS_METHODS,
    component,
    basisImpact,
  };
}

function makePreview(over: Partial<AllocationPreview> = {}): AllocationPreview {
  return {
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    method: 'manual_quantity',
    description: 'Split in proportion to acquired quantity.',
    componentPublicId: 'RV-ACOST-SHIP01',
    totalMinor: '1000',
    currency: 'USD',
    shares: [
      { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '750', weight: '3' },
      { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-BBB222', amountMinor: '250', weight: '1' },
    ],
    wrote: false,
    ...over,
  };
}

/**
 * The DESKTOP rendering.
 *
 * `DataTable` and `ResponsiveRecordList` are both mounted in jsdom, because the
 * hand-over between them is a CSS breakpoint and jsdom applies no CSS. Querying
 * at `screen` level therefore finds two of everything. This helper picks one
 * rendering deliberately, so a test says which surface it is asserting about.
 */
const table = () => within(screen.getByRole('table'));

function renderLanding() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/cost']}>
        <Routes><Route path="/cost" element={<Cost />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/cost/RV-ACOST-SHIP01']}>
        <Routes>
          <Route path="/cost/:componentPublicId" element={<CostComponentWorkspace />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role = 'owner';
  workspaceId = 'ws-1';
  queue = makeQueue([makeSummary()]);
  queueError = null;
  view = makeView(makeDetail());
  viewError = null;
  preview = makePreview();
  previewError = null;
  calls = [];
  outcomes = {};
});

afterEach(() => cleanup());

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// --- the landing page --------------------------------------------------------

describe('the cost queue', () => {
  it('lists governed components with where each one stands', async () => {
    renderLanding();
    await waitFor(() => expect(table().getByText('RV-ACOST-SHIP01')).toBeTruthy());
    expect(table().getByText('Shared, not yet split')).toBeTruthy();
  });

  // THE LOAD-BEARING TRUTH RULE, AT THE SCREEN.
  it('shows an unreported amount as words, never as a currency zero', async () => {
    queue = makeQueue([makeSummary({
      componentPublicId: 'RV-ACOST-TAXUNK',
      componentType: 'tax',
      amount: { state: 'unknown', currency: 'USD' },
      workflowState: 'amount_not_known',
    })]);
    renderLanding();
    await waitFor(() => expect(table().getByText('RV-ACOST-TAXUNK')).toBeTruthy());
    expect(table().getByText('Not reported')).toBeTruthy();
    expect(table().queryByText('0.00 USD')).toBeNull();
  });

  // A documented zero is a DIFFERENT fact and must not look the same.
  it('shows a documented free amount as a real zero', async () => {
    queue = makeQueue([makeSummary({
      amount: { state: 'documented_free', minor: '0', currency: 'USD' },
      workflowState: 'amount_not_known',
    })]);
    renderLanding();
    await waitFor(() => expect(table().getByText('0.00 USD')).toBeTruthy());
    expect(table().queryByText('Not reported')).toBeNull();
  });

  // A FAILED RETRIEVAL IS NEVER A ZERO, and never an empty list.
  it('never renders a failed read as an empty queue', async () => {
    queueError = new CostError('dependency_failed', 502);
    renderLanding();
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.queryByText(/No governed cost components/i)).toBeNull();
  });

  // And the counts must not read as facts about a workspace we could not read.
  it('shows zero counts only when the read succeeded', async () => {
    queue = makeQueue([]);
    renderLanding();
    await waitFor(() => expect(table().getByText(/No governed cost components/i)).toBeTruthy());
    const counts = document.querySelector('[data-cost-count="awaiting_proposal"]');
    expect(counts?.textContent).toMatch(/0/);
  });

  it('says the counts are of a subset when the answer was cut short', async () => {
    queue = makeQueue([makeSummary()], { complete: false });
    renderLanding();
    await waitFor(() => expect(screen.getByText(/not the whole picture/i)).toBeTruthy());
  });

  // THE ABSENT TOTAL, STATED RATHER THAN MISSING.
  it('explains why there is no headline total', async () => {
    renderLanding();
    await waitFor(() => expect(screen.getByText(/There is no total on this page, on purpose/i)).toBeTruthy());
    expect(screen.getByText(/different currencies/i)).toBeTruthy();
    expect(screen.getByText(/counts an unknown amount as zero/i)).toBeTruthy();
  });

  it('renders no internal identifier', async () => {
    renderLanding();
    await waitFor(() => expect(table().getByText('RV-ACOST-SHIP01')).toBeTruthy());
    expect(document.body.textContent ?? '').not.toMatch(UUID);
  });

  // FOUND BY THE BROWSER GATE, PINNED HERE.
  //
  // The narrow rendering is a SECOND rendering of the same rows, not a summary
  // of the table, and it has to carry the same facts. An earlier version handed
  // the record list the raw domain rows instead of records, which produced a
  // list of empty cards at every phone width. The desktop table was unaffected,
  // so nothing failed until a real browser rendered the narrow layout.
  it('carries the same facts in the narrow rendering as in the table', async () => {
    queue = makeQueue([
      makeSummary(),
      makeSummary({
        componentPublicId: 'RV-ACOST-TAX001',
        componentType: 'tax',
        amount: { state: 'unknown', currency: 'USD' },
        workflowState: 'amount_not_known',
      }),
    ]);
    renderLanding();
    const list = await screen.findByRole('list', { name: 'Governed cost components' });
    const cards = within(list);
    expect(cards.getByText('RV-ACOST-SHIP01')).toBeTruthy();
    expect(cards.getByText('Shared, not yet split')).toBeTruthy();
    expect(cards.getByText('10.00 USD')).toBeTruthy();
    // And the truth rule survives the second rendering: still words, not zero.
    expect(cards.getByText('Not reported')).toBeTruthy();
    expect(cards.queryByText('0.00 USD')).toBeNull();
  });
});

// --- the component workspace -------------------------------------------------

describe('one cost component', () => {
  it('states what its attribution state actually means', async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByText(/is NOT a cost basis for any line/i)).toBeTruthy());
  });

  it('says plainly that no confirmed basis exists', async () => {
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByText(/not a cost basis for any\s+acquisition line/i)).toBeTruthy());
  });

  // A PROPOSAL IS NOT A BASIS. The distinction is carried in words, every time.
  it('never describes a pending proposal as a cost basis', async () => {
    view = makeView(makeDetail({
      workflowState: 'proposed_awaiting_confirmation',
      candidateCount: 2,
      candidateTotalMinor: '1000',
      conservationDeltaMinor: '0',
      allocations: [
        makeAllocation(),
        makeAllocation({
          allocationPublicId: 'RV-ACALLOC-BBB222',
          acquisitionLinePublicId: 'RV-AL-BBB222',
          amountMinor: '250',
        }),
      ],
    }));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('RV-ACALLOC-AAA111')).toBeTruthy());
    const panel = within(screen.getByRole('region', { name: 'Proposed split' }));
    expect(panel.getAllByText(/NOT a cost basis|not a cost basis/i).length).toBeGreaterThan(0);
    expect(panel.getByText(/withdrawing is not a deletion/i)).toBeTruthy();
    // And each row says a proposal has not been reviewed.
    expect(panel.getAllByText(/Not reviewed — a proposal is not a cost basis/i).length).toBe(2);
  });

  it('states the exact conservation position of a pending proposal', async () => {
    view = makeView(makeDetail({
      workflowState: 'proposed_awaiting_confirmation',
      candidateCount: 1,
      candidateTotalMinor: '960',
      conservationDeltaMinor: '-40',
      allocations: [makeAllocation({ amountMinor: '960' })],
    }));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('RV-ACALLOC-AAA111')).toBeTruthy());
    const total = document.querySelector('[data-candidate-total]');
    expect(total?.textContent).toMatch(/9\.60 USD/);
    expect(total?.textContent).toMatch(/does NOT match the component amount/i);
  });

  it('renders no internal identifier', async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('RV-ACOST-SHIP01')).toBeTruthy());
    expect(document.body.textContent ?? '').not.toMatch(UUID);
  });
});

// --- capability --------------------------------------------------------------

describe('capability comes from the server, never from a client guess', () => {
  it('offers a viewer no mutation control at all', async () => {
    role = 'viewer';
    view = makeView(makeDetail({
      workflowState: 'proposed_awaiting_confirmation',
      candidateCount: 1,
      candidateTotalMinor: '1000',
      conservationDeltaMinor: '0',
      allocations: [makeAllocation({ amountMinor: '1000' })],
    }));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('RV-ACALLOC-AAA111')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Propose a split/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Confirm this split/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reverse this allocation/i })).toBeNull();
  });

  it('offers no proposal control when the amount was never reported', async () => {
    view = makeView(makeDetail({
      amount: { state: 'unknown', currency: 'USD' },
      workflowState: 'amount_not_known',
      conservationDeltaMinor: null,
    }));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText(/nothing here treats it as\s+zero/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Propose a split/i })).toBeNull();
  });

  it('offers reversal only for a confirmed allocation', async () => {
    view = makeView(makeDetail({
      workflowState: 'allocated',
      confirmedCount: 1,
      allocations: [makeAllocation({ state: 'confirmed', amountMinor: '1000', reviewedAt: '2026-08-10T12:00:00.000Z' })],
    }));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Reverse this allocation/i })).toBeTruthy());
  });
});

// --- proposing ---------------------------------------------------------------

describe('proposing a split', () => {
  async function openEditor() {
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Propose a split/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Propose a split/i }));
    await waitFor(() =>
      expect(screen.getByText(/A proposal is durable and cannot be edited/i)).toBeTruthy());
  }

  // The copy corrected in Batch 2. Withdrawal now EXISTS, so claiming it does
  // not would be false — but it is a governed act with a permanent record, not
  // an undo, and the warning has to say which.
  it('warns that a proposal is durable and that withdrawal is not an undo', async () => {
    await openEditor();
    // Scoped to the dialog: the page behind it makes the same point in its own
    // words, and an unscoped match would find both.
    const warning = within(screen.getByRole('dialog'));
    expect(warning.getByText(/not an undo/i)).toBeTruthy();
    expect(warning.getByText(/stay on record as history/i)).toBeTruthy();
    expect(screen.queryByText(/no way to delete a proposed split/i)).toBeNull();
  });

  it('will not send until a split has been computed', async () => {
    await openEditor();
    const send = screen.getByRole('button', { name: /Propose this split/i });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it('computes the split on the server and shows the exact per-line amounts', async () => {
    await openEditor();
    fireEvent.click(screen.getByLabelText(/By quantity/i));
    fireEvent.click(screen.getByRole('button', { name: /Compute the split/i }));
    await waitFor(() =>
      expect(document.querySelector('[data-share-for="RV-AL-AAA111"]')?.textContent)
        .toMatch(/7\.50 USD/));
    expect(document.querySelector('[data-share-for="RV-AL-BBB222"]')?.textContent).toMatch(/2\.50 USD/);
    expect(document.querySelector('[data-conservation]')?.getAttribute('data-conservation'))
      .toBe('balanced');
  });

  it('sends exactly the amounts that were displayed', async () => {
    await openEditor();
    fireEvent.click(screen.getByLabelText(/By quantity/i));
    fireEvent.click(screen.getByRole('button', { name: /Compute the split/i }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Propose this split/i }) as HTMLButtonElement).disabled)
        .toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Propose this split/i }));
    await waitFor(() => expect(calls.find((call) => call.fn === 'propose')).toBeTruthy());
    const proposal = calls.find((call) => call.fn === 'propose')!.args[2] as {
      method: string;
      allocations: { acquisitionLinePublicId: string; amountMinor: string }[];
    };
    expect(proposal.method).toBe('manual_quantity');
    expect(proposal.allocations).toEqual([
      { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-AAA111', amountMinor: '750' },
      { sourceSystemPublicId: 'RV-SS-WHATNOT', acquisitionLinePublicId: 'RV-AL-BBB222', amountMinor: '250' },
    ]);
  });

  // THE DEAD-END GUARD, AT THE SCREEN. A hand-entered split that does not add
  // up is refused here, with the exact difference stated, rather than being
  // sent and becoming permanent.
  it('refuses a hand-entered split that does not add up, and says by how much', async () => {
    await openEditor();
    fireEvent.click(screen.getByLabelText(/Entered by hand/i));
    fireEvent.change(screen.getByLabelText(/Amount for RV-AL-AAA111/i), { target: { value: '7.50' } });
    fireEvent.change(screen.getByLabelText(/Amount for RV-AL-BBB222/i), { target: { value: '2.10' } });
    await waitFor(() =>
      expect(document.querySelector('[data-conservation]')?.getAttribute('data-conservation'))
        .toBe('out_of_balance'));
    expect(document.querySelector('[data-conservation]')?.textContent).toMatch(/0\.40 USD less/);
    expect((screen.getByRole('button', { name: /Propose this split/i }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(calls.some((call) => call.fn === 'propose')).toBe(false);
  });

  it('accepts a hand-entered split that adds up', async () => {
    await openEditor();
    fireEvent.click(screen.getByLabelText(/Entered by hand/i));
    fireEvent.change(screen.getByLabelText(/Amount for RV-AL-AAA111/i), { target: { value: '7.50' } });
    fireEvent.change(screen.getByLabelText(/Amount for RV-AL-BBB222/i), { target: { value: '2.50' } });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Propose this split/i }) as HTMLButtonElement).disabled)
        .toBe(false));
  });

  // Half a cent is not something the ledger holds. It is refused, not rounded.
  it('refuses more precision than the currency has rather than rounding it', async () => {
    await openEditor();
    fireEvent.click(screen.getByLabelText(/Entered by hand/i));
    fireEvent.change(screen.getByLabelText(/Amount for RV-AL-AAA111/i), { target: { value: '7.505' } });
    await waitFor(() =>
      expect(screen.getByText(/not an amount USD can hold exactly/i)).toBeTruthy());
    expect(screen.getByText(/It was not rounded to fit/i)).toBeTruthy();
  });

  // THE ANTI-FABRICATION CASE, AT THE SCREEN.
  it('shows the refusal when a value split has no value basis, and invents nothing', async () => {
    previewError = new CostError('no_value_basis', 409);
    await openEditor();
    fireEvent.click(screen.getByLabelText(/By known value/i));
    fireEvent.click(screen.getByRole('button', { name: /Compute the split/i }));
    await waitFor(() => expect(screen.getByText(/None of the lines in scope has a known direct cost/i)).toBeTruthy());
    expect(screen.getByText(/was NOT invented from an even share/i)).toBeTruthy();
    expect(document.querySelector('[data-share-for="RV-AL-AAA111"]')).toBeNull();
  });

  // "None recorded" is not "0.00". The distinction is why the value split
  // refuses at all.
  it('shows a line with no known direct cost as having none, not as zero', async () => {
    await openEditor();
    const line = document.querySelector('[data-scope-line="RV-AL-BBB222"]');
    expect(line?.textContent).toMatch(/None recorded/);
    expect(line?.textContent).not.toMatch(/Known direct cost 0\.00/);
  });
});

// --- the verify-first recovery ----------------------------------------------

describe('a lost proposal response', () => {
  async function loseTheResponse() {
    outcomes.propose = [new CostError('dependency_failed', 502)];
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Propose a split/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Propose a split/i }));
    await waitFor(() =>
      expect(screen.getByText(/A proposal is durable and cannot be edited/i)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/By quantity/i));
    fireEvent.click(screen.getByRole('button', { name: /Compute the split/i }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Propose this split/i }) as HTMLButtonElement).disabled)
        .toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Propose this split/i }));
    await waitFor(() =>
      expect(screen.getByText(/It is unknown whether the split was recorded/i)).toBeTruthy());
  }

  // FOUND BY THE BROWSER GATE, PINNED HERE.
  //
  // The split editor is a modal. Left open after an unknown outcome it sits on
  // top of the recovery banner and swallows every click aimed at the only
  // control that can resolve the situation. jsdom cannot see that — it applies
  // no CSS and has no top layer — so the browser suite caught it and this test
  // holds the fix in place.
  it('closes the split editor so the recovery control is reachable', async () => {
    await loseTheResponse();
    expect(screen.queryByText(/A proposal is durable and cannot be edited/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Check what is on record/i })).toBeTruthy();
  });

  // And a refusal the contract NAMED keeps the editor open, because that is a
  // problem the owner can fix in place.
  it('keeps the editor open when the contract named a refusal', async () => {
    outcomes.propose = [new CostError('proposal_would_not_conserve', 409)];
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Propose a split/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Propose a split/i }));
    fireEvent.click(await screen.findByLabelText(/By quantity/i));
    fireEvent.click(screen.getByRole('button', { name: /Compute the split/i }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Propose this split/i }) as HTMLButtonElement).disabled)
        .toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Propose this split/i }));
    await waitFor(() => expect(screen.getAllByText(/does not add up/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/A proposal is durable and cannot be edited/i)).toBeTruthy();
  });

  it('locks proposing and never claims nothing was sent', async () => {
    await loseTheResponse();
    const banner = document.body.textContent ?? '';
    expect(banner).not.toMatch(/nothing was sent|was not sent/i);
    expect(banner).toMatch(/unknown/i);
    expect(screen.getByRole('button', { name: /Check what is on record/i })).toBeTruthy();
  });

  it('proves the attempt COMMITTED when the pending proposal matches', async () => {
    await loseTheResponse();
    view = makeView(makeDetail({
      workflowState: 'proposed_awaiting_confirmation',
      candidateCount: 2,
      candidateTotalMinor: '1000',
      conservationDeltaMinor: '0',
      allocations: [
        makeAllocation(),
        makeAllocation({
          allocationPublicId: 'RV-ACALLOC-BBB222',
          acquisitionLinePublicId: 'RV-AL-BBB222',
          amountMinor: '250',
        }),
      ],
    }));
    fireEvent.click(screen.getByRole('button', { name: /Check what is on record/i }));
    await waitFor(() => expect(screen.getByText(/The split did reach the database/i)).toBeTruthy());
    expect(screen.getByText(/It was not recorded twice/i)).toBeTruthy();
  });

  // A colleague's pending proposal must NOT be reported as the owner's.
  it('reports a pending proposal that is not the one attempted as its own outcome', async () => {
    await loseTheResponse();
    view = makeView(makeDetail({
      workflowState: 'proposed_awaiting_confirmation',
      candidateCount: 2,
      candidateTotalMinor: '1000',
      conservationDeltaMinor: '0',
      allocations: [
        makeAllocation({ amountMinor: '900' }),
        makeAllocation({
          allocationPublicId: 'RV-ACALLOC-BBB222',
          acquisitionLinePublicId: 'RV-AL-BBB222',
          amountMinor: '100',
        }),
      ],
    }));
    fireEvent.click(screen.getByRole('button', { name: /Check what is on record/i }));
    await waitFor(() =>
      expect(screen.getByText(/A pending proposal exists, but it is not yours/i)).toBeTruthy());
    expect(screen.getByText(/Do not confirm what is on record/i)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/did reach the database/i);
  });

  it('proves the attempt did NOT commit when nothing is pending', async () => {
    await loseTheResponse();
    view = makeView(makeDetail());
    fireEvent.click(screen.getByRole('button', { name: /Check what is on record/i }));
    await waitFor(() => expect(screen.getByText(/The split was not recorded/i)).toBeTruthy());
    // And only now is proposing offered again.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Propose a split/i })).toBeTruthy());
  });

  // A FAILED VERIFICATION IS NOT AN ABSENCE.
  it('stays locked when verification itself fails', async () => {
    await loseTheResponse();
    viewError = new CostError('dependency_failed', 502);
    fireEvent.click(screen.getByRole('button', { name: /Check what is on record/i }));
    await waitFor(() =>
      expect(screen.getByText(/It is still unknown whether the split was recorded/i)).toBeTruthy());
    expect(screen.getByText(/Proposing is still locked/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Propose a split$/i })).toBeNull();
  });

  // A refusal the DATABASE named proves nothing was written, so the outcome is
  // not in doubt and the owner is not sent through verification for nothing.
  it('does not lock proposing when the contract named a refusal', async () => {
    outcomes.propose = [new CostError('proposal_would_not_conserve', 409)];
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Propose a split/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Propose a split/i }));
    fireEvent.click(await screen.findByLabelText(/By quantity/i));
    fireEvent.click(screen.getByRole('button', { name: /Compute the split/i }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Propose this split/i }) as HTMLButtonElement).disabled)
        .toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Propose this split/i }));
    await waitFor(() => expect(screen.getAllByText(/does not add up/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/It is unknown whether the split was recorded/i)).toBeNull();
  });
});

// --- confirming and reversing ------------------------------------------------

describe('confirming a proposal', () => {
  function pendingView() {
    return makeView(makeDetail({
      workflowState: 'proposed_awaiting_confirmation',
      candidateCount: 2,
      candidateTotalMinor: '1000',
      conservationDeltaMinor: '0',
      allocations: [
        makeAllocation(),
        makeAllocation({
          allocationPublicId: 'RV-ACALLOC-BBB222',
          acquisitionLinePublicId: 'RV-AL-BBB222',
          amountMinor: '250',
        }),
      ],
    }));
  }

  // THE COUNT CONTRACT. The total sent is the total the owner was SHOWN.
  it('sends the displayed total, not a recomputed one', async () => {
    view = pendingView();
    outcomes.confirm = [{ componentPublicId: 'RV-ACOST-SHIP01', confirmed: 2, totalMinor: '1000', replayable: false }];
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Confirm this split as the cost basis/i }));
    await waitFor(() => expect(screen.getByText(/independently verifies/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Confirm the cost basis/i }));
    await waitFor(() => expect(calls.find((call) => call.fn === 'confirm')).toBeTruthy());
    expect(calls.find((call) => call.fn === 'confirm')!.args[2]).toBe('1000');
  });

  it('shows the owner the exact figure it will send before they confirm', async () => {
    view = pendingView();
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Confirm this split as the cost basis/i }));
    await waitFor(() =>
      expect(screen.getByText(/Proposed total, as shown on this screen/i)).toBeTruthy());
  });

  it('reports a stale-total refusal as a stale value, not as a failure to try', async () => {
    view = pendingView();
    outcomes.confirm = [new CostError('expected_total_mismatch', 409)];
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Confirm this split as the cost basis/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm the cost basis/i }));
    await waitFor(() =>
      expect(screen.getByText(/does not total what this screen was showing/i)).toBeTruthy());
    expect(screen.getByText(/nothing was confirmed/i)).toBeTruthy();
  });
});

describe('reversing a confirmed allocation', () => {
  beforeEach(() => {
    view = makeView(makeDetail({
      workflowState: 'allocated',
      confirmedCount: 1,
      allocations: [makeAllocation({
        state: 'confirmed', amountMinor: '1000', reviewedAt: '2026-08-10T12:00:00.000Z',
      })],
    }));
  });

  it('requires a reason and says the rows are kept', async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Reverse this allocation/i }));
    await waitFor(() => expect(screen.getByText(/Nothing is deleted/i)).toBeTruthy());
    const confirm = screen.getByRole('button', { name: /Reverse the allocation/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('sends the reason the owner gave', async () => {
    outcomes.reverse = [{ componentPublicId: 'RV-ACOST-SHIP01', reversed: 1, replayable: false }];
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Reverse this allocation/i }));
    fireEvent.change(await screen.findByLabelText(/Why is this allocation being reversed/i), {
      target: { value: 'Shipping was billed to the wrong order' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Reverse the allocation/i }));
    await waitFor(() => expect(calls.find((call) => call.fn === 'reverse')).toBeTruthy());
    expect(calls.find((call) => call.fn === 'reverse')!.args[2])
      .toBe('Shipping was billed to the wrong order');
  });

  it('says what reversal preserved, not just that it happened', async () => {
    outcomes.reverse = [{ componentPublicId: 'RV-ACOST-SHIP01', reversed: 1, replayable: false }];
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Reverse this allocation/i }));
    fireEvent.change(await screen.findByLabelText(/Why is this allocation being reversed/i), {
      target: { value: 'Wrong order' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Reverse the allocation/i }));
    await waitFor(() => expect(screen.getByText(/kept as history/i)).toBeTruthy());
    expect(screen.getByText(/nothing was deleted/i)).toBeTruthy();
  });
});

// === S2.5 Batch 2 ============================================================

const PENDING = () => makeView(makeDetail({
  workflowState: 'proposed_awaiting_confirmation',
  candidateCount: 2,
  candidateTotalMinor: '1000',
  conservationDeltaMinor: '0',
  allocations: [
    makeAllocation(),
    makeAllocation({
      allocationPublicId: 'RV-ACALLOC-BBB222',
      acquisitionLinePublicId: 'RV-AL-BBB222',
      amountMinor: '250',
    }),
  ],
}));

const REFRESHED = {
  status: 'refreshed' as const, algorithmVersion: '1.1.0', contentHash: 'a'.repeat(64), basisRows: 4,
};

describe('withdrawing a pending proposal', () => {
  beforeEach(() => { view = PENDING(); });

  it('offers withdrawal beside confirmation for an owner', async () => {
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Withdraw this proposal/i })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Confirm this split as the cost basis/i })).toBeTruthy();
  });

  it('offers withdrawal to an operator', async () => {
    role = 'operator';
    view = PENDING();
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Withdraw this proposal/i })).toBeTruthy());
  });

  // A viewer remains read-only, exactly as in Batch 1.
  it('offers a viewer no withdrawal control at all', async () => {
    role = 'viewer';
    view = PENDING();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('RV-ACALLOC-AAA111')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Withdraw this proposal/i })).toBeNull();
  });

  it('requires a reason before it will send', async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Withdraw this proposal/i }));
    await waitFor(() => expect(screen.getByText(/It is NOT a\s+deletion/i)).toBeTruthy());
    expect((screen.getByRole('button', { name: /Withdraw the proposal/i }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(calls.some((call) => call.fn === 'withdraw')).toBe(false);
  });

  it('sends the reason the owner gave', async () => {
    outcomes.withdraw = [{
      componentPublicId: 'RV-ACOST-SHIP01', withdrawn: 2, replayable: false, basisRecompute: REFRESHED,
    }];
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Withdraw this proposal/i }));
    fireEvent.change(await screen.findByLabelText(/Why is this proposal being withdrawn/i), {
      target: { value: 'The weighting used quantity instead of value' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Withdraw the proposal/i }));
    await waitFor(() => expect(calls.find((call) => call.fn === 'withdraw')).toBeTruthy());
    expect(calls.find((call) => call.fn === 'withdraw')!.args[2])
      .toBe('The weighting used quantity instead of value');
  });

  // NEVER AS A DELETION.
  it('says what withdrawal preserved, and never calls it a deletion', async () => {
    outcomes.withdraw = [{
      componentPublicId: 'RV-ACOST-SHIP01', withdrawn: 2, replayable: false, basisRecompute: REFRESHED,
    }];
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Withdraw this proposal/i }));
    fireEvent.change(await screen.findByLabelText(/Why is this proposal being withdrawn/i), {
      target: { value: 'Wrong weighting' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Withdraw the proposal/i }));
    await waitFor(() => expect(screen.getByText(/were NOT deleted/i)).toBeTruthy());
    expect(screen.getByText(/remain on record as history/i)).toBeTruthy();
  });

  it('keeps withdrawn rows visible as history', async () => {
    view = makeView(makeDetail({
      workflowState: 'awaiting_proposal',
      candidateCount: 0,
      candidateTotalMinor: '0',
      allocations: [
        makeAllocation({ state: 'withdrawn' }),
        makeAllocation({
          allocationPublicId: 'RV-ACALLOC-BBB222', acquisitionLinePublicId: 'RV-AL-BBB222',
          amountMinor: '250', state: 'withdrawn',
        }),
      ],
    }));
    renderWorkspace();
    const history = within(await screen.findByRole('region', { name: 'Withdrawn proposals' }));
    expect(history.getByText('RV-ACALLOC-AAA111')).toBeTruthy();
    expect(history.getByText('RV-ACALLOC-BBB222')).toBeTruthy();
    expect(history.getAllByText(/never became a cost basis/i).length).toBeGreaterThan(0);
    expect(history.getAllByText(/was not deleted/i).length).toBeGreaterThan(0);
  });

  // A corrected proposal after withdrawal is a NEW proposal, and is offered.
  it('permits a corrected proposal once the old one is withdrawn', async () => {
    view = makeView(makeDetail({
      workflowState: 'awaiting_proposal',
      candidateCount: 0,
      candidateTotalMinor: '0',
      allocations: [makeAllocation({ state: 'withdrawn' })],
    }));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Propose a split/i })).toBeTruthy());
  });

  it('reports "nothing to withdraw" as a refusal, not a silent success', async () => {
    outcomes.withdraw = [new CostError('nothing_to_withdraw', 409)];
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Withdraw this proposal/i }));
    fireEvent.change(await screen.findByLabelText(/Why is this proposal being withdrawn/i), {
      target: { value: 'Wrong weighting' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Withdraw the proposal/i }));
    await waitFor(() =>
      expect(screen.getByText(/no pending proposal to withdraw/i)).toBeTruthy());
    // A named refusal proves nothing was written, so recovery is not engaged.
    expect(screen.queryByText(/It is unknown whether the proposal was withdrawn/i)).toBeNull();
  });
});

describe('a lost withdrawal response', () => {
  async function loseTheResponse() {
    view = PENDING();
    outcomes.withdraw = [new CostError('dependency_failed', 502)];
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Withdraw this proposal/i }));
    fireEvent.change(await screen.findByLabelText(/Why is this proposal being withdrawn/i), {
      target: { value: 'Wrong weighting' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Withdraw the proposal/i }));
    await waitFor(() =>
      expect(screen.getByText(/It is unknown whether the proposal was withdrawn/i)).toBeTruthy());
  }

  it('locks withdrawal and never claims nothing was sent', async () => {
    await loseTheResponse();
    expect(document.body.textContent ?? '').not.toMatch(/nothing was sent|was not sent/i);
    expect(screen.queryByRole('button', { name: /^Withdraw this proposal$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Check what is on record/i })).toBeTruthy();
  });

  it('proves the withdrawal COMMITTED when the retained rows are withdrawn', async () => {
    await loseTheResponse();
    view = makeView(makeDetail({
      workflowState: 'awaiting_proposal',
      candidateCount: 0,
      candidateTotalMinor: '0',
      allocations: [
        makeAllocation({ state: 'withdrawn' }),
        makeAllocation({
          allocationPublicId: 'RV-ACALLOC-BBB222', acquisitionLinePublicId: 'RV-AL-BBB222',
          amountMinor: '250', state: 'withdrawn',
        }),
      ],
    }));
    fireEvent.click(screen.getByRole('button', { name: /Check what is on record/i }));
    await waitFor(() => expect(screen.getByText('The proposal was withdrawn')).toBeTruthy());
    expect(screen.getAllByText(/did reach the database/i).length).toBeGreaterThan(0);
  });

  // THE CONCURRENT-CONFIRM CASE, REFLECTED TRUTHFULLY.
  it('reports a confirmation winning the race, and never as a withdrawal', async () => {
    await loseTheResponse();
    view = makeView(makeDetail({
      workflowState: 'allocated',
      attributionState: 'allocated',
      candidateCount: 0,
      confirmedCount: 2,
      candidateTotalMinor: '0',
      allocations: [
        makeAllocation({ state: 'confirmed', reviewedAt: '2026-08-15T12:00:00.000Z' }),
        makeAllocation({
          allocationPublicId: 'RV-ACALLOC-BBB222', acquisitionLinePublicId: 'RV-AL-BBB222',
          amountMinor: '250', state: 'confirmed', reviewedAt: '2026-08-15T12:00:00.000Z',
        }),
      ],
    }));
    fireEvent.click(screen.getByRole('button', { name: /Check what is on record/i }));
    await waitFor(() =>
      expect(screen.getByText('The proposal was CONFIRMED, not withdrawn')).toBeTruthy());
    expect(screen.getByText(/now the governed cost basis/i)).toBeTruthy();
    expect(screen.getByText(/reverse it rather than withdrawing it/i)).toBeTruthy();
  });

  it('proves the withdrawal did NOT commit when the same proposal is still pending', async () => {
    await loseTheResponse();
    view = PENDING();
    fireEvent.click(screen.getByRole('button', { name: /Check what is on record/i }));
    await waitFor(() => expect(screen.getByText('The proposal was not withdrawn')).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Withdraw this proposal/i })).toBeTruthy());
  });

  it('stays locked when the candidate set moved unattributably', async () => {
    await loseTheResponse();
    view = makeView(makeDetail({
      workflowState: 'proposed_awaiting_confirmation',
      candidateCount: 1,
      candidateTotalMinor: '750',
      allocations: [makeAllocation()],
    }));
    fireEvent.click(screen.getByRole('button', { name: /Check what is on record/i }));
    await waitFor(() =>
      expect(screen.getByText('What happened cannot be attributed from the record')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Withdraw this proposal$/i })).toBeNull();
  });

  it('stays locked when verification itself fails', async () => {
    await loseTheResponse();
    viewError = new CostError('dependency_failed', 502);
    fireEvent.click(screen.getByRole('button', { name: /Check what is on record/i }));
    await waitFor(() =>
      expect(screen.getByText('It is still unknown whether the proposal was withdrawn')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Withdraw this proposal$/i })).toBeNull();
  });
});

describe('the derived basis refresh is reported as its own operation', () => {
  beforeEach(() => { view = PENDING(); });

  async function confirmWith(basisRecompute: unknown) {
    outcomes.confirm = [{
      componentPublicId: 'RV-ACOST-SHIP01', confirmed: 2, totalMinor: '1000',
      replayable: false, basisRecompute,
    }];
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Confirm this split as the cost basis/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm the cost basis/i }));
  }

  it('says the basis was recomputed', async () => {
    await confirmWith(REFRESHED);
    await waitFor(() =>
      expect(screen.getByText(/recomputed by algorithm\s+1\.1\.0/i)).toBeTruthy());
  });

  it('says an unchanged derivation still stands', async () => {
    await confirmWith({
      status: 'unchanged', algorithmVersion: '1.1.0', contentHash: 'b'.repeat(64), basisRows: 4,
    });
    await waitFor(() => expect(screen.getByText(/had not changed/i)).toBeTruthy());
    expect(screen.getByText(/Nothing needed recomputing/i)).toBeTruthy();
  });

  // THE LOAD-BEARING TRUTH RULE OF THIS BATCH, AT THE SCREEN.
  it('never relabels a committed allocation as failed when the recompute fails', async () => {
    await confirmWith({ status: 'failed', code: 'dependency_failed', retryable: true });
    await waitFor(() =>
      expect(screen.getByText(/The allocation change is recorded; the derived basis was not refreshed/i))
        .toBeTruthy());
    // The allocation is still reported as the success it was.
    expect(screen.getByText(/are now the governed cost basis/i)).toBeTruthy();
    // And nothing tells the owner the allocation failed.
    expect(screen.queryByText(/allocation failed|could not be confirmed/i)).toBeNull();
    expect(screen.getByText(/Retrying is safe/i)).toBeTruthy();
  });

  it('reports the basis refresh after a withdrawal too', async () => {
    outcomes.withdraw = [{
      componentPublicId: 'RV-ACOST-SHIP01', withdrawn: 2, replayable: false,
      basisRecompute: { status: 'failed', code: 'dependency_failed', retryable: true },
    }];
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: /Withdraw this proposal/i }));
    fireEvent.change(await screen.findByLabelText(/Why is this proposal being withdrawn/i), {
      target: { value: 'Wrong weighting' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Withdraw the proposal/i }));
    await waitFor(() => expect(screen.getByText(/were NOT deleted/i)).toBeTruthy());
    expect(screen.getByText(/the derived basis was not refreshed/i)).toBeTruthy();
  });
});

describe('the derived cost basis, shown beside the evidence', () => {
  const basisPanel = () =>
    within(screen.getByRole('region', { name: 'Derived inventory cost basis' }));

  it('is a separate region from the allocation evidence', async () => {
    renderWorkspace();
    await waitFor(() => expect(basisPanel().getByText(/DERIVED, not decided/i)).toBeTruthy());
    expect(screen.getByRole('region', { name: 'Proposed split' })).toBeTruthy();
  });

  it('shows an established basis as an exact figure', async () => {
    renderWorkspace();
    await waitFor(() => expect(basisPanel().getByText('66.00 USD')).toBeTruthy());
  });

  // AN UNRESOLVED BASIS IS NOT A ZERO.
  it('shows an unresolved currency as words, never as 0.00', async () => {
    renderWorkspace();
    await waitFor(() => expect(basisPanel().getByText(/No established basis/i)).toBeTruthy());
    const line = document.querySelector('[data-basis-line="RV-AL-BBB222"]');
    const usd = line?.querySelector('[data-basis-currency="USD"]');
    expect(usd?.textContent).toMatch(/No established basis/);
    expect(usd?.textContent).not.toMatch(/0\.00/);
    expect(usd?.querySelector('[data-basis-total="none"]')).toBeTruthy();
  });

  // CURRENCIES ARE SHOWN SEPARATELY AND NEVER COMBINED.
  it('shows each currency separately and offers no combined total', async () => {
    renderWorkspace();
    await waitFor(() => expect(basisPanel().getByText('5.00 EUR')).toBeTruthy());
    const line = document.querySelector('[data-basis-line="RV-AL-BBB222"]');
    expect(line?.querySelector('[data-basis-currency="EUR"]')).toBeTruthy();
    expect(line?.querySelector('[data-basis-currency="USD"]')).toBeTruthy();
    // 500 EUR-minor + 0 would be 5.00; a combined figure must not appear.
    expect(basisPanel().queryByText(/combined|grand total/i)).toBeNull();
  });

  // FIFO MUST NEVER READ AS PROOF OF PHYSICAL MOVEMENT.
  it('states the FIFO caveat prominently, not only in a tooltip', async () => {
    renderWorkspace();
    // The prominent alert. This is the copy an owner cannot miss.
    await waitFor(() =>
      expect(basisPanel().getByText(/FIFO here is an accounting convention/i)).toBeTruthy());
    // The caveat itself appears in the alert AND in the method glossary. Both
    // are wanted, so the assertion counts rather than demanding exactly one.
    expect(basisPanel().getAllByText(/does not assert which physical unit arrived first/i).length)
      .toBeGreaterThan(0);
    expect(basisPanel().getAllByText(/FIFO layer \(accounting convention\)/i).length)
      .toBeGreaterThan(0);
  });

  it('distinguishes the three attribution methods truthfully', async () => {
    renderWorkspace();
    await waitFor(() => expect(basisPanel().getAllByText(/FIFO layer/i).length).toBeGreaterThan(0));
    expect(basisPanel().getAllByText(/Equal attribution \(stated convention\)/i).length)
      .toBeGreaterThan(0);
    expect(basisPanel().getAllByText(/^Not established$/).length).toBeGreaterThan(0);
  });

  it('says why a line is not fully resolved', async () => {
    renderWorkspace();
    await waitFor(() =>
      expect(basisPanel().getByText(/units arrived beyond/i)).toBeTruthy());
    expect(basisPanel().getByText(/Cost evidence on this line is still unresolved/i)).toBeTruthy();
  });

  it('names inventory subjects by governed public identity only', async () => {
    renderWorkspace();
    await waitFor(() => expect(basisPanel().getByText(/RV-IITM-000001/)).toBeTruthy());
    expect(document.body.textContent ?? '').not.toMatch(UUID);
  });

  // NOT DERIVED is a third state, and must not render as zeroes.
  it('says the basis has never been derived rather than showing zeroes', async () => {
    view = makeView(makeDetail(), { derived: false, lines: [] });
    renderWorkspace();
    await waitFor(() =>
      expect(basisPanel().getByText(/No cost basis has been derived for these lines yet/i)).toBeTruthy());
    expect(basisPanel().getByText(/not a cost basis of zero/i)).toBeTruthy();
    expect(basisPanel().queryByText(/0\.00/)).toBeNull();
  });

  it('states the algorithm version the derivation came from', async () => {
    renderWorkspace();
    await waitFor(() =>
      expect(basisPanel().getAllByText(/Derived by algorithm 1\.1\.0/i).length).toBeGreaterThan(0));
  });
});

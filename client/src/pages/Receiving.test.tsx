// @vitest-environment jsdom
//
// S2.3 Batch 1 — the governed receiving workflow, driven through the DOM.
//
// Everything here is RENDERED and operated the way an operator operates it.
// Nothing greps a source file, and nothing asserts on an implementation detail
// that a refactor would break without changing what the operator sees.
//
// THE LOAD-BEARING TESTS
//
//   * a failed queue read is never an empty queue;
//   * an overage is shown as observed truth and is never clamped to expected;
//   * a correction sends the value the operator was LOOKING AT, and a stale
//     correction refreshes and demands a fresh decision instead of winning;
//   * submission says what it does AND what it does not do;
//   * a viewer is offered no mutation control at all;
//   * nothing optimistic is ever painted as governed receipt truth.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Receiving from './Receiving';
import ReceiptWorkspace from './ReceiptWorkspace';
import {
  ReceivingError,
  type ReceivingExpectedLine,
  type ReceivingQueue,
  type ReceivingQueueRow,
  type ReceivingReceiptDetail,
} from '../lib/receivingApi';

let role: 'owner' | 'operator' | 'viewer';
let workspaceId: string;
let queue: ReceivingQueue | null;
let queueError: ReceivingError | null;
let detail: ReceivingReceiptDetail | null;
let detailError: ReceivingError | null;
let calls: Array<{ fn: string; args: unknown[] }>;
let outcomes: Record<string, Array<unknown | ReceivingError>>;
/** Held promises, so a pending state can be observed mid-flight. */
let holdFns: Set<string>;
let releases: Array<() => void>;

vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({ workspace: workspaceId ? { id: workspaceId, name: 'Vault', role } : null }),
}));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));

function record(fn: string, ...args: unknown[]) {
  calls.push({ fn, args });
  if (holdFns.has(fn)) return new Promise((resolve) => releases.push(() => resolve({ replayed: false })));
  const next = outcomes[fn]?.shift();
  if (next instanceof ReceivingError) return Promise.reject(next);
  return Promise.resolve(next ?? { replayed: false });
}

vi.mock('../lib/receivingApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createReceivingTransport: () => ({
    queue: () => (queueError ? Promise.reject(queueError) : Promise.resolve(queue)),
    receipt: () => (detailError ? Promise.reject(detailError) : Promise.resolve(detail)),
    openReceipt: (...a: unknown[]) => record('openReceipt', ...a),
    recordLine: (...a: unknown[]) => record('recordLine', ...a),
    correctLine: (...a: unknown[]) => record('correctLine', ...a),
    cancelReceipt: (...a: unknown[]) => record('cancelReceipt', ...a),
    submitReceipt: (...a: unknown[]) => record('submitReceipt', ...a),
  }),
}));

function makeRow(over: Partial<ReceivingQueueRow> = {}): ReceivingQueueRow {
  return {
    orderPublicId: 'RV-ACQ-AAA111',
    sourceOrderReference: 'WN-ORDER-1',
    sellers: ['alpha'],
    orderStatus: 'completed',
    occurredAt: '2026-08-01T00:00:00.000Z',
    receivableLineCount: 2,
    expectedQuantityTotal: 5,
    observedQuantityTotal: 0,
    workflowState: 'not_started',
    openReceiptPublicId: null,
    receipts: [],
    shipments: [
      {
        publicId: 'RV-ASHP-AAA111',
        carrier: 'UPS',
        trackingNumber: '1Z999',
        status: 'delivered',
        expectedAt: '2026-08-03T00:00:00.000Z',
        carrierReceivedAt: '2026-08-04T00:00:00.000Z',
      },
    ],
    ...over,
  };
}

function makeQueue(rows: ReceivingQueueRow[], over: Partial<ReceivingQueue> = {}): ReceivingQueue {
  return {
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    complete: true,
    role,
    rows,
    ...over,
  };
}

function makeLine(over: Partial<ReceivingExpectedLine> = {}): ReceivingExpectedLine {
  return {
    sourceSystemPublicId: 'RV-SS-WHATNOT',
    acquisitionLinePublicId: 'RV-AL-AAA111',
    title: 'Vintage card lot A',
    expectedQuantity: 3,
    exclusionState: 'included',
    observed: null,
    cumulativeReceivedQuantity: 0,
    links: [],
    linkedQuantity: 0,
    unlinkedQuantity: 0,
    ...over,
  };
}

function makeDetail(over: Partial<ReceivingReceiptDetail> = {}): ReceivingReceiptDetail {
  return {
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    role,
    receipt: {
      publicId: 'RV-ARCPT-AAA111',
      status: 'open',
      receivedAt: '2026-08-05T10:00:00.000Z',
      note: 'Box 1 of 2',
      shipmentPublicId: 'RV-ASHP-AAA111',
      createdAt: '2026-08-05T09:00:00.000Z',
    },
    order: {
      publicId: 'RV-ACQ-AAA111',
      sourceOrderReference: 'WN-ORDER-1',
      sellers: ['alpha'],
      orderStatus: 'completed',
      occurredAt: '2026-08-01T00:00:00.000Z',
    },
    lines: [makeLine()],
    shipments: [
      {
        publicId: 'RV-ASHP-AAA111',
        carrier: 'UPS',
        trackingNumber: '1Z999',
        status: 'delivered',
        expectedAt: null,
        carrierReceivedAt: '2026-08-04T00:00:00.000Z',
      },
    ],
    discrepancies: [],
    reconciliation: {
      receiptStatus: 'open',
      linesFullyLinked: false,
      linesNeedingLinks: [],
      overageLinesMissingEvidence: [],
      openDiscrepancyCount: 0,
      claimedDiscrepancyCount: 0,
      terminalDiscrepancyCount: 0,
    },
    ...over,
  };
}


/**
 * The DESKTOP rendering.
 *
 * `DataTable` and `ResponsiveRecordList` are both mounted in jsdom, because the
 * hand-over between them is a CSS breakpoint and jsdom applies no CSS. Querying
 * at `screen` level therefore finds two of everything. These helpers pick one
 * rendering deliberately, so a test says which surface it is asserting about
 * instead of silently matching whichever copy came first.
 */
const table = () => within(screen.getByRole('table'));
function renderLanding() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/receiving']}>
        <Routes>
          <Route path="/receiving" element={<Receiving />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/receiving/RV-ARCPT-AAA111']}>
        <Routes>
          <Route path="/receiving/:receiptPublicId" element={<ReceiptWorkspace />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role = 'operator';
  workspaceId = 'ws-1';
  queue = makeQueue([makeRow()]);
  queueError = null;
  detail = makeDetail();
  detailError = null;
  calls = [];
  outcomes = {};
  holdFns = new Set();
  releases = [];
});

afterEach(cleanup);

describe('the receiving queue tells the truth about what it knows', () => {
  it('renders governed rows with expected and observed as separate labelled facts', async () => {
    renderLanding();
    expect(await table().findByText('WN-ORDER-1')).toBeTruthy();
    // EXPECTED is acquisition evidence and is labelled as such.
    expect(screen.getAllByText(/5/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: /expected/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: /observed/i }).length).toBeGreaterThan(0);
  });

  // THE CENTRAL RULE. A failed retrieval must never read as "nothing to do".
  it('never turns a failed queue read into an empty queue', async () => {
    queueError = new ReceivingError('dependency_failed', 502);
    renderLanding();
    await waitFor(() => {
      expect(screen.queryByText(/did not answer/i)).toBeTruthy();
    });
    expect(screen.queryAllByText(/There is no receiving work/i)).toHaveLength(0);
    // And no fabricated counts in the header.
    expect(screen.getByText(/counts are unavailable/i)).toBeTruthy();
  });

  it('distinguishes a proven-empty queue from a failed one', async () => {
    queue = makeQueue([]);
    renderLanding();
    expect((await screen.findAllByText(/There is no receiving work/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/answered and returned no acquisition orders/i).length).toBeGreaterThan(0);
  });

  it('says a partial queue is partial rather than presenting it as the whole', async () => {
    queue = makeQueue([makeRow()], { complete: false });
    renderLanding();
    await table().findByText('WN-ORDER-1');
    expect(screen.getAllByText(/reached its size limit/i).length).toBeGreaterThan(0);
  });

  it('reports an unauthorized read as unauthorized, not as empty', async () => {
    queueError = new ReceivingError('unauthorized_workspace', 403);
    renderLanding();
    await waitFor(() => expect(screen.queryByText(/not permitted/i)).toBeTruthy());
    expect(screen.queryAllByText(/There is no receiving work/i)).toHaveLength(0);
  });

  it('reports a missing governed contract as a deployment problem', async () => {
    queueError = new ReceivingError('receiving_contract_missing', 503);
    renderLanding();
    await waitFor(() => expect(screen.queryByText(/not deployed here/i)).toBeTruthy());
  });

  it('states counts only from an answer that actually arrived', async () => {
    queue = makeQueue([
      makeRow({ workflowState: 'receiving_in_progress', openReceiptPublicId: 'RV-ARCPT-AAA111' }),
      makeRow({
        orderPublicId: 'RV-ACQ-BBB222',
        sourceOrderReference: 'WN-ORDER-2',
        workflowState: 'submitted_pending_review',
      }),
    ]);
    renderLanding();
    await table().findByText('WN-ORDER-1');
    const counts = document.querySelector('[data-receiving-counts]');
    expect(counts?.textContent).toContain('1 open sessions');
    expect(counts?.textContent).toContain('1 submitted');
  });
});

describe('opening a receiving session', () => {
  it('offers no mutation control to a viewer', async () => {
    role = 'viewer';
    queue = makeQueue([makeRow()]);
    renderLanding();
    await table().findByText('WN-ORDER-1');
    expect(table().queryByRole('button', { name: /open receipt/i })).toBeNull();
  });

  it('requires an arrival time, because a receipt without one can never be submitted', async () => {
    renderLanding();
    await table().findByText('WN-ORDER-1');
    fireEvent.click(table().getByRole('button', { name: /open receipt/i }));
    const confirm = await screen.findByRole('button', { name: /open receiving session/i });
    // Disabled until an arrival time exists. Nothing is sent.
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('offers only this order\'s shipments, never a free-text identity', async () => {
    renderLanding();
    await table().findByText('WN-ORDER-1');
    fireEvent.click(table().getByRole('button', { name: /open receipt/i }));
    const select = await screen.findByLabelText(/associated shipment/i);
    expect(select.tagName).toBe('SELECT');
    const options = within(select as HTMLElement).getAllByRole('option');
    expect(options[0].textContent).toMatch(/No shipment record/i);
    expect(options[1].textContent).toContain('RV-ASHP-AAA111');
    // The carrier's status is shown as the CARRIER's, never as receipt truth.
    expect(options[1].textContent).toMatch(/carrier status: delivered/i);
  });

  it('sends one idempotency key per confirmed intent', async () => {
    outcomes.openReceipt = [{ receiptPublicId: 'RV-ARCPT-NEW001', status: 'open', replayed: false }];
    renderLanding();
    await table().findByText('WN-ORDER-1');
    fireEvent.click(table().getByRole('button', { name: /open receipt/i }));
    fireEvent.change(await screen.findByLabelText(/when did the goods arrive/i), {
      target: { value: '2026-08-05T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: /open receiving session/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const body = calls[0].args[2] as { idempotencyKey: string; receivedAt: string };
    expect(body.idempotencyKey).toMatch(/^receiving-/);
    expect(body.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reports a governed replay as a replay rather than a second session', async () => {
    outcomes.openReceipt = [{ receiptPublicId: 'RV-ARCPT-NEW001', status: 'open', replayed: true }];
    renderLanding();
    await table().findByText('WN-ORDER-1');
    fireEvent.click(table().getByRole('button', { name: /open receipt/i }));
    fireEvent.change(await screen.findByLabelText(/when did the goods arrive/i), {
      target: { value: '2026-08-05T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: /open receiving session/i }));
    expect(await screen.findByText(/was already open for this order/i)).toBeTruthy();
  });
});

describe('expected versus observed', () => {
  it('shows every receivable line, including those with nothing recorded', async () => {
    detail = makeDetail({
      lines: [
        makeLine(),
        makeLine({ acquisitionLinePublicId: 'RV-AL-BBB222', title: 'Card lot B', expectedQuantity: 2 }),
      ],
    });
    renderWorkspace();
    expect(await table().findByText('Vintage card lot A')).toBeTruthy();
    expect(table().getByText('Card lot B')).toBeTruthy();
    expect(table().getAllByText(/Nothing recorded/i).length).toBeGreaterThan(0);
  });

  // THE OVERAGE RULE.
  it('shows an overage as observed truth instead of clamping it to expected', async () => {
    detail = makeDetail({
      lines: [
        makeLine({
          expectedQuantity: 3,
          observed: { receiptLinePublicId: 'RV-ARL-AAA111', quantityReceived: 11, note: null },
          cumulativeReceivedQuantity: 11,
        }),
      ],
    });
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    // The observed 11 is present and is NOT reduced to the expected 3.
    expect(table().getAllByText('11').length).toBeGreaterThan(0);
    expect(table().getAllByText(/More than expected by 8/i).length).toBeGreaterThan(0);
  });

  it('does not offer an upper bound that would refuse an overage', async () => {
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(table().getByRole('button', { name: /^record$/i }));
    const input = await screen.findByLabelText(/observed quantity/i);
    // A `max` attribute here would make the browser refuse physical truth.
    expect(input.getAttribute('max')).toBeNull();
  });

  it('warns about an overage without blocking it', async () => {
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(table().getByRole('button', { name: /^record$/i }));
    const input = await screen.findByLabelText(/observed quantity/i);
    fireEvent.change(input, { target: { value: '11' } });
    expect(screen.getByText(/More than the acquisition expected/i)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: /record observed quantity/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it('records with the source-qualified addressing the governed function requires', async () => {
    outcomes.recordLine = [{ receiptLinePublicId: 'RV-ARL-NEW', quantityReceived: 4, replayed: false }];
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(table().getByRole('button', { name: /^record$/i }));
    fireEvent.change(await screen.findByLabelText(/observed quantity/i), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /record observed quantity/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].args[2]).toMatchObject({
      sourceSystemPublicId: 'RV-SS-WHATNOT',
      acquisitionLinePublicId: 'RV-AL-AAA111',
      quantityReceived: 4,
    });
  });

  // No optimistic business row. The table shows what the SERVER returned.
  it('paints no receipt line until the governed re-read supplies one', async () => {
    holdFns = new Set(['recordLine']);
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(table().getByRole('button', { name: /^record$/i }));
    fireEvent.change(await screen.findByLabelText(/observed quantity/i), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /record observed quantity/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    // In flight: the detail still reports nothing observed, and so does the page.
    expect(table().getAllByText(/Nothing recorded/i).length).toBeGreaterThan(0);
    expect(table().queryByText('4')).toBeNull();
  });
});

describe('correcting an observed quantity', () => {
  beforeEach(() => {
    detail = makeDetail({
      lines: [
        makeLine({
          observed: { receiptLinePublicId: 'RV-ARL-AAA111', quantityReceived: 5, note: null },
          cumulativeReceivedQuantity: 5,
        }),
      ],
    });
  });

  it('requires a reason before anything can be sent', async () => {
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(table().getByRole('button', { name: /^correct$/i }));
    const confirm = await screen.findByRole('button', { name: /correct observed quantity/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('sends the compare-and-set value the operator was looking at', async () => {
    outcomes.correctLine = [{ receiptLinePublicId: 'RV-ARL-AAA111', quantityReceived: 4, replayed: false }];
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(table().getByRole('button', { name: /^correct$/i }));
    fireEvent.change(await screen.findByLabelText(/corrected observed quantity/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/why is this being corrected/i), {
      target: { value: 'Recount after unpacking' },
    });
    fireEvent.click(screen.getByRole('button', { name: /correct observed quantity/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].args[1]).toBe('RV-ARL-AAA111');
    expect(calls[0].args[2]).toEqual({
      // The value on screen when the decision was made — NOT a re-read value.
      expectedQuantity: 5,
      desiredQuantity: 4,
      reason: 'Recount after unpacking',
    });
  });

  // A stale correction must never silently overwrite.
  it('refuses to overwrite a value that moved, and demands a fresh decision', async () => {
    outcomes.correctLine = [new ReceivingError('receipt_line_conflict', 409)];
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(table().getByRole('button', { name: /^correct$/i }));
    fireEvent.change(await screen.findByLabelText(/corrected observed quantity/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/why is this being corrected/i), { target: { value: 'Recount' } });
    fireEvent.click(screen.getByRole('button', { name: /correct observed quantity/i }));

    expect(await screen.findByText(/not the one this screen was showing/i)).toBeTruthy();
    expect(screen.getByText(/nothing was changed/i)).toBeTruthy();
    // Exactly one attempt. Nothing was resent automatically.
    expect(calls.filter((call) => call.fn === 'correctLine')).toHaveLength(1);
    // The confirmation is still open, so the operator decides again.
    expect(screen.getByRole('button', { name: /correct observed quantity/i })).toBeTruthy();
  });

  it('states plainly that a correction does not change the acquisition', async () => {
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(table().getByRole('button', { name: /^correct$/i }));
    expect(await screen.findByText(/does not change the acquisition's expected quantity/i)).toBeTruthy();
    expect(screen.getByText(/does not create a discrepancy/i)).toBeTruthy();
  });
});

describe('cancelling a receiving session', () => {
  it('requires a reason', async () => {
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(screen.getAllByRole('button', { name: /cancel receiving session/i })[0]);
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /^cancel receiving session$/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  // Cancellation is not deletion, and must never be described as deletion.
  it('presents cancellation as preserved evidence rather than as deletion', async () => {
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(screen.getAllByRole('button', { name: /cancel receiving session/i })[0]);
    const consequence = within(await screen.findByRole('dialog')).getByText(/PRESERVED as history and is not deleted/i);
    expect(consequence).toBeTruthy();
    expect(within(screen.getByRole('dialog')).queryByText(/will be deleted|permanently removed|erased/i)).toBeNull();
  });

  it('sends the reason and reports the outcome', async () => {
    outcomes.cancelReceipt = [{ receiptPublicId: 'RV-ARCPT-AAA111', status: 'cancelled', replayed: false }];
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(screen.getAllByRole('button', { name: /cancel receiving session/i })[0]);
    fireEvent.change(await screen.findByLabelText(/why is this session being cancelled/i), {
      target: { value: 'Wrong box opened' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^cancel receiving session$/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].args[2]).toBe('Wrong box opened');
    expect(await screen.findByText(/preserved as history/i)).toBeTruthy();
  });

  it('renders a cancelled receipt as terminal, with no mutation controls', async () => {
    detail = makeDetail({
      receipt: { ...makeDetail().receipt, status: 'cancelled' },
    });
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    expect(screen.getByText(/This receiving session was abandoned/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /submit receipt/i })).toBeNull();
    expect(table().queryByRole('button', { name: /^record$/i })).toBeNull();
  });
});

describe('submitting a receipt', () => {
  beforeEach(() => {
    detail = makeDetail({
      lines: [
        makeLine({
          observed: { receiptLinePublicId: 'RV-ARL-AAA111', quantityReceived: 5, note: null },
          cumulativeReceivedQuantity: 5,
        }),
      ],
    });
  });

  // The exact distinction the work order requires the copy to make.
  it('explains that submission freezes quantities and is NOT reconciliation', async () => {
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(screen.getAllByRole('button', { name: /submit receipt/i })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/freezes the observed quantities/i).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/moves the receipt to submitted review/i)).toBeTruthy();
    expect(within(dialog).getByText(/create any inventory/i)).toBeTruthy();
    expect(within(dialog).getByText(/every discrepancy has been resolved/i)).toBeTruthy();
    expect(within(dialog).getByText(/owner reconciliation is complete/i)).toBeTruthy();
    expect(within(dialog).getByText(/establish a cost basis/i)).toBeTruthy();
  });

  it('uses no celebratory copy implying the acquisition is finished', async () => {
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(screen.getAllByRole('button', { name: /submit receipt/i })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).not.toMatch(/congratulations|all done|complete!|finished|success!/i);
  });

  it('summarizes the observed quantities being frozen and any difference', async () => {
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(screen.getAllByRole('button', { name: /submit receipt/i })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('RV-ARCPT-AAA111');
    expect(dialog.textContent).toContain('RV-AL-AAA111');
    expect(dialog.textContent).toMatch(/observed\s*5\s*against expected\s*3/i);
    expect(within(dialog).getByText(/differ from the acquisition's expected/i)).toBeTruthy();
  });

  it('reports the submitted outcome without claiming inventory was created', async () => {
    outcomes.submitReceipt = [{ receiptPublicId: 'RV-ARCPT-AAA111', status: 'submitted', replayed: false }];
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    fireEvent.click(screen.getAllByRole('button', { name: /submit receipt/i })[0]);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^submit receipt$/i }));
    expect(await screen.findByText(/No inventory was created/i)).toBeTruthy();
  });

  it('renders a submitted receipt as frozen and awaiting review', async () => {
    detail = makeDetail({ receipt: { ...makeDetail().receipt, status: 'submitted' } });
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    expect(screen.getByText(/frozen and the receipt is awaiting review/i)).toBeTruthy();
    expect(screen.getByText(/owner reconciliation has not run/i)).toBeTruthy();
  });
});

describe('receipt is not shipment', () => {
  it('labels the shipment as transport and denies it establishes receiving truth', async () => {
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    expect(
      screen.getByText(/carrier reporting delivered does not establish that quantities were verified/i),
    ).toBeTruthy();
  });

  it('supports a receipt with no shipment as a legitimate case', async () => {
    detail = makeDetail({
      receipt: { ...makeDetail().receipt, shipmentPublicId: null },
      shipments: [],
    });
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    expect(screen.getByText(/supported case, not a gap/i)).toBeTruthy();
  });
});

describe('role behaviour comes from the server', () => {
  it('offers a viewer no receiving operation at all', async () => {
    role = 'viewer';
    detail = makeDetail({
      role: 'viewer',
      lines: [
        makeLine({
          observed: { receiptLinePublicId: 'RV-ARL-AAA111', quantityReceived: 5, note: null },
          cumulativeReceivedQuantity: 5,
        }),
      ],
    });
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    expect(screen.queryByRole('button', { name: /submit receipt/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cancel receiving session/i })).toBeNull();
    expect(table().queryByRole('button', { name: /^correct$/i })).toBeNull();
    expect(table().queryByRole('button', { name: /^record$/i })).toBeNull();
  });

  it.each(['owner', 'operator'] as const)('offers %s the Batch 1 operations', async (given) => {
    role = given;
    detail = makeDetail({ role: given });
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    expect(screen.getByRole('button', { name: /submit receipt/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel receiving session/i })).toBeTruthy();
  });
});

describe('the receipt read tells the truth about what it knows', () => {
  it('treats an unknown receipt as proven-absent rather than failed', async () => {
    detailError = new ReceivingError('receipt_not_found', 404);
    renderWorkspace();
    await waitFor(() =>
      expect(screen.queryAllByText(/no receivable acquisition lines|not found/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/did not answer/i)).toBeNull();
  });

  it('never renders a failed receipt read as a receipt with no lines observed', async () => {
    detailError = new ReceivingError('dependency_failed', 502);
    renderWorkspace();
    await waitFor(() => expect(screen.queryByText(/did not answer/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /submit receipt/i })).toBeNull();
  });
});

describe('Batch 1 exposes none of Batch 2', () => {
  it('offers no inventory linking, unlink, discrepancy, or reconciliation control', async () => {
    detail = makeDetail({
      lines: [
        makeLine({
          observed: { receiptLinePublicId: 'RV-ARL-AAA111', quantityReceived: 5, note: null },
          cumulativeReceivedQuantity: 5,
        }),
      ],
    });
    renderWorkspace();
    await table().findByText('Vintage card lot A');
    const body = document.body.textContent ?? '';
    for (const forbidden of [/link inventory/i, /unlink/i, /raise discrepancy/i, /reconcile/i, /cost basis/i]) {
      expect(body).not.toMatch(forbidden);
    }
  });
});

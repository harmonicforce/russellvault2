// @vitest-environment jsdom
//
// S2.3 Batch 2 — inventory provenance, discrepancies and owner reconciliation,
// driven through the DOM.
//
// THE LOAD-BEARING TESTS
//
//   * observed, linked and remaining are three separate facts, and a remainder
//     is never called "missing inventory";
//   * a serialized item is exactly one unit and offers no quantity field;
//   * unlink requires a reason and never claims the inventory was deleted;
//   * discrepancy creation has NO blind retry after a lost response, and a
//     FAILED verification keeps creation locked rather than unlocking it;
//   * only an owner may resolve, write off, or reconcile;
//   * an overage without Over shipped evidence is named as a blocker;
//   * a reconciled receipt is terminal and claims no cost basis.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReceiptWorkspace from './ReceiptWorkspace';
import Receiving from './Receiving';
import {
  ReceivingError,
  type Discrepancy,
  type InventoryLink,
  type InventorySubjectCandidate,
  type ReceivingExpectedLine,
  type ReceivingQueue,
  type ReceivingReceiptDetail,
} from '../lib/receivingApi';

let role: 'owner' | 'operator' | 'viewer';
let workspaceId: string;
let detail: ReceivingReceiptDetail | null;
let detailError: ReceivingError | null;
/** Flipped mid-test so an authoritative RE-READ can be made to fail on demand. */
let rereadFails: boolean;
let subjects: InventorySubjectCandidate[];
let calls: Array<{ fn: string; args: unknown[] }>;
let outcomes: Record<string, Array<unknown | ReceivingError>>;
let queue: ReceivingQueue | null;

vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({ workspace: workspaceId ? { id: workspaceId, name: 'Vault', role } : null }),
}));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));

function record(fn: string, ...args: unknown[]) {
  calls.push({ fn, args });
  const next = outcomes[fn]?.shift();
  if (next instanceof ReceivingError) return Promise.reject(next);
  return Promise.resolve(next ?? { replayed: false });
}

vi.mock('../lib/receivingApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createReceivingTransport: () => ({
    queue: () => Promise.resolve(queue),
    receipt: (...a: unknown[]) => {
      calls.push({ fn: 'receipt', args: a });
      if (rereadFails) return Promise.reject(new ReceivingError('dependency_failed', 502));
      return detailError ? Promise.reject(detailError) : Promise.resolve(detail);
    },
    inventorySubjects: () =>
      Promise.resolve({
        coverage: 'governed_native_committed', historicalLegacyImported: false,
        complete: true, subjects,
      }),
    openReceipt: (...a: unknown[]) => record('openReceipt', ...a),
    recordLine: (...a: unknown[]) => record('recordLine', ...a),
    correctLine: (...a: unknown[]) => record('correctLine', ...a),
    cancelReceipt: (...a: unknown[]) => record('cancelReceipt', ...a),
    submitReceipt: (...a: unknown[]) => record('submitReceipt', ...a),
    linkInventory: (...a: unknown[]) => record('linkInventory', ...a),
    unlinkInventory: (...a: unknown[]) => record('unlinkInventory', ...a),
    reconcileReceipt: (...a: unknown[]) => record('reconcileReceipt', ...a),
    raiseDiscrepancy: (...a: unknown[]) => record('raiseDiscrepancy', ...a),
    transitionDiscrepancy: (...a: unknown[]) => record('transitionDiscrepancy', ...a),
  }),
}));

const LOT_SUBJECT: InventorySubjectCandidate = {
  subjectKind: 'lot', publicId: 'RV-ILOT-AAA111', trackingMode: 'lot_managed',
  productDisplayName: 'Bulk commons box', skuPublicId: 'RV-SKU-AAA111',
  conditionOrQuality: 'played', locationDisplayName: 'Shelf A1',
  lotQuantity: 12, serialNumber: null, gradingCompany: null,
  certificateNumber: null, parentLotPublicId: null,
};

const ITEM_SUBJECT: InventorySubjectCandidate = {
  subjectKind: 'item', publicId: 'RV-IITM-AAA111', trackingMode: 'serialized',
  productDisplayName: 'Graded slab', skuPublicId: 'RV-SKU-BBB222',
  conditionOrQuality: 'mint', locationDisplayName: 'Vault',
  lotQuantity: null, serialNumber: 'SER-1', gradingCompany: 'PSA',
  certificateNumber: '12345678', parentLotPublicId: 'RV-ILOT-BBB222',
};

function makeLink(over: Partial<InventoryLink> = {}): InventoryLink {
  return {
    inventoryLinkPublicId: 'RV-ARIL-AAA111',
    receiptLinePublicId: 'RV-ARL-AAA111',
    quantityLinked: 2,
    subjectKind: 'lot',
    inventoryLotPublicId: 'RV-ILOT-AAA111',
    inventoryItemPublicId: null,
    productDisplayName: 'Bulk commons box',
    skuPublicId: 'RV-SKU-AAA111',
    conditionOrQuality: 'played',
    locationDisplayName: 'Shelf A1',
    serialNumber: null,
    ...over,
  };
}

function makeLine(over: Partial<ReceivingExpectedLine> = {}): ReceivingExpectedLine {
  const observed = over.observed !== undefined
    ? over.observed
    : { receiptLinePublicId: 'RV-ARL-AAA111', quantityReceived: 5, note: null };
  const links = over.links ?? [];
  const linked = over.linkedQuantity ?? links.reduce((sum, l) => sum + l.quantityLinked, 0);
  return {
    sourceSystemPublicId: 'RV-SS-WHATNOT',
    acquisitionLinePublicId: 'RV-AL-AAA111',
    title: 'Vintage card lot A',
    expectedQuantity: 3,
    exclusionState: 'included',
    cumulativeReceivedQuantity: observed?.quantityReceived ?? 0,
    ...over,
    observed,
    links,
    linkedQuantity: linked,
    unlinkedQuantity: over.unlinkedQuantity ?? Math.max(0, (observed?.quantityReceived ?? 0) - linked),
  };
}

function makeDiscrepancy(over: Partial<Discrepancy> = {}): Discrepancy {
  return {
    discrepancyPublicId: 'RV-ADISC-AAA111',
    kind: 'over_shipped',
    status: 'open',
    orderPublicId: 'RV-ACQ-AAA111',
    receiptPublicId: 'RV-ARCPT-AAA111',
    receiptLinePublicId: 'RV-ARL-AAA111',
    acquisitionLinePublicId: 'RV-AL-AAA111',
    quantityExpected: 3,
    quantityObserved: 5,
    detail: 'Two extra units in the box',
    resolutionNote: null,
    resolvedAt: null,
    createdAt: '2026-08-06T10:00:00.000Z',
    ...over,
  };
}

function makeDetail(over: Partial<ReceivingReceiptDetail> = {}): ReceivingReceiptDetail {
  const lines = over.lines ?? [makeLine({ links: [makeLink()] })];
  return {
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    role,
    receipt: {
      publicId: 'RV-ARCPT-AAA111', status: 'submitted',
      receivedAt: '2026-08-05T10:00:00.000Z', note: null,
      shipmentPublicId: null, createdAt: '2026-08-05T09:00:00.000Z',
    },
    order: {
      publicId: 'RV-ACQ-AAA111', sourceOrderReference: 'WN-ORDER-1',
      sellers: ['alpha'], orderStatus: 'completed', occurredAt: '2026-08-01T00:00:00.000Z',
    },
    shipments: [],
    discrepancies: [],
    ...over,
    lines,
    reconciliation: over.reconciliation ?? {
      receiptStatus: over.receipt?.status ?? 'submitted',
      linesFullyLinked: false,
      linesNeedingLinks: lines
        .filter((l) => l.observed && l.linkedQuantity !== l.observed.quantityReceived)
        .map((l) => ({
          acquisitionLinePublicId: l.acquisitionLinePublicId,
          observed: l.observed!.quantityReceived,
          linked: l.linkedQuantity,
        })),
      overageLinesMissingEvidence: [],
      openDiscrepancyCount: (over.discrepancies ?? []).filter((d) => d.status === 'open').length,
      claimedDiscrepancyCount: 0,
      terminalDiscrepancyCount: 0,
    },
  };
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

function renderLanding() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/receiving']}>
        <Routes><Route path="/receiving" element={<Receiving />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The provenance region, which renders once at every width. */
const provenance = () => within(screen.getByRole('region', { name: 'Inventory provenance' }));
const discrepancyRegion = () => within(screen.getByRole('region', { name: 'Receiving discrepancies' }));

beforeEach(() => {
  role = 'operator';
  workspaceId = 'ws-1';
  detail = makeDetail();
  detailError = null;
  rereadFails = false;
  subjects = [LOT_SUBJECT, ITEM_SUBJECT];
  calls = [];
  outcomes = {};
  queue = {
    coverage: 'governed_native_committed', historicalLegacyImported: false,
    complete: true, role: 'operator',
    rows: [{
      orderPublicId: 'RV-ACQ-AAA111', sourceOrderReference: 'WN-ORDER-1', sellers: ['alpha'],
      orderStatus: 'completed', occurredAt: '2026-08-01T00:00:00.000Z',
      receivableLineCount: 1, expectedQuantityTotal: 3, observedQuantityTotal: 0,
      workflowState: 'not_started', openReceiptPublicId: null, receipts: [], shipments: [],
    }],
  };
});

afterEach(cleanup);

describe('inventory provenance presentation', () => {
  it('states observed, linked and remaining as three separate facts', async () => {
    renderWorkspace();
    const panel = await waitFor(() => provenance());
    expect(panel.getByText('Observed')).toBeTruthy();
    expect(panel.getByText('Linked')).toBeTruthy();
    expect(panel.getByText('Still needs a subject')).toBeTruthy();
    expect(panel.getByText('5 received, 2 linked, 3 still needs an inventory subject.')).toBeTruthy();
  });

  // "Missing inventory" would be a different, and false, claim.
  it('never calls the unlinked remainder missing inventory', async () => {
    renderWorkspace();
    await waitFor(() => provenance());
    expect(document.body.textContent).not.toMatch(/missing inventory/i);
  });

  it('names the subject kind in words and shows recognisable identity', async () => {
    renderWorkspace();
    const panel = await waitFor(() => provenance());
    expect(panel.getByText('Lot-managed lot')).toBeTruthy();
    expect(panel.getByText(/Bulk commons box/)).toBeTruthy();
    expect(panel.getByText(/Shelf A1/)).toBeTruthy();
  });

  it('distinguishes a serialized link from a lot-managed one in words', async () => {
    detail = makeDetail({
      lines: [makeLine({
        links: [makeLink({
          inventoryLinkPublicId: 'RV-ARIL-BBB222', subjectKind: 'item',
          inventoryLotPublicId: null, inventoryItemPublicId: 'RV-IITM-AAA111',
          quantityLinked: 1, productDisplayName: 'Graded slab', serialNumber: 'SER-1',
        })],
      })],
    });
    renderWorkspace();
    const panel = await waitFor(() => provenance());
    expect(panel.getByText('Serialized item')).toBeTruthy();
    expect(panel.getByText(/serial SER-1/)).toBeTruthy();
  });

  it('offers no linking control while the receipt is still open', async () => {
    detail = makeDetail({
      receipt: { ...makeDetail().receipt, status: 'open' },
    });
    renderWorkspace();
    const panel = await waitFor(() => provenance());
    expect(panel.queryByRole('button', { name: /link inventory/i })).toBeNull();
    expect(panel.getByText(/linking begins after submission/i)).toBeTruthy();
  });

  it('offers a viewer no linking or unlink control', async () => {
    role = 'viewer';
    detail = makeDetail({ role: 'viewer' });
    renderWorkspace();
    const panel = await waitFor(() => provenance());
    expect(panel.queryByRole('button', { name: /link inventory/i })).toBeNull();
    expect(panel.queryByRole('button', { name: /remove link/i })).toBeNull();
  });
});

describe('linking to a governed inventory subject', () => {
  it('links a lot-managed subject with an editable quantity', async () => {
    outcomes.linkInventory = [{ inventoryLinkPublicId: 'RV-ARIL-NEW', replayed: false }];
    renderWorkspace();
    fireEvent.click((await waitFor(() => provenance())).getByRole('button', { name: /link inventory/i }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: /RV-ILOT-AAA111/ });
    fireEvent.change(within(dialog).getByLabelText(/^Inventory subject/), {
      target: { value: 'RV-ILOT-AAA111' },
    });
    // The remaining amount is a DEFAULT and is visibly editable.
    const quantity = within(dialog).getByLabelText(/quantity to attribute/i) as HTMLInputElement;
    expect(quantity.value).toBe('3');
    fireEvent.change(quantity, { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^link to inventory$/i }));

    await waitFor(() => expect(calls.filter((c) => c.fn === 'linkInventory')).toHaveLength(1));
    expect(calls.find((c) => c.fn === 'linkInventory')!.args[2])
      .toEqual({ inventoryLotPublicId: 'RV-ILOT-AAA111', quantity: 2 });
  });

  // A serialized item is one unit. There is no quantity field to get wrong.
  it('links a serialized item as exactly one unit with no quantity field', async () => {
    outcomes.linkInventory = [{ inventoryLinkPublicId: 'RV-ARIL-NEW', replayed: false }];
    renderWorkspace();
    fireEvent.click((await waitFor(() => provenance())).getByRole('button', { name: /link inventory/i }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: /RV-ILOT-AAA111/ });
    fireEvent.change(within(dialog).getByLabelText(/^Inventory subject/), {
      target: { value: 'RV-IITM-AAA111' },
    });
    expect(within(dialog).queryByLabelText(/quantity to attribute/i)).toBeNull();
    expect(within(dialog).getByText(/exactly one unit/i)).toBeTruthy();
    // And it says how many separate items a multi-unit observation needs.
    expect(within(dialog).getByText(/5 separate items/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: /^link to inventory$/i }));
    await waitFor(() => expect(calls.filter((c) => c.fn === 'linkInventory')).toHaveLength(1));
    expect(calls.find((c) => c.fn === 'linkInventory')!.args[2])
      .toEqual({ inventoryItemPublicId: 'RV-IITM-AAA111' });
  });

  it('shows the tracking mode as inventory truth, not an operator choice', async () => {
    renderWorkspace();
    fireEvent.click((await waitFor(() => provenance())).getByRole('button', { name: /link inventory/i }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: /RV-ILOT-AAA111/ });
    fireEvent.change(within(dialog).getByLabelText(/^Inventory subject/), {
      target: { value: 'RV-ILOT-AAA111' },
    });
    expect(within(dialog).getByText(/recorded by inventory, not chosen here/i)).toBeTruthy();
  });

  it('directs the operator to the governed creation workflow when nothing matches', async () => {
    subjects = [];
    renderWorkspace();
    fireEvent.click((await waitFor(() => provenance())).getByRole('button', { name: /link inventory/i }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/does not create Products/i)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: /add inventory/i })).toBeTruthy();
  });

  it('surfaces a bounded over-capacity refusal without a client-side workaround', async () => {
    outcomes.linkInventory = [new ReceivingError('inventory_link_over_capacity', 409)];
    renderWorkspace();
    fireEvent.click((await waitFor(() => provenance())).getByRole('button', { name: /link inventory/i }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: /RV-ILOT-AAA111/ });
    fireEvent.change(within(dialog).getByLabelText(/^Inventory subject/), {
      target: { value: 'RV-ILOT-AAA111' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^link to inventory$/i }));
    expect(await screen.findByText(/more units than this receipt line observed/i)).toBeTruthy();
  });
});

describe('wrong-link recovery', () => {
  it('requires a reason before an unlink can be confirmed', async () => {
    renderWorkspace();
    fireEvent.click((await waitFor(() => provenance())).getByRole('button', { name: /remove link/i }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /^remove inventory link$/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(calls.filter((c) => c.fn === 'unlinkInventory')).toHaveLength(0);
  });

  // THE COPY THAT MATTERS. Unlinking is not deletion.
  it('never presents an unlink as deleting the inventory', async () => {
    renderWorkspace();
    fireEvent.click((await waitFor(() => provenance())).getByRole('button', { name: /remove link/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/does NOT delete the inventory lot or item/i)).toBeTruthy();
    expect(within(dialog).getByText(/does NOT rewrite acquisition evidence/i)).toBeTruthy();
    expect(within(dialog).getByText(/only possible before owner reconciliation/i)).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/delete the item|destroy|permanently remove the lot/i);
  });

  it('sends the exact link identity and reason', async () => {
    outcomes.unlinkInventory = [{ inventoryLinkPublicId: 'RV-ARIL-AAA111', unlinked: true, replayed: false }];
    renderWorkspace();
    fireEvent.click((await waitFor(() => provenance())).getByRole('button', { name: /remove link/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/why is this link being removed/i), {
      target: { value: 'Attributed to the wrong lot' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^remove inventory link$/i }));
    await waitFor(() => expect(calls.filter((c) => c.fn === 'unlinkInventory')).toHaveLength(1));
    const call = calls.find((c) => c.fn === 'unlinkInventory')!;
    expect(call.args[1]).toBe('RV-ARIL-AAA111');
    expect(call.args[2]).toBe('Attributed to the wrong lot');
    expect(await screen.findByText(/inventory subject itself was not deleted/i)).toBeTruthy();
  });
});

describe('discrepancy creation has no blind retry', () => {
  const openReport = async () => {
    renderWorkspace();
    const region = await waitFor(() => discrepancyRegion());
    fireEvent.click(region.getByRole('button', { name: /record a discrepancy/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/what kind of discrepancy/i), {
      target: { value: 'over_shipped' },
    });
    fireEvent.change(within(dialog).getByLabelText(/what did you observe/i), {
      target: { value: 'Two extra units in the box' },
    });
    return dialog;
  };

  it('offers the closed governed vocabulary and nothing else', async () => {
    const dialog = await openReport();
    const options = within(within(dialog).getByLabelText(/what kind of discrepancy/i) as HTMLElement)
      .getAllByRole('option');
    expect(options).toHaveLength(7);
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Short shipped'),
      expect.stringContaining('Over shipped'),
      expect.stringContaining('Damaged'),
      expect.stringContaining('Wrong item'),
      expect.stringContaining('Not as described'),
      expect.stringContaining('Price mismatch'),
      expect.stringContaining('Never arrived'),
    ]);
  });

  it('states that a discrepancy is evidence and not an edit to the acquisition', async () => {
    const dialog = await openReport();
    expect(within(dialog).getByText(/does not edit the acquisition record/i)).toBeTruthy();
  });

  it('offers no monetary inputs for price_mismatch', async () => {
    const dialog = await openReport();
    fireEvent.change(within(dialog).getByLabelText(/what kind of discrepancy/i), {
      target: { value: 'price_mismatch' },
    });
    expect(within(dialog).getByText(/no monetary fields/i)).toBeTruthy();
    expect(within(dialog).queryByLabelText(/amount|value|currency/i)).toBeNull();
  });

  // THE CENTRAL BATCH 2 RULE.
  it('locks creation and offers NO retry after an unknown outcome', async () => {
    outcomes.raiseDiscrepancy = [new ReceivingError('dependency_failed', 502)];
    const dialog = await openReport();
    fireEvent.click(within(dialog).getByRole('button', { name: /^record discrepancy$/i }));

    expect(await screen.findByText(/may or may not have been created/i)).toBeTruthy();
    // Exactly one attempt, and no control that would send another.
    expect(calls.filter((c) => c.fn === 'raiseDiscrepancy')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^retry$|try again|record discrepancy/i })).toBeNull();
    expect(screen.getByRole('button', { name: /check what is on record/i })).toBeTruthy();
    // Never the false guarantee.
    expect(document.body.textContent).not.toMatch(/nothing was sent/i);
  });

  it('tells the operator it committed, and refuses to send again', async () => {
    outcomes.raiseDiscrepancy = [new ReceivingError('dependency_failed', 502)];
    const dialog = await openReport();
    fireEvent.click(within(dialog).getByRole('button', { name: /^record discrepancy$/i }));
    await screen.findByText(/may or may not have been created/i);

    // The authoritative re-read now contains a matching record that was not
    // there before the attempt.
    detail = makeDetail({
      discrepancies: [makeDiscrepancy({
        discrepancyPublicId: 'RV-ADISC-NEW',
        // ORDER-scoped, matching the order-level report that was attempted.
        receiptPublicId: null, receiptLinePublicId: null,
      })],
    });
    fireEvent.click(screen.getByRole('button', { name: /check what is on record/i }));

    expect((await screen.findAllByText(/RV-ADISC-NEW/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/not recorded twice/i)).toBeTruthy();
    // Still exactly one attempt: verification never resends.
    expect(calls.filter((c) => c.fn === 'raiseDiscrepancy')).toHaveLength(1);
  });

  it('permits a NEW attempt only once a complete re-read proves nothing was recorded', async () => {
    outcomes.raiseDiscrepancy = [new ReceivingError('dependency_failed', 502)];
    const dialog = await openReport();
    fireEvent.click(within(dialog).getByRole('button', { name: /^record discrepancy$/i }));
    await screen.findByText(/may or may not have been created/i);

    // The re-read succeeds and contains no matching new record.
    fireEvent.click(screen.getByRole('button', { name: /check what is on record/i }));
    expect(await screen.findByText(/did not reach the database/i)).toBeTruthy();
    expect(screen.getByText(/You can record it again/i)).toBeTruthy();
    // The creation control is offered again — as a NEW attempt, not a resend.
    expect(discrepancyRegion().getByRole('button', { name: /record a discrepancy/i })).toBeTruthy();
  });

  // A FAILED verification is not an absence.
  it('keeps creation locked when the verification itself fails', async () => {
    outcomes.raiseDiscrepancy = [new ReceivingError('dependency_failed', 502)];
    const dialog = await openReport();
    fireEvent.click(within(dialog).getByRole('button', { name: /^record discrepancy$/i }));
    await screen.findByText(/may or may not have been created/i);

    rereadFails = true;
    fireEvent.click(screen.getByRole('button', { name: /check what is on record/i }));

    expect(await screen.findByText(/could not be re-read/i)).toBeTruthy();
    expect(screen.getByText(/still locked/i)).toBeTruthy();
    // No creation control, and still no retry.
    expect(discrepancyRegion().queryByRole('button', { name: /record a discrepancy/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/nothing was sent/i);
  });
});

describe('never arrived is reported without a receipt', () => {
  it('is available from the receiving landing page and creates no receipt', async () => {
    outcomes.raiseDiscrepancy = [{ discrepancyPublicId: 'RV-ADISC-NEW', status: 'open' }];
    renderLanding();
    fireEvent.click((await screen.findAllByRole('button', { name: /nothing arrived/i }))[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/No receipt — this concerns the order itself/i)).toBeTruthy();
    const options = within(within(dialog).getByLabelText(/what kind of discrepancy/i) as HTMLElement)
      .getAllByRole('option');
    expect(options.map((o) => o.textContent?.split(' —')[0])).toEqual(['Never arrived', 'Short shipped']);

    fireEvent.change(within(dialog).getByLabelText(/what did you observe/i), {
      target: { value: 'Tracking says delivered, nothing at the door' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^record discrepancy$/i }));

    await waitFor(() => expect(calls.filter((c) => c.fn === 'raiseDiscrepancy')).toHaveLength(1));
    expect(calls.find((c) => c.fn === 'raiseDiscrepancy')!.args[2]).toMatchObject({
      receiptPublicId: null, receiptLinePublicId: null, kind: 'never_arrived',
    });
    // No receipt was opened to carry the report.
    expect(calls.filter((c) => c.fn === 'openReceipt')).toHaveLength(0);
    expect(await screen.findByText(/No receipt was created, because nothing arrived/i)).toBeTruthy();
  });

  it('offers no blind retry on the landing page either', async () => {
    outcomes.raiseDiscrepancy = [new ReceivingError('dependency_failed', 502)];
    renderLanding();
    fireEvent.click((await screen.findAllByRole('button', { name: /nothing arrived/i }))[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/what did you observe/i), { target: { value: 'Gone' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^record discrepancy$/i }));

    expect((await screen.findAllByText(/whether it was recorded is unknown/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/could create a second record/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/nothing was sent/i);
  });
});

describe('discrepancy lifecycle by role', () => {
  beforeEach(() => {
    detail = makeDetail({ discrepancies: [makeDiscrepancy()] });
  });

  it('renders kind and status as words, never colour alone', async () => {
    renderWorkspace();
    const region = await waitFor(() => discrepancyRegion());
    expect(region.getByText('Over shipped')).toBeTruthy();
    expect(region.getByText('Open')).toBeTruthy();
    expect(region.getByText(/More units arrived than the acquisition recorded/i)).toBeTruthy();
    expect(region.getByText(/Receipt line RV-ARL-AAA111/)).toBeTruthy();
  });

  it('lets an operator claim but not resolve or write off', async () => {
    renderWorkspace();
    const region = await waitFor(() => discrepancyRegion());
    expect(region.getByRole('button', { name: /claim for review/i })).toBeTruthy();
    expect(region.queryByRole('button', { name: /^resolve$/i })).toBeNull();
    expect(region.queryByRole('button', { name: /^write off$/i })).toBeNull();
  });

  it('describes a claim as taking ownership, not as a resolution', async () => {
    renderWorkspace();
    fireEvent.click((await waitFor(() => discrepancyRegion()))
      .getByRole('button', { name: /claim for review/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/does NOT.*resolve it/is)).toBeTruthy();
  });

  it('offers a viewer no lifecycle action', async () => {
    role = 'viewer';
    detail = makeDetail({ role: 'viewer', discrepancies: [makeDiscrepancy()] });
    renderWorkspace();
    const region = await waitFor(() => discrepancyRegion());
    expect(region.queryByRole('button', { name: /claim for review/i })).toBeNull();
    expect(region.queryByRole('button', { name: /record a discrepancy/i })).toBeNull();
  });

  describe('as owner', () => {
    beforeEach(() => {
      role = 'owner';
      detail = makeDetail({ role: 'owner', discrepancies: [makeDiscrepancy()] });
    });

    it('requires a resolution note to resolve', async () => {
      renderWorkspace();
      fireEvent.click((await waitFor(() => discrepancyRegion())).getByRole('button', { name: /^resolve$/i }));
      const dialog = await screen.findByRole('dialog');
      const confirm = within(dialog).getByRole('button', { name: /^resolve discrepancy$/i });
      expect((confirm as HTMLButtonElement).disabled).toBe(true);
      expect(within(dialog).getByText(/original evidence.*is PRESERVED/is)).toBeTruthy();
    });

    it('explains a write-off does not pretend the evidence became equal', async () => {
      renderWorkspace();
      fireEvent.click((await waitFor(() => discrepancyRegion())).getByRole('button', { name: /^write off$/i }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/without claiming the expected and observed evidence became equal/i))
        .toBeTruthy();
      expect(within(dialog).getByText(/difference stands on record/i)).toBeTruthy();
    });

    it('sends the governed target and note', async () => {
      outcomes.transitionDiscrepancy = [
        { discrepancyPublicId: 'RV-ADISC-AAA111', status: 'resolved', replayed: false },
      ];
      renderWorkspace();
      fireEvent.click((await waitFor(() => discrepancyRegion())).getByRole('button', { name: /^resolve$/i }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText(/resolution note/i), {
        target: { value: 'Supplier credited the difference' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: /^resolve discrepancy$/i }));
      await waitFor(() => expect(calls.filter((c) => c.fn === 'transitionDiscrepancy')).toHaveLength(1));
      expect(calls.find((c) => c.fn === 'transitionDiscrepancy')!.args[2])
        .toEqual({ target: 'resolved', resolutionNote: 'Supplier credited the difference' });
    });

    it('shows terminal evidence with its resolution and the preserved original', async () => {
      detail = makeDetail({
        role: 'owner',
        discrepancies: [makeDiscrepancy({
          status: 'resolved', resolutionNote: 'Supplier credited the difference',
          resolvedAt: '2026-08-07T10:00:00.000Z',
        })],
      });
      renderWorkspace();
      const region = await waitFor(() => discrepancyRegion());
      expect(region.getByText('Resolved')).toBeTruthy();
      expect(region.getByText('Supplier credited the difference')).toBeTruthy();
      expect(region.getByText(/original evidence above is preserved/i)).toBeTruthy();
      // Terminal: no further lifecycle control.
      expect(region.queryByRole('button', { name: /^resolve$/i })).toBeNull();
    });
  });
});

describe('overage evidence and reconciliation', () => {
  it('names the Over shipped requirement without creating it', async () => {
    detail = makeDetail({
      reconciliation: {
        ...makeDetail().reconciliation,
        overageLinesMissingEvidence: [
          { acquisitionLinePublicId: 'RV-AL-AAA111', expected: 3, cumulativeReceived: 5 },
        ],
      },
    });
    renderWorkspace();
    expect(await screen.findByText(/Observed receiving exceeds the acquisition quantity/i)).toBeTruthy();
    expect(screen.getByText(/Record an Over shipped discrepancy before owner reconciliation/i)).toBeTruthy();
    expect(screen.getByText(/never created automatically/i)).toBeTruthy();
    // Nothing was raised on the operator's behalf.
    expect(calls.filter((c) => c.fn === 'raiseDiscrepancy')).toHaveLength(0);
  });

  it('offers reconciliation to an owner only', async () => {
    renderWorkspace();
    await waitFor(() => provenance());
    expect(screen.queryByRole('button', { name: /reconcile receipt/i })).toBeNull();

    cleanup();
    role = 'owner';
    detail = makeDetail({ role: 'owner' });
    renderWorkspace();
    await waitFor(() => provenance());
    expect(screen.getByRole('button', { name: /reconcile receipt/i })).toBeTruthy();
  });

  it('shows per-line observed, linked and difference rather than one readiness badge', async () => {
    role = 'owner';
    detail = makeDetail({ role: 'owner' });
    renderWorkspace();
    await waitFor(() => provenance());
    fireEvent.click(screen.getByRole('button', { name: /reconcile receipt/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('RV-AL-AAA111')).toBeTruthy();
    expect(within(dialog).getByText('3 not linked')).toBeTruthy();
    expect(within(dialog).getByText(/only 2 linked/i)).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/\bReady\b/);
  });

  it('states what reconciliation does and does not mean', async () => {
    role = 'owner';
    detail = makeDetail({ role: 'owner' });
    renderWorkspace();
    await waitFor(() => provenance());
    fireEvent.click(screen.getByRole('button', { name: /reconcile receipt/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/you accept this receiving evidence as the owner/i)).toBeTruthy();
    expect(within(dialog).getByText(/receipt becomes terminal and can no longer be changed/i)).toBeTruthy();
    expect(within(dialog).getByText(/provenance links become immutable/i)).toBeTruthy();
    expect(within(dialog).getByText(/a cost basis has been calculated/i)).toBeTruthy();
    expect(within(dialog).getByText(/the item is listed or sold/i)).toBeTruthy();
  });

  it('reconciles and reports that no cost basis was calculated', async () => {
    role = 'owner';
    detail = makeDetail({ role: 'owner' });
    outcomes.reconcileReceipt = [
      { receiptPublicId: 'RV-ARCPT-AAA111', status: 'reconciled', replayed: false },
    ];
    renderWorkspace();
    await waitFor(() => provenance());
    fireEvent.click(screen.getByRole('button', { name: /reconcile receipt/i }));
    fireEvent.click(within(await screen.findByRole('dialog'))
      .getByRole('button', { name: /^reconcile receipt$/i }));

    await waitFor(() => expect(calls.filter((c) => c.fn === 'reconcileReceipt')).toHaveLength(1));
    expect(await screen.findByText(/No cost basis was calculated/i)).toBeTruthy();
  });
});

describe('a reconciled receipt is terminal', () => {
  beforeEach(() => {
    role = 'owner';
    detail = makeDetail({
      role: 'owner',
      receipt: { ...makeDetail().receipt, status: 'reconciled' },
      lines: [makeLine({ links: [makeLink()], linkedQuantity: 5, unlinkedQuantity: 0 })],
    });
  });

  it('offers no record, correct, cancel, submit, link, unlink or reconcile control', async () => {
    renderWorkspace();
    await waitFor(() => provenance());
    for (const name of [
      /^record$/i, /^correct$/i, /cancel receiving session/i, /submit receipt/i,
      /link inventory/i, /remove link/i, /reconcile receipt/i,
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('keeps provenance visible and says it is now immutable', async () => {
    renderWorkspace();
    const panel = await waitFor(() => provenance());
    expect(panel.getByText('RV-ARIL-AAA111')).toBeTruthy();
    expect(panel.getByText(/provenance is now immutable/i)).toBeTruthy();
    expect(panel.getByText(/inventory itself is unaffected/i)).toBeTruthy();
  });

  it('claims no cost basis anywhere on the page', async () => {
    renderWorkspace();
    await waitFor(() => provenance());
    expect(document.body.textContent).not.toMatch(/cost basis (has been|is) (calculated|established)/i);
  });
});

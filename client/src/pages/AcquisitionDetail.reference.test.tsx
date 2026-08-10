// @vitest-environment jsdom
//
// S1.6.6 — the governed acquisition detail as the canonical detail reference.
//
// AcquisitionDetail.render.test.tsx is the S1.4 preservation contract and proves
// that the behaviour it locked down still holds. This file proves what S1.6.6
// ADDED: the truth vocabulary, the coverage and provenance model, the placement
// integrity treatment, the money rules, the delivered-versus-receiving
// distinction, the unresolved-operation coordinator — and, above all, the
// correction of a false guarantee the page used to make.
//
// THE FALSE GUARANTEE
//
// Before this slice, clearing a retained retry told the operator:
//
//     "Unconfirmed request discarded. Nothing was sent."
//
// A request whose response never arrived may have reached the governed backend
// and committed. Nobody on this page can know. The tests in the "unknown
// outcome" describe block below are load-bearing: they fail against the old
// implementation, and they are the reason this slice exists.
//
// Everything here is RENDERED and driven through the DOM. Nothing greps the
// page source.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AcquisitionDetail, { returnTarget } from './AcquisitionDetail';
import {
  AcquisitionDetailError,
  type AcquisitionDetail as Detail,
  type Payment,
  type Shipment,
} from '../lib/acquisitionDetailApi';

const SOURCE = 'SRC-A';
const LINE = 'LINE-1';

let role: 'owner' | 'operator' | 'viewer';
let workspaceId: string;
let detail: Detail | null;
let detailError: AcquisitionDetailError | null;
/** Flipped mid-test so an authoritative RE-READ can be made to fail on demand. */
let detailFails: AcquisitionDetailError | null;
let detailCalls: unknown[][];
let calls: Array<{ fn: string; args: unknown[] }>;
let outcomes: Record<string, Array<'ok' | AcquisitionDetailError>>;
let holdFns: Set<string>;
let releases: Array<() => void>;
let holdDetail: boolean;
/** The router state handed to the page, i.e. where the operator came from. */
let locationState: unknown;

vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({ workspace: workspaceId ? { id: workspaceId, name: 'Vault', role } : null }),
}));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));

function outcome(fn: string): Promise<unknown> {
  if (holdFns.has(fn)) return new Promise((resolve) => releases.push(() => resolve({ ok: true })));
  const next = outcomes[fn]?.shift() ?? 'ok';
  return next === 'ok' ? Promise.resolve({ ok: true }) : Promise.reject(next);
}
function record(fn: string, ...args: unknown[]) {
  calls.push({ fn, args });
  return outcome(fn);
}

vi.mock('../lib/acquisitionDetailApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAcquisitionDetailTransport: () => ({
    // Records its arguments, so a retry can be proved to re-read the SAME
    // source-qualified address rather than merely to have happened.
    detail: (...a: unknown[]) => {
      detailCalls.push(a);
      if (holdDetail) return new Promise(() => undefined);
      const failure = detailError ?? detailFails;
      return failure ? Promise.reject(failure) : Promise.resolve(detail);
    },
    classify: (...a: unknown[]) => record('classify', ...a),
    override: (...a: unknown[]) => record('override', ...a),
    recordPayment: (...a: unknown[]) => record('recordPayment', ...a),
    reversePayment: (...a: unknown[]) => record('reversePayment', ...a),
    createShipment: (...a: unknown[]) => record('createShipment', ...a),
    transitionShipment: (...a: unknown[]) => record('transitionShipment', ...a),
    exclude: (...a: unknown[]) => record('exclude', ...a),
    restore: (...a: unknown[]) => record('restore', ...a),
  }),
}));

function makePayment(over: Partial<Payment> = {}): Payment {
  return {
    publicId: 'RV-APAY-AAA111',
    paidAt: '2026-08-03T09:00:00.000Z',
    amountMinor: 1500,
    currency: 'USD',
    instrument: 'card',
    externalReference: null,
    evidenceNote: null,
    state: 'active',
    reversedAt: null,
    reversalReason: null,
    reversalEvent: null,
    ...over,
  } as Payment;
}
function makeShipment(over: Partial<Shipment> = {}): Shipment {
  return {
    publicId: 'RV-ASHIP-BBB222',
    carrier: 'USPS Priority Mail',
    trackingNumber: '9400 1234-5678',
    status: 'expected',
    shippedAt: null,
    expectedAt: null,
    receivedAt: null,
    shippingReferenceMinor: 450,
    currency: 'USD',
    evidenceNote: null,
    transitionHistory: [],
    allowedNextTransitions: ['in_transit', 'delivered', 'lost', 'cancelled'],
    ...over,
  } as Shipment;
}
function makeDetail(over: Partial<Detail> = {}): Detail {
  return {
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    identity: { sourceSystemPublicId: SOURCE, linePublicId: LINE },
    line: {
      publicId: LINE,
      quantity: 2,
      description: 'A line',
      referenceNumber: 'REF-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      businessVertical: 'Pokémon / TCG',
      fullTitle: 'Sealed booster box',
      deliveredItemTitle: 'booster box',
      sellerNormalized: 'seller',
    },
    order: {
      publicId: 'RV-ACQ-AAA111',
      sourceOrderReference: 'ORDER-1',
      status: 'unknown',
      sourceReportedStatus: 'shipped',
      sourceReportedTotalMinor: 5000,
      currency: 'USD',
      occurredAt: '2026-08-01T10:00:00.000Z',
      channel: { publicId: 'RV-CH-1', name: 'Channel' },
      supplier: { publicId: 'RV-SUP-1', displayName: 'A seller' },
      sourceSystem: { publicId: SOURCE, kind: 'manual' },
    },
    placement: { lotPublicId: 'RV-ALOT-AAA111', sequence: 1, label: 'Lot A', integrityState: 'current' },
    classification: {
      publicId: 'RV-ACL-1',
      optionKey: 'sealed',
      optionLabel: 'Sealed',
      method: 'rule',
      confidence: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      state: 'classified',
    },
    classificationHistory: [
      {
        publicId: 'RV-ACL-1',
        optionKey: 'sealed',
        optionLabel: 'Sealed',
        method: 'owner_override',
        confidence: 1,
        createdAt: '2026-08-02T00:00:00.000Z',
        supersededAt: null,
        ownerOverrideReason: 'owner inspected the sealed case',
      },
    ],
    classificationOptions: [
      { key: 'sealed', label: 'Sealed' },
      { key: 'slab', label: 'Slab' },
    ],
    payments: [makePayment()],
    paymentSummary: {
      activeCount: 1,
      activeCurrencies: ['USD'],
      mixedCurrencies: false,
      activeTotalMinor: 1500,
      sourceReportedTotalMinor: 5000,
      differenceMinor: 3500,
    },
    shipments: [makeShipment()],
    exclusion: { state: 'included', current: null, history: [] },
    sourceEvidence: { sourceSystemPublicId: SOURCE, sourceRecordRowKey: 'a-row-1', sourceImportJobPublicId: 'IMP-A' },
    ...over,
  } as Detail;
}

let client: QueryClient;
function tree() {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: `/acquisitions/${SOURCE}/${LINE}`, state: locationState }]}>
        <Routes>
          <Route path="/acquisitions/:sourceSystemPublicId/:linePublicId" element={<AcquisitionDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(tree());
}
const ready = () => screen.findByText('Sealed booster box');

beforeEach(() => {
  role = 'owner';
  workspaceId = 'ws-1';
  detail = makeDetail();
  detailError = null;
  detailFails = null;
  detailCalls = [];
  calls = [];
  outcomes = {};
  holdFns = new Set();
  releases = [];
  holdDetail = false;
  locationState = null;
});
afterEach(cleanup);

const failure = () => new AcquisitionDetailError('dependency_failed', 502);
const panel = (name: string) => within(screen.getByLabelText(name));

/**
 * The value of one labelled fact inside a named panel.
 *
 * Precise on purpose. A page this dense legitimately repeats strings — "USD
 * 15.00" is both the recorded total and the one payment that makes it up — so
 * a bare text query proves less than it appears to. This asserts the value
 * sitting under a specific `<dt>`.
 */
function factValue(sectionName: string, label: string): string {
  const section = screen.getByLabelText(sectionName);
  const term = Array.from(section.querySelectorAll('dt')).find((node) => node.textContent === label);
  if (!term) throw new Error(`No fact labelled "${label}" in "${sectionName}"`);
  return (term.nextElementSibling?.textContent ?? '').trim();
}

async function startPayment() {
  fireEvent.change(screen.getByLabelText(/Payment amount/), { target: { value: '12.34' } });
  fireEvent.change(screen.getByLabelText(/Payment date and time/), { target: { value: '2026-08-06T12:00' } });
  fireEvent.submit(screen.getByLabelText('Record payment'));
}

// ---------------------------------------------------------------------------

describe('S1.6.6 detail truth', () => {
  it('shows a loading state that is not an empty record and not a zero', async () => {
    holdDetail = true;
    renderPage();
    expect(screen.getByRole('status').textContent).toContain('Loading governed acquisition detail');
    // Not empty, and no financial figure invented while the answer is pending.
    expect(document.querySelector('[data-truth-state="empty"]')).toBeNull();
    expect(screen.queryByText('Sealed booster box')).toBeNull();
    expect(screen.queryByText(/USD 0\.00/)).toBeNull();
  });

  it('renders the authoritative record when it arrives', async () => {
    renderPage();
    await ready();
    expect(factValue('Overview', 'Source order reference')).toBe('ORDER-1');
    expect(factValue('Financial', 'Recorded active total')).toBe('USD 15.00');
  });

  // Four codes, four different answers, and each next action differs.
  it.each([
    ['acquisition_not_found', 404, 'Acquisition line not found', 'empty'],
    ['unauthorized_workspace', 403, 'You do not have access to this', 'unauthorized'],
    ['signed_out', 401, 'You do not have access to this', 'unauthorized'],
    ['acquisition_read_contract_missing', 500, 'Not configured in this deployment', 'notConfigured'],
    ['dependency_failed', 502, 'Could not be loaded', 'unavailable'],
  ])('renders %s as a distinct state', async (code, status, heading, marker) => {
    detailError = new AcquisitionDetailError(code, status);
    renderPage();
    expect(await screen.findByText(heading)).toBeTruthy();
    expect(document.querySelector(`[data-truth-state="${marker}"]`)).toBeTruthy();
  });

  it('separates a signed-out session from an ordinary workspace refusal in words', async () => {
    detailError = new AcquisitionDetailError('signed_out', 401);
    renderPage();
    expect(await screen.findByText(/session is no longer signed in/)).toBeTruthy();
  });

  it('never claims a record does not exist because the dependency failed', async () => {
    detailError = failure();
    renderPage();
    await screen.findByText('Could not be loaded');
    expect(document.querySelector('[data-truth-state="empty"]')).toBeNull();
    expect(screen.queryByText('Acquisition line not found')).toBeNull();
  });

  it('says nothing about whether an unreadable record exists', async () => {
    detailError = new AcquisitionDetailError('unauthorized_workspace', 403);
    renderPage();
    await screen.findByText('You do not have access to this');
    // No retry is offered: repeating the request cannot change the answer.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('Sealed booster box')).toBeNull();
  });

  it('retries a dependency failure against the same source-qualified address', async () => {
    detailError = failure();
    renderPage();
    await screen.findByText('Could not be loaded');
    detailError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await ready();
    // Every read — first and retried — carried BOTH identifiers.
    expect(detailCalls.length).toBeGreaterThan(1);
    for (const args of detailCalls) expect(args).toEqual(['ws-1', SOURCE, LINE]);
  });

  it('keeps the record on screen and marks it stale when a re-read fails', async () => {
    renderPage();
    await ready();
    detailFails = failure();
    fireEvent.click(screen.getByRole('button', { name: 'Run governed classifier' }));
    await waitFor(() => expect(document.querySelector('[data-truth-state="stale"]')).toBeTruthy());
    // The record is still there; it is simply no longer claimed to be current.
    expect(screen.getByText('Sealed booster box')).toBeTruthy();
  });

  it('treats an unselected workspace as unconfigured rather than as a missing record', async () => {
    workspaceId = '';
    renderPage();
    expect(await screen.findByText('Not configured in this deployment')).toBeTruthy();
    expect(document.querySelector('[data-truth-state="empty"]')).toBeNull();
  });
});

describe('S1.6.6 source-qualified identity and return navigation', () => {
  it('addresses the governed read with both identifiers', async () => {
    renderPage();
    await ready();
    expect(detailCalls[0]).toEqual(['ws-1', SOURCE, LINE]);
  });

  it('exposes no internal UUID', async () => {
    renderPage();
    await ready();
    expect(document.body.textContent ?? '').not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it('source-qualifies an eligibility decision', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from downstream workflows' }));
    fireEvent.change(screen.getByLabelText(/Eligibility decision reason/), { target: { value: 'not resale stock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls.find((c) => c.fn === 'exclude')).toBeTruthy());
    expect(calls[0].args.slice(0, 3)).toEqual(['ws-1', SOURCE, LINE]);
  });

  it('returns to the exact filtered acquisitions list the operator came from', async () => {
    locationState = { from: '/acquisitions?seller=A+seller&page=3&sort=occurred_at' };
    renderPage();
    await ready();
    expect(screen.getByRole('link', { name: /Back to acquisitions/ }).getAttribute('href')).toBe(
      '/acquisitions?seller=A+seller&page=3&sort=occurred_at',
    );
  });

  it('falls back to the plain list rather than manufacturing a return URL', async () => {
    renderPage();
    await ready();
    expect(screen.getByRole('link', { name: /Back to acquisitions/ }).getAttribute('href')).toBe('/acquisitions');
  });

  // A `from` is operator-supplied routing state, so it is checked rather than
  // trusted. None of these is repaired into "something close enough".
  it.each([
    ['an off-site absolute URL', 'https://example.test/acquisitions'],
    ['a protocol-relative URL', '//example.test/acquisitions'],
    ['an unrelated in-app route', '/inventory?page=2'],
    ['a prefix collision', '/acquisitions-export?page=2'],
    ['a non-string', 42],
  ])('refuses %s as a return target', (_label, from) => {
    expect(returnTarget({ from })).toBe('/acquisitions');
  });

  it('accepts only the acquisitions list and its query string', () => {
    expect(returnTarget({ from: '/acquisitions' })).toBe('/acquisitions');
    expect(returnTarget({ from: '/acquisitions?page=2' })).toBe('/acquisitions?page=2');
    expect(returnTarget(null)).toBe('/acquisitions');
  });
});

describe('S1.6.6 coverage and provenance', () => {
  it('states the governed-native coverage and the missing legacy history', async () => {
    renderPage();
    await ready();
    const coverage = screen.getByLabelText('Governed coverage').textContent ?? '';
    expect(coverage).toContain('governed-native acquisition evidence');
    expect(coverage).toContain('Historical legacy Whatnot acquisition history');
    expect(coverage).toContain('has not been imported');
  });

  it('forbids totalling governed and legacy figures together', async () => {
    renderPage();
    await ready();
    const coverage = screen.getByLabelText('Governed coverage').textContent ?? '';
    expect(coverage).toContain('Do not total these figures');
    expect(coverage).toContain('must not be added together');
  });

  it('claims no completed historical reconciliation', async () => {
    renderPage();
    await ready();
    const coverage = screen.getByLabelText('Governed coverage').textContent ?? '';
    expect(coverage).toContain('nothing on this page implies that record-level historical reconciliation');
    expect(coverage).not.toMatch(/reconciliation (is )?complete/i);
  });

  it('marks the source evidence as imported rather than governed', async () => {
    renderPage();
    await ready();
    const evidence = panel('Source evidence');
    expect(evidence.getByText(/Imported source evidence/)).toBeTruthy();
    expect(evidence.queryByText('Governed')).toBeNull();
  });

  it('labels the raw source row key as a source key, not an RV identity', async () => {
    renderPage();
    await ready();
    const evidence = panel('Source evidence');
    expect(evidence.getByText(/A raw key from the source system/)).toBeTruthy();
    expect(evidence.getByText(/Not a Russell Vault governed identity/)).toBeTruthy();
  });

  it('does not stamp every ordinary fact as governed', async () => {
    renderPage();
    await ready();
    // ProvenanceLabel is for the places authority actually differs. If every
    // row wore it, the one row that is NOT governed would read the same.
    expect(document.querySelectorAll('[data-provenance]')).toHaveLength(1);
  });

  it('fabricates no link to source evidence the application cannot reach', async () => {
    renderPage();
    await ready();
    expect(screen.getByLabelText('Source evidence').querySelectorAll('a')).toHaveLength(0);
  });
});

describe('S1.6.6 placement integrity', () => {
  it('renders the active lot when the placement is current', async () => {
    renderPage();
    await ready();
    const overview = panel('Overview');
    expect(overview.getByText('RV-ALOT-AAA111')).toBeTruthy();
    expect(overview.getByText('Lot A')).toBeTruthy();
  });

  it('treats a missing active placement as an integrity problem, not a blank field', async () => {
    detail = makeDetail({ placement: { lotPublicId: null, sequence: null, label: null, integrityState: 'missing_active_placement' } });
    renderPage();
    await ready();
    const overview = panel('Overview');
    expect(overview.getByText('No active lot placement')).toBeTruthy();
    expect(overview.getByText(/governed placement chain is incomplete/)).toBeTruthy();
  });

  it('invents no lot and claims no downstream readiness when the placement is missing', async () => {
    detail = makeDetail({ placement: { lotPublicId: null, sequence: null, label: null, integrityState: 'missing_active_placement' } });
    renderPage();
    await ready();
    const overview = panel('Overview');
    expect(overview.queryByText(/RV-ALOT/)).toBeNull();
    expect(overview.getByText(/Downstream readiness must not be assumed/)).toBeTruthy();
    // No repair action is offered here, because none exists.
    expect(overview.queryByRole('button')).toBeNull();
  });
});

describe('S1.6.6 classification', () => {
  it('shows the current classification, method and confidence', async () => {
    renderPage();
    await ready();
    expect(factValue('Classification', 'Current classification')).toBe('Sealed');
    expect(factValue('Classification', 'Method')).toBe('rule');
    expect(factValue('Classification', 'Confidence')).toBe('1');
  });

  it('keeps the append-only history and the owner reason attached to its own row', async () => {
    renderPage();
    await ready();
    expect(panel('Classification').getByText(/Sealed · owner_override .* owner inspected the sealed case/)).toBeTruthy();
  });

  it('offers the classifier to an operator and the override to nobody but an owner', async () => {
    role = 'operator';
    renderPage();
    await ready();
    expect(screen.getByRole('button', { name: 'Run governed classifier' })).toBeTruthy();
    expect(screen.queryByLabelText('Owner classification override')).toBeNull();
  });

  it('collects the override reason in a real labelled field, never a browser prompt', async () => {
    const prompt = vi.spyOn(window, 'prompt' as never);
    renderPage();
    await ready();
    const field = screen.getByLabelText('Required reason');
    expect(field.tagName).toBe('TEXTAREA');
    fireEvent.change(field, { target: { value: 'owner saw a slab' } });
    fireEvent.submit(screen.getByLabelText('Owner classification override'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'override')).toBeTruthy());
    expect(prompt).not.toHaveBeenCalled();
  });

  it('refuses an override with no reason and sends nothing', async () => {
    renderPage();
    await ready();
    fireEvent.submit(screen.getByLabelText('Owner classification override'));
    expect(await screen.findByText('An override reason is required.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('states an explicit pending state while the classifier runs', async () => {
    holdFns.add('classify');
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Run governed classifier' }));
    expect(await screen.findByText('Running the governed classifier…')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Run governed classifier' }).getAttribute('aria-busy'),
    ).toBe('true');
    releases.forEach((r) => r());
  });

  // Classification carries no idempotency key, so it has no unconfirmed-outcome
  // hazard and must not be blocked by an unrelated unresolved payment.
  it('stays usable while an unrelated governed operation is unresolved', async () => {
    outcomes = { recordPayment: [failure()] };
    renderPage();
    await ready();
    await startPayment();
    await waitFor(() => expect(screen.getByText('Retry exact request')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Run governed classifier' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('S1.6.6 downstream eligibility', () => {
  const openConfirmation = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from downstream workflows' }));

  it('says included or excluded in words rather than by colour', async () => {
    renderPage();
    await ready();
    const pill = panel('Downstream eligibility').getByText('Included');
    expect(pill.textContent).toBe('Included');
  });

  it('names the consequence and the preservation of source evidence', async () => {
    renderPage();
    await ready();
    openConfirmation();
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('stops this acquisition line being used in downstream receiving');
    expect(dialog.textContent).toContain('does not delete or rewrite the source acquisition evidence');
  });

  it('states whether the decision can be undone', async () => {
    renderPage();
    await ready();
    openConfirmation();
    expect(screen.getByRole('dialog').textContent).toContain('reversible');
  });

  it('identifies exactly which record is affected', async () => {
    renderPage();
    await ready();
    openConfirmation();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(LINE)).toBeTruthy();
    expect(dialog.getByText(SOURCE)).toBeTruthy();
  });

  it('offers a cancel that sends nothing', async () => {
    renderPage();
    await ready();
    openConfirmation();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('withholds the control from an operator', async () => {
    role = 'operator';
    renderPage();
    await ready();
    expect(screen.queryByRole('button', { name: 'Exclude from downstream workflows' })).toBeNull();
  });

  it('closes only for its OWN confirmed operation', async () => {
    holdFns.add('recordPayment');
    renderPage();
    await ready();
    openConfirmation();
    fireEvent.change(screen.getByLabelText(/Eligibility decision reason/), { target: { value: 'half typed' } });
    // A payment resolving must not discard a half-typed eligibility decision.
    await startPayment();
    await waitFor(() => expect(calls.find((c) => c.fn === 'recordPayment')).toBeTruthy());
    releases.forEach((r) => r());
    await waitFor(() => expect(screen.getByText(/Payment recorded/)).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText(/Eligibility decision reason/) as HTMLTextAreaElement).value).toBe('half typed');
  });
});

describe('S1.6.6 money truth', () => {
  it('shows a single-currency total qualified by its currency', async () => {
    renderPage();
    await ready();
    expect(factValue('Financial', 'Recorded active total')).toBe('USD 15.00');
  });

  it('produces NO combined total across mixed currencies', async () => {
    detail = makeDetail({
      payments: [makePayment(), makePayment({ publicId: 'RV-APAY-BBB222', currency: 'EUR', amountMinor: 2000 })],
      paymentSummary: {
        activeCount: 2,
        activeCurrencies: ['USD', 'EUR'],
        mixedCurrencies: true,
        activeTotalMinor: null,
        sourceReportedTotalMinor: 5000,
        differenceMinor: null,
      },
    });
    renderPage();
    await ready();
    const financial = panel('Financial');
    expect(factValue('Financial', 'Recorded active total')).toBe('Mixed currencies — no combined total');
    // No difference is computed across currencies, and no total is invented.
    expect(financial.queryByText('Payment difference')).toBeNull();
    expect(financial.queryByText('USD 35.00')).toBeNull();
  });

  it('reads an absent total as unrecorded rather than as zero', async () => {
    detail = makeDetail({
      payments: [],
      paymentSummary: {
        activeCount: 0,
        activeCurrencies: [],
        mixedCurrencies: false,
        activeTotalMinor: null,
        sourceReportedTotalMinor: 5000,
        differenceMinor: null,
      },
    });
    renderPage();
    await ready();
    const financial = panel('Financial');
    expect(factValue('Financial', 'Recorded active total')).toBe('No active recorded total');
    expect(financial.queryByText('USD 0.00')).toBeNull();
  });

  it('shows an authoritative zero count as a zero', async () => {
    detail = makeDetail({
      payments: [],
      paymentSummary: {
        activeCount: 0,
        activeCurrencies: [],
        mixedCurrencies: false,
        activeTotalMinor: null,
        sourceReportedTotalMinor: null,
        differenceMinor: null,
      },
    });
    renderPage();
    await ready();
    expect(factValue('Financial', 'Active payments')).toBe('0');
  });

  it('renders money and counts with tabular numerals', async () => {
    renderPage();
    await ready();
    expect(panel('Financial').getAllByText('USD 15.00')[0].className).toContain('tabular-nums');
    expect(panel('Overview').getByText('2').className).toContain('tabular-nums');
  });

  it('preserves the source-reported total and the comparable difference', async () => {
    renderPage();
    await ready();
    const financial = panel('Financial');
    expect(factValue('Financial', 'Source-reported total')).toBe('USD 50.00');
    expect(financial.getByText('Payment difference')).toBeTruthy();
    expect(factValue('Financial', 'Payment difference')).toBe('USD 35.00');
  });
});

describe('S1.6.6 payments and reversal', () => {
  it('keeps every recorded payment fact', async () => {
    detail = makeDetail({
      payments: [makePayment({ externalReference: 'EXT-9', evidenceNote: 'screenshot on file' })],
    });
    renderPage();
    await ready();
    const financial = panel('Financial');
    expect(financial.getByText('RV-APAY-AAA111')).toBeTruthy();
    expect(factValue('Financial', 'External reference')).toBe('EXT-9');
    expect(financial.getByText(/screenshot on file/)).toBeTruthy();
    // "card" is also an option in the record-payment form, so the recorded
    // instrument is asserted by count rather than by uniqueness.
    expect(financial.getAllByText('card').length).toBeGreaterThan(1);
    expect(financial.getByText('active')).toBeTruthy();
  });

  it('inserts no optimistic payment row before the server confirms', async () => {
    holdFns.add('recordPayment');
    renderPage();
    await ready();
    await startPayment();
    await waitFor(() => expect(calls.find((c) => c.fn === 'recordPayment')).toBeTruthy());
    // Still exactly the one payment the authoritative record contains.
    expect(panel('Financial').getAllByText(/RV-APAY-/)).toHaveLength(1);
    expect(panel('Financial').queryByText('USD 12.34')).toBeNull();
    releases.forEach((r) => r());
  });

  it('gives reversal to an owner only', async () => {
    role = 'operator';
    renderPage();
    await ready();
    expect(screen.queryByText('Reverse (preserve history)')).toBeNull();
  });

  it('states that a reversal preserves evidence and is not a deletion', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByText('Reverse (preserve history)'));
    const dialog = screen.getByRole('dialog').textContent ?? '';
    expect(dialog).toContain('preserved');
    expect(dialog).toContain('this is not a deletion');
  });

  it('names the exact payment being reversed', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByText('Reverse (preserve history)'));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('RV-APAY-AAA111')).toBeTruthy();
    expect(dialog.getByText('USD 15.00')).toBeTruthy();
  });

  it('requires a reversal reason and sends nothing without one', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByText('Reverse (preserve history)'));
    fireEvent.click(screen.getByText('Confirm reversal'));
    expect(await screen.findByText('A reversal reason is required.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('keeps the reversal history with actor, time and reason', async () => {
    detail = makeDetail({
      payments: [
        makePayment({
          state: 'reversed',
          reversedAt: '2026-08-04T00:00:00.000Z',
          reversalReason: 'duplicate charge',
          reversalEvent: {
            publicId: 'RV-APREV-1',
            actorId: 'user-1',
            reversedAt: '2026-08-04T00:00:00.000Z',
            reason: 'duplicate charge',
          },
        }),
      ],
    });
    renderPage();
    await ready();
    const financial = panel('Financial');
    expect(financial.getByText('Reversal history')).toBeTruthy();
    expect(financial.getByText('duplicate charge')).toBeTruthy();
    expect(financial.getByText(/actor user-1/)).toBeTruthy();
    // A reversed payment offers no second reversal.
    expect(financial.queryByText('Reverse (preserve history)')).toBeNull();
  });
});

describe('S1.6.6 shipments', () => {
  it('keeps every recorded shipment fact', async () => {
    detail = makeDetail({
      shipments: [makeShipment({ shippedAt: '2026-08-02T00:00:00.000Z', evidenceNote: 'label scan' })],
    });
    renderPage();
    await ready();
    const shipments = panel('Inbound shipments');
    expect(shipments.getByText('RV-ASHIP-BBB222')).toBeTruthy();
    expect(shipments.getByText('USPS Priority Mail')).toBeTruthy();
    expect(shipments.getByText('9400 1234-5678')).toBeTruthy();
    expect(shipments.getByText('USD 4.50')).toBeTruthy();
    expect(shipments.getByText('label scan')).toBeTruthy();
  });

  // The distinction this panel exists to protect.
  it('states that delivered is not receiving', async () => {
    detail = makeDetail({ shipments: [makeShipment({ status: 'delivered', receivedAt: '2026-08-05T00:00:00.000Z', allowedNextTransitions: [] })] });
    renderPage();
    await ready();
    const shipments = screen.getByLabelText('Inbound shipments').textContent ?? '';
    expect(shipments).toContain('carrier-reported arrival');
    expect(shipments).toContain('not mean the shipment has been physically reconciled');
    expect(shipments).toContain('governed receiving is complete');
  });

  it('offers no receiving workflow because a shipment says delivered', async () => {
    detail = makeDetail({ shipments: [makeShipment({ status: 'delivered', receivedAt: '2026-08-05T00:00:00.000Z', allowedNextTransitions: [] })] });
    renderPage();
    await ready();
    expect(screen.queryByRole('button', { name: /receive/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /check in/i })).toBeNull();
  });

  it('offers only the transitions the server allows', async () => {
    detail = makeDetail({ shipments: [makeShipment({ status: 'in_transit', allowedNextTransitions: ['delivered'] })] });
    renderPage();
    await ready();
    const shipments = panel('Inbound shipments');
    expect(shipments.getByRole('button', { name: 'delivered' })).toBeTruthy();
    expect(shipments.queryByRole('button', { name: 'lost' })).toBeNull();
    expect(shipments.queryByRole('button', { name: 'cancelled' })).toBeNull();
  });

  it('offers no transition at all when the server allows none', async () => {
    detail = makeDetail({ shipments: [makeShipment({ status: 'cancelled', allowedNextTransitions: [] })] });
    renderPage();
    await ready();
    expect(panel('Inbound shipments').queryByRole('button', { name: 'delivered' })).toBeNull();
  });

  it('carries the expected status as a compare-and-set on a transition', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'in transit' }));
    fireEvent.click(screen.getByText('Confirm transition'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'transitionShipment')).toBeTruthy());
    expect((calls[0].args[2] as Record<string, unknown>).expectedStatus).toBe('expected');
  });

  it('makes transition direction intelligible in text', async () => {
    detail = makeDetail({
      shipments: [
        makeShipment({
          status: 'in_transit',
          allowedNextTransitions: ['delivered'],
          transitionHistory: [
            {
              publicId: 'RV-ASTRAN-1',
              fromStatus: 'expected',
              toStatus: 'in_transit',
              applied: true,
              receivedAt: null,
              reason: null,
              actorId: 'user-1',
              createdAt: '2026-08-03T00:00:00.000Z',
            },
          ],
        }),
      ],
    });
    renderPage();
    await ready();
    expect(panel('Inbound shipments').getByText(/changed from expected to in transit/)).toBeTruthy();
  });

  it('inserts no optimistic shipment before the server confirms', async () => {
    holdFns.add('createShipment');
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText('Carrier'), { target: { value: 'DHL' } });
    fireEvent.submit(screen.getByLabelText('Create shipment'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'createShipment')).toBeTruthy());
    expect(panel('Inbound shipments').getAllByText(/RV-ASHIP-/)).toHaveLength(1);
    releases.forEach((r) => r());
  });

  // A stale expected status is KNOWN-wrong. Replaying it under the same key
  // would be meaningless, so it is never retained for a blind retry.
  it('retains no retry for a stale transition and mints a new key on the next one', async () => {
    outcomes = { transitionShipment: [new AcquisitionDetailError('stale_status', 409)] };
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'in transit' }));
    fireEvent.click(screen.getByText('Confirm transition'));
    await waitFor(() => expect(screen.getByText(/Shipment changed elsewhere/)).toBeTruthy());
    expect(screen.queryByText('Retry exact request')).toBeNull();
    expect(screen.queryByText('Stop retrying and verify')).toBeNull();

    const first = (calls[0].args[2] as Record<string, unknown>).idempotencyKey;
    fireEvent.click(screen.getByRole('button', { name: 'in transit' }));
    fireEvent.click(screen.getByText('Confirm transition'));
    await waitFor(() => expect(calls.filter((c) => c.fn === 'transitionShipment')).toHaveLength(2));
    expect((calls[1].args[2] as Record<string, unknown>).idempotencyKey).not.toBe(first);
  });

  it('re-reads the authoritative shipment state after a stale transition', async () => {
    outcomes = { transitionShipment: [new AcquisitionDetailError('stale_status', 409)] };
    renderPage();
    await ready();
    const before = detailCalls.length;
    fireEvent.click(screen.getByRole('button', { name: 'in transit' }));
    fireEvent.click(screen.getByText('Confirm transition'));
    await waitFor(() => expect(detailCalls.length).toBeGreaterThan(before));
  });
});

describe('S1.6.6 unresolved governed operation', () => {
  it('retains the exact operation object on an unconfirmed payment', async () => {
    outcomes = { recordPayment: [failure()] };
    renderPage();
    await ready();
    await startPayment();
    await waitFor(() => expect(screen.getByText('Retry exact request')).toBeTruthy());

    const first = calls.filter((c) => c.fn === 'recordPayment')[0];
    fireEvent.click(screen.getByText('Retry exact request'));
    await waitFor(() => expect(calls.filter((c) => c.fn === 'recordPayment')).toHaveLength(2));
    const second = calls.filter((c) => c.fn === 'recordPayment')[1];

    // Same workspace, same target, same payload, same key. Byte for byte.
    expect(second.args).toEqual(first.args);
    const firstBody = first.args[2] as Record<string, unknown>;
    const secondBody = second.args[2] as Record<string, unknown>;
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);
    expect(secondBody.amountMinor).toBe(1234);
  });

  it('reuses the source qualification on a retried eligibility decision', async () => {
    outcomes = { exclude: [failure()] };
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from downstream workflows' }));
    fireEvent.change(screen.getByLabelText(/Eligibility decision reason/), { target: { value: 'not resale stock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('Retry exact request')).toBeTruthy());

    const first = calls.filter((c) => c.fn === 'exclude')[0];
    fireEvent.click(screen.getByText('Retry exact request'));
    await waitFor(() => expect(calls.filter((c) => c.fn === 'exclude')).toHaveLength(2));
    expect(calls.filter((c) => c.fn === 'exclude')[1].args).toEqual(first.args);
    expect(first.args[1]).toBe(SOURCE);
  });

  it('blocks a different coordinated mutation while one is unresolved', async () => {
    outcomes = { recordPayment: [failure()] };
    renderPage();
    await ready();
    await startPayment();
    await waitFor(() => expect(screen.getByText('Retry exact request')).toBeTruthy());

    fireEvent.submit(screen.getByLabelText('Create shipment'));
    await waitFor(() => expect(screen.getByText(/Resolve the unconfirmed payment first/)).toBeTruthy());
    expect(calls.filter((c) => c.fn === 'createShipment')).toHaveLength(0);
  });

  // An unresolved consequential operation is the most urgent thing on the page.
  // It must not sit below the coverage notice, which never changes.
  it('puts the unresolved-operation notice above the standing coverage notice', async () => {
    outcomes = { recordPayment: [failure()] };
    renderPage();
    await ready();
    await startPayment();
    await waitFor(() => expect(screen.getByText('Retry exact request')).toBeTruthy());

    const notice = screen.getByRole('alert');
    const coverage = screen.getByLabelText('Governed coverage');
    // eslint-disable-next-line no-bitwise
    expect(notice.compareDocumentPosition(coverage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('explains why an exact retry is safe without exposing the key', async () => {
    outcomes = { recordPayment: [failure()] };
    renderPage();
    await ready();
    await startPayment();
    await waitFor(() => expect(screen.getByText('Retry exact request')).toBeTruthy());

    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain('Payment was not confirmed');
    expect(notice.textContent).toContain('same key');
    expect(notice.textContent).toContain('cannot record it twice');
    expect(notice.textContent).toContain('No other payment, reversal, shipment, transition or eligibility decision');
    // The idempotency key is machinery, not evidence.
    const key = (calls[0].args[2] as Record<string, string>).idempotencyKey;
    expect(notice.textContent).not.toContain(key);
  });
});

// ---------------------------------------------------------------------------
// THE LOAD-BEARING REGRESSION.
//
// Every test in this block fails against the pre-S1.6.6 implementation, whose
// discard path asserted "Unconfirmed request discarded. Nothing was sent."
describe('S1.6.6 unknown outcome — the false discard guarantee', () => {
  async function unresolvedPayment() {
    outcomes = { recordPayment: [failure()] };
    renderPage();
    await ready();
    await startPayment();
    await waitFor(() => expect(screen.getByText('Stop retrying and verify')).toBeTruthy());
  }

  it('never tells the operator that nothing was sent', async () => {
    await unresolvedPayment();
    fireEvent.click(screen.getByText('Stop retrying and verify'));
    // Waits for the RESOLVED state, not for the button label to change.
    // While the authoritative re-read is in flight the control reads
    // "Verifying…", so a wait keyed on the old label passes the instant the
    // click lands — before the outcome exists. That raced green locally and
    // failed on a slower CI runner, which is exactly the kind of test that
    // looks like a product bug when it finally breaks.
    await waitFor(() => expect(screen.queryByText(/still unknown|Verification failed/)).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('Stop retrying and verify')).toBeNull());
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('Nothing was sent');
    expect(body).not.toContain('discarded');
  });

  it('never claims the operation definitely failed or definitely succeeded', async () => {
    await unresolvedPayment();
    fireEvent.click(screen.getByText('Stop retrying and verify'));
    // Waits for the RESOLVED state, not for the button label to change.
    // While the authoritative re-read is in flight the control reads
    // "Verifying…", so a wait keyed on the old label passes the instant the
    // click lands — before the outcome exists. That raced green locally and
    // failed on a slower CI runner, which is exactly the kind of test that
    // looks like a product bug when it finally breaks.
    await waitFor(() => expect(screen.queryByText(/still unknown|Verification failed/)).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('Stop retrying and verify')).toBeNull());
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/payment (failed|succeeded)/i);
    expect(body).not.toMatch(/nothing (was )?(changed|committed)/i);
  });

  it('states that the outcome remains unknown after stopping', async () => {
    await unresolvedPayment();
    fireEvent.click(screen.getByText('Stop retrying and verify'));
    expect(await screen.findByText(/still unknown/)).toBeTruthy();
    expect(screen.getByText(/may have committed without returning a response/)).toBeTruthy();
    expect(screen.getByText(/inspect it before submitting a replacement/)).toBeTruthy();
  });

  it('re-reads the authoritative record before unlocking anything', async () => {
    await unresolvedPayment();
    const before = detailCalls.length;
    fireEvent.click(screen.getByText('Stop retrying and verify'));
    // Waits for the RESOLVED state, not for the button label to change.
    // While the authoritative re-read is in flight the control reads
    // "Verifying…", so a wait keyed on the old label passes the instant the
    // click lands — before the outcome exists. That raced green locally and
    // failed on a slower CI runner, which is exactly the kind of test that
    // looks like a product bug when it finally breaks.
    await waitFor(() => expect(screen.queryByText(/still unknown|Verification failed/)).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('Stop retrying and verify')).toBeNull());
    expect(detailCalls.length).toBeGreaterThan(before);
  });

  it('stays locked when the verifying re-read fails', async () => {
    await unresolvedPayment();
    detailFails = failure();
    fireEvent.click(screen.getByText('Stop retrying and verify'));

    expect(await screen.findByText(/Verification failed/)).toBeTruthy();
    // The unresolved notice — and the lock it carries — is still on screen.
    expect(screen.getByText('Stop retrying and verify')).toBeTruthy();
    expect(screen.getByText('Retry exact request')).toBeTruthy();
    expect(screen.getByText(/outcome remains unknown and the current record could not be confirmed/)).toBeTruthy();
  });

  it('refuses a replacement operation while verification has failed', async () => {
    await unresolvedPayment();
    detailFails = failure();
    fireEvent.click(screen.getByText('Stop retrying and verify'));
    await screen.findByText(/Verification failed/);

    const before = calls.length;
    fireEvent.submit(screen.getByLabelText('Create shipment'));
    await waitFor(() => expect(screen.getByText(/Resolve the unconfirmed payment first/)).toBeTruthy());
    expect(calls).toHaveLength(before);
  });

  it('clears the retained retry once the re-read succeeds, and only then', async () => {
    await unresolvedPayment();
    detailFails = failure();
    fireEvent.click(screen.getByText('Stop retrying and verify'));
    await screen.findByText(/Verification failed/);

    // The record becomes readable again; stopping now resolves.
    detailFails = null;
    fireEvent.click(screen.getByText('Stop retrying and verify'));
    // Waits for the RESOLVED state, not for the button label to change.
    // While the authoritative re-read is in flight the control reads
    // "Verifying…", so a wait keyed on the old label passes the instant the
    // click lands — before the outcome exists. That raced green locally and
    // failed on a slower CI runner, which is exactly the kind of test that
    // looks like a product bug when it finally breaks.
    await waitFor(() => expect(screen.queryByText(/still unknown|Verification failed/)).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('Stop retrying and verify')).toBeNull());
    expect(screen.getByText(/still unknown/)).toBeTruthy();

    fireEvent.submit(screen.getByLabelText('Create shipment'));
    await waitFor(() => expect(calls.filter((c) => c.fn === 'createShipment')).toHaveLength(1));
  });

  it('keeps the retry available and exact after a failed verification', async () => {
    await unresolvedPayment();
    detailFails = failure();
    fireEvent.click(screen.getByText('Stop retrying and verify'));
    await screen.findByText(/Verification failed/);

    detailFails = null;
    const first = calls.filter((c) => c.fn === 'recordPayment')[0];
    fireEvent.click(screen.getByText('Retry exact request'));
    await waitFor(() => expect(calls.filter((c) => c.fn === 'recordPayment')).toHaveLength(2));
    expect(calls.filter((c) => c.fn === 'recordPayment')[1].args).toEqual(first.args);
  });
});

describe('S1.6.6 mutation feedback', () => {
  it('names the record that changed rather than saying only "Saved"', async () => {
    renderPage();
    await ready();
    await startPayment();
    expect(await screen.findByText('Payment recorded and the governed detail was re-read.')).toBeTruthy();
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it.each([
    ['shipment', async () => fireEvent.submit(screen.getByLabelText('Create shipment')), 'Shipment created and the governed detail was re-read.'],
    [
      'eligibility decision',
      async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Exclude from downstream workflows' }));
        fireEvent.change(screen.getByLabelText(/Eligibility decision reason/), { target: { value: 'not resale stock' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      },
      'Eligibility decision confirmed and the governed detail was re-read.',
    ],
  ])('gives a %s its own bounded confirmation', async (_label, start, expected) => {
    renderPage();
    await ready();
    await start();
    expect(await screen.findByText(expected)).toBeTruthy();
  });

  // A mutation response is authoritative; a re-read that failed is not a
  // refresh. Presenting the stale record as confirmed would be the same class
  // of lie the recovery flow exists to remove.
  it('refuses to present an unverified record as a refreshed one', async () => {
    renderPage();
    await ready();
    detailFails = failure();
    await startPayment();
    expect(await screen.findByText(/could not be verified afterwards/)).toBeTruthy();
    expect(screen.getByText(/may not reflect the confirmed change/)).toBeTruthy();
    expect(screen.queryByText('Payment recorded and the governed detail was re-read.')).toBeNull();
  });
});

describe('S1.6.6 fixed transactional surface', () => {
  it('offers no customization, widget, or layout control', async () => {
    renderPage();
    await ready();
    for (const name of [/customize/i, /customise/i, /add widget/i, /widget catalog/i, /edit layout/i, /reorder/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(document.querySelector('[data-widget]')).toBeNull();
  });
});

describe('S1.6.6 responsive and accessible architecture', () => {
  // jsdom does not lay out, so these assert the class-level architecture and
  // the presence of evidence — never real geometry, which is S1.6.7's job.
  it('gives every major section an intentional responsive fact layout', async () => {
    renderPage();
    await ready();
    for (const name of ['Overview', 'Classification', 'Downstream eligibility', 'Financial', 'Inbound shipments', 'Source evidence']) {
      const section = screen.getByLabelText(name);
      expect(section.querySelector('[class*="sm:grid-cols"], [class*="lg:grid-cols"], [class*="xl:grid-cols"]')).toBeTruthy();
    }
  });

  it('keeps long identifiers and tracking numbers wrappable', async () => {
    renderPage();
    await ready();
    expect(panel('Overview').getByText('RV-ACQ-AAA111').className).toContain('break-all');
    expect(panel('Inbound shipments').getByText('9400 1234-5678').className).toContain('break-all');
  });

  it('omits no critical history or provenance at any width', async () => {
    detail = makeDetail({
      exclusion: {
        state: 'excluded',
        current: {
          publicId: 'RV-AEXCL-1',
          state: 'excluded',
          reason: 'not resale stock',
          actorId: 'user-1',
          createdAt: '2026-08-03T00:00:00.000Z',
          supersededAt: null,
        },
        history: [
          {
            publicId: 'RV-AEXCL-1',
            state: 'excluded',
            reason: 'not resale stock',
            actorId: 'user-1',
            createdAt: '2026-08-03T00:00:00.000Z',
            supersededAt: null,
          },
        ],
      },
    });
    renderPage();
    await ready();
    // No history or provenance is behind a responsive hide.
    for (const name of ['Classification', 'Downstream eligibility', 'Source evidence']) {
      const section = screen.getByLabelText(name);
      expect(section.querySelector('[class*="hidden"], [class*=":hidden"]')).toBeNull();
    }
    expect(panel('Downstream eligibility').getByText(/Excluded from downstream workflows · not resale stock/)).toBeTruthy();
  });

  it('keeps every action reachable and touch-sized', async () => {
    renderPage();
    await ready();
    for (const name of ['Run governed classifier', 'Exclude from downstream workflows', 'Add payment', 'Create shipment']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).toMatch(/min-h-(9|11)/);
    }
  });

  it('gives every panel a real heading and accessible name', async () => {
    renderPage();
    await ready();
    for (const name of ['Overview', 'Classification', 'Downstream eligibility', 'Financial', 'Inbound shipments', 'Source evidence']) {
      const section = screen.getByLabelText(name);
      expect(within(section).getAllByRole('heading', { level: 2 })[0].textContent).toBe(name);
    }
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('gives the governed confirmation an accessible name and a focusable panel', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from downstream workflows' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('Exclude from downstream workflows');
  });

  it('carries status in words, never in colour alone', async () => {
    renderPage();
    await ready();
    // Every status pill has visible text; none is an empty coloured chip.
    for (const pill of Array.from(document.querySelectorAll('[data-tone]'))) {
      expect((pill.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });
});

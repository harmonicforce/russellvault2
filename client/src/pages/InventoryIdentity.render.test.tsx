// @vitest-environment jsdom
//
// S1.6.3 rendered acceptance for the Inventory Identity diagnostic surface,
// the proof migration for the new primitives.
//
// TWO JOBS
//
// 1. Prove the page's existing behaviour is UNCHANGED: the same transports are
//    called with the same arguments, the same facts are displayed, and nothing
//    on the surface mutates anything.
// 2. Prove the primitives are actually wired: the disabled build reports a
//    configuration state rather than a failure, a rejected lookup reports a
//    bounded error, and the lot list can now tell an authoritative zero from a
//    failed read.
//
// Everything is asserted against the rendered DOM. Nothing reads page source.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InventoryIdentity from './InventoryIdentity';
import type { IdentityRecord } from '../lib/inventoryIdentity';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

let enabled: boolean;
let calls: Array<{ fn: string; args: unknown[] }>;
let lots: IdentityRecord[];
let lotsRejection: Error | null;
let lookupRejection: Error | null;

vi.mock('../lib/provenanceConfig', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getProvenanceUiConfig: () =>
    enabled ? { mode: 'repository-fixtures', url: 'https://shadow.test', anonKey: 'anon' } : null,
}));

vi.mock('../lib/supabaseShadow', () => ({
  createShadowClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } }),
}));

vi.mock('../lib/inventoryIdentityApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createInventoryIdentityTransport: () => ({
    listLots: (...args: unknown[]) => {
      calls.push({ fn: 'listLots', args });
      return lotsRejection ? Promise.reject(lotsRejection) : Promise.resolve(lots);
    },
    lookupPublicId: (...args: unknown[]) => {
      calls.push({ fn: 'lookupPublicId', args });
      return lookupRejection
        ? Promise.reject(lookupRejection)
        : Promise.resolve({ kind: 'lot', record: lots[0] ?? { id: 'l1', public_id: 'RV-C-0001' } });
    },
    lookupScan: (...args: unknown[]) => {
      calls.push({ fn: 'lookupScan', args });
      return lookupRejection
        ? Promise.reject(lookupRejection)
        : Promise.resolve({
            kind: 'item',
            record: { id: 'i1', public_id: 'RV-ITEM-0001', scan_sku: 'RV-7K3F9Q2' },
          });
    },
    lotDetail: (...args: unknown[]) => {
      calls.push({ fn: 'lotDetail', args });
      return Promise.resolve({
        product: { public_id: 'RV-PROD-0001' },
        sku: { public_id: 'RV-SKU-0001' },
        lot: { public_id: 'RV-C-0001', quantity: 6 },
        location: { public_id: 'RV-LOC-0001' },
        serializedChildCount: 0,
        capacity: null,
        atCapacity: false,
      });
    },
    itemDetail: (...args: unknown[]) => {
      calls.push({ fn: 'itemDetail', args });
      return Promise.resolve({
        product: { public_id: 'RV-PROD-0001' },
        sku: { public_id: 'RV-SKU-0001' },
        lot: { public_id: 'RV-C-0001' },
        item: { public_id: 'RV-ITEM-0001', scan_sku: 'RV-7K3F9Q2' },
        location: { public_id: 'RV-LOC-0001' },
      });
    },
  }),
}));

beforeEach(() => {
  enabled = true;
  calls = [];
  lotsRejection = null;
  lookupRejection = null;
  lots = [
    { id: 'l1', public_id: 'RV-C-0001', tracking_mode: 'lot_managed', quantity: 6, record_origin: 'import' },
    { id: 'l2', public_id: 'RV-S-0002', tracking_mode: 'serialized', quantity: 1, record_origin: 'intake' },
  ];
});

afterEach(cleanup);

const setWorkspace = () =>
  fireEvent.change(screen.getByLabelText(/Workspace id/), { target: { value: WORKSPACE } });

const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('InventoryIdentity — preserved behaviour', () => {
  it('reports a disabled build as a configuration state, not as a failure', () => {
    enabled = false;
    render(<InventoryIdentity />);
    expect(text()).toMatch(/not enabled in this build/i);
    // Same fact the page always reported; now it says configuration rather
    // than implying breakage.
    expect(text()).toMatch(/Nothing has failed/i);
    expect(screen.queryByRole('button', { name: 'Load lots' })).toBeNull();
  });

  it('renders the staging notice and the read-only scope statement verbatim', () => {
    render(<InventoryIdentity />);
    expect(text()).toMatch(/Staging \/ non-authoritative/);
    expect(text()).toMatch(/imported source evidence for review only/);
    expect(text()).toMatch(/Read-only\. This is a diagnostic surface/);
  });

  it('still exposes all five diagnostic panels', () => {
    render(<InventoryIdentity />);
    for (const heading of [
      /Exact public-id lookup/,
      /Exact unit scan-SKU search/,
      /Lot identity list/,
      /Lot identity chain/,
      /Item identity chain/,
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('resolves a public id through the same transport call', async () => {
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.change(screen.getByLabelText(/Public id/), { target: { value: 'RV-C-0001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(calls).toContainEqual({ fn: 'lookupPublicId', args: [WORKSPACE, 'RV-C-0001'] }));
    await screen.findByText('Inventory Lot');
  });

  it('searches a unit scan SKU through the same transport call', async () => {
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.change(screen.getByLabelText(/Unit scan SKU/), { target: { value: 'RV-7K3F9Q2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find item' }));
    await waitFor(() => expect(calls).toContainEqual({ fn: 'lookupScan', args: [WORKSPACE, 'RV-7K3F9Q2'] }));
    await waitFor(() => expect(text()).toMatch(/RV-7K3F9Q2/));
  });

  it('loads lots with the unchanged limit and offset', async () => {
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Load lots' }));
    await waitFor(() => expect(calls).toContainEqual({ fn: 'listLots', args: [WORKSPACE, 50, 0] }));
  });

  it('loads a lot identity chain and renders the same grains and capacity', async () => {
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.change(screen.getByLabelText(/Lot internal id/), { target: { value: 'l1' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Load chain' })[0]);
    await waitFor(() => expect(calls).toContainEqual({ fn: 'lotDetail', args: [WORKSPACE, 'l1'] }));
    await screen.findByText('Product Catalog');
    expect(text()).toMatch(/Storage Location/);
    expect(text()).toMatch(/Capacity: lot-managed \(6\)/);
  });

  it('loads an item identity chain by internal id', async () => {
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.change(screen.getByLabelText(/Item internal id/), { target: { value: 'i1' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Load chain' })[1]);
    await waitFor(() => expect(calls).toContainEqual({ fn: 'itemDetail', args: [WORKSPACE, 'i1'] }));
    await screen.findByText('Serialized Item');
    expect(text()).toMatch(/Scan SKU: RV-7K3F9Q2/);
  });

  // The page's defining guarantee.
  it('offers no mutation control anywhere on the surface', () => {
    render(<InventoryIdentity />);
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    for (const name of names) {
      expect(name).not.toMatch(/save|delete|void|adjust|move|correct|submit|apply/i);
    }
  });
});

describe('InventoryIdentity — the primitives it now uses', () => {
  it('marks the page provenance once, not on every row', async () => {
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Load lots' }));
    await screen.findAllByText('RV-C-0001');
    // One authority marker for the surface. Stamping every lot would make the
    // marker meaningless.
    expect(document.querySelectorAll('[data-provenance]')).toHaveLength(1);
    expect(document.querySelector('[data-provenance="imported"]')).toBeTruthy();
  });

  it('renders a failed lookup as a bounded error', async () => {
    lookupRejection = new Error('The governed identity service did not respond.');
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The governed identity service did not respond.');
    expect(alert.textContent).toMatch(/diagnostic lookup failed/i);
  });

  it('renders lots as records carrying every fact the old card showed', async () => {
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Load lots' }));
    await screen.findAllByText('RV-C-0001');
    const list = screen.getByRole('list', { name: 'Lot identity records' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    for (const label of ['Public ID', 'Tracking mode', 'Quantity', 'Record origin']) {
      expect(text()).toMatch(new RegExp(label));
    }
    expect(text()).toMatch(/lot_managed/);
    expect(text()).toMatch(/serialized/);
  });

  // The defect the migration repairs: before this, a workspace with no lots and
  // a lot read that failed both rendered exactly nothing.
  it('distinguishes an authoritative zero from a failed lot read', async () => {
    lots = [];
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Load lots' }));
    await screen.findByText('No lots in this workspace');
    expect(text()).toMatch(/confirmed result, not a failed request/i);

    cleanup();
    calls = [];
    lotsRejection = new Error('The lot read timed out.');
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Load lots' }));
    await waitFor(() => expect(text()).toMatch(/The request failed/i));
    expect(text()).toMatch(/IDENTITY_LOT_LIST_FAILED/);
    expect(text()).not.toMatch(/No lots in this workspace/);
    expect(text()).not.toMatch(/confirmed result, not a failed request/i);
  });

  it('offers a retry that resends the same lot read', async () => {
    lotsRejection = new Error('The lot read timed out.');
    render(<InventoryIdentity />);
    setWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Load lots' }));
    await waitFor(() => expect(text()).toMatch(/The request failed/i));

    lotsRejection = null;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await screen.findAllByText('RV-C-0001');
    expect(calls.filter((c) => c.fn === 'listLots')).toHaveLength(2);
    expect(calls.every((c) => c.fn !== 'listLots' || c.args[0] === WORKSPACE)).toBe(true);
  });

  it('shows nothing about lots until the operator asks', () => {
    render(<InventoryIdentity />);
    // "Not requested yet" is not a truth state, and must not be rendered as one.
    expect(screen.queryByRole('list', { name: 'Lot identity records' })).toBeNull();
    expect(text()).not.toMatch(/No lots in this workspace/);
    expect(text()).not.toMatch(/could not be loaded/i);
  });

  it('gives every diagnostic input a real accessible label', () => {
    render(<InventoryIdentity />);
    for (const label of [/Workspace id/, /Public id/, /Unit scan SKU/, /Lot internal id/, /Item internal id/]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });
});

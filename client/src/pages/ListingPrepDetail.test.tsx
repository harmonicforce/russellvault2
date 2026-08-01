// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ListingPrepDetail from './ListingPrepDetail';
import type {
  ListingPrepTransport, PrepBlocker, PrepRecord, PrepStatus,
} from '../lib/listingPrepApi';

const PREP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SUBJECT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

let role: 'owner' | 'operator' | 'viewer';
let record: PrepRecord;
let calls: Array<{ fn: string; args: unknown[] }>;

vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({
    workspace: { id: 'ws-1', name: 'Vault', role },
    userId: 'user-1',
    client: {},
  }),
}));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));
vi.mock('../lib/mediaApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createMediaTransport: () => ({}),
}));
// The gallery has its own suite; here it is a placeholder so the detail page's
// own behaviour is what is being measured.
vi.mock('../components/MediaGallery', () => ({
  MediaGallery: () => <div data-testid="gallery" />,
}));

const transport = {
  get: async () => record,
  presets: async () => [],
  setCheck: (...args: unknown[]) => { calls.push({ fn: 'setCheck', args }); return Promise.resolve(record); },
  saveContent: (...args: unknown[]) => { calls.push({ fn: 'saveContent', args }); return Promise.resolve(record); },
  transition: (...args: unknown[]) => { calls.push({ fn: 'transition', args }); return Promise.resolve(record); },
  markListed: (...args: unknown[]) => { calls.push({ fn: 'markListed', args }); return Promise.resolve(record); },
  applyPreset: (...args: unknown[]) => { calls.push({ fn: 'applyPreset', args }); return Promise.resolve(record); },
} as unknown as ListingPrepTransport;

vi.mock('../lib/listingPrepApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createListingPrepTransport: () => transport,
}));

function makeRecord(over: Partial<PrepRecord> = {}): PrepRecord {
  return {
    id: PREP, public_id: 'RV-LP-ABC123', subject_kind: 'item', subject_id: SUBJECT,
    subtype: 'raw_card', status: 'in_preparation' as PrepStatus, priority: 'normal',
    assigned_to: null, owner_notes: null, blocked_reason: null,
    content: {
      working_title: 'Blastoise base set', condition_summary: 'Sharp corners',
      description_notes: null, defects_disclosures: null, included_items: null,
      research_notes: null, listing_format: null, quantity_to_list: null,
      currency: 'USD', asking_price_minor: 8500, minimum_price_minor: null,
      shipping_policy_ref: null, return_policy_ref: null,
      package_weight_grams: 90, package_length_mm: 200,
      package_width_mm: 150, package_height_mm: 20,
    },
    listed_at: null, external_listing_ref: null,
    readiness_status: 'needs_condition_review',
    blockers: [
      { code: 'check_condition_assessment', kind: 'condition', label: 'Condition assessed' },
    ] as PrepBlocker[],
    subject_state: 'active',
    identity: {
      public_id: 'RV-ITEM-9001', display_name: 'Blastoise', detail_line: 'RAW-1',
      subtype: 'raw_card', record_state: 'active', is_available: true, quantity: 1,
      tracking_mode: 'serialized', condition_or_grade: null, grading_company: null,
      scan_identifier: 'RV-XYZ', location_code: 'BIN-A', location_display_name: 'Bin A',
      open_correction_count: 0, media_count: 3,
    },
    checks: [
      { requirement_key: 'condition_assessment', label: 'Condition assessed',
        requirement_kind: 'condition', is_required: true, display_order: 1,
        state: 'unknown', note: null, confirmed_by: null, updated_at: null },
      { requirement_key: 'language_confirmed', label: 'Language confirmed',
        requirement_kind: 'identity', is_required: false, display_order: 2,
        state: 'confirmed', note: null, confirmed_by: 'user-1', updated_at: '2026-08-01T00:00:00Z' },
    ],
    events: [
      { id: 'e1', event_type: 'started', from_status: null, to_status: 'not_started',
        actor_id: 'user-1', reason: null, detail: {}, created_at: '2026-08-01T00:00:00Z' },
    ],
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    ...over,
  } as PrepRecord;
}

beforeEach(() => { role = 'owner'; calls = []; record = makeRecord(); });
afterEach(() => cleanup());

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={[`/listing-prep/${PREP}`]}>
      <Routes>
        <Route path="/listing-prep/:prepId" element={<ListingPrepDetail />} />
      </Routes>
    </MemoryRouter>
  );

describe('listing prep detail', () => {
  it('says what is stopping the record being listed, in words', async () => {
    renderDetail();
    const heading = await screen.findByText('What is stopping this being listed');
    // The blocker is stated in the blockers section, not only implied by an
    // unticked box further down the page.
    expect(within(heading.parentElement!).getByText('Condition assessed')).toBeTruthy();
  });

  // The whole point of the checklist: a filled-in field is not a confirmation.
  it('offers the confirmation as an explicit act, not a filled-in field', async () => {
    renderDetail();
    fireEvent.click(await screen.findByLabelText('Confirm Condition assessed'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'setCheck')).toBeTruthy());
    expect(calls.find((c) => c.fn === 'setCheck')!.args.slice(1)).toEqual([
      'condition_assessment', 'confirmed',
    ]);
  });

  it('lets a confirmation be withdrawn', async () => {
    renderDetail();
    fireEvent.click(await screen.findByLabelText('Clear Language confirmed'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'setCheck')).toBeTruthy());
    expect(calls.find((c) => c.fn === 'setCheck')!.args[2]).toBe('unknown');
  });

  // Required scenario: an owner cannot wave a blocked record through.
  it('will not let even an owner mark a blocked record ready to list', async () => {
    renderDetail();
    const button = await screen.findByText('Mark ready to list') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(calls.find((c) => c.fn === 'transition')).toBeUndefined();
  });

  it('enables the owner review only when nothing is outstanding', async () => {
    record = makeRecord({ readiness_status: 'ready', blockers: [] });
    renderDetail();
    const button = await screen.findByText('Mark ready to list') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(calls.find((c) => c.fn === 'transition')?.args[1]).toBe('ready_to_list'));
  });

  it('does not offer the owner-only review to an operator', async () => {
    role = 'operator';
    record = makeRecord({ readiness_status: 'ready', blockers: [] });
    renderDetail();
    expect(await screen.findByText('Send for review')).toBeTruthy();
    expect(screen.queryByText('Mark ready to list')).toBeNull();
  });

  it('gives a viewer the whole record and none of the controls', async () => {
    role = 'viewer';
    renderDetail();
    expect(await screen.findByText('Blastoise')).toBeTruthy();
    expect(screen.getByText(/read-only access/)).toBeTruthy();
    expect(screen.queryByLabelText('Confirm Condition assessed')).toBeNull();
    expect(screen.queryByText('Save listing details')).toBeNull();
  });

  it('demands where it was listed before it will record a listing', async () => {
    record = makeRecord({ status: 'ready_to_list', readiness_status: 'ready', blockers: [] });
    renderDetail();
    const submit = await screen.findByText('Record as listed') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Where did you list it?'), {
      target: { value: 'ebay/998877' },
    });
    fireEvent.click(screen.getByText('Record as listed'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'markListed')?.args[1]).toBe('ebay/998877'));
  });

  // The non-goal, said out loud on the screen where it matters.
  it('says plainly that recording a listing moved no stock', async () => {
    record = makeRecord({
      status: 'listed', readiness_status: 'ready', blockers: [],
      listed_at: '2026-08-01T10:00:00Z', external_listing_ref: 'ebay/998877',
    });
    renderDetail();
    expect(await screen.findByText(/changed no inventory/)).toBeTruthy();
    expect(screen.getByText('ebay/998877')).toBeTruthy();
  });

  it('does not offer to edit a listed record until it is reopened', async () => {
    record = makeRecord({
      status: 'listed', readiness_status: 'ready', blockers: [],
      listed_at: '2026-08-01T10:00:00Z', external_listing_ref: 'ebay/1',
    });
    renderDetail();
    expect(await screen.findByText('Reopen')).toBeTruthy();
    expect(screen.queryByText('Save listing details')).toBeNull();
  });

  it('rejects a price floor above the asking price before sending anything', async () => {
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Lowest acceptable'), { target: { value: '999.00' } });
    fireEvent.click(screen.getByText('Save listing details'));
    expect(await screen.findByText(/cannot be above the asking price/)).toBeTruthy();
    expect(calls.find((c) => c.fn === 'saveContent')).toBeUndefined();
  });

  it('refuses an unreadable price rather than sending a guess', async () => {
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Asking price'), { target: { value: 'about fifty' } });
    fireEvent.click(screen.getByText('Save listing details'));
    expect(await screen.findByText(/Enter the asking price as an amount/)).toBeTruthy();
    expect(calls.find((c) => c.fn === 'saveContent')).toBeUndefined();
  });

  it('sends money as whole minor units, never as a decimal', async () => {
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Asking price'), { target: { value: '24.99' } });
    fireEvent.click(screen.getByText('Save listing details'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'saveContent')).toBeTruthy());
    const patch = calls.find((c) => c.fn === 'saveContent')!.args[1] as Record<string, unknown>;
    expect(patch.asking_price_minor).toBe(2499);
  });

  it('does not ask a single serialized item how many to list', async () => {
    renderDetail();
    await screen.findByText('Package and shipping');
    expect(screen.queryByLabelText('Quantity to list')).toBeNull();
  });

  it('asks a quantity-managed lot how many the listing covers', async () => {
    record = makeRecord({ subject_kind: 'lot' });
    renderDetail();
    expect(await screen.findByLabelText('Quantity to list')).toBeTruthy();
  });

  it('shows the reason a record was blocked where the next person will see it', async () => {
    record = makeRecord({ status: 'blocked', blocked_reason: 'waiting on the grading return' });
    renderDetail();
    expect(await screen.findByText(/waiting on the grading return/)).toBeTruthy();
  });

  it('reports a failed load as a failure, not as an empty record', async () => {
    const failing = { ...transport, get: async () => { throw new Error('That preparation is no longer in this workspace.'); } };
    vi.spyOn(transport, 'get').mockImplementation(failing.get);
    renderDetail();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/no longer in this workspace/)).toBeTruthy();
    vi.restoreAllMocks();
  });
});

// @vitest-environment jsdom
//
// The counting surfaces, driven the way an operator drives them.
//
// The tests that matter most here are the ones about what does NOT happen: an
// untouched quantity field does not become a zero, a duplicate scan does not
// count twice, a blind count does not render an expected quantity, an
// inventory-changing resolution does not fire without confirmation, and a
// terminal count offers no controls at all.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CompletionPanel, DiscrepancyCard, LotQueuePanel, ObservationFeedPanel, ProgressPanel,
  ScanPanel, TerminalBanner,
} from './CycleCountPanels';
import { scanFeedback, type Progress, type Readiness } from '../lib/cycleCount';
import type { DiscrepancyRow, LotQueueRow, ObservationFeedRow } from '../lib/cycleCountApi';

afterEach(cleanup);

const progress = (over: Partial<Progress> = {}): Progress => ({
  expected_item_count: 0, found_item_count: 0, wrong_location_count: 0,
  unexpected_item_count: 0, uncounted_item_count: 0,
  expected_lot_count: 0, counted_lot_count: 0, uncounted_lot_count: 0,
  matched_lot_count: 0, variance_lot_count: 0, observed_zero_lot_count: 0,
  total_observation_count: 0, ...over,
});

const readiness = (over: Partial<Readiness> = {}): Readiness => ({
  status: 'review', can_complete: false, can_complete_with_deferrals: false,
  open_count: 0, recount_requested_count: 0, resolved_count: 0, deferred_count: 0,
  failed_resolution_count: 0, inventory_changing_resolution_count: 0, blockers: [], ...over,
});

const lot = (over: Partial<LotQueueRow> = {}): LotQueueRow => ({
  expected_lot_id: 'e1', lot_id: 'l1', lot_public_id: 'RV-C-0001', display_name: 'Booster Box',
  inventory_subtype: 'sealed_tcg', business_vertical: 'tcg',
  expected_location_code: 'BIN-A', lot_state: 'active',
  expected_quantity: 12, observation_id: null, observed_quantity: null, variance: null,
  observation_note: null, observed_at: null, count_status: 'uncounted', ...over,
});

const discrepancy = (over: Partial<DiscrepancyRow> = {}): DiscrepancyRow => ({
  discrepancy_id: 'd1', public_id: 'RV-CCD-0001', discrepancy_kind: 'lot_shortage',
  status: 'open', expected_quantity: 12, observed_quantity: 9, variance: -3,
  detected_at: '2026-07-30T10:00:00Z', recount_requested_at: null,
  recount_requested_by_email: null, resolved_at: null, resolved_by_email: null,
  deferral_reason: null, subject_public_id: 'RV-C-0001', subject_display_name: 'Booster Box',
  subject_kind: 'lot', item_id: null, lot_id: 'l1',
  certificate_number: null, serial_number: null, grading_company: null,
  expected_location_code: 'BIN-A', observed_location_code: 'BIN-A',
  observations: [], post_snapshot_activity: [], resolutions: [], ...over,
});

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function renderScan(over: Partial<Parameters<typeof ScanPanel>[0]> = {}) {
  const onScan = vi.fn().mockResolvedValue(undefined);
  const props = {
    locations: [{ code: 'BIN-A', label: 'BIN-A — Bin A' }, { code: 'BIN-B', label: 'BIN-B' }],
    locationCode: 'BIN-A',
    onLocationChange: vi.fn(),
    onScan,
    feedback: null,
    busy: false,
    dialogOpen: false,
    ...over,
  };
  const view = render(<ScanPanel {...props} />);
  return { view, onScan, props };
}

describe('the scan panel', () => {
  it('gives the scan field focus on arrival, so a wedge scanner just works', () => {
    renderScan();
    expect(document.activeElement).toBe(screen.getByLabelText('Scan or type an identifier'));
  });

  it('submits on Enter and clears the field afterwards', async () => {
    const user = userEvent.setup();
    const { onScan } = renderScan();
    const field = screen.getByLabelText('Scan or type an identifier');
    await user.type(field, 'CERT-1{Enter}');
    expect(onScan).toHaveBeenCalledWith('CERT-1', null);
    await waitFor(() => expect((field as HTMLInputElement).value).toBe(''));
  });

  it('takes focus back after a scan resolves', async () => {
    const user = userEvent.setup();
    renderScan();
    const field = screen.getByLabelText('Scan or type an identifier');
    await user.type(field, 'CERT-1{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it('sends an optional note along with the identifier', async () => {
    const user = userEvent.setup();
    const { onScan } = renderScan();
    await user.type(screen.getByLabelText('Note (optional)'), 'box was open');
    await user.type(screen.getByLabelText('Scan or type an identifier'), 'CERT-1{Enter}');
    expect(onScan).toHaveBeenCalledWith('CERT-1', 'box was open');
  });

  it('refuses a second scan while the first is still unresolved', async () => {
    const user = userEvent.setup();
    const { onScan } = renderScan({ busy: true });
    await user.type(screen.getByLabelText('Scan or type an identifier'), 'CERT-1{Enter}');
    expect(onScan).not.toHaveBeenCalled();
  });

  it('does not submit an empty scan', async () => {
    const user = userEvent.setup();
    const { onScan } = renderScan();
    await user.type(screen.getByLabelText('Scan or type an identifier'), '{Enter}');
    expect(onScan).not.toHaveBeenCalled();
  });

  it('does not steal focus while a dialog owns the screen', () => {
    renderScan({ dialogOpen: true });
    expect(document.activeElement).not.toBe(screen.getByLabelText('Scan or type an identifier'));
  });

  it('announces the result in a polite live region', () => {
    renderScan({ feedback: scanFeedback({ outcome: 'expected_found', item_public_id: 'RV-ITEM-1' }) });
    const region = document.getElementById('cc-scan-feedback');
    expect(region!.getAttribute('aria-live')).toBe('polite');
    expect(within(region!).getByText('Found where expected')).toBeTruthy();
  });

  it('tells the operator plainly when a scan was a duplicate', () => {
    renderScan({
      feedback: scanFeedback({
        outcome: 'duplicate', item_public_id: 'RV-ITEM-1', first_observed_at: '10:00',
      }),
    });
    expect(screen.getByText('Already counted this round')).toBeTruthy();
  });

  it('shows an ambiguous identifier as a refusal, not as a count', () => {
    renderScan({
      feedback: scanFeedback({ outcome: 'ambiguous', identifier: 'ABC', match_count: 2 }),
    });
    expect(screen.getByText('That identifier matches more than one unit')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Lot counting
// ---------------------------------------------------------------------------

function renderLots(rows: readonly LotQueueRow[], withheld = false) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <LotQueuePanel
      rows={rows}
      quantitiesWithheld={withheld}
      savingLotId={null}
      onSave={onSave}
    />
  );
  return { onSave };
}

describe('the lot queue', () => {
  it('leaves an untouched quantity field empty rather than seeding the expected number', () => {
    renderLots([lot({ expected_quantity: 12 })]);
    expect((screen.getByLabelText('Counted quantity') as HTMLInputElement).value).toBe('');
  });

  it('refuses to save an untouched field, and says a blank is not a zero', async () => {
    const user = userEvent.setup();
    const { onSave } = renderLots([lot()]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('does not record a zero');
  });

  it('saves a deliberate zero as a real observed quantity', async () => {
    const user = userEvent.setup();
    const { onSave } = renderLots([lot()]);
    await user.type(screen.getByLabelText('Counted quantity'), '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ lot_id: 'l1' }), 0, null);
  });

  it('saves on Enter, so a whole shelf can be entered from the keyboard', async () => {
    const user = userEvent.setup();
    const { onSave } = renderLots([lot()]);
    await user.type(screen.getByLabelText('Counted quantity'), '9{Enter}');
    expect(onSave).toHaveBeenCalledWith(expect.anything(), 9, null);
  });

  it('rejects a non-integer instead of sending it to the database', async () => {
    const user = userEvent.setup();
    const { onSave } = renderLots([lot()]);
    await user.type(screen.getByLabelText('Counted quantity'), '1.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows the expected quantity and variance on a visible count', () => {
    renderLots([lot({
      observation_id: 'o1', observed_quantity: 9, variance: -3, count_status: 'short',
    })]);
    expect(screen.getByText(/Expected 12/)).toBeTruthy();
    expect(screen.getByText(/variance -3/)).toBeTruthy();
    expect(screen.getByText('Short')).toBeTruthy();
  });

  it('renders no expected quantity at all during a blind count', () => {
    renderLots([lot({
      expected_quantity: null, observation_id: 'o1', observed_quantity: 9,
      variance: null, count_status: 'saved',
    })], true);
    // No expected figure anywhere on the row — the only mention of the word is
    // the notice explaining that quantities are being withheld.
    expect(screen.queryByText(/Expected \d/)).toBeNull();
    expect(screen.queryByText(/variance/)).toBeNull();
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText(/blind count/i)).toBeTruthy();
  });

  it('carries status as a mark as well as a colour', () => {
    renderLots([lot({ count_status: 'uncounted' })]);
    expect(screen.getByText('Not counted')).toBeTruthy();
  });

  it('offers Update rather than Save once a lot has been counted', () => {
    renderLots([lot({ observation_id: 'o1', observed_quantity: 9, count_status: 'short' })]);
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy();
  });

  it('says so when a filter matches nothing', () => {
    renderLots([]);
    expect(screen.getByText('No lots match that filter.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Discrepancy resolution
// ---------------------------------------------------------------------------

function renderDiscrepancy(row: DiscrepancyRow, readOnly = false) {
  const onResolve = vi.fn().mockResolvedValue(undefined);
  const onRecount = vi.fn().mockResolvedValue(undefined);
  render(
    <ul>
      <DiscrepancyCard
        row={row} busy={false} readOnly={readOnly}
        onResolve={onResolve} onRecount={onRecount}
      />
    </ul>
  );
  return { onResolve, onRecount };
}

describe('a discrepancy', () => {
  it('offers only the actions the database will accept for its kind', () => {
    renderDiscrepancy(discrepancy({ discrepancy_kind: 'lot_shortage' }));
    const select = screen.getByLabelText('What to do about this');
    expect(within(select).queryByText('Write the unit off as lost')).toBeNull();
    expect(within(select).getByText('Adjust the lot to the counted quantity')).toBeTruthy();
  });

  it('offers the write-off only where there is a unit to write off', () => {
    renderDiscrepancy(discrepancy({
      discrepancy_kind: 'item_missing', item_id: 'i1', lot_id: null, subject_kind: 'item',
    }));
    expect(within(screen.getByLabelText('What to do about this'))
      .getByText('Write the unit off as lost')).toBeTruthy();
  });

  it('will not apply anything until an action is chosen', async () => {
    const user = userEvent.setup();
    const { onResolve } = renderDiscrepancy(discrepancy());
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Choose what to do');
  });

  it('demands a reason before deferring', async () => {
    const user = userEvent.setup();
    const { onResolve } = renderDiscrepancy(discrepancy());
    await user.selectOptions(screen.getByLabelText('What to do about this'), 'deferred');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('reason');
  });

  it('applies a bookkeeping outcome without a confirmation step', async () => {
    const user = userEvent.setup();
    const { onResolve } = renderDiscrepancy(discrepancy());
    await user.selectOptions(screen.getByLabelText('What to do about this'), 'observation_mistaken');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onResolve).toHaveBeenCalledWith(expect.anything(), 'observation_mistaken', null, null);
  });

  it('will not change inventory without an explicit confirmation', async () => {
    const user = userEvent.setup();
    const { onResolve } = renderDiscrepancy(discrepancy());
    await user.selectOptions(screen.getByLabelText('What to do about this'), 'lot_quantity_adjusted');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm this change to inventory')).toBeTruthy();
  });

  it('shows the three states before applying an inventory change', async () => {
    const user = userEvent.setup();
    renderDiscrepancy(discrepancy());
    await user.selectOptions(screen.getByLabelText('What to do about this'), 'lot_quantity_adjusted');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Frozen expectation')).toBeTruthy();
    expect(screen.getByText('After this action')).toBeTruthy();
    // "Counted" appears on the card as well as in the dialog, so its presence is
    // asserted by count rather than by uniqueness.
    expect(screen.getAllByText('Counted').length).toBeGreaterThan(1);
  });

  it('applies the change once confirmed', async () => {
    const user = userEvent.setup();
    const { onResolve } = renderDiscrepancy(discrepancy());
    await user.selectOptions(screen.getByLabelText('What to do about this'), 'lot_quantity_adjusted');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Yes, apply it' }));
    expect(onResolve).toHaveBeenCalledWith(expect.anything(), 'lot_quantity_adjusted', null, null);
  });

  it('routes a recount through the recount handler, not through resolve', async () => {
    const user = userEvent.setup();
    const { onResolve, onRecount } = renderDiscrepancy(discrepancy());
    await user.selectOptions(screen.getByLabelText('What to do about this'), 'recount_requested');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onRecount).toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('labels Intake routing as bookkeeping, not as receiving', async () => {
    const user = userEvent.setup();
    renderDiscrepancy(discrepancy({
      discrepancy_kind: 'item_unexpected', item_id: 'i1', lot_id: null, subject_kind: 'item',
    }));
    await user.selectOptions(screen.getByLabelText('What to do about this'), 'routed_to_intake');
    expect(screen.getByText(/does not create\s+an inventory record/)).toBeTruthy();
  });

  it('keeps a failed attempt visible, with what the database said', () => {
    renderDiscrepancy(discrepancy({
      resolutions: [{
        resolution_id: 'r1', action: 'lot_quantity_adjusted', note: null, succeeded: false,
        failure_detail: 'quantity changed, reload and try again',
        resolved_at: 't', resolved_by_email: 'owner@test', movement_id: null, adjustment_id: null,
      }],
    }));
    expect(screen.getByText('Last attempt failed')).toBeTruthy();
    expect(screen.getByText('quantity changed, reload and try again')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
  });

  it('does not call a discrepancy resolved after a failure, and offers a retry', () => {
    renderDiscrepancy(discrepancy({
      resolutions: [{
        resolution_id: 'r1', action: 'lot_quantity_adjusted', note: null, succeeded: false,
        failure_detail: 'stale', resolved_at: 't', resolved_by_email: null,
        movement_id: null, adjustment_id: null,
      }],
    }));
    expect(screen.queryByText('Resolved')).toBeNull();
    expect(screen.getByLabelText('Try again')).toBeTruthy();
  });

  it('shows activity after the snapshot as evidence, with the warning wording', () => {
    renderDiscrepancy(discrepancy({
      post_snapshot_activity: [{
        activity_kind: 'lot_split', activity_public_id: 'RV-LIN-1',
        occurred_at: 't', detail: '3 units', from_value: 'RV-C-0001', to_value: 'RV-C-0002',
      }],
    }));
    expect(screen.getByText(/Activity after snapshot may explain this discrepancy/)).toBeTruthy();
    expect(screen.getByText('Lot split')).toBeTruthy();
  });

  it('shows every round side by side and says whether they agree', () => {
    renderDiscrepancy(discrepancy({
      observations: [
        { observation_id: 'o1', count_round: 1, outcome: 'short', observed_at: 't1', observed_by_email: null, note: null, observed_quantity: 9, voided_at: null, void_reason: null },
        { observation_id: 'o2', count_round: 2, outcome: 'short', observed_at: 't2', observed_by_email: null, note: null, observed_quantity: 9, voided_at: null, void_reason: null },
      ],
    }));
    expect(screen.getByText('Round 1')).toBeTruthy();
    expect(screen.getByText('Round 2')).toBeTruthy();
    expect(screen.getByText('The rounds agree.')).toBeTruthy();
  });

  it('says plainly when the rounds disagree', () => {
    renderDiscrepancy(discrepancy({
      observations: [
        { observation_id: 'o1', count_round: 1, outcome: 'short', observed_at: 't1', observed_by_email: null, note: null, observed_quantity: 9, voided_at: null, void_reason: null },
        { observation_id: 'o2', count_round: 2, outcome: 'short', observed_at: 't2', observed_by_email: null, note: null, observed_quantity: 11, voided_at: null, void_reason: null },
      ],
    }));
    expect(screen.getByText('The rounds disagree — both are kept.')).toBeTruthy();
  });

  it('offers no controls at all when the count is read only', () => {
    renderDiscrepancy(discrepancy(), true);
    expect(screen.queryByLabelText('What to do about this')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('offers no controls once a discrepancy is resolved', () => {
    renderDiscrepancy(discrepancy({ status: 'resolved', resolutions: [{
      resolution_id: 'r1', action: 'lot_quantity_adjusted', note: null, succeeded: true,
      failure_detail: null, resolved_at: 't', resolved_by_email: null,
      movement_id: null, adjustment_id: 'a1',
    }] }));
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(screen.getByText('Resolved')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Completion and cancellation
// ---------------------------------------------------------------------------

function renderCompletion(r: Readiness) {
  const onComplete = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn().mockResolvedValue(undefined);
  render(<CompletionPanel readiness={r} busy={false} onComplete={onComplete} onCancel={onCancel} />);
  return { onComplete, onCancel };
}

describe('completion', () => {
  it('disables completion while work is open, and names the blockers', () => {
    renderCompletion(readiness({ open_count: 2, blockers: ['2 discrepancy(s) are still open.'] }));
    expect((screen.getByRole('button', { name: 'Complete this count' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('· 2 discrepancy(s) are still open.')).toBeTruthy();
  });

  it('disables completion while a resolution has failed', () => {
    renderCompletion(readiness({
      failed_resolution_count: 1, blockers: ['1 discrepancy(s) have a failed resolution and no successful one.'],
    }));
    expect((screen.getByRole('button', { name: 'Complete this count' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not offer the deferred path unless the server says it is available', () => {
    renderCompletion(readiness({ deferred_count: 2, can_complete_with_deferrals: false }));
    expect(screen.queryByRole('button', { name: /Complete with/ })).toBeNull();
  });

  it('completes normally when nothing is outstanding', async () => {
    const user = userEvent.setup();
    const { onComplete } = renderCompletion(readiness({ can_complete: true, resolved_count: 3 }));
    await user.click(screen.getByRole('button', { name: 'Complete this count' }));
    expect(onComplete).toHaveBeenCalledWith(false, null);
  });

  it('keeps deferred completion behind its own control, showing the count', async () => {
    const user = userEvent.setup();
    renderCompletion(readiness({ can_complete_with_deferrals: true, deferred_count: 3 }));
    const button = screen.getByRole('button', { name: 'Complete with 3 deferred…' });
    await user.click(button);
    expect(screen.getByText('Complete with deferred discrepancies')).toBeTruthy();
  });

  it('refuses a deferred completion without the acknowledgement and a reason', async () => {
    const user = userEvent.setup();
    const { onComplete } = renderCompletion(
      readiness({ can_complete_with_deferrals: true, deferred_count: 2 })
    );
    await user.click(screen.getByRole('button', { name: 'Complete with 2 deferred…' }));
    await user.click(screen.getByRole('button', { name: 'Complete with deferrals' }));
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('passes the elevated flag and the reason once both are given', async () => {
    const user = userEvent.setup();
    const { onComplete } = renderCompletion(
      readiness({ can_complete_with_deferrals: true, deferred_count: 2 })
    );
    await user.click(screen.getByRole('button', { name: 'Complete with 2 deferred…' }));
    await user.click(screen.getByRole('checkbox'));
    await user.type(
      screen.getByLabelText('Why complete now (required)'),
      'The supplier will confirm the shortfall next week.'
    );
    await user.click(screen.getByRole('button', { name: 'Complete with deferrals' }));
    expect(onComplete).toHaveBeenCalledWith(true, 'The supplier will confirm the shortfall next week.');
  });
});

describe('cancellation', () => {
  it('requires a reason', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderCompletion(readiness());
    await user.click(screen.getByRole('button', { name: 'Cancel this count…' }));
    await user.click(screen.getByRole('button', { name: 'Cancel the count' }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('warns that a count which already changed stock will be refused', async () => {
    const user = userEvent.setup();
    renderCompletion(readiness({ inventory_changing_resolution_count: 2 }));
    await user.click(screen.getByRole('button', { name: 'Cancel this count…' }));
    expect(screen.getByText(/already applied 2 change/)).toBeTruthy();
  });

  it('cancels with a reason', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderCompletion(readiness());
    await user.click(screen.getByRole('button', { name: 'Cancel this count…' }));
    await user.type(screen.getByLabelText('Reason (required)'), 'Counted the wrong aisle.');
    await user.click(screen.getByRole('button', { name: 'Cancel the count' }));
    expect(onCancel).toHaveBeenCalledWith('Counted the wrong aisle.');
  });
});

// ---------------------------------------------------------------------------
// Observations and progress
// ---------------------------------------------------------------------------

const observation = (over: Partial<ObservationFeedRow> = {}): ObservationFeedRow => ({
  observation_id: 'o1', subject_kind: 'item', count_round: 1, outcome: 'expected_found',
  subject_public_id: 'RV-ITEM-1', display_name: 'Charizard', raw_identifier: 'CERT-1',
  note: null, observed_at: '2026-07-30T10:00:00Z', observed_location_code: 'BIN-A',
  expected_location_code: 'BIN-A', observed_quantity: null, expected_quantity: null,
  voided_at: null, void_reason: null, observed_by_email: 'owner@test', is_current_round: true,
  ...over,
});

describe('the observation feed', () => {
  it('undoes an observation as a void, explaining that the original is kept', async () => {
    const user = userEvent.setup();
    const onVoid = vi.fn().mockResolvedValue(undefined);
    render(<ObservationFeedPanel rows={[observation()]} onVoid={onVoid} voidingId={null} />);
    await user.click(screen.getByRole('button', { name: /Undo this observation/ }));
    expect(screen.getByText(/marked as voided — it is not deleted/)).toBeTruthy();
    await user.type(screen.getByLabelText('Why (optional)'), 'wrong shelf');
    await user.click(screen.getByRole('button', { name: 'Undo the observation' }));
    expect(onVoid).toHaveBeenCalledWith(expect.objectContaining({ observation_id: 'o1' }), 'wrong shelf');
  });

  it('labels an earlier round rather than folding it into the current one', () => {
    render(<ObservationFeedPanel rows={[observation({ count_round: 1, is_current_round: false })]} />);
    expect(screen.getByText('Round 1 — earlier count')).toBeTruthy();
  });

  it('marks a voided observation instead of hiding it', () => {
    render(<ObservationFeedPanel rows={[observation({ voided_at: 't', void_reason: 'mis-scan' })]} />);
    expect(screen.getByText(/voided: mis-scan/)).toBeTruthy();
  });

  it('offers no undo at all on a read-only count', () => {
    render(<ObservationFeedPanel rows={[observation()]} readOnly />);
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });
});

describe('progress', () => {
  it('reports both grains and exposes a progressbar to assistive technology', () => {
    render(
      <ProgressPanel
        progress={progress({
          expected_item_count: 4, found_item_count: 3, uncounted_item_count: 1,
          expected_lot_count: 2, counted_lot_count: 2,
        })}
        round={1}
        percent={83}
      />
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('83');
    expect(screen.getByText('Units not counted')).toBeTruthy();
    expect(screen.getByText('Lots counted')).toBeTruthy();
  });

  it('shows the round, so a recount is never mistaken for the first pass', () => {
    render(<ProgressPanel progress={progress()} round={2} percent={0} />);
    expect(screen.getByText('Round 2')).toBeTruthy();
  });

  it('omits review totals while counting — not-yet-known is not the same as nothing wrong', () => {
    render(<ProgressPanel progress={progress()} round={1} percent={0} reviewTotals={null} />);
    expect(screen.queryByText('Review totals')).toBeNull();
  });

  it('shows review totals, including the net variance, once review has begun', () => {
    render(
      <ProgressPanel
        progress={progress()}
        round={1}
        percent={100}
        reviewTotals={{
          missing_item_count: 1, unexpected_item_count: 0, wrong_location_count: 0,
          lot_shortage_count: 1, lot_overage_count: 0, lot_uncounted_count: 0,
          shortage_units: 3, overage_units: 1, open_count: 2, recount_requested_count: 0,
          resolved_count: 0, deferred_count: 1, total_count: 2,
        }}
      />
    );
    expect(screen.getByText('Review totals')).toBeTruthy();
    expect(screen.getByText('Net variance')).toBeTruthy();
    expect(screen.getByText('Deferred')).toBeTruthy();
  });
});

describe('a terminal count', () => {
  it('says it is read only, unmistakably', () => {
    render(<TerminalBanner status="completed" />);
    expect(screen.getByText('Completed count — read only.')).toBeTruthy();
  });

  it('shows the cancellation reason when there is one', () => {
    render(<TerminalBanner status="cancelled" reason="Counted the wrong aisle." />);
    expect(screen.getByText('Cancelled count — read only.')).toBeTruthy();
    expect(screen.getByText(/Counted the wrong aisle\./)).toBeTruthy();
  });
});

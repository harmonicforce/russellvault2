// @vitest-environment jsdom
//
// Phase 6A Quick Add — RENDERED component tests. These drive the real React
// component through a fake transport (the SERVER stays authoritative for every
// rule and outcome — the fake only stands in for its responses) and prove the
// operator workflow: focus, scanner/Enter advance, keyboard commit guard,
// session resume, stale reload, duplicate recovery, terminal read-only states,
// responsive layout, and the shadow indicator. No network, no real Supabase.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import QuickAdd from './QuickAdd';
import type {
  IntakeCommitReceipt,
  IntakeGroupSnapshot,
  IntakeGroupSummary,
  IntakeTransport,
} from '../lib/intakeApi';

const WS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const RECEIPT: IntakeCommitReceipt = {
  outcome: 'committed', idempotent_replay: false, session_id: SESSION, group_id: 'g-1',
  group_public_id: 'RV-IG-1', idempotency_key: 'key-1', product_id: 'p-1', product_public_id: 'RV-PROD-1',
  product_created: true, sku_id: 's-1', sku_public_id: 'RV-SKU-1', sku_fingerprint: 'f'.repeat(64),
  sku_created: true, lot_id: 'l-1', lot_public_id: 'RV-I-0000000001', tracking_mode: 'serialized',
  quantity: 1, items: [{ entry_id: 'e-1', entry_index: 1, item_id: 'i-1', item_public_id: 'RV-ITEM-1', scan_sku: 'RV-7K3F9Q2' }],
  source_state: 'stated', source_evidence: { source_kind: 'personal_collection' }, candidates: [],
  applied_rule_version: 'INTAKE_RULES_1', next_action: 'READY_FOR_FUTURE_LISTING_PREP',
  actor: 'u-1', committed_at: '2026-07-26T00:00:00Z',
};

function serverSnapshot(over: Partial<IntakeGroupSnapshot['group']> = {}, extra: Partial<IntakeGroupSnapshot> = {}): IntakeGroupSnapshot {
  return {
    group: {
      id: 'g-9', public_id: 'RV-IG-9', session_id: SESSION, state: 'draft', version: 7,
      category: 'graded_tcg', business_vertical: 'trading_cards', display_name: 'Blastoise',
      product_attrs: { featured_subject: 'Blastoise', set_name: 'Base Set', card_number: '2' },
      sku_attrs: { grading_company: 'PSA', numeric_grade: '10', grade_designation: 'GEM MINT', product_format: 'Graded slab' },
      quantity: 1, tracking_mode: 'serialized', serialized_child_count: 1, source_state: 'stated',
      source_evidence: { source_kind: 'retail_purchase' }, condition_state: null, location_code: 'BIN-2',
      owner_tagged: false, unique_condition: false, requires_item_media: false, security_sensitive: false,
      applied_rule_version: null, next_action: null, committed_product_id: null, committed_sku_id: null,
      committed_lot_id: null, committed_at: null, created_at: '2026-07-26T00:00:00Z', updated_at: '2026-07-26T00:00:00Z',
      ...over,
    },
    entries: [{
      id: 'e-9', public_id: 'RV-IE-9', entry_index: 1, grading_company: 'PSA', numeric_grade: '10',
      grade_designation: 'GEM MINT', certificate_number: 'PSA-88002', serial_number: null, entry_attrs: {}, committed_item_id: null,
    }],
    candidates: [], evaluation: { ready: true, blockers: [], rule_version: 'INTAKE_RULES_1' }, receipt: null, editable: true,
    ...extra,
  };
}

const draftSummary: IntakeGroupSummary = {
  id: 'g-9', public_id: 'RV-IG-9', session_id: SESSION, state: 'draft', version: 7,
  category: 'graded_tcg', business_vertical: 'trading_cards', display_name: 'Blastoise',
  quantity: 1, tracking_mode: 'serialized', serialized_child_count: 1, source_state: 'stated',
  location_code: 'BIN-2', next_action: null, applied_rule_version: null, committed_at: null,
  created_at: '2026-07-26T00:00:00Z', updated_at: '2026-07-26T00:00:00Z',
};

// A fully spy-able fake transport with workable defaults. Individual tests
// override specific methods to script server outcomes.
function makeTransport(over: Partial<IntakeTransport> = {}): IntakeTransport {
  return {
    createSession: vi.fn(async () => ({ id: SESSION, public_id: 'RV-ISESS-1', state: 'open' as const })),
    resumeSession: vi.fn(async () => ({ id: SESSION, public_id: 'RV-ISESS-1', state: 'open' as const })),
    listGroups: vi.fn(async () => [draftSummary]),
    getGroupSnapshot: vi.fn(async () => serverSnapshot()),
    createGradedGroup: vi.fn(async () => ({ id: 'g-1', public_id: 'RV-IG-1', state: 'draft' as const, version: 1 })),
    updateGroup: vi.fn(async () => ({ id: 'g-1', public_id: 'RV-IG-1', state: 'draft' as const, version: 2 })),
    upsertEntry: vi.fn(async () => ({ id: 'e-1', public_id: 'RV-IE-1', entry_index: 1, version: 3 })),
    evaluateRules: vi.fn(async () => ({ ready: true, blockers: [], rule_version: 'INTAKE_RULES_1' })),
    preview: vi.fn(async () => ({
      staging: true as const, authoritative: false as const, content_hash: 'a'.repeat(64),
      product_canonical_key: 'k', sku_fingerprint: 'f', would_create_product: true, would_create_sku: true,
      tracking_mode: 'serialized' as const, quantity: 1, serialized_child_count: 1, source_state: 'stated' as const,
      next_action_preview: 'NO_IMMEDIATE_ACTION' as const, ready: true, blockers: [], rule_version: 'INTAKE_RULES_1',
    })),
    commit: vi.fn(async () => RECEIPT),
    getReceipt: vi.fn(async () => RECEIPT),
    abandonGroup: vi.fn(async () => ({ state: 'abandoned' })),
    ...over,
  };
}

function renderQuickAdd(transport: IntakeTransport) {
  return render(
    <MemoryRouter>
      <QuickAdd transport={transport} />
    </MemoryRouter>,
  );
}

async function startNewSession(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Workspace id'), WS);
  await user.click(screen.getByRole('button', { name: 'Start new session' }));
}

async function resume(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Workspace id'), WS);
  await user.type(screen.getByLabelText('Existing session id'), SESSION);
  await user.click(screen.getByRole('button', { name: 'Resume existing session' }));
}

let originalWidth: number;
beforeEach(() => { originalWidth = window.innerWidth; });
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
});

describe('Quick Add rendered workflow', () => {
  it('1. starting a session focuses Certificate number', async () => {
    const user = userEvent.setup();
    renderQuickAdd(makeTransport());
    await startNewSession(user);
    const cert = await screen.findByLabelText('Certificate number');
    await waitFor(() => expect(document.activeElement).toBe(cert));
  });

  it('2. scanner/Enter advances through the visible field order', async () => {
    const user = userEvent.setup();
    renderQuickAdd(makeTransport());
    await startNewSession(user);
    const cert = await screen.findByLabelText('Certificate number');
    await waitFor(() => expect(document.activeElement).toBe(cert));
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByLabelText('Grading company'));
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByLabelText('Numeric grade'));
  });

  it('3. Enter does not trigger server readiness on each field', async () => {
    const t = makeTransport();
    const user = userEvent.setup();
    renderQuickAdd(t);
    await startNewSession(user);
    const cert = await screen.findByLabelText('Certificate number');
    await waitFor(() => expect(document.activeElement).toBe(cert));
    await user.keyboard('{Enter}{Enter}{Enter}');
    expect(t.evaluateRules).not.toHaveBeenCalled();
    expect(t.preview).not.toHaveBeenCalled();
    expect(t.commit).not.toHaveBeenCalled();
  });

  it('4. Ctrl/Command+Enter cannot commit before the server reports ready', async () => {
    const t = makeTransport();
    const user = userEvent.setup();
    renderQuickAdd(t);
    await startNewSession(user);
    const cert = await screen.findByLabelText('Certificate number');
    await waitFor(() => expect(document.activeElement).toBe(cert));
    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(t.commit).not.toHaveBeenCalled();
  });

  it('5. a resumed session hydrates the latest editable draft', async () => {
    const t = makeTransport();
    const user = userEvent.setup();
    renderQuickAdd(t);
    await resume(user);
    const cert = await screen.findByLabelText('Certificate number');
    await waitFor(() => expect((cert as HTMLInputElement).value).toBe('PSA-88002'));
    expect((screen.getByLabelText('Set name') as HTMLInputElement).value).toBe('Base Set');
    expect((screen.getByLabelText('Card number') as HTMLInputElement).value).toBe('2');
    expect(t.listGroups).toHaveBeenCalled();
    expect(t.getGroupSnapshot).toHaveBeenCalledWith(WS, 'g-9');
  });

  it('6. a stale reload replaces local values and version with the server snapshot', async () => {
    const staleServer = serverSnapshot({ version: 42 }, {
      entries: [{
        id: 'e-9', public_id: 'RV-IE-9', entry_index: 1, grading_company: 'PSA', numeric_grade: '10',
        grade_designation: 'GEM MINT', certificate_number: 'SERVER-CERT-999', serial_number: null, entry_attrs: {}, committed_item_id: null,
      }],
    });
    const t = makeTransport({
      commit: vi.fn(async () => ({
        outcome: 'conflict' as const, conflict_type: 'stale_version' as const,
        message: 'stale', group_id: 'g-1', expected_version: 3, actual_version: 42,
      })),
      getGroupSnapshot: vi.fn(async () => staleServer),
    });
    const user = userEvent.setup();
    renderQuickAdd(t);
    await startNewSession(user);
    const cert = await screen.findByLabelText('Certificate number');
    await user.type(screen.getByLabelText('Card name or featured subject'), 'Blastoise');
    await user.type(cert, 'LOCAL-CERT-1');
    await user.click(screen.getByRole('button', { name: 'Check readiness' }));
    await user.click(await screen.findByRole('button', { name: 'Commit slab' }));
    // Stale state appears; reload requires a deliberate confirmation.
    await user.click(await screen.findByRole('button', { name: 'Reload latest' }));
    await user.click(await screen.findByRole('button', { name: /Reload and discard/ }));
    await waitFor(() =>
      expect((screen.getByLabelText('Certificate number') as HTMLInputElement).value).toBe('SERVER-CERT-999'),
    );
    expect(screen.getByRole('alert').textContent).toMatch(/discarded|replaced/i);
  });

  it('7. duplicate state presents Review existing item only when a real reference exists', async () => {
    const withRef = makeTransport({
      commit: vi.fn(async () => ({
        outcome: 'failed' as const, failure_class: 'duplicate_identity' as const, sqlstate: '23505',
        message: 'duplicate certificate', group_id: 'g-1',
        existing_item: { item_public_id: 'RV-ITEM-5', lot_public_id: 'RV-I-0000000005', scan_sku: 'RV-ABC1234' },
      })),
    });
    const user = userEvent.setup();
    const { unmount } = renderQuickAdd(withRef);
    await startNewSession(user);
    await user.type(screen.getByLabelText('Card name or featured subject'), 'Blastoise');
    await user.type(screen.getByLabelText('Certificate number'), 'PSA-88002');
    await user.click(screen.getByRole('button', { name: 'Check readiness' }));
    await user.click(await screen.findByRole('button', { name: 'Commit slab' }));
    expect(await screen.findByRole('button', { name: 'Review existing item' })).toBeTruthy();
    expect(screen.getByText('RV-ITEM-5')).toBeTruthy();
    expect(screen.getByText(/Use Inventory search/i)).toBeTruthy();
    unmount();

    // Without a server reference: no Review existing item button.
    const noRef = makeTransport({
      commit: vi.fn(async () => ({
        outcome: 'failed' as const, failure_class: 'duplicate_identity' as const, sqlstate: '23505',
        message: 'duplicate certificate', group_id: 'g-1',
      })),
    });
    const user2 = userEvent.setup();
    renderQuickAdd(noRef);
    await startNewSession(user2);
    await user2.type(screen.getByLabelText('Card name or featured subject'), 'Blastoise');
    await user2.type(screen.getByLabelText('Certificate number'), 'PSA-88002');
    await user2.click(screen.getByRole('button', { name: 'Check readiness' }));
    await user2.click(await screen.findByRole('button', { name: 'Commit slab' }));
    await screen.findByRole('button', { name: 'Edit certificate' });
    expect(screen.queryByRole('button', { name: 'Review existing item' })).toBeNull();
  });

  it('8. duplicate state always permits Edit certificate', async () => {
    const t = makeTransport({
      commit: vi.fn(async () => ({
        outcome: 'failed' as const, failure_class: 'duplicate_identity' as const, sqlstate: '23505',
        message: 'duplicate certificate', group_id: 'g-1',
        existing_item: { item_public_id: 'RV-ITEM-5', lot_public_id: 'RV-I-0000000005', scan_sku: 'RV-ABC1234' },
      })),
    });
    const user = userEvent.setup();
    renderQuickAdd(t);
    await startNewSession(user);
    await user.type(screen.getByLabelText('Card name or featured subject'), 'Blastoise');
    await user.type(screen.getByLabelText('Certificate number'), 'PSA-88002');
    await user.click(screen.getByRole('button', { name: 'Check readiness' }));
    await user.click(await screen.findByRole('button', { name: 'Commit slab' }));
    expect(await screen.findByRole('button', { name: 'Edit certificate' })).toBeTruthy();
  });

  it('9. abandoned state is read-only and exposes Return to sessions', async () => {
    const t = makeTransport({
      resumeSession: vi.fn(async () => ({ id: SESSION, public_id: 'RV-ISESS-1', state: 'abandoned' as const })),
    });
    const user = userEvent.setup();
    renderQuickAdd(t);
    await resume(user);
    expect((await screen.findAllByText(/abandoned and read only/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Return to sessions' })).toBeTruthy();
    // No mutation controls.
    expect(screen.queryByRole('button', { name: 'Check readiness' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Commit slab' })).toBeNull();
    // Fields are read-only.
    expect((screen.getByLabelText('Certificate number') as HTMLInputElement).disabled).toBe(true);
    // No group was ever created by resuming.
    expect(t.createGradedGroup).not.toHaveBeenCalled();
    // Return to sessions drops back to the picker.
    await user.click(screen.getByRole('button', { name: 'Return to sessions' }));
    expect(await screen.findByRole('button', { name: 'Start new session' })).toBeTruthy();
  });

  it('10. committed state exposes Add another slab and View item', async () => {
    const t = makeTransport();
    const user = userEvent.setup();
    renderQuickAdd(t);
    await startNewSession(user);
    await user.type(screen.getByLabelText('Card name or featured subject'), 'Charizard');
    await user.type(screen.getByLabelText('Certificate number'), 'CGC-77001');
    await user.click(screen.getByRole('button', { name: 'Check readiness' }));
    await user.click(await screen.findByRole('button', { name: 'Commit slab' }));
    expect(await screen.findByRole('button', { name: 'Add another slab' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View item' })).toBeTruthy();
    expect(screen.getByText('RV-ITEM-1')).toBeTruthy();
  });

  it('11. desktop layout renders side by side at the approved breakpoint', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    const user = userEvent.setup();
    renderQuickAdd(makeTransport());
    await startNewSession(user);
    const grid = await screen.findByTestId('quick-add-grid');
    expect(grid.getAttribute('data-layout')).toBe('side-by-side');
    expect(grid.className).toContain('grid-cols-2');
  });

  it('12. iPad layout renders stacked without horizontal overflow', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 834, configurable: true });
    const user = userEvent.setup();
    const { container } = renderQuickAdd(makeTransport());
    await startNewSession(user);
    const grid = await screen.findByTestId('quick-add-grid');
    expect(grid.getAttribute('data-layout')).toBe('stacked');
    expect(grid.className).toContain('grid-cols-1');
    // The page container clips horizontal overflow so the body never scrolls sideways.
    expect(container.querySelector('.overflow-x-hidden')).not.toBeNull();
  });

  it('13. the SHADOW / NON-AUTHORITATIVE indicator is visible', async () => {
    renderQuickAdd(makeTransport());
    expect(screen.getAllByText('SHADOW / NON-AUTHORITATIVE').length).toBeGreaterThan(0);
  });

  it('14. focus moves to the first blocker after failed readiness', async () => {
    const t = makeTransport({
      evaluateRules: vi.fn(async () => ({
        ready: false,
        blockers: [{ code: 'missing_required', field: 'tcg_certificate_number', message: 'certificate number is required' }],
        rule_version: 'INTAKE_RULES_1',
      })),
    });
    const user = userEvent.setup();
    renderQuickAdd(t);
    await startNewSession(user);
    await user.type(screen.getByLabelText('Card name or featured subject'), 'Charizard');
    await user.click(screen.getByRole('button', { name: 'Check readiness' }));
    const cert = screen.getByLabelText('Certificate number');
    await waitFor(() => expect(document.activeElement).toBe(cert));
    expect(screen.getAllByText(/certificate number is required/i).length).toBeGreaterThan(0);
  });

  it('15. an idempotent replay renders the existing receipt without creating another item', async () => {
    const t = makeTransport({
      commit: vi.fn(async () => ({ ...RECEIPT, idempotent_replay: true })),
    });
    const user = userEvent.setup();
    renderQuickAdd(t);
    await startNewSession(user);
    await user.type(screen.getByLabelText('Card name or featured subject'), 'Charizard');
    await user.type(screen.getByLabelText('Certificate number'), 'CGC-77001');
    await user.click(screen.getByRole('button', { name: 'Check readiness' }));
    await user.click(await screen.findByRole('button', { name: 'Commit slab' }));
    const receipt = await screen.findByText(/Idempotent replay/i);
    expect(receipt).toBeTruthy();
    // The single committed item id is shown once; only one commit call was made.
    expect(within(receipt.closest('div')!.parentElement!).getAllByText('RV-ITEM-1').length).toBeGreaterThan(0);
    expect(t.commit).toHaveBeenCalledTimes(1);
  });
});

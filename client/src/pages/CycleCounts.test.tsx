// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import CycleCounts from './CycleCounts';

const api={create:vi.fn(),start:vi.fn(),list:vi.fn(),progress:vi.fn(),history:vi.fn(),discrepancies:vi.fn(),attempts:vi.fn(),
 observeItem:vi.fn(),observeLot:vi.fn(),observations:vi.fn(),voidObservation:vi.fn(),attestItemAbsence:vi.fn(),submit:vi.fn(),selectRecount:vi.fn(),beginRecount:vi.fn(),createAttempt:vi.fn(),approveAttempt:vi.fn(),executeAttempt:vi.fn(),complete:vi.fn(),cancel:vi.fn()};
let role:'owner'|'operator'|'viewer'='owner';
vi.mock('../lib/workspaceContext',()=>({useWorkspace:()=>({workspace:{id:'ws',name:'Vault',role},client:{}})}));
vi.mock('../lib/cycleCountApi',async(importOriginal)=>{const actual=await importOriginal<typeof import('../lib/cycleCountApi')>();return {...actual,createCycleCountTransport:()=>api}});
const review={id:'s',public_id:'RV-CC-REVIEW',status:'review',blind_count:true,created_at:'2026-01-01',current_round_id:'r'};
const counting={...review,public_id:'RV-CC-COUNT',status:'in_progress'};
const progress={round_id:'r',round_number:2,round_type:'recount',round_status:'counting',current_round_expected_subject_count:null,current_round_observed_item_count:1,current_round_observed_lot_count:1,current_round_remaining_count:null,historical_round_count:2,total_historical_observations:4,blind:true};
afterEach(()=>cleanup());
beforeEach(()=>{vi.clearAllMocks();role='owner';api.list.mockResolvedValue([]);api.create.mockResolvedValue({id:'cc-1',public_id:'RV-CC-AAA111',status:'draft',outcome:'created'});api.start.mockResolvedValue({status:'in_progress'});api.progress.mockResolvedValue(progress);api.history.mockResolvedValue({status:'review',completion_summary:null,rounds:[{id:'r',public_id:'RV-CCR-2',round_number:2,round_type:'recount',status:'submitted',reason:'verify',subject_count:2,item_observation_count:1,lot_observation_count:1,result_count:2}]});api.attempts.mockResolvedValue([]);api.observations.mockResolvedValue([]);api.discrepancies.mockResolvedValue([])});
describe('Cycle Counts rendered states',()=>{
 it('keeps active blind recount entry free of stale resolution controls',async()=>{role='operator';api.list.mockResolvedValue([counting]);render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-COUNT'));expect(await screen.findByText('Blind counting')).toBeTruthy();expect(screen.getByText('recount round 2')).toBeTruthy();expect(screen.getByLabelText('Item identifier')).toBeTruthy();expect(screen.queryByText('Current discrepancies')).toBeNull();expect(screen.getByText('Hidden')).toBeTruthy()});
 it('does not request protected history while an operator is counting',async()=>{role='operator';api.list.mockResolvedValue([counting]);render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-COUNT'));await screen.findByText('Blind counting');expect(api.history).not.toHaveBeenCalled()});
 it('confirms an incomplete initial round after the structured warning',async()=>{const initial={...counting,current_round_id:'r1'};api.list.mockResolvedValue([initial]);api.progress.mockResolvedValue({...progress,round_type:'initial',round_number:1});api.submit.mockResolvedValueOnce({outcome:'confirmation_required',uncounted_item_count:2,uncounted_lot_count:1}).mockResolvedValueOnce({outcome:'submitted'});render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-COUNT'));fireEvent.click(await screen.findByText('Submit current round'));expect(await screen.findByText(/2 uncounted items and 1 uncounted lots/)).toBeTruthy();fireEvent.click(screen.getByText('Confirm incomplete round'));await waitFor(()=>expect(api.submit).toHaveBeenLastCalledWith('s',true))});
 it('offers missing-item attestation during a recount',async()=>{role='operator';api.list.mockResolvedValue([counting]);api.attestItemAbsence.mockResolvedValue({outcome:'accepted'});render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-COUNT'));fireEvent.change(await screen.findByLabelText('Missing item public ID'),{target:{value:'RV-ITEM-1'}});fireEvent.change(screen.getByLabelText('Absence reason'),{target:{value:'searched recount area'}});fireEvent.click(screen.getByText('Attest not found'));await waitFor(()=>expect(api.attestItemAbsence).toHaveBeenCalledWith('s','RV-ITEM-1','not_found','searched recount area',expect.any(String)))});
 it('reuses the client key after an indeterminate scanner failure',async()=>{role='operator';api.list.mockResolvedValue([counting]);api.observeItem.mockRejectedValueOnce(new Error('network interrupted')).mockResolvedValueOnce({outcome:'idempotent_replay'});render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-COUNT'));fireEvent.change(await screen.findByLabelText('Item identifier'),{target:{value:'ITEM-1'}});fireEvent.change(screen.getByLabelText('Observed location'),{target:{value:'BIN-A'}});fireEvent.click(screen.getByText('Record observation'));await screen.findByText('network interrupted');fireEvent.click(screen.getByText('Record observation'));await waitFor(()=>expect(api.observeItem).toHaveBeenCalledTimes(2));expect(api.observeItem.mock.calls[0][3]).toBe(api.observeItem.mock.calls[1][3])});
 it('selects multiple discrepancies into one recount',async()=>{api.list.mockResolvedValue([review]);api.discrepancies.mockResolvedValue([{id:'d1',public_id:'D1',kind:'item_wrong_location',status:'open',classification:'confirmed_after_recount',subject_type:'item',expected_quantity:null,observed_quantity:null,computed_variance:null,post_snapshot_classification:'none',recount_outcome:'confirmed_after_recount',allowed_actions:[]},{id:'d2',public_id:'D2',kind:'lot_shortage',status:'open',classification:'changed_after_recount',subject_type:'lot',expected_quantity:10,observed_quantity:7,computed_variance:-3,post_snapshot_classification:'none',recount_outcome:'changed_after_recount',allowed_actions:[]}]);api.selectRecount.mockResolvedValue({outcome:'selected'});api.beginRecount.mockResolvedValue({outcome:'recount_started'});render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-REVIEW'));fireEvent.click(await screen.findByLabelText('Select D1 for recount'));fireEvent.click(screen.getByLabelText('Select D2 for recount'));fireEvent.change(screen.getByText('Recount reason').parentElement!.querySelector('input')!,{target:{value:'verify together'}});fireEvent.click(screen.getByText('Begin one recount (2)'));await waitFor(()=>expect(api.selectRecount).toHaveBeenCalledWith('s',['d1','d2'],'verify together'));expect(api.beginRecount).toHaveBeenCalledWith('s','verify together')});
 it('locks counted destination and exposes reviewed relocation separately',async()=>{api.list.mockResolvedValue([review]);api.discrepancies.mockResolvedValue([{id:'d1',public_id:'D1',kind:'item_wrong_location',status:'open',classification:'wrong_location',subject_type:'item',expected_quantity:null,observed_quantity:null,computed_variance:null,post_snapshot_classification:'none',recount_outcome:null,allowed_actions:[{action:'item_moved_to_counted_location',reason_required:true,destination_mode:'observed',quantity_mode:'none',approval_required:false},{action:'item_moved_to_reviewed_location',reason_required:true,destination_mode:'reviewed',quantity_mode:'none',approval_required:true}]}]);render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-REVIEW'));expect(await screen.findByText('Destination locked to counted location')).toBeTruthy();fireEvent.change(screen.getByLabelText('Resolution action'),{target:{value:'item_moved_to_reviewed_location'}});expect(screen.getByLabelText('Reviewed destination')).toBeTruthy()});
 it('requires acknowledgement of post-snapshot activity before resolution',async()=>{api.list.mockResolvedValue([review]);api.discrepancies.mockResolvedValue([{id:'d1',public_id:'D1',kind:'lot_shortage',status:'open',classification:'shortage',subject_type:'lot',expected_quantity:10,observed_quantity:7,computed_variance:-3,post_snapshot_classification:'quantity_changed',recount_outcome:null,allowed_actions:[{action:'lot_quantity_adjusted',reason_required:true,destination_mode:'none',quantity_mode:'latest_observed',approval_required:true}]}]);render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-REVIEW'));expect(await screen.findByText(/Post-snapshot change: quantity changed/)).toBeTruthy();fireEvent.change(screen.getByLabelText('Resolution reason'),{target:{value:'verified'}});const resolve=screen.getByText('Resolve current result') as HTMLButtonElement;expect(resolve.disabled).toBe(true);fireEvent.click(screen.getByText('I reviewed the post-snapshot activity'));expect(resolve.disabled).toBe(false)});
 it('shows durable failure and retry',async()=>{api.list.mockResolvedValue([review]);api.attempts.mockResolvedValue([{id:'a',discrepancy_id:'d',action:'lot_quantity_adjusted',reason:'count',reviewed_destination_code:null,status:'failed',failure_classification:'GOVERNED_VALIDATION_FAILED',created_at:'2026-01-01',events:[]}]);api.executeAttempt.mockResolvedValue({outcome:'succeeded'});render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-REVIEW'));expect(await screen.findByText(/GOVERNED_VALIDATION_FAILED/)).toBeTruthy();fireEvent.click(screen.getByText('Retry'));expect(api.executeAttempt).toHaveBeenCalledWith('a')});
 it('renders completed totals from the latest-result summary',async()=>{const completed={...review,status:'completed',public_id:'RV-CC-DONE'};api.list.mockResolvedValue([completed]);api.history.mockResolvedValue({status:'completed',completion_summary:{latest_subject_count:2,found_item_count:1,observed_lot_quantity:10,shortage_quantity:0,overage_quantity:0,net_variance:0,resolved_discrepancy_count:2,deferred_discrepancy_count:0},rounds:[]});render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-DONE'));expect(await screen.findByLabelText('Latest-result completion summary')).toBeTruthy();expect(screen.getByText('Observed lot units').parentElement?.textContent).toContain('10');expect(screen.getByText(/Historical evidence is excluded/)).toBeTruthy()});
 it('only enables completion when no current discrepancy remains',async()=>{api.list.mockResolvedValue([review]);api.complete.mockResolvedValue({outcome:'completed'});render(<CycleCounts/>);fireEvent.click(await screen.findByText('RV-CC-REVIEW'));const complete=await screen.findByText('Complete cycle count') as HTMLButtonElement;expect(complete.disabled).toBe(false);fireEvent.click(complete);expect(api.complete).toHaveBeenCalledWith('s',false,'All current results reviewed')});
});

// First use was missing entirely: an empty workspace could display and operate
// existing sessions, but had no way to create one, while the server had exposed
// create and start all along.
describe('Cycle Counts first use', () => {
  const openForm = async () => {
    render(<CycleCounts />);
    fireEvent.click(await screen.findByText('Start cycle count'));
  };
  const reviewScope = () => {
    fireEvent.change(screen.getByLabelText('Root location code'), { target: { value: 'BIN-A' } });
    fireEvent.click(screen.getByText('Review scope'));
  };

  it('offers a way to start one in a workspace that has none', async () => {
    render(<CycleCounts />);
    expect(await screen.findByText('Start cycle count')).toBeTruthy();
    // The old empty state said only "Choose a session" — with nothing to choose.
    expect(screen.getByText(/start a new cycle count/i)).toBeTruthy();
  });

  it('does not offer a viewer the ability to start one', async () => {
    role = 'viewer';
    render(<CycleCounts />);
    await screen.findByText('Cycle Counts');
    expect(screen.queryByText('Start cycle count')).toBeNull();
  });

  it('reviews the scope before anything is created', async () => {
    await openForm();
    reviewScope();
    expect(await screen.findByText('Create draft')).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  // A blind count exists to prevent exactly this: being told what to find.
  it('reveals no expected totals while reviewing a blind scope', async () => {
    await openForm();
    reviewScope();
    await screen.findByText('Create draft');
    expect(screen.getByText(/nothing here or on the counting screen will tell you what is expected/i)).toBeTruthy();
    expect(screen.queryByText(/expected item/i)).toBeNull();
    expect(screen.queryByText(/expected quantity/i)).toBeNull();
  });

  it('creates a draft and then requires an explicit start', async () => {
    await openForm();
    reviewScope();
    fireEvent.click(await screen.findByText('Create draft'));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    // Creating does not start counting: starting freezes the expected-inventory
    // snapshot, and that is the moment worth confirming.
    expect(api.start).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('Start counting'));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith('cc-1'));
  });

  it('sends an idempotency key and the chosen scope', async () => {
    await openForm();
    reviewScope();
    fireEvent.click(await screen.findByText('Create draft'));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    const scope = api.create.mock.calls[0][0];
    expect(scope.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(scope.rootLocationCode).toBe('BIN-A');
    expect(scope.blindCount).toBe(true);
  });

  // If the first attempt committed and the response was lost, the retry must
  // reattach rather than open a second count over the same shelf.
  it('reuses the same key on retry rather than minting a new one', async () => {
    api.create.mockRejectedValueOnce(new Error('network lost'))
      .mockResolvedValueOnce({ id: 'cc-1', public_id: 'RV-CC-AAA111', status: 'draft', outcome: 'idempotent_replay' });
    await openForm();
    reviewScope();
    fireEvent.click(await screen.findByText('Create draft'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('Create draft'));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
    expect(api.create.mock.calls[1][0].idempotencyKey).toBe(api.create.mock.calls[0][0].idempotencyKey);
  });

  it('says plainly when a retry reattached to an existing draft', async () => {
    api.create.mockResolvedValue({ id: 'cc-1', public_id: 'RV-CC-AAA111', status: 'draft', outcome: 'idempotent_replay' });
    await openForm();
    reviewScope();
    fireEvent.click(await screen.findByText('Create draft'));
    expect(await screen.findByText(/Reattached to the draft this request already created/)).toBeTruthy();
  });

  // Create succeeded, start failed. Saying nothing about the draft would leave
  // the operator hunting for a session they were never told about.
  it('reports the created draft honestly when starting it fails', async () => {
    api.start.mockRejectedValue(new Error('The snapshot could not be frozen.'));
    await openForm();
    reviewScope();
    fireEvent.click(await screen.findByText('Create draft'));
    fireEvent.click(await screen.findByText('Start counting'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The snapshot could not be frozen.');
    expect(alert.textContent).toContain('RV-CC-AAA111');
    expect(alert.textContent).toMatch(/still waiting to be started/);
  });

  it('carries an explicitly non-blind choice through to the request', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText('Root location code'), { target: { value: 'BIN-A' } });
    fireEvent.click(screen.getByLabelText(/Blind count/));
    fireEvent.click(screen.getByText('Review scope'));
    expect(await screen.findByText('Expected quantities visible')).toBeTruthy();
    fireEvent.click(screen.getByText('Create draft'));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0].blindCount).toBe(false);
  });

  // Scope filters are database enums. Typing them by hand produced a filter
  // that matched nothing and a count that found nothing, with no way to tell
  // which had happened.
  it('offers the governed categories as choices rather than free text', async () => {
    await openForm();
    const subtype = screen.getByLabelText('Category (optional)') as HTMLSelectElement;
    expect(subtype.tagName).toBe('SELECT');
    const options = [...subtype.options].map((o) => o.textContent);
    expect(options[0]).toBe('Every category');
    expect(options).toContain('Graded Card');
    expect(options).toContain('Sealed TCG');
    // Never a raw enum value in front of the operator.
    expect(options).not.toContain('graded_card');
  });

  it('offers the governed verticals as choices rather than free text', async () => {
    await openForm();
    const vertical = screen.getByLabelText('Business vertical (optional)') as HTMLSelectElement;
    expect(vertical.tagName).toBe('SELECT');
    const options = [...vertical.options].map((o) => o.textContent);
    expect(options[0]).toBe('Every vertical');
    expect(options).toContain('Trading cards');
    expect(options).not.toContain('tcg');
  });

  it('sends the enum value each select stands for', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText('Root location code'), { target: { value: 'BIN-A' } });
    fireEvent.change(screen.getByLabelText('Category (optional)'), { target: { value: 'sealed_tcg' } });
    fireEvent.change(screen.getByLabelText('Business vertical (optional)'), { target: { value: 'tcg' } });
    fireEvent.click(screen.getByText('Review scope'));
    // The review screen reads back the label, not the enum.
    expect(await screen.findByText('Sealed TCG')).toBeTruthy();
    expect(screen.getByText('Trading cards')).toBeTruthy();

    fireEvent.click(screen.getByText('Create draft'));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0].subtypeFilter).toBe('sealed_tcg');
    expect(api.create.mock.calls[0][0].verticalFilter).toBe('tcg');
  });

  it('sends no filter at all when neither select is used', async () => {
    await openForm();
    reviewScope();
    fireEvent.click(await screen.findByText('Create draft'));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0].subtypeFilter ?? null).toBeNull();
    expect(api.create.mock.calls[0][0].verticalFilter ?? null).toBeNull();
  });

  // The key is bound in the database to the scope it was first used with.
  // Editing the scope after an unknown result makes this a DIFFERENT request,
  // so it must carry a different key — otherwise the database correctly
  // refuses it as key reuse and the operator cannot proceed at all.
  it('mints a new key when the scope is edited after an unknown result', async () => {
    api.create.mockRejectedValueOnce(new Error('network lost'));
    await openForm();
    reviewScope();
    fireEvent.click(await screen.findByText('Create draft'));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByText('Back'));
    fireEvent.change(screen.getByLabelText('Root location code'), { target: { value: 'BIN-B' } });
    fireEvent.click(screen.getByText('Review scope'));
    fireEvent.click(await screen.findByText('Create draft'));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));

    expect(api.create.mock.calls[1][0].rootLocationCode).toBe('BIN-B');
    expect(api.create.mock.calls[1][0].idempotencyKey)
      .not.toBe(api.create.mock.calls[0][0].idempotencyKey);
  });

  it('still reuses the key when the scope is untouched after an unknown result', async () => {
    api.create.mockRejectedValueOnce(new Error('network lost'))
      .mockResolvedValueOnce({ id: 'cc-1', public_id: 'RV-CC-AAA111', status: 'draft', outcome: 'idempotent_replay' });
    await openForm();
    reviewScope();
    fireEvent.click(await screen.findByText('Create draft'));
    await screen.findByRole('alert');
    // Back and forward through the form without changing anything.
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(screen.getByText('Review scope'));
    fireEvent.click(await screen.findByText('Create draft'));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
    expect(api.create.mock.calls[1][0].idempotencyKey).toBe(api.create.mock.calls[0][0].idempotencyKey);
  });

  it('explains a key-reuse conflict without inventing a draft', async () => {
    api.create.mockResolvedValueOnce({ outcome: 'idempotency_conflict', code: 'IDEMPOTENCY_KEY_REUSED' });
    await openForm();
    reviewScope();
    fireEvent.click(await screen.findByText('Create draft'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/already used to create a different count/);
    expect(alert.textContent).toMatch(/nothing was created or altered/);
    // No draft was invented from a response that carried none.
    expect(screen.queryByText('Start counting')).toBeNull();
  });

  it('recovers from a conflict with a fresh key on the next attempt', async () => {
    api.create.mockResolvedValueOnce({ outcome: 'idempotency_conflict', code: 'IDEMPOTENCY_KEY_REUSED' })
      .mockResolvedValueOnce({ id: 'cc-1', public_id: 'RV-CC-AAA111', status: 'draft', outcome: 'created' });
    await openForm();
    reviewScope();
    fireEvent.click(await screen.findByText('Create draft'));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByText('Create draft'));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
    expect(api.create.mock.calls[1][0].idempotencyKey)
      .not.toBe(api.create.mock.calls[0][0].idempotencyKey);
    expect(await screen.findByText('Start counting')).toBeTruthy();
  });
});

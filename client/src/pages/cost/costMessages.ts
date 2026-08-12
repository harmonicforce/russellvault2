// The bounded governed refusal, in the owner's words.
//
// Each sentence names what the DATABASE decided and what the owner can do next.
// None of them apologises, guesses, or suggests a workaround: when the governed
// cost contract refuses an operation the refusal IS the governed answer, and a
// UI that offered a way around it would be offering a way around the contract.
//
// The code is always shown alongside the sentence, so an owner reporting a
// problem can name the same thing the server logged.

import { CostError } from '../../lib/costApi';

const MESSAGES: Record<string, string> = {
  cost_component_not_found:
    'That cost component could not be found in this workspace.',
  component_directly_attributed:
    'This cost belongs wholly to one acquisition line, so there is nothing to split. A directly-attributed '
    + 'component is already a cost basis.',
  allocation_already_confirmed:
    'This component already has a CONFIRMED allocation. Reverse it first if the split needs to change — '
    + 'reversing preserves the existing rows as history rather than deleting them.',
  component_reversed:
    'This cost component has been reversed and superseded, so it cannot be allocated. Work from the '
    + 'component that replaced it.',
  amount_not_known:
    'This component has no known amount, so there is no total to split. An amount the source never '
    + 'reported is not zero, and the governed contract will not let it be treated as one. The amount has '
    + 'to be established before any allocation can happen.',
  proposal_already_pending:
    'This component already has a PENDING proposal, so a second one was refused. The governed contract '
    + 'cannot withdraw a pending proposal — it can only be confirmed or left — so check whose proposal is '
    + 'on record before doing anything else.',
  duplicate_line_in_proposal:
    'The same acquisition line appeared more than once in the split. Each line may be allocated at most '
    + 'once per proposal.',
  line_outside_component_scope:
    'One of the lines named is not inside this component’s governed scope. A lot-scoped cost can only be '
    + 'split across that lot; an order-scoped cost, across the lots under that order.',
  acquisition_line_not_found:
    'One of the acquisition lines named could not be found in this workspace under that source system.',
  ambiguous_acquisition_line:
    'That acquisition line identity matches more than one governed record, so it does not identify one '
    + 'line. This needs investigation before a cost can be attached to it.',
  no_candidates_to_confirm:
    'There is no pending proposal to confirm. It may have been confirmed already, in which case the '
    + 'component now shows a confirmed allocation.',
  expected_total_mismatch:
    'The pending proposal does not total what this screen was showing, so nothing was confirmed. The '
    + 'proposal has changed since it was displayed — re-read the component and confirm against the '
    + 'current figures.',
  allocation_does_not_conserve:
    'The pending proposal does not add up to the component’s own amount, so the governed contract refused '
    + 'to confirm it. Cost is conserved by the database, not by this screen.',
  proposal_would_not_conserve:
    'This split does not add up to the component’s amount, so it was NOT sent. That refusal is '
    + 'deliberate: a proposal that does not conserve can never be confirmed and can never be withdrawn, '
    + 'so writing one would leave this component permanently stuck. Adjust the amounts until they total '
    + 'the component amount.',
  nothing_to_reverse:
    'This component has no confirmed allocation to reverse.',
  no_value_basis:
    'None of the lines in scope has a known direct cost, so there is no value to split in proportion to. '
    + 'A split was NOT invented from an even share and labelled as value-weighted — that would record a '
    + 'basis that does not exist. Choose a different method, or establish the direct costs first.',
  no_weight_basis:
    'Every line in scope has nothing to weight by, so this method has no basis to split on. Choose a '
    + 'different method.',
  no_lines_in_scope:
    'This component’s governed scope contains no acquisition lines, so there is nothing to split across.',
  method_not_computable:
    'A hand-entered split is not computed. Enter each amount directly.',
  acquisition_job_not_committed:
    'The acquisition import behind this cost has not been committed, so its costs cannot be attributed '
    + 'yet.',
  batch_too_large:
    'That split names more lines than the governed contract accepts in one proposal.',
  invalid_request: 'The governed contract refused these values.',
  unauthorized_workspace: 'You are not permitted to perform cost allocation in this workspace.',
  signed_out: 'Your session is no longer signed in.',
  cost_contract_missing:
    'The governed cost contract is not deployed in this environment. A database update has not been '
    + 'applied.',
  dependency_failed:
    'The governed cost service did not answer. Whether this request reached the record is unknown.',
};

export function costMessage(error: unknown): { readonly code: string; readonly message: string } {
  const code = error instanceof CostError ? error.code : 'dependency_failed';
  return { code, message: MESSAGES[code] ?? MESSAGES.dependency_failed };
}

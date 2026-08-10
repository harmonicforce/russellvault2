// The bounded governed refusal, in the operator's words.
//
// Each sentence names what the DATABASE decided and what the operator can do
// next. None of them apologises, guesses, or suggests a workaround: when S2.2
// refuses a receiving operation the refusal is the governed answer, and a UI
// that offered a way around it would be offering a way around the contract.
//
// The code is always shown alongside the sentence, so an operator reporting a
// problem can name the same thing the server logged.

import { ReceivingError } from '../../lib/receivingApi';

const MESSAGES: Record<string, string> = {
  receipt_not_open:
    'This receipt is no longer open, so it cannot be changed. A submitted or cancelled receipt is a closed record.',
  receipt_terminal:
    'This receipt has already reached a final state and cannot be changed.',
  receipt_not_submitted:
    'This receipt has not been submitted, so that operation does not apply to it yet.',
  receipt_line_conflict:
    'The stored quantity is not the one this screen was showing, so nothing was changed. The receipt has been re-read — check the current value and confirm again.',
  idempotency_conflict:
    'A different receiving session was already recorded under this request. Re-read the order before trying again.',
  acquisition_line_not_in_receipt_order:
    'That acquisition line does not belong to this receipt\'s order, so it cannot be received here.',
  acquisition_line_excluded:
    'That acquisition line has been excluded from downstream workflows, so receiving evidence cannot be recorded against it.',
  acquisition_integrity_error:
    'The governed records for that acquisition line are ambiguous, so receiving refused to act on them. This needs investigation before receiving can continue.',
  receipt_not_found: 'This receipt could not be found in this workspace.',
  receipt_line_not_found: 'That receipt line could not be found in this workspace.',
  acquisition_not_found: 'That acquisition order could not be found in this workspace.',
  invalid_request: 'The governed contract refused these values.',
  unauthorized_workspace: 'You are not permitted to perform receiving operations in this workspace.',
  signed_out: 'Your session is no longer signed in.',
  receiving_contract_missing:
    'The governed receiving contract is not deployed in this environment. A database update has not been applied.',
  dependency_failed:
    'The governed receiving service did not answer. Whether this request reached the record is unknown.',
};

export function mutationMessage(error: unknown): { readonly code: string; readonly message: string } {
  const code = error instanceof ReceivingError ? error.code : 'dependency_failed';
  return { code, message: MESSAGES[code] ?? MESSAGES.dependency_failed };
}

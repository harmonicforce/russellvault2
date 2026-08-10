// The governed receiving transport.
//
// Mirrors `acquisitionDetailApi` exactly: one `call` that attaches the caller's
// bearer token and the workspace, one bounded error type carrying the code the
// server named, and a transport factory the pages consume. Nothing here holds
// state, retries, or decides a receiving rule.
//
// THE THREE FACTS ARE SEPARATE TYPES, ON PURPOSE.
//
// `expectedQuantity` is acquisition evidence. `observed.quantityReceived` is
// receiving evidence. They are never the same field and neither is ever derived
// from the other, so no rendering path can accidentally write one from the
// other. There is no `difference` field: Batch 1 DISPLAYS a difference for
// operator awareness and records none.

export type ReceiptStatus = 'open' | 'submitted' | 'reconciled' | 'cancelled';

export type ReceivingWorkflowState =
  | 'not_started'
  | 'receiving_in_progress'
  | 'submitted_pending_review'
  | 'reconciled'
  | 'cancelled_only';

export type Role = 'owner' | 'operator' | 'viewer';

/** A governed shipment REFERENCE. Transport state, never receipt truth. */
export interface ReceivingShipment {
  readonly publicId: string;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly status: string;
  readonly expectedAt: string | null;
  /** The CARRIER's timestamp. Named so it cannot be read as a receipt's. */
  readonly carrierReceivedAt: string | null;
}

export interface ReceivingReceiptSummary {
  readonly publicId: string;
  readonly status: ReceiptStatus;
  readonly receivedAt: string | null;
  readonly shipmentPublicId: string | null;
  readonly recordedLineCount: number;
  readonly observedQuantityTotal: number;
  readonly createdAt: string;
}

export interface ReceivingQueueRow {
  readonly orderPublicId: string;
  readonly sourceOrderReference: string | null;
  readonly sellers: readonly string[];
  readonly orderStatus: string | null;
  readonly occurredAt: string | null;
  readonly receivableLineCount: number;
  readonly expectedQuantityTotal: number;
  readonly observedQuantityTotal: number;
  readonly workflowState: ReceivingWorkflowState;
  readonly openReceiptPublicId: string | null;
  readonly receipts: readonly ReceivingReceiptSummary[];
  readonly shipments: readonly ReceivingShipment[];
}

export interface ReceivingQueue {
  readonly coverage: 'governed_native_committed';
  readonly historicalLegacyImported: false;
  /** False when a read hit its ceiling, so the list is a subset and says so. */
  readonly complete: boolean;
  readonly role: Role;
  readonly rows: readonly ReceivingQueueRow[];
}

export interface ReceivingExpectedLine {
  readonly sourceSystemPublicId: string;
  readonly acquisitionLinePublicId: string;
  readonly title: string | null;
  /** EXPECTED — acquisition evidence. Receiving never rewrites it. */
  readonly expectedQuantity: number;
  readonly exclusionState: 'included' | 'excluded';
  /** OBSERVED on THIS receipt. Null means nothing has been counted yet. */
  readonly observed: {
    readonly receiptLinePublicId: string;
    readonly quantityReceived: number;
    readonly note: string | null;
  } | null;
  readonly cumulativeReceivedQuantity: number;
}

export interface ReceivingReceiptDetail {
  readonly coverage: 'governed_native_committed';
  readonly historicalLegacyImported: false;
  readonly role: Role;
  readonly receipt: {
    readonly publicId: string;
    readonly status: ReceiptStatus;
    readonly receivedAt: string | null;
    readonly note: string | null;
    readonly shipmentPublicId: string | null;
    readonly createdAt: string;
  };
  readonly order: {
    readonly publicId: string;
    readonly sourceOrderReference: string | null;
    readonly sellers: readonly string[];
    readonly orderStatus: string | null;
    readonly occurredAt: string | null;
  };
  readonly lines: readonly ReceivingExpectedLine[];
  readonly shipments: readonly ReceivingShipment[];
}

export interface ReceiptMutationResult {
  readonly receiptPublicId: string;
  readonly status: ReceiptStatus;
  readonly replayed: boolean;
}

export interface ReceiptLineMutationResult {
  readonly receiptLinePublicId: string;
  readonly quantityReceived: number;
  readonly replayed: boolean;
}

export class ReceivingError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * The refusals that mean "what you were shown is no longer what the database
 * holds".
 *
 * Named rather than inferred from a status, because 409 also covers "this
 * receipt is closed", which is not a stale-value problem and needs a different
 * sentence. A stale value must be re-read and re-confirmed, never resent.
 */
export const STALE_CODES: readonly string[] = ['receipt_line_conflict', 'idempotency_conflict'];

export function isStaleConflict(error: unknown): boolean {
  return error instanceof ReceivingError && STALE_CODES.includes(error.code);
}

async function call<T>(
  tokens: () => Promise<string | null>,
  path: string,
  workspaceId: string,
  init?: RequestInit,
): Promise<T> {
  const token = await tokens();
  if (!token) throw new ReceivingError('signed_out', 401);
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(
    `/api/receiving${path}${separator}workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...init?.headers,
      },
    },
  );
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new ReceivingError(body?.error ?? 'dependency_failed', response.status);
  return body as T;
}

export const receivingQueueKey = (workspaceId: string | undefined) =>
  ['receiving-queue', workspaceId] as const;
export const receivingReceiptKey = (workspaceId: string | undefined, receiptPublicId: string) =>
  ['receiving-receipt', workspaceId, receiptPublicId] as const;

/**
 * A key for ONE semantic operation.
 *
 * Minted where the operator confirms an intent, never inside a retry path. A
 * key created per attempt would make every retry a NEW operation to the
 * database, which is precisely the duplicate the key exists to prevent.
 *
 * Only opening a receipt needs one. The other Batch 1 operations already have
 * governed replay semantics of their own: recording is keyed on the
 * (receipt, acquisition line) grain, correction is a compare-and-set, and
 * cancel/submit return `replayed` when the receipt already holds the target
 * status.
 */
export function mintIdempotencyKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `receiving-${random}`.slice(0, 200);
}

export function createReceivingTransport(tokens: () => Promise<string | null>) {
  const post = <T,>(path: string, workspaceId: string, body: unknown) =>
    call<T>(tokens, path, workspaceId, { method: 'POST', body: JSON.stringify(body) });
  const receipt = (publicId: string) => `/receipts/${encodeURIComponent(publicId)}`;

  return {
    queue: (workspaceId: string) => call<ReceivingQueue>(tokens, '/queue', workspaceId),

    receipt: (workspaceId: string, receiptPublicId: string) =>
      call<ReceivingReceiptDetail>(tokens, receipt(receiptPublicId), workspaceId),

    openReceipt: (
      workspaceId: string,
      orderPublicId: string,
      body: {
        readonly shipmentPublicId: string | null;
        readonly receivedAt: string;
        readonly note: string | null;
        readonly idempotencyKey: string;
      },
    ) =>
      post<ReceiptMutationResult>(
        `/orders/${encodeURIComponent(orderPublicId)}/receipts`, workspaceId, body),

    recordLine: (
      workspaceId: string,
      receiptPublicId: string,
      body: {
        readonly sourceSystemPublicId: string;
        readonly acquisitionLinePublicId: string;
        readonly quantityReceived: number;
        readonly note: string | null;
      },
    ) => post<ReceiptLineMutationResult>(`${receipt(receiptPublicId)}/lines`, workspaceId, body),

    correctLine: (
      workspaceId: string,
      receiptLinePublicId: string,
      body: {
        readonly expectedQuantity: number;
        readonly desiredQuantity: number;
        readonly reason: string;
      },
    ) =>
      post<ReceiptLineMutationResult>(
        `/receipt-lines/${encodeURIComponent(receiptLinePublicId)}/correct`, workspaceId, body),

    cancelReceipt: (workspaceId: string, receiptPublicId: string, reason: string) =>
      post<ReceiptMutationResult>(`${receipt(receiptPublicId)}/cancel`, workspaceId, { reason }),

    submitReceipt: (workspaceId: string, receiptPublicId: string) =>
      post<ReceiptMutationResult>(`${receipt(receiptPublicId)}/submit`, workspaceId, {}),
  };
}

export type ReceivingTransport = ReturnType<typeof createReceivingTransport>;

// The governed cost allocation transport.
//
// Mirrors `receivingApi` exactly: one `call` that attaches the caller's bearer
// token and the workspace, one bounded error type carrying the code the server
// named, and a transport factory the pages consume. Nothing here holds state,
// retries, or decides an allocation rule.
//
// EVERY AMOUNT IS A STRING OF INTEGER MINOR UNITS.
//
// Not a number, and not a formatted currency string — a canonical decimal
// integer, e.g. `'1000'` for $10.00. There is deliberately no `number` anywhere
// on this surface where an amount is authoritative, in either direction:
//
//   * a JavaScript number is a float, and a float that has been through a JSON
//     round trip is not guaranteed to be the figure the ledger holds;
//   * `0.1 + 0.2` is the canonical demonstration of why money is never a float,
//     and a cost basis is exactly the kind of figure people later reconcile
//     against a bank statement.
//
// Arithmetic on these values is done in `BigInt`, in `costMoney.ts`. Formatting
// for display happens once, at the very edge, and the formatted string is never
// read back.
//
// AN UNKNOWN AMOUNT CARRIES NO FIGURE AT ALL. `Amount` is a discriminated
// union, and the `unknown` member has no `minor` field for a rendering path to
// reach for. That is the type system enforcing the rule the whole codebase
// rests on: a cost nobody reported is not a cost of zero.

export type Role = 'owner' | 'operator' | 'viewer';

/** `public.cost_component_type`. */
export type CostComponentType = 'item_price' | 'shipping' | 'tax' | 'fee' | 'discount' | 'other';

/** `public.cost_attribution_state`. */
export type CostAttributionState = 'direct' | 'allocated' | 'unresolved';

/**
 * `public.cost_allocation_state`.
 *
 * `withdrawn` arrived with S2.4.1. It is TERMINAL and history-preserving: the
 * row stays on record with its original amount and method, and the governed
 * transition trigger refuses to move it anywhere else. It is NOT a deletion and
 * nothing on this surface may present it as one.
 */
export type CostAllocationState = 'candidate' | 'confirmed' | 'reversed' | 'withdrawn';

/**
 * A governed amount.
 *
 * `unrepresentable` is not a database state — it is the server admitting that
 * the stored `bigint` is outside the range JSON carries exactly, so it will not
 * send a rounded figure dressed as the real one.
 */
export type Amount =
  | { readonly state: 'known'; readonly minor: string; readonly currency: string }
  | { readonly state: 'documented_free'; readonly minor: '0'; readonly currency: string }
  | { readonly state: 'unknown'; readonly currency: string }
  | { readonly state: 'unrepresentable'; readonly currency: string };

/** The CLOSED application vocabulary of allocation methods. */
export type AllocationMethod = 'manual_equal' | 'manual_quantity' | 'manual_value' | 'manual_custom';

export const ALLOCATION_METHODS: readonly AllocationMethod[] = [
  'manual_equal', 'manual_quantity', 'manual_value', 'manual_custom',
];

export interface MethodOption {
  readonly method: AllocationMethod;
  readonly description: string;
}

export type AllocationWorkflowState =
  | 'directly_attributed'
  | 'awaiting_proposal'
  | 'proposed_awaiting_confirmation'
  | 'allocated'
  | 'amount_not_known'
  | 'component_reversed';

export interface ScopeLine {
  readonly sourceSystemPublicId: string;
  readonly acquisitionLinePublicId: string;
  readonly title: string | null;
  readonly quantity: number;
  readonly exclusionState: 'included' | 'excluded';
  readonly lotPublicId: string;
  /** Null means NO known direct cost. It does not mean zero. */
  readonly knownDirectCostMinor: string | null;
}

export interface AllocationRecord {
  readonly allocationPublicId: string;
  readonly sourceSystemPublicId: string | null;
  readonly acquisitionLinePublicId: string | null;
  readonly amountMinor: string;
  readonly method: string;
  readonly state: CostAllocationState;
  readonly reviewedAt: string | null;
  readonly reversedAt: string | null;
  readonly createdAt: string;
}

export interface CostComponentSummary {
  readonly componentPublicId: string;
  readonly componentType: CostComponentType;
  readonly amount: Amount;
  readonly attributionState: CostAttributionState;
  readonly workflowState: AllocationWorkflowState;
  readonly scopeKind: 'line_item' | 'lot' | 'order';
  readonly orderPublicId: string | null;
  readonly lotPublicId: string | null;
  readonly directLinePublicId: string | null;
  readonly evidenceNote: string | null;
  readonly candidateCount: number;
  readonly confirmedCount: number;
  readonly createdAt: string;
  readonly isReversed: boolean;
}

export interface CostComponentDetail extends CostComponentSummary {
  readonly order: {
    readonly publicId: string;
    readonly sourceOrderReference: string | null;
    readonly orderStatus: string | null;
    readonly occurredAt: string | null;
  } | null;
  readonly scopeLines: readonly ScopeLine[];
  readonly allocations: readonly AllocationRecord[];
  readonly candidateTotalMinor: string;
  /**
   * Candidate sum minus the component total, exactly. Null when there is no
   * total to conserve against, or when a candidate amount could not be carried.
   */
  readonly conservationDeltaMinor: string | null;
}

export interface CostQueue {
  readonly coverage: 'governed_native_committed';
  readonly historicalLegacyImported: false;
  /** False when a read hit its ceiling, so the list is a subset and says so. */
  readonly complete: boolean;
  readonly role: Role;
  readonly methods: readonly MethodOption[];
  readonly rows: readonly CostComponentSummary[];
}

export interface CostComponentView {
  readonly coverage: 'governed_native_committed';
  readonly historicalLegacyImported: false;
  readonly role: Role;
  readonly methods: readonly MethodOption[];
  readonly basisMethods: readonly BasisMethodOption[];
  readonly component: CostComponentDetail;
  /**
   * The DERIVED basis for this component's scope lines.
   *
   * Carried separately from `component` on purpose: the component is evidence
   * an owner decided, this is what the governed recompute concluded from it,
   * and merging them would let a proposal read as a cost.
   */
  readonly basisImpact: BasisImpact;
}

export interface SplitShare {
  readonly sourceSystemPublicId: string;
  readonly acquisitionLinePublicId: string;
  readonly amountMinor: string;
  readonly weight: string;
}

export interface AllocationPreview {
  readonly coverage: 'governed_native_committed';
  readonly historicalLegacyImported: false;
  readonly method: AllocationMethod;
  readonly description: string;
  readonly componentPublicId: string;
  readonly totalMinor: string;
  readonly currency: string;
  readonly shares: readonly SplitShare[];
  /** Always false. Stated rather than implied: previewing changed nothing. */
  readonly wrote: false;
}

/**
 * The result of proposing a split.
 *
 * `replayable: false` is the important field, and it is the server SAYING what
 * the client would otherwise have to infer from an absence: this governed
 * function has no idempotency key, so a lost response can never be resolved by
 * sending the same request again.
 */
export interface ProposalResult {
  readonly componentPublicId: string;
  readonly method: AllocationMethod;
  readonly proposed: number;
  readonly totalMinor: string;
  readonly replayable: false;
}

export interface ConfirmationResult {
  readonly componentPublicId: string;
  readonly confirmed: number;
  readonly totalMinor: string;
  readonly replayable: false;
  readonly basisRecompute: BasisRecomputeOutcome;
}

export interface ReversalResult {
  readonly componentPublicId: string;
  readonly reversed: number;
  readonly replayable: false;
  readonly basisRecompute: BasisRecomputeOutcome;
}

/**
 * The result of withdrawing a pending proposal.
 *
 * `replayable: false` again: `withdraw_cost_allocation` has no idempotency key
 * and returns no `replayed` flag, so a lost response can never be resolved by
 * sending the same request again.
 */
export interface WithdrawalResult {
  readonly componentPublicId: string;
  readonly withdrawn: number;
  readonly replayable: false;
  readonly basisRecompute: BasisRecomputeOutcome;
}

// --- the derived inventory cost basis ----------------------------------------

/** `public.inventory_cost_basis_method`. */
export type BasisMethod =
  | 'fifo'
  | 'source_observed_specific'
  | 'deterministic_equal_attribution'
  | 'unresolved';

export interface BasisMethodOption {
  readonly method: BasisMethod;
  readonly description: string;
}

export interface BasisCurrencyTotal {
  readonly currency: string;
  /** Null when no unit in this currency has an established basis. NOT zero. */
  readonly knownTotalMinor: string | null;
  readonly resolvedUnitCount: number;
  readonly unresolvedUnitCount: number;
  readonly methods: readonly BasisMethod[];
}

export interface BasisLineImpact {
  readonly sourceSystemPublicId: string;
  readonly acquisitionLinePublicId: string;
  readonly title: string | null;
  readonly subjects: readonly {
    readonly subjectKind: 'lot' | 'item';
    readonly publicId: string;
  }[];
  /** One entry PER CURRENCY. There is deliberately no combined total. */
  readonly currencies: readonly BasisCurrencyTotal[];
  readonly unresolved: {
    readonly expectedQuantity: number;
    readonly reconciledQuantity: number;
    readonly pendingExpectedQuantity: number;
    readonly overageQuantity: number;
    readonly hasUnresolvedCostEvidence: boolean;
  } | null;
  readonly algorithmVersion: string | null;
  readonly derivedAt: string | null;
}

export interface BasisImpact {
  /**
   * False when no governed recompute has ever published a row for these lines.
   * A third state, distinct from both "resolved" and "unresolved".
   */
  readonly derived: boolean;
  readonly lines: readonly BasisLineImpact[];
}

/**
 * The outcome of the governed basis recompute, carried BESIDE an allocation
 * result rather than folded into it.
 *
 * A `failed` recompute never means the allocation failed. The allocation had
 * already committed when the recompute ran; saying otherwise would send an
 * owner to retry an operation that succeeded, and the retry would be refused.
 */
export type BasisRecomputeOutcome =
  | {
      readonly status: 'refreshed';
      readonly algorithmVersion: string;
      readonly contentHash: string;
      readonly basisRows: number;
    }
  | {
      readonly status: 'unchanged';
      readonly algorithmVersion: string;
      readonly contentHash: string;
      readonly basisRows: number;
    }
  | { readonly status: 'failed'; readonly code: string; readonly retryable: true };

// --- S2.6: the governed unresolved-cost queue --------------------------------

/**
 * Why one row needs attention.
 *
 * A CLOSED set of distinct, evidenced problems. There is deliberately no
 * "needs attention" bucket: six different problems need six different actions,
 * and collapsing them turns a work list into a pile.
 */
export type UnresolvedReason =
  | 'amount_not_known'
  | 'shared_cost_unallocated'
  | 'proposal_awaiting_review'
  | 'basis_unresolved'
  | 'overage_without_cost'
  | 'negative_net_cost_evidence'
  | 'basis_never_derived';

export interface ReasonDescriptor {
  readonly reason: UnresolvedReason;
  readonly title: string;
  readonly description: string;
  readonly nextAction: string;
}

export type UnresolvedSubject = 'cost_component' | 'acquisition_line' | 'workspace';

export interface UnresolvedRow {
  readonly key: string;
  readonly reason: UnresolvedReason;
  readonly subject: UnresolvedSubject;
  readonly componentPublicId: string | null;
  readonly componentType: CostComponentType | null;
  /** Null where the row is not about a component's own amount at all. */
  readonly amount: Amount | null;
  /** Rows are never merged across currencies and no total spans them. */
  readonly currency: string | null;
  readonly orderPublicId: string | null;
  readonly lotPublicId: string | null;
  readonly acquisitionLinePublicId: string | null;
  readonly sourceSystemPublicId: string | null;
  readonly attributionState: CostAttributionState | null;
  readonly candidateCount: number | null;
  readonly basis: {
    readonly unresolvedUnitCount: number;
    readonly methods: readonly BasisMethod[];
  } | null;
  readonly quantities: {
    readonly expected: number;
    readonly reconciled: number;
    readonly overage: number;
  } | null;
  readonly netMinor: string | null;
}

export interface UnresolvedCostQueue {
  readonly coverage: 'governed_native_committed';
  readonly historicalLegacyImported: false;
  /** False when a read hit its ceiling, so the list is a subset and says so. */
  readonly complete: boolean;
  readonly role: Role;
  readonly reasons: readonly ReasonDescriptor[];
  /**
   * What the last published derivation was.
   *
   * `staleness: 'not_evidenced'` is permanent and deliberate: nothing readable
   * evidences whether the current derivation still reflects current inputs, so
   * this surface reports what ran and refuses to claim whether it is current.
   */
  readonly derivation: {
    readonly everRun: boolean;
    readonly algorithmVersion: string | null;
    readonly derivedAt: string | null;
    readonly staleness: 'not_evidenced';
  };
  readonly rows: readonly UnresolvedRow[];
}

export class CostError extends Error {
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
 * component is directly attributed", which is not a stale-value problem and
 * needs a different sentence. A stale value must be re-read and re-confirmed,
 * never resent.
 */
export const STALE_CODES: readonly string[] = [
  'expected_total_mismatch',
  'allocation_does_not_conserve',
  'proposal_already_pending',
  'allocation_already_confirmed',
];

export function isStaleConflict(error: unknown): boolean {
  return error instanceof CostError && STALE_CODES.includes(error.code);
}

async function call<T>(
  tokens: () => Promise<string | null>,
  path: string,
  workspaceId: string,
  init?: RequestInit,
): Promise<T> {
  const token = await tokens();
  if (!token) throw new CostError('signed_out', 401);
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(
    `/api/cost${path}${separator}workspaceId=${encodeURIComponent(workspaceId)}`,
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
  if (!response.ok) throw new CostError(body?.error ?? 'dependency_failed', response.status);
  return body as T;
}

export const costQueueKey = (workspaceId: string | undefined) =>
  ['cost-queue', workspaceId] as const;
export const unresolvedCostKey = (workspaceId: string | undefined) =>
  ['cost-unresolved', workspaceId] as const;
export const costComponentKey = (workspaceId: string | undefined, componentPublicId: string) =>
  ['cost-component', workspaceId, componentPublicId] as const;

/** One line of a proposal, addressed by GOVERNED PUBLIC IDENTITY only. */
export interface ProposalLine {
  readonly sourceSystemPublicId: string;
  readonly acquisitionLinePublicId: string;
  readonly amountMinor: string;
}

export function createCostTransport(tokens: () => Promise<string | null>) {
  const post = <T,>(path: string, workspaceId: string, body: unknown) =>
    call<T>(tokens, path, workspaceId, { method: 'POST', body: JSON.stringify(body) });
  const component = (publicId: string) => `/components/${encodeURIComponent(publicId)}`;

  return {
    queue: (workspaceId: string) => call<CostQueue>(tokens, '/queue', workspaceId),

    /**
     * The unresolved-cost queue.
     *
     * A read, and only a read. It is deliberately a SEPARATE call from
     * `queue()`: the two answer different questions from different governed
     * surfaces, and one failing must not blank the other.
     */
    unresolved: (workspaceId: string) =>
      call<UnresolvedCostQueue>(tokens, '/unresolved', workspaceId),

    component: (workspaceId: string, componentPublicId: string) =>
      call<CostComponentView>(tokens, component(componentPublicId), workspaceId),

    /**
     * Compute a split without writing anything.
     *
     * The shares this returns are the shares `propose` takes. The caller sends
     * them back verbatim rather than recomputing, so the owner confirms exactly
     * the figures they were shown.
     */
    previewAllocation: (
      workspaceId: string,
      componentPublicId: string,
      body: {
        readonly method: AllocationMethod;
        readonly lines?: readonly {
          readonly sourceSystemPublicId: string;
          readonly acquisitionLinePublicId: string;
        }[];
      },
    ) =>
      post<AllocationPreview>(
        `${component(componentPublicId)}/allocation-preview`, workspaceId, body),

    propose: (
      workspaceId: string,
      componentPublicId: string,
      body: {
        readonly method: AllocationMethod;
        readonly allocations: readonly ProposalLine[];
      },
    ) => post<ProposalResult>(`${component(componentPublicId)}/allocations`, workspaceId, body),

    confirm: (workspaceId: string, componentPublicId: string, expectedTotalMinor: string) =>
      post<ConfirmationResult>(
        `${component(componentPublicId)}/allocations/confirm`, workspaceId, { expectedTotalMinor }),

    reverse: (workspaceId: string, componentPublicId: string, reason: string) =>
      post<ReversalResult>(
        `${component(componentPublicId)}/allocations/reverse`, workspaceId, { reason }),

    /**
     * Withdraw the pending proposal.
     *
     * Recovery, not an undo. The withdrawn rows stay on record with their
     * original amounts and method, and the reason becomes governed audit
     * history — so a reason is required here as well as in the database.
     */
    withdraw: (workspaceId: string, componentPublicId: string, reason: string) =>
      post<WithdrawalResult>(
        `${component(componentPublicId)}/allocations/withdraw`, workspaceId, { reason }),
  };
}

export type CostTransport = ReturnType<typeof createCostTransport>;

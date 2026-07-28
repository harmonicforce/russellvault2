// Single-item intake — draft persistence and restore reconciliation.
//
// Typing a graded slab or a pair of shoes into the form is real work. Closing
// the tab, reloading, or losing the connection used to throw all of it away,
// and worse: the half-finished draft group the form had already created on the
// server stayed behind with nothing pointing at it.
//
// This keeps the operator's typed values, and — separately — the identity of
// whatever that draft already created server-side, so a restored form can be
// reconciled against the server instead of guessing. The rules mirror Batch
// Intake's, because the risk is the same one: a restored draft must never be
// attached to a different workspace or a different session, and a retry must
// never create a second record.
//
// Pure logic only: no React, no network.

import type { CategoryValues } from './intakeCategories';

export interface SingleDraft {
  /**
   * The draft's FULL identity. Values alone are harmless; the group id is not,
   * so the workspace and session it belongs to travel with it.
   */
  readonly workspaceId: string;
  readonly categoryKey: string;
  readonly values: CategoryValues;
  readonly sessionId: string | null;
  readonly sessionLabel: string;
  /** The server draft this form already created, if it got that far. */
  readonly groupId: string | null;
  readonly groupVersion: number | null;
  /**
   * Set only once a commit was actually attempted. Restoring it is what makes
   * retrying an interrupted commit replay the receipt instead of duplicating.
   */
  readonly idempotencyKey: string | null;
  readonly savedAt: string;
}

/** What restoring concluded about the saved draft's server state. */
export type DraftRestoreState =
  /** Nothing had reached the server yet; only typed values were restored. */
  | { kind: 'values_only' }
  /** The draft is still live and editable under its original session. */
  | { kind: 'resumed'; groupId: string; version: number }
  /** The commit had actually succeeded before the interruption. */
  | { kind: 'already_committed'; groupId: string }
  /** The session or the draft is gone; values kept, server identity dropped. */
  | { kind: 'stale'; reason: string };

export function singleDraftStorageKey(workspaceId: string): string {
  return `rv.singleDraft.${workspaceId}`;
}

export function serializeSingleDraft(draft: SingleDraft): string {
  return JSON.stringify(draft);
}

/**
 * True when the form holds nothing worth saving. An untouched form must not
 * overwrite a real saved draft with a blank one.
 */
export function isBlankDraft(values: CategoryValues): boolean {
  return Object.entries(values).every(([key, value]) => {
    if (key === 'quantity') return value === '' || value === '1';
    if (key === 'tracking_choice') return true;
    return (value ?? '').trim() === '';
  });
}

/**
 * Restore a saved draft. Returns null on anything unrecognizable, and refuses
 * a draft belonging to a different workspace outright — restoring one would
 * carry another workspace's server group id into this one.
 */
export function deserializeSingleDraft(
  raw: string | null,
  expectedWorkspaceId?: string
): SingleDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SingleDraft;
    if (typeof parsed?.categoryKey !== 'string') return null;
    if (!parsed.values || typeof parsed.values !== 'object') return null;
    if (expectedWorkspaceId && parsed.workspaceId && parsed.workspaceId !== expectedWorkspaceId) {
      return null;
    }
    return {
      workspaceId: parsed.workspaceId ?? expectedWorkspaceId ?? '',
      categoryKey: parsed.categoryKey,
      values: { ...parsed.values },
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      sessionLabel: typeof parsed.sessionLabel === 'string' ? parsed.sessionLabel : '',
      groupId: typeof parsed.groupId === 'string' ? parsed.groupId : null,
      groupVersion: typeof parsed.groupVersion === 'number' ? parsed.groupVersion : null,
      idempotencyKey: typeof parsed.idempotencyKey === 'string' ? parsed.idempotencyKey : null,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    };
  } catch {
    return null;
  }
}

/**
 * Decide what a restored draft may reuse, given what the server says about its
 * session and its group. Pure, so the rule is testable without a network.
 *
 * The one thing this must never do is hand back a group id under a session
 * that is not the one the group was created in.
 */
export function reconcileRestoredDraft(input: {
  draft: SingleDraft;
  /** null when the draft never started a session. */
  sessionState: 'open' | 'closed' | 'missing' | null;
  /** null when the draft never created a group, or the lookup failed. */
  groupState: 'draft' | 'committed' | 'abandoned' | 'unreachable' | null;
}): DraftRestoreState {
  const { draft, sessionState, groupState } = input;

  // A committed group is a fact regardless of its session's state: the work
  // the operator was worried about losing actually landed.
  if (groupState === 'committed' && draft.groupId) {
    return { kind: 'already_committed', groupId: draft.groupId };
  }

  if (!draft.groupId) return { kind: 'values_only' };

  if (sessionState !== 'open') {
    return {
      kind: 'stale',
      reason:
        'The session this draft belonged to is no longer open. Your entries are kept — ' +
        'adding this now starts a new session and creates one record.',
    };
  }
  if (groupState === 'abandoned') {
    return {
      kind: 'stale',
      reason:
        'This draft was abandoned on the server. Your entries are kept — ' +
        'adding this now creates one new record.',
    };
  }
  if (groupState === 'unreachable' || groupState === null) {
    return {
      kind: 'stale',
      reason:
        'The saved draft could not be found on the server. Your entries are kept — ' +
        'adding this now creates one new record.',
    };
  }
  if (draft.groupVersion === null) {
    // Without the version there is nothing safe to update against; treat the
    // server draft as unusable rather than guessing a version.
    return { kind: 'stale', reason: 'The saved draft could not be resumed. Your entries are kept.' };
  }
  return { kind: 'resumed', groupId: draft.groupId, version: draft.groupVersion };
}

/**
 * What the form should hold after reconciliation. A stale outcome keeps every
 * typed value and drops ONLY the server identity, so the next commit creates
 * exactly one new record instead of replaying a key that no longer has a group.
 */
export function draftAfterRestore(
  draft: SingleDraft,
  state: DraftRestoreState
): { values: CategoryValues; sessionId: string | null; group: { id: string; version: number } | null; idempotencyKey: string | null } {
  switch (state.kind) {
    case 'resumed':
      return {
        values: draft.values,
        sessionId: draft.sessionId,
        group: { id: state.groupId, version: state.version },
        idempotencyKey: draft.idempotencyKey,
      };
    case 'values_only':
      return {
        values: draft.values,
        sessionId: draft.sessionId,
        group: null,
        idempotencyKey: draft.idempotencyKey,
      };
    case 'already_committed':
    case 'stale':
      // An idempotency key is only meaningful paired with its group. Carrying
      // it forward alone is how a retry silently replays the wrong receipt.
      return { values: draft.values, sessionId: null, group: null, idempotencyKey: null };
  }
}

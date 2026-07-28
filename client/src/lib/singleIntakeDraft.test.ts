// Single-item draft persistence: what survives a refresh, and — more
// importantly — what is deliberately dropped so a restore cannot duplicate a
// record or attach one session's draft to another.
import { describe, expect, it } from 'vitest';
import {
  deserializeSingleDraft, draftAfterRestore, isBlankDraft, reconcileRestoredDraft,
  serializeSingleDraft, singleDraftStorageKey, type SingleDraft,
} from './singleIntakeDraft';

function draft(over: Partial<SingleDraft> = {}): SingleDraft {
  return {
    workspaceId: 'ws-1',
    categoryKey: 'graded_card',
    values: { card_name: 'Charizard', certificate_number: 'CERT-9' },
    sessionId: 'sess-1',
    sessionLabel: 'Tuesday intake',
    groupId: 'g-1',
    groupVersion: 4,
    idempotencyKey: 'idem-1',
    savedAt: '2026-07-28T10:00:00.000Z',
    ...over,
  };
}

describe('storage key', () => {
  it('is scoped per workspace', () => {
    expect(singleDraftStorageKey('ws-1')).not.toBe(singleDraftStorageKey('ws-2'));
  });
});

describe('round trip', () => {
  it('preserves the typed values and the server identity together', () => {
    const restored = deserializeSingleDraft(serializeSingleDraft(draft()), 'ws-1');
    expect(restored).not.toBeNull();
    expect(restored!.values.card_name).toBe('Charizard');
    expect(restored!.groupId).toBe('g-1');
    expect(restored!.groupVersion).toBe(4);
    expect(restored!.idempotencyKey).toBe('idem-1');
    expect(restored!.sessionId).toBe('sess-1');
  });

  it('refuses a draft saved under a different workspace', () => {
    expect(deserializeSingleDraft(serializeSingleDraft(draft()), 'ws-2')).toBeNull();
  });

  it('returns null for missing or corrupt storage rather than throwing', () => {
    expect(deserializeSingleDraft(null)).toBeNull();
    expect(deserializeSingleDraft('not json')).toBeNull();
    expect(deserializeSingleDraft('{"categoryKey":"graded_card"}')).toBeNull();
  });
});

describe('blank drafts', () => {
  it('treats an untouched form as nothing worth saving', () => {
    expect(isBlankDraft({ card_name: '', quantity: '1', tracking_choice: 'serialized' })).toBe(true);
    expect(isBlankDraft({ card_name: '  ', quantity: '' })).toBe(true);
  });

  it('treats any real entry as worth saving', () => {
    expect(isBlankDraft({ card_name: 'Charizard', quantity: '1' })).toBe(false);
    expect(isBlankDraft({ card_name: '', quantity: '3' })).toBe(false);
  });
});

describe('reconciling a restored draft against the server', () => {
  it('resumes a live draft under its original session', () => {
    const state = reconcileRestoredDraft({
      draft: draft(), sessionState: 'open', groupState: 'draft',
    });
    expect(state).toEqual({ kind: 'resumed', groupId: 'g-1', version: 4 });
    const after = draftAfterRestore(draft(), state);
    expect(after.group).toEqual({ id: 'g-1', version: 4 });
    expect(after.sessionId).toBe('sess-1');
  });

  it('reports a commit that had actually succeeded before the interruption', () => {
    const state = reconcileRestoredDraft({
      draft: draft(), sessionState: 'open', groupState: 'committed',
    });
    expect(state).toEqual({ kind: 'already_committed', groupId: 'g-1' });
  });

  it('still reports the commit when the session has since closed', () => {
    // A committed group is a fact about inventory, not about the session.
    const state = reconcileRestoredDraft({
      draft: draft(), sessionState: 'closed', groupState: 'committed',
    });
    expect(state.kind).toBe('already_committed');
  });

  it('never resumes a group under a session that is no longer open', () => {
    for (const sessionState of ['closed', 'missing', null] as const) {
      const state = reconcileRestoredDraft({ draft: draft(), sessionState, groupState: 'draft' });
      expect(state.kind).toBe('stale');
    }
  });

  it('drops an abandoned or unreachable server draft but keeps the typing', () => {
    for (const groupState of ['abandoned', 'unreachable', null] as const) {
      const state = reconcileRestoredDraft({ draft: draft(), sessionState: 'open', groupState });
      expect(state.kind).toBe('stale');
      const after = draftAfterRestore(draft(), state);
      expect(after.values.card_name).toBe('Charizard');
      expect(after.group).toBeNull();
    }
  });

  it('will not resume a group whose version was not saved', () => {
    const state = reconcileRestoredDraft({
      draft: draft({ groupVersion: null }), sessionState: 'open', groupState: 'draft',
    });
    expect(state.kind).toBe('stale');
  });

  it('restores values alone when nothing had reached the server', () => {
    const d = draft({ groupId: null, groupVersion: null, idempotencyKey: null, sessionId: null });
    const state = reconcileRestoredDraft({ draft: d, sessionState: null, groupState: null });
    expect(state).toEqual({ kind: 'values_only' });
    expect(draftAfterRestore(d, state).values.card_name).toBe('Charizard');
  });
});

describe('what a stale restore deliberately discards', () => {
  it('drops the idempotency key with the group it belonged to', () => {
    // A key without its group cannot replay a receipt — it can only mislead
    // the next commit into thinking a retry is in progress.
    const state = reconcileRestoredDraft({
      draft: draft(), sessionState: 'open', groupState: 'abandoned',
    });
    const after = draftAfterRestore(draft(), state);
    expect(after.idempotencyKey).toBeNull();
    expect(after.group).toBeNull();
    expect(after.sessionId).toBeNull();
  });

  it('drops the session so the next commit opens a fresh one', () => {
    const state = reconcileRestoredDraft({
      draft: draft(), sessionState: 'closed', groupState: 'draft',
    });
    expect(draftAfterRestore(draft(), state).sessionId).toBeNull();
  });
});

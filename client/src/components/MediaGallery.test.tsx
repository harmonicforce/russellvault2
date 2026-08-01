// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MediaGallery } from './MediaGallery';
import type { MediaReadiness, MediaRecord, MediaTransport } from '../lib/mediaApi';

const slot = (key: string, label: string, required: boolean, covered: boolean, kind = 'angle') =>
  ({ slot_key: key, slot_label: label, slot_kind: kind, is_required: required, covered }) as MediaReadiness['slots'][number];

function media(over: Partial<MediaRecord> & { id: string }): MediaRecord {
  return {
    lifecycle: 'active', storage_path: `ws/subject/${over.id}.jpg`, slot_key: null, slot_label: null,
    sort_order: 0, is_primary: false, content_type: 'image/jpeg', byte_size: 1000,
    rotation_degrees: 0, original_filename: null, created_at: '2026-08-01T00:00:00Z',
    deleted_at: null, purge_after: null, purged_at: null, ...over,
  } as MediaRecord;
}

let rows: MediaRecord[];
let readiness: MediaReadiness;
let calls: Array<{ fn: string; args: unknown[] }>;

function fakeTransport(): MediaTransport {
  const record = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); return Promise.resolve({}); };
  return {
    list: async () => rows,
    readiness: async () => readiness,
    signedUrls: async (paths: readonly string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    reorder: (kind: string, subjectId: string, ids: readonly string[]) => {
      calls.push({ fn: 'reorder', args: [kind, subjectId, [...ids]] });
      return Promise.resolve({});
    },
    setPrimary: record('setPrimary'),
    rotate: record('rotate'),
    remove: record('remove'),
    restore: record('restore'),
    reserve: record('reserve'),
    commit: record('commit'),
    abandon: record('abandon'),
    purge: record('purge'),
    issues: async () => [],
    reconcile: record('reconcile'),
    resolveIssue: record('resolveIssue'),
    readinessSummary: async () => ({ counts: {}, open_issue_count: 0 }),
  } as unknown as MediaTransport;
}

beforeEach(() => {
  calls = [];
  rows = [
    media({ id: 'a', slot_label: 'Front', slot_key: 'front', sort_order: 0, is_primary: true }),
    media({ id: 'b', slot_label: 'Back', slot_key: 'back', sort_order: 1 }),
    media({ id: 'c', slot_label: 'Defects', slot_key: 'defects', sort_order: 2 }),
  ];
  readiness = {
    readiness_status: 'missing_defect_photo', subtype: 'raw_card',
    active_count: 3, reserved_count: 0, recoverable_count: 0, open_issue_count: 0,
    missing_required_angles: [], missing_required_defect_photos: ['Defects or flaws'],
    slots: [slot('front', 'Front', true, true), slot('back', 'Back', true, true),
            slot('defects', 'Defects or flaws', true, false, 'defect')],
  };
});
afterEach(() => cleanup());

const renderGallery = (canEdit = true) =>
  render(<MediaGallery transport={fakeTransport()} subjectKind="item" subjectId="subject-1" canEdit={canEdit} />);

describe('media gallery', () => {
  it('shows the photos, the primary image and the outstanding checklist item', async () => {
    renderGallery();
    expect(await screen.findByText('Primary')).toBeTruthy();
    expect(screen.getByText('Needs a condition photo')).toBeTruthy();
    // The uncovered required slot is the one still flagged.
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });

  // Required scenario: reorder using the touch controls persists.
  it('reorders with the touch controls and sends the whole new sequence', async () => {
    renderGallery();
    fireEvent.click(await screen.findByLabelText('Move Back earlier'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'reorder')).toBeTruthy());
    expect(calls.find((c) => c.fn === 'reorder')!.args[2]).toEqual(['b', 'a', 'c']);
  });

  it('does not offer to move the first photo earlier or the last one later', async () => {
    renderGallery();
    expect((await screen.findByLabelText('Move Front earlier') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Move Defects later') as HTMLButtonElement).disabled).toBe(true);
  });

  it('switches the primary image through the governed call', async () => {
    renderGallery();
    fireEvent.click(await screen.findByLabelText('Make Back the primary image'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'setPrimary')?.args[0]).toBe('b'));
    // The photo that is already primary offers no such control.
    expect(screen.queryByLabelText('Make Front the primary image')).toBeNull();
  });

  it('rotates by a quarter turn without touching the stored path', async () => {
    renderGallery();
    fireEvent.click(await screen.findByLabelText('Rotate Front'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'rotate')?.args).toEqual(['a', 90]));
  });

  it('applies stored rotation at display time only', async () => {
    rows[0] = media({ id: 'a', slot_label: 'Front', slot_key: 'front', is_primary: true, rotation_degrees: 90 });
    renderGallery();
    const image = await screen.findByAltText('Front');
    expect(image.getAttribute('style')).toContain('rotate(90deg)');
    expect(image.getAttribute('src')).toBe('https://signed/ws/subject/a.jpg');
  });

  it('confirms before deleting and does nothing when the operator declines', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderGallery();
    fireEvent.click(await screen.findByLabelText('Delete Back'));
    expect(confirm).toHaveBeenCalled();
    expect(calls.find((c) => c.fn === 'remove')).toBeUndefined();
    // The photo is still in the gallery.
    expect(screen.getByLabelText('Delete Back')).toBeTruthy();
    confirm.mockRestore();
  });

  it('deletes on confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderGallery();
    fireEvent.click(await screen.findByLabelText('Delete Back'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'remove')?.args[0]).toBe('b'));
    confirm.mockRestore();
  });

  it('offers recently deleted photos for restoration', async () => {
    rows.push(media({
      id: 'd', slot_label: 'Old', lifecycle: 'deleted',
      deleted_at: '2026-08-01T00:00:00Z', purge_after: '2026-08-31T00:00:00Z',
    }));
    readiness = { ...readiness, recoverable_count: 1 };
    renderGallery();
    expect(await screen.findByText('Recently deleted')).toBeTruthy();
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'restore')?.args[0]).toBe('d'));
  });

  it('says an upload is unfinished rather than counting it as a photograph', async () => {
    rows.push(media({ id: 'e', lifecycle: 'reserved' }));
    readiness = { ...readiness, readiness_status: 'upload_incomplete', reserved_count: 1 };
    renderGallery();
    expect(await screen.findByText('Upload unfinished')).toBeTruthy();
    expect(screen.getByText(/still uploading or did not finish/)).toBeTruthy();
    // The unfinished upload is not rendered as one of the record's photos.
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });

  it('gives a viewer the gallery but none of the controls', async () => {
    renderGallery(false);
    expect(await screen.findByText('Primary')).toBeTruthy();
    expect(screen.queryByLabelText('Delete Back')).toBeNull();
    expect(screen.queryByLabelText('Rotate Front')).toBeNull();
    expect(screen.queryByText('Add photos')).toBeNull();
  });
});

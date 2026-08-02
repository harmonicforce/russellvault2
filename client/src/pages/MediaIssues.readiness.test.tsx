// @vitest-environment jsdom
//
// The photo readiness drill-down.
//
// The dashboard tile reports an exact governed total. The drill-down asked for
// one default page of fifty and offered no way forward, so a backlog of 120 let
// the operator reach seventy of the records the tile counted and no more —
// which is the same class of defect as a count that opens the wrong page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MediaReadinessPage, MediaReadinessStatus } from '../lib/operationsDashboardApi';

type Call = {
  workspaceId: string;
  status?: readonly MediaReadinessStatus[];
  limit?: number;
  offset?: number;
};

const calls: Call[] = [];
let respond: (call: Call) => Promise<MediaReadinessPage>;

vi.mock('../lib/workspaceContext', () => ({
  useWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Vault', role: 'owner' } }),
}));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient: () => ({}) }));
vi.mock('../lib/tokenProvider', () => ({ tokenProviderFromClient: () => async () => 'jwt' }));
// The storage-issues tab is not under test; it must simply not settle and
// disturb the readiness assertions.
vi.mock('../lib/mediaApi', () => ({
  createMediaTransport: () => ({
    issues: () => new Promise(() => undefined),
    reconcile: () => new Promise(() => undefined),
    resolveIssue: () => new Promise(() => undefined),
  }),
}));
vi.mock('../lib/operationsDashboardApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/operationsDashboardApi')>();
  return {
    ...actual,
    createOperationsDashboardTransport: () => ({
      mediaReadiness: (
        workspaceId: string, status?: readonly MediaReadinessStatus[], limit?: number, offset?: number,
      ) => {
        const call = { workspaceId, status, limit, offset };
        calls.push(call);
        return respond(call);
      },
    }),
  };
});

const { default: MediaIssues } = await import('./MediaIssues');

const row = (n: number, status: MediaReadinessStatus = 'missing_required_angle') => ({
  subject_kind: 'item' as const,
  subject_id: `i${n}`,
  public_id: `RV-I${n}`,
  display_name: `Charizard ${n}`,
  detail_line: null,
  subtype: 'graded_card',
  readiness_status: status,
  active_count: 1,
  reserved_count: 0,
  open_issue_count: 0,
  missing_required_angles: ['back'],
  missing_required_defect_photos: [],
});

const pageOf = (rows: ReturnType<typeof row>[], total: number, offset = 0): MediaReadinessPage => ({
  asOf: '2026-08-02T00:00:00Z', total, limit: 50, offset, rows,
});

const renderAt = (search: string) =>
  render(<MemoryRouter initialEntries={[`/photo-issues${search}`]}><MediaIssues /></MemoryRouter>);

beforeEach(() => {
  calls.length = 0;
  respond = async () => pageOf([row(1)], 1);
});
afterEach(cleanup);

describe('photo readiness drill-down', () => {
  it('asks for the first page with the governed page size', async () => {
    renderAt('?tab=readiness&status=missing_required_angle');
    await screen.findByText('Charizard 1');
    expect(calls[0].status).toEqual(['missing_required_angle']);
    expect(calls[0].limit).toBe(50);
    expect(calls[0].offset).toBe(0);
  });

  // THE REGRESSION. A total above one page must be reachable.
  it('exposes a next page when the total exceeds one page', async () => {
    respond = async () => pageOf(Array.from({ length: 50 }, (_, i) => row(i + 1)), 120);
    renderAt('?tab=readiness');
    await screen.findByText('Charizard 1');

    expect(screen.getByText(/Page 1 of 3/)).toBeTruthy();
    expect(screen.getByText(/showing 1–50/)).toBeTruthy();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
  });

  it('requests the correct offset when the page changes', async () => {
    respond = async (call) => pageOf(
      Array.from({ length: 50 }, (_, i) => row((call.offset ?? 0) + i + 1)), 120, call.offset ?? 0);
    renderAt('?tab=readiness');
    await screen.findByText('Charizard 1');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].offset).toBe(50);
    await screen.findByText('Charizard 51');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.length).toBe(3));
    expect(calls[2].offset).toBe(100);
  });

  it('does not keep a page number when the status changes', async () => {
    respond = async (call) => pageOf(
      Array.from({ length: 50 }, (_, i) => row((call.offset ?? 0) + i + 1)), 120, call.offset ?? 0);
    renderAt('?tab=readiness');
    await screen.findByText('Charizard 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.length).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: 'Upload unfinished' }));
    await waitFor(() => expect(calls.length).toBe(3));
    // A different population starts at its own beginning.
    expect(calls[2].status).toEqual(['upload_incomplete']);
    expect(calls[2].offset).toBe(0);
  });

  // Stale rows under a new heading read as the answer to the new question.
  it('never shows the previous status’s rows while the next is loading', async () => {
    let release: (page: MediaReadinessPage) => void = () => undefined;
    respond = async (call) => {
      if (call.status?.[0] === 'upload_incomplete') {
        return new Promise<MediaReadinessPage>((resolve) => { release = resolve; });
      }
      return pageOf([row(1), row(2)], 2);
    };
    renderAt('?tab=readiness&status=missing_required_angle');
    await screen.findByText('Charizard 1');

    fireEvent.click(screen.getByRole('button', { name: 'Upload unfinished' }));
    await screen.findByText(/Loading photo readiness/);
    expect(screen.queryByText('Charizard 1')).toBeNull();
    expect(screen.queryByText('Charizard 2')).toBeNull();

    release(pageOf([row(9, 'upload_incomplete')], 1));
    await screen.findByText('Charizard 9');
  });

  it('ignores an unrecognised status instead of crashing on it', async () => {
    respond = async () => pageOf([row(1)], 1);
    renderAt('?tab=readiness&status=not_a_real_status');
    await screen.findByText('Charizard 1');

    // Dropped, not forwarded: sending it on would have reported an empty
    // backlog for a filter that never existed.
    expect(calls[0].status).toBeUndefined();
    expect(screen.getByText(/not one this system recognises/)).toBeTruthy();
  });

  it('treats a nonsense page number as the first page', async () => {
    renderAt('?tab=readiness&page=not-a-number');
    await screen.findByText('Charizard 1');
    expect(calls[0].offset).toBe(0);
  });

  it('reports a dependency failure as unknown, never as zero', async () => {
    respond = async () => { throw new Error('This dashboard panel could not be loaded because a dependency failed. The value is unknown, not zero.'); };
    renderAt('?tab=readiness');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('unknown, not zero');
    // No empty-state copy, and no fabricated count.
    expect(screen.queryByText(/Every current record has the photographs/)).toBeNull();
    expect(screen.queryByText(/^0 current record/)).toBeNull();
  });

  it('keeps the filters usable after a failure', async () => {
    respond = async () => { throw new Error('dependency failed'); };
    renderAt('?tab=readiness&status=missing_required_angle');
    await screen.findByRole('alert');
    // The operator can change the filter without navigating away from the error.
    expect(screen.getByRole('button', { name: 'Everything outstanding' })).toBeTruthy();
  });
});

// Phase 4 acquisition-review controller tests.
//
// Proves safe-by-default and fail-closed behavior, ACTUAL-role capability
// gating (the role comes from the server, never the UI), and the preview-gated
// commit flow — without a browser or a live server.

import { describe, it, expect, vi } from 'vitest';
import {
  AcquisitionReviewController,
  formatDetailValue,
  type AcquisitionTransport,
  type PreviewSummary,
  type WorkspaceRole,
} from './acquisitionReview';

function fakeTransport(
  role: WorkspaceRole = 'operator',
  overrides: Partial<AcquisitionTransport> = {}
): AcquisitionTransport {
  return {
    getSession: async () => ({ role }),
    listJobs: async () => [],
    listChannels: async () => [
      { id: 'ch-1', public_id: 'RV-CH-1', name: 'Whatnot', kind: 'marketplace' },
    ],
    listOrders: async () => ({ total: 0, orders: [] }),
    getOrderDetail: async () => ({
      order: { id: 'o1' },
      lots: [],
      placements: [],
      activePlacements: [],
      historicalPlacements: [],
      lines: [],
      costComponents: [],
      currentComponents: [],
      historicalComponents: [],
      allocations: [],
      currentAllocations: [],
      reversedAllocations: [],
      discrepancy: {},
      auditEvents: [],
    }),
    listSupplierCandidates: async () => [
      { sourceSystemId: 'ss-1', normalizedHandle: 'acme', rawHandles: ['acme', 'ACME'], supplierCount: 2 },
    ],
    listAuditEvents: async () => [],
    commit: async () => ({
      importJobId: 'j1',
      status: 'committed',
      orders: 2,
      lineItems: 2,
      resumed: false,
    }),
    preview: async () =>
      ({
        orders: 2,
        lots: 2,
        lineItems: 2,
        costComponents: 2,
        unresolvedSupplierCandidates: 1,
        unresolvedCostComponents: 0,
        distinctSellerHandles: 2,
        sourceReportedTotalMinor: 1000,
        normalizedKnownComponentMinor: 1000,
        knownComponents: 1,
        documentedFreeComponents: 0,
        unknownComponents: 1,
        discrepancies: 1,
        supplierCandidates: [],
        staging: true,
        authoritative: false,
      }) satisfies PreviewSummary,
    ...overrides,
  };
}

describe('safe by default', () => {
  it('an unconfigured controller is inert and makes no request', async () => {
    const getSession = vi.fn();
    const controller = new AcquisitionReviewController(
      fakeTransport('owner', { getSession }),
      false // not configured
    );
    expect(controller.getState().status).toBe('unconfigured');
    expect(controller.getState().capabilities.readOnly).toBe(true);
    await controller.open('ws-1');
    expect(getSession).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe('unconfigured');
  });

  it('is always staging and never authoritative', () => {
    const controller = new AcquisitionReviewController(fakeTransport(), true);
    expect(controller.getState().staging).toBe(true);
    expect(controller.getState().authoritative).toBe(false);
  });
});

describe('capabilities come from the ACTUAL server-resolved role', () => {
  it('a server-resolved viewer is read-only and cannot run the workflow', async () => {
    const preview = vi.fn();
    const controller = new AcquisitionReviewController(fakeTransport('viewer', { preview }), true);
    await controller.open('ws-1');
    expect(controller.getState().role).toBe('viewer');
    expect(controller.getState().capabilities.canRunWorkflow).toBe(false);
    expect(controller.getState().capabilities.readOnly).toBe(true);
    await controller.runPreview('job-1');
    expect(preview).not.toHaveBeenCalled();
    expect(controller.getState().error).toMatch(/operator or owner/);
  });

  it('a server-resolved operator may run the workflow', async () => {
    const controller = new AcquisitionReviewController(fakeTransport('operator'), true);
    await controller.open('ws-1');
    expect(controller.getState().capabilities.canRunWorkflow).toBe(true);
  });

  it('a server-resolved owner may run the workflow', async () => {
    const controller = new AcquisitionReviewController(fakeTransport('owner'), true);
    await controller.open('ws-1');
    expect(controller.getState().capabilities.canRunWorkflow).toBe(true);
  });
});

describe('preview-gated commit', () => {
  it('commit is refused until the exact source job has been previewed', async () => {
    const commit = vi.fn(async () => ({
      importJobId: 'j1',
      status: 'committed',
      orders: 2,
      lineItems: 2,
      resumed: false,
    }));
    const controller = new AcquisitionReviewController(fakeTransport('operator', { commit }), true);
    await controller.open('ws-1');

    // No preview yet → refused.
    await controller.runCommit({ sourceImportJobId: 'src', channelId: 'ch-1', idempotencyKey: 'key-000001' });
    expect(commit).not.toHaveBeenCalled();
    expect(controller.getState().error).toMatch(/preview this source import job/);

    // Preview a DIFFERENT job → committing 'src' still refused.
    await controller.runPreview('other');
    await controller.runCommit({ sourceImportJobId: 'src', channelId: 'ch-1', idempotencyKey: 'key-000001' });
    expect(commit).not.toHaveBeenCalled();

    // Preview 'src' → commit now allowed.
    await controller.runPreview('src');
    expect(controller.getState().previewedSourceJobId).toBe('src');
    await controller.runCommit({ sourceImportJobId: 'src', channelId: 'ch-1', idempotencyKey: 'key-000001' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(controller.getState().commitOutcome?.status).toBe('committed');
  });

  it('clearPreview invalidates a stale preview', async () => {
    const controller = new AcquisitionReviewController(fakeTransport('operator'), true);
    await controller.open('ws-1');
    await controller.runPreview('src');
    expect(controller.getState().previewedSourceJobId).toBe('src');
    controller.clearPreview();
    expect(controller.getState().previewedSourceJobId).toBeNull();
    expect(controller.getState().preview).toBeNull();
  });

  it('a viewer cannot run the governed commit even after (refused) preview', async () => {
    const commit = vi.fn();
    const controller = new AcquisitionReviewController(fakeTransport('viewer', { commit }), true);
    await controller.open('ws-1');
    await controller.runCommit({ sourceImportJobId: 'src', channelId: 'ch-1', idempotencyKey: 'key-000001' });
    expect(commit).not.toHaveBeenCalled();
    expect(controller.getState().error).toMatch(/operator or owner/);
  });
});

describe('order detail and candidates', () => {
  it('loads a selected order detail with current/historical sections', async () => {
    const controller = new AcquisitionReviewController(fakeTransport('viewer'), true);
    await controller.open('ws-1');
    await controller.openOrder('o1');
    const d = controller.getState().orderDetail;
    expect(d?.order).toEqual({ id: 'o1' });
    expect(d).toHaveProperty('currentComponents');
    expect(d).toHaveProperty('historicalComponents');
    expect(d).toHaveProperty('reversedAllocations');
  });

  it('candidates carry a source system id for a stable key', async () => {
    const controller = new AcquisitionReviewController(fakeTransport('operator'), true);
    await controller.open('ws-1');
    expect(controller.getState().candidates[0].sourceSystemId).toBe('ss-1');
  });

  it('channels are loaded for the commit control', async () => {
    const controller = new AcquisitionReviewController(fakeTransport('operator'), true);
    await controller.open('ws-1');
    expect(controller.getState().channels).toHaveLength(1);
  });
});

describe('formatDetailValue renders structured values readably', () => {
  it('renders a source_detail object as compact JSON, not [object Object]', () => {
    const rendered = formatDetailValue({ seller: 'acme', unit_cost: 3 });
    expect(rendered).toBe('{"seller":"acme","unit_cost":3}');
    expect(rendered).not.toContain('[object Object]');
  });
  it('renders null/undefined as a dash and scalars as strings', () => {
    expect(formatDetailValue(null)).toBe('—');
    expect(formatDetailValue(undefined)).toBe('—');
    expect(formatDetailValue(42)).toBe('42');
    expect(formatDetailValue('WN-A-000001')).toBe('WN-A-000001');
  });
});

describe('fail closed', () => {
  it('a load error shows an error state, not partial data', async () => {
    const controller = new AcquisitionReviewController(
      fakeTransport('operator', {
        listOrders: async () => {
          throw new Error('boom');
        },
      }),
      true
    );
    await controller.open('ws-1');
    expect(controller.getState().status).toBe('error');
    expect(controller.getState().orders).toHaveLength(0);
    expect(controller.getState().error).toBe('boom');
  });
});

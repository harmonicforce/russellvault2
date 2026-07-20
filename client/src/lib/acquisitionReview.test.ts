// Phase 4 acquisition-review controller tests.
//
// Proves the safe-by-default and fail-closed behavior and the viewer/operator
// permission gating that the page relies on, without a browser or a live server.

import { describe, it, expect, vi } from 'vitest';
import {
  AcquisitionReviewController,
  type AcquisitionTransport,
  type PreviewSummary,
} from './acquisitionReview';

function fakeTransport(overrides: Partial<AcquisitionTransport> = {}): AcquisitionTransport {
  return {
    listJobs: async () => [],
    listOrders: async () => ({ total: 0, orders: [] }),
    listSupplierCandidates: async () => [],
    listAuditEvents: async () => [],
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
    const listJobs = vi.fn();
    const controller = new AcquisitionReviewController(
      fakeTransport({ listJobs }),
      false // not configured
    );
    expect(controller.getState().status).toBe('unconfigured');
    expect(controller.getState().capabilities.readOnly).toBe(true);
    await controller.open('ws-1', 'owner');
    expect(listJobs).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe('unconfigured');
  });

  it('is always staging and never authoritative', () => {
    const controller = new AcquisitionReviewController(fakeTransport(), true);
    expect(controller.getState().staging).toBe(true);
    expect(controller.getState().authoritative).toBe(false);
  });
});

describe('permission gating', () => {
  it('a viewer is read-only and cannot run the workflow', async () => {
    const preview = vi.fn();
    const controller = new AcquisitionReviewController(fakeTransport({ preview }), true);
    await controller.open('ws-1', 'viewer');
    expect(controller.getState().capabilities.canRunWorkflow).toBe(false);
    expect(controller.getState().capabilities.readOnly).toBe(true);
    await controller.runPreview('job-1');
    expect(preview).not.toHaveBeenCalled();
    expect(controller.getState().error).toMatch(/operator or owner/);
  });

  it('an operator may run the workflow', async () => {
    const controller = new AcquisitionReviewController(fakeTransport(), true);
    await controller.open('ws-1', 'operator');
    expect(controller.getState().capabilities.canRunWorkflow).toBe(true);
    await controller.runPreview('job-1');
    const preview = controller.getState().preview;
    expect(preview).not.toBeNull();
    expect(preview!.unknownComponents).toBe(1);
    expect(preview!.authoritative).toBe(false);
  });

  it('an owner may run the workflow', async () => {
    const controller = new AcquisitionReviewController(fakeTransport(), true);
    await controller.open('ws-1', 'owner');
    expect(controller.getState().capabilities.canRunWorkflow).toBe(true);
  });
});

describe('fail closed', () => {
  it('a load error shows an error state, not partial data', async () => {
    const controller = new AcquisitionReviewController(
      fakeTransport({
        listOrders: async () => {
          throw new Error('boom');
        },
      }),
      true
    );
    await controller.open('ws-1', 'operator');
    expect(controller.getState().status).toBe('error');
    expect(controller.getState().orders).toHaveLength(0);
    expect(controller.getState().error).toBe('boom');
  });
});

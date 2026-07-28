// The read-only banner warns that changes will not be saved. It must appear
// on every page where that is true, and on none where it is false — an
// incorrect warning here tells the owner their working app is broken.
import { describe, expect, it } from 'vitest';
import { appliesToPath } from './ReadOnlyBanner';

describe('read-only banner scope', () => {
  it('covers every page when the Supabase surfaces are switched off', () => {
    // The legacy-only deployment: every page really is a legacy page.
    for (const path of ['/', '/inventory', '/sales', '/checks', '/anything']) {
      expect(appliesToPath(path, false)).toBe(true);
    }
  });

  it('still warns on the legacy write surfaces', () => {
    for (const path of ['/inventory', '/purchases', '/cost-links', '/listings', '/sales']) {
      expect(appliesToPath(path, true)).toBe(true);
    }
  });

  it('stays off the Supabase-backed pages, whose writes are unaffected', () => {
    for (const path of [
      '/', '/workbench', '/quick-add', '/batch-intake', '/scan',
      '/inventory/current', '/inventory/current/abc-123', '/inventory/lots/def-456',
      '/intake-sessions', '/locations', '/checks',
    ]) {
      expect(appliesToPath(path, true)).toBe(false);
    }
  });

  it('distinguishes legacy /inventory from the Supabase inventory beneath it', () => {
    expect(appliesToPath('/inventory', true)).toBe(true);
    expect(appliesToPath('/inventory/current', true)).toBe(false);
    expect(appliesToPath('/inventory/lots/x', true)).toBe(false);
  });
});

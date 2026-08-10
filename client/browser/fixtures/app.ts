// The browser-gate application fixture.
//
// WHAT THIS BOOTS
//
// The REAL Russell Vault production bundle: the real `main.tsx`, the real
// `AuthShell`, the real `AppShell`, the real routes, the real pages, and the
// real design system. There is no browser-test mode, no compile-time branch, no
// alternate entry point and no cloned "test version" of any page. The build the
// gate exercises is produced by the same `vite build` the deployment uses; only
// the four governed environment variables differ, and they point the app at a
// Supabase origin that does not exist.
//
// WHERE DETERMINISM COMES FROM
//
// Two places, both OUTSIDE the application:
//
//   1. `addInitScript` seeds the browser's own localStorage with the session
//      and theme a real operator's browser would already hold.
//   2. `page.route` answers the network at the browser boundary.
//
// The application does all of its own work in between. That is the difference
// between testing the UI we ship and testing a replica of it.
//
// Anything the harness does not explicitly answer is ABORTED rather than
// allowed out, so a fixture gap surfaces as a visible failure instead of a
// silent request to a real host.

import { test as base, expect, type Page, type Route } from '@playwright/test';
import {
  SUPABASE_STORAGE_KEY,
  SUPABASE_URL,
  WORKSPACE_ID,
  WORKSPACE_NAME,
  SKU_PREFIX,
  storedSession,
} from './identity';
import { ALL_LINES, FACETS, FIXED_NOW, makeDetail } from './data';
import { ReceivingWorld, RECEIPT_PUBLIC_ID } from './receivingData';
import type { AcquisitionDetail } from '../../src/lib/acquisitionDetailApi';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Scenario {
  /** Seeded theme preference. `system` leaves the OS preference in charge. */
  theme: ThemeChoice;
  /** Facet suggestions fail; the rows must survive it. */
  facetsFail: boolean;
  /** The acquisition detail this workspace returns. */
  detail: AcquisitionDetail;
  /**
   * Governed mutations reject with this code until it is cleared. Drives the
   * S1.6.6 unresolved-operation recovery path.
   */
  mutationFailure: string | null;
  /** The authoritative detail re-read fails; drives failed verification. */
  detailReadFails: boolean;
  /** `/api/health` reports a degraded legacy dependency. */
  degradedHealth: boolean;

  // --- S2.3 receiving ---------------------------------------------------
  /** The governed receiving queue read fails. Must never render as empty. */
  receivingQueueFails: boolean;
  /** The governed queue answers truthfully that there is nothing to receive. */
  receivingQueueEmpty: boolean;
  /** The queue answer is a subset, so the page must say so. */
  receivingQueuePartial: boolean;
  /** Governed receiving mutations reject with this code until cleared. */
  receivingMutationFailure: string | null;
  /** The caller's governed role, as the server reports it. */
  receivingRole: 'owner' | 'operator' | 'viewer';
  /** The live receiving world these routes read and mutate. */
  receiving: ReceivingWorld;
}

const DEFAULT_SCENARIO: Scenario = {
  theme: 'light',
  facetsFail: false,
  detail: makeDetail(),
  mutationFailure: null,
  detailReadFails: false,
  degradedHealth: false,
  receivingQueueFails: false,
  receivingQueueEmpty: false,
  receivingQueuePartial: false,
  receivingMutationFailure: null,
  receivingRole: 'operator',
  receiving: new ReceivingWorld(),
};

/**
 * A live, mutable scenario handle a spec can adjust mid-test.
 *
 * `set` is ASYNC on purpose. Route handlers read `state` lazily, so a network
 * change takes effect immediately — but the theme is seeded into localStorage
 * by an init script, and an init script is serialized when it is REGISTERED.
 * Changing the theme therefore has to re-register the seed before the next
 * navigation, and a synchronous setter would silently leave the old value in
 * place while appearing to work.
 */
export class ScenarioControl {
  readonly state: Scenario;
  private reseed: (() => Promise<void>) | null = null;

  constructor(initial?: Partial<Scenario>) {
    // A FRESH receiving world per scenario. `DEFAULT_SCENARIO` is a module
    // singleton, so spreading it would hand every test the same mutable object
    // and let one test's recorded quantity become the next test's starting
    // state — the kind of cross-test leak that produces a failure nobody can
    // reproduce in isolation.
    this.state = { ...DEFAULT_SCENARIO, receiving: new ReceivingWorld(), ...initial };
  }

  /** @internal wired by `installScenario`. */
  attach(reseed: () => Promise<void>): void {
    this.reseed = reseed;
  }

  async set(patch: Partial<Scenario>): Promise<void> {
    Object.assign(this.state, patch);
    if (this.reseed) await this.reseed();
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

/** Supabase PostgREST and GoTrue, answered at the browser boundary. */
async function routeSupabase(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname;

  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
      },
    });
  }

  // GoTrue. A refresh is answered rather than forbidden: the session is
  // long-lived, but a client that decides to refresh must not hang.
  if (path.startsWith('/auth/v1/')) {
    if (path.endsWith('/token')) return json(route, storedSession());
    if (path.endsWith('/logout')) return json(route, {});
    if (path.endsWith('/user')) return json(route, storedSession().user);
    return json(route, {});
  }

  // PostgREST.
  if (path === '/rest/v1/workspace_members') {
    return json(route, [{ workspace_id: WORKSPACE_ID, role: 'owner' }]);
  }
  if (path === '/rest/v1/workspaces') {
    return json(route, [
      {
        id: WORKSPACE_ID,
        name: WORKSPACE_NAME,
        sku_prefix: SKU_PREFIX,
        // Non-null: first-run setup is complete, so `FirstRunGate` lets the
        // governed routes mount. Setting it null would test the setup screen,
        // which is a different surface.
        setup_completed_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
  }

  // Any other governed table read: an empty result, which every governed
  // surface renders as a proven zero rather than a failure.
  return json(route, []);
}

/** The Express API surface, answered at the browser boundary. */
async function routeApi(route: Route, scenario: Scenario) {
  const url = new URL(route.request().url());
  const path = url.pathname;
  const method = route.request().method();

  if (path === '/api/health') {
    const healthy = !scenario.degradedHealth;
    return json(
      route,
      {
        ok: healthy,
        readOnly: true,
        legacyDatabaseAvailable: healthy,
        legacySchemaPresent: healthy,
        legacySeeded: healthy,
        legacyBootWritesEnabled: false,
        ...(healthy ? {} : { reason: 'legacy_database_unavailable' }),
      },
      healthy ? 200 : 503,
    );
  }

  if (path === '/api/version') {
    return json(route, { commit: 'browser-gate', builtAt: '2026-08-01T00:00:00.000Z' });
  }

  // --- Acquisitions list -------------------------------------------------
  if (path === '/api/acquisition/facets') {
    if (scenario.facetsFail) return json(route, { error: 'dependency_failed' }, 502);
    return json(route, {
      coverage: 'governed_native_committed',
      historicalLegacyImported: false,
      facets: FACETS,
    });
  }

  if (path === '/api/acquisition/lines') {
    const params = url.searchParams;
    const limit = Number(params.get('limit') ?? 50);
    const offset = Number(params.get('offset') ?? 0);

    // Filtering and sorting are applied HERE, in the recorded answer, exactly
    // as the server would. The client is never asked to re-derive them — that
    // would test a rule the client does not own.
    let rows = ALL_LINES.slice();
    const query = params.get('query');
    if (query) {
      const needle = query.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.full_title ?? '').toLowerCase().includes(needle) ||
          (r.seller_normalized ?? '').toLowerCase().includes(needle) ||
          (r.source_order_reference ?? '').toLowerCase().includes(needle),
      );
    }
    const seller = params.get('seller');
    if (seller) rows = rows.filter((r) => r.seller_normalized === seller);
    const vertical = params.get('businessVertical');
    if (vertical) rows = rows.filter((r) => r.business_vertical === vertical);
    const classification = params.get('classification');
    if (classification) rows = rows.filter((r) => r.classification_key === classification);
    const methodFilter = params.get('method');
    if (methodFilter) rows = rows.filter((r) => r.classification_method === methodFilter);
    const state = params.get('classificationState');
    if (state) rows = rows.filter((r) => r.classification_state === state);
    const exclusion = params.get('exclusionState');
    if (exclusion) rows = rows.filter((r) => r.exclusion_state === exclusion);

    const sort = params.get('sort') ?? 'occurred_at';
    const order = params.get('order') ?? 'desc';
    const key = (row: (typeof rows)[number]): string => {
      switch (sort) {
        case 'seller':
          return row.seller_normalized ?? '';
        case 'title':
          return row.full_title ?? '';
        case 'quantity':
          return String(row.quantity).padStart(6, '0');
        case 'classification':
          return row.classification_label ?? '';
        case 'created_at':
          return row.created_at;
        default:
          return row.occurred_at ?? '';
      }
    };
    rows.sort((a, b) => (order === 'asc' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))));

    return json(route, {
      coverage: 'governed_native_committed',
      historicalLegacyImported: false,
      total: rows.length,
      limit,
      offset,
      rows: rows.slice(offset, offset + limit),
    });
  }

  // --- Acquisition detail ------------------------------------------------
  const detailMatch = path.match(/^\/api\/acquisition\/sources\/([^/]+)\/lines\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    if (scenario.detailReadFails) return json(route, { error: 'dependency_failed' }, 502);
    return json(route, scenario.detail);
  }

  // Every governed mutation on this surface. A configured failure code makes
  // the response unresolved, which is exactly the S1.6.6 recovery path.
  if (path.startsWith('/api/acquisition/') && method === 'POST') {
    if (scenario.mutationFailure) return json(route, { error: scenario.mutationFailure }, 502);
    return json(route, { ok: true });
  }

  // --- Operational panels -------------------------------------------------
  //
  // These are recorded at their REAL contract shapes. Returning a plausible
  // wrapper like `{ rows: [], total: 0 }` with a 200 is worse than returning a
  // failure: the page believes it, reads a field the contract never had, and
  // crashes — which is a defect in the fixture wearing the costume of a defect
  // in the product.
  // --- S2.3 governed receiving -------------------------------------------
  if (path.startsWith('/api/receiving/')) {
    const world = scenario.receiving;
    const role = scenario.receivingRole;

    if (path === '/api/receiving/queue') {
      // A FAILED read, answered as a failure. The page must never render this
      // as "there is no receiving work" — that is the defect the whole truth
      // contract exists to prevent.
      if (scenario.receivingQueueFails) return json(route, { error: 'dependency_failed' }, 502);
      const payload = world.queue(role, !scenario.receivingQueuePartial);
      if (scenario.receivingQueueEmpty) return json(route, { ...payload, rows: [] });
      return json(route, payload);
    }

    if (method === 'GET' && path.startsWith('/api/receiving/receipts/')) {
      const wanted = decodeURIComponent(path.split('/').pop() ?? '');
      if (wanted !== RECEIPT_PUBLIC_ID) return json(route, { error: 'receipt_not_found' }, 404);
      return json(route, world.receipt(role));
    }

    if (method === 'POST') {
      if (scenario.receivingMutationFailure) {
        const code = scenario.receivingMutationFailure;
        const status = code.endsWith('_not_found') ? 404
          : code === 'invalid_request' ? 400
          : code === 'unauthorized_workspace' ? 403 : 409;
        return json(route, { error: code }, status);
      }
      const body = JSON.parse(route.request().postData() ?? '{}');

      if (path.endsWith('/receipts') && path.includes('/orders/')) {
        return json(route, { receiptPublicId: RECEIPT_PUBLIC_ID, status: 'open', replayed: false });
      }
      if (path.endsWith('/lines')) {
        const result = world.recordLine(body.acquisitionLinePublicId, body.quantityReceived);
        return result ? json(route, result) : json(route, { error: 'acquisition_not_found' }, 404);
      }
      if (path.endsWith('/correct')) {
        const id = decodeURIComponent(path.split('/').slice(-2)[0]);
        const result = world.correctLine(id, body.desiredQuantity);
        return result ? json(route, result) : json(route, { error: 'receipt_line_not_found' }, 404);
      }
      if (path.endsWith('/cancel')) return json(route, world.transition('cancelled'));
      if (path.endsWith('/submit')) return json(route, world.transition('submitted'));
    }

    return json(route, { error: 'receipt_not_found' }, 404);
  }

  if (path === '/api/operations-dashboard/health') {
    return json(route, {
      asOf: FIXED_NOW,
      serializedUnits: 412,
      lotManagedRecords: 96,
      lotManagedUnits: 1_284,
      withoutLocation: 7,
    });
  }

  if (path === '/api/operations-dashboard/work') {
    return json(route, {
      asOf: FIXED_NOW,
      definition: 'Governed readiness backlog',
      tasks: [
        {
          taskType: 'needs_location',
          subjectKind: 'lot',
          subjectId: '3f7c1d92-0000-4000-8000-00000000c001',
          publicId: 'RV-LOT-4471',
          displayName: 'Aug 1 Whatnot haul',
          reason: 'No storage location recorded',
          ageDays: 3,
          severity: 'high',
          score: 82,
          scoreExplanation: 'Unlocated for 3 days',
          destination: '/locations',
        },
        {
          taskType: 'needs_photos',
          subjectKind: 'item',
          subjectId: '3f7c1d92-0000-4000-8000-00000000c002',
          publicId: 'RV-ITEM-8830',
          displayName: 'Charizard ex — graded slab',
          reason: 'Required angle missing',
          ageDays: 1,
          severity: 'medium',
          score: 54,
          scoreExplanation: 'Missing one required angle',
          destination: '/photo-issues',
        },
      ],
    });
  }

  if (path === '/api/operations-dashboard/activity') {
    return json(route, {
      asOf: FIXED_NOW,
      source: 'governed movement events',
      events: [
        {
          id: '3f7c1d92-0000-4000-8000-00000000d001',
          public_id: 'RV-ITEM-8830',
          eventType: 'moved',
          moved_at: '2026-08-01T09:30:00.000Z',
          destination: '/current-inventory',
        },
      ],
    });
  }

  if (path === '/api/operations-dashboard/workflows') {
    return json(route, {
      asOf: FIXED_NOW,
      media: { no_active_photo: 12, by_readiness: { complete: 84, missing_required_angle: 9 }, open_issue_count: 3 },
      listingPrep: {
        by_status: { not_started: 22, in_preparation: 8, ready_to_list: 5 },
        by_readiness: { ready: 5, needs_photos: 9, blocked: 2 },
        no_active_preparation: 22,
        ready_now: 5,
        regressed_ready: 1,
      },
    });
  }

  // --- A deliberately unavailable dependency ------------------------------
  //
  // One source fails on purpose, so the Workbench renders a ready widget and an
  // unavailable one on the same screen at the same time. That pairing is the
  // whole point of the S1.6.4 truth model: a failure has to READ differently
  // from a zero, side by side, or an operator cannot tell them apart.
  if (path.startsWith('/api/listing-prep')) {
    return json(route, { error: 'dependency_failed' }, 502);
  }

  if (path.startsWith('/api/intake/sessions')) {
    return json(route, { total: 0, sessions: [] });
  }

  // A governed read this harness has not recorded. Answered as an explicit,
  // bounded dependency failure rather than left to hang, so the surface renders
  // a truthful "could not be loaded" instead of an eternal skeleton.
  return json(route, { error: 'dependency_failed' }, 502);
}

export async function installScenario(page: Page, control: ScenarioControl): Promise<void> {
  const { state } = control;

  // Init scripts accumulate and cannot be removed, so every seed carries a
  // GENERATION. Within one document the newest generation wins, which is what
  // makes `scenario.set({ theme })` take effect. Across a reload the generation
  // is already recorded, so a seed never overwrites a choice the APPLICATION
  // itself persisted — otherwise the harness would quietly disprove the very
  // persistence it is supposed to be testing.
  let generation = 0;
  const seed = async () => {
    const thisGeneration = generation;
    generation += 1;
    await page.addInitScript(
      ({ storageKey, session, theme, themeKey, workspaceId, gen }) => {
        window.localStorage.setItem(storageKey, JSON.stringify(session));
        window.localStorage.setItem('rv.activeWorkspaceId', workspaceId);
        const applied = Number(window.localStorage.getItem('__rv_gate_theme_generation') ?? '-1');
        if (gen > applied) {
          window.localStorage.setItem(themeKey, theme);
          window.localStorage.setItem('__rv_gate_theme_generation', String(gen));
        }
      },
      {
        storageKey: SUPABASE_STORAGE_KEY,
        session: storedSession(),
        theme: control.state.theme,
        themeKey: 'rv.theme.v1',
        workspaceId: WORKSPACE_ID,
        gen: thisGeneration,
      },
    );
  };
  control.attach(seed);
  await seed();

  await page.addInitScript(
    () => {
      // The workspace selection a returning operator's browser already holds,
      // so the gate never depends on which workspace happens to sort first.
      // Deliberately separate from the seed above, which is re-registered.
    },
  );

  // ORDER MATTERS. Playwright consults handlers in REVERSE registration order,
  // so the catch-all is registered FIRST and therefore consulted LAST. Register
  // it after the specific handlers and it swallows every governed request,
  // which presents as the application sitting on its sign-in form with
  // "Failed to fetch" — a failure mode worth naming, because the page looks
  // plausible and the harness is what is broken.
  //
  // Nothing may leave the browser for a real host. A font, an analytics beacon
  // or a forgotten CDN reference would make the gate depend on the network.
  await page.route('**', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost') || url.startsWith('data:')) {
      return route.continue();
    }
    return route.abort('blockedbyclient');
  });

  await page.route('**/api/**', (route) => routeApi(route, state));
  await page.route(`${SUPABASE_URL}/**`, routeSupabase);
}

interface GateFixtures {
  scenario: ScenarioControl;
  app: Page;
}

export const test = base.extend<GateFixtures>({
  // The second argument is Playwright's fixture-provider callback. It is named
  // `provide` rather than the conventional `use` because the repository lints
  // with oxlint's React rules, which read a bare `use(...)` call as the React
  // hook and reject it outside a component.
  scenario: async ({ page: _page }, provide) => {
    await provide(new ScenarioControl());
  },
  app: async ({ page, scenario }, provide) => {
    await installScenario(page, scenario);
    await provide(page);
  },
});

export { expect };

/** Waits for the governed shell to be past auth, workspace load and first run. */
export async function gotoGoverned(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('[data-shell-root]')).toBeVisible({ timeout: 20_000 });
}

// @vitest-environment jsdom
//
// Behavioral acceptance for the layout model and the LayoutStore.
//
// Two properties carry this file:
//
//   1. A LAYOUT IS PRESENTATION PREFERENCE, NEVER BUSINESS DATA. Nothing that
//      reaches storage may be a count, a total, or an API response.
//   2. NO IDENTITY CAN READ ANOTHER'S LAYOUT. User, workspace and surface are
//      all part of the key, and a leak in any one of them is a leak.
import { describe, expect, it, vi } from 'vitest';
import {
  LAYOUT_SCHEMA_VERSION,
  addInstance,
  containsDefinition,
  defaultLayout,
  moveInstance,
  removeInstance,
  reorderInstances,
  repairLayout,
  resizeInstance,
  type WorkbenchLayout,
} from './layoutModel';
import { createBrowserLayoutStore } from './browserLayoutStore';
import { LAYOUT_KEY_PREFIX, layoutStorageKey, type LayoutIdentity } from './layoutStore';

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const IDENTITY: LayoutIdentity = { userId: 'user-a', workspaceId: 'ws-1', surface: 'daily-workbench' };

describe('storage key identity', () => {
  it('is namespaced and versioned', () => {
    expect(layoutStorageKey(IDENTITY).startsWith(`${LAYOUT_KEY_PREFIX}.v${LAYOUT_SCHEMA_VERSION}.`)).toBe(true);
  });

  it('separates users, so a shared tablet does not leak an arrangement', () => {
    expect(layoutStorageKey({ ...IDENTITY, userId: 'user-b' })).not.toBe(layoutStorageKey(IDENTITY));
  });

  it('separates workspaces', () => {
    expect(layoutStorageKey({ ...IDENTITY, workspaceId: 'ws-2' })).not.toBe(layoutStorageKey(IDENTITY));
  });

  it('separates surfaces, so Home and Daily Workbench are not one blob', () => {
    expect(layoutStorageKey({ ...IDENTITY, surface: 'home' })).not.toBe(layoutStorageKey(IDENTITY));
  });

  // The failure mode a single global key would have.
  it('is not one shared key across every identity', () => {
    const keys = new Set([
      layoutStorageKey(IDENTITY),
      layoutStorageKey({ ...IDENTITY, userId: 'user-b' }),
      layoutStorageKey({ ...IDENTITY, workspaceId: 'ws-2' }),
      layoutStorageKey({ ...IDENTITY, surface: 'home' }),
    ]);
    expect(keys.size).toBe(4);
  });

  it('gives an unresolved user or workspace its own explicit segment', () => {
    // Omitting the segment would silently merge two identities onto one key.
    expect(layoutStorageKey({ ...IDENTITY, userId: null })).toContain('anonymous');
    expect(layoutStorageKey({ ...IDENTITY, workspaceId: null })).toContain('no-workspace');
    expect(layoutStorageKey({ ...IDENTITY, userId: null })).not.toBe(layoutStorageKey(IDENTITY));
  });
});

describe('isolation between identities', () => {
  it('does not let user A read user B layout', () => {
    const storage = memoryStorage();
    const store = createBrowserLayoutStore(storage);
    const a: LayoutIdentity = { userId: 'user-a', workspaceId: 'ws-1', surface: 'home' };
    const b: LayoutIdentity = { userId: 'user-b', workspaceId: 'ws-1', surface: 'home' };

    store.write(a, { schemaVersion: LAYOUT_SCHEMA_VERSION, surface: 'home', instances: [] });
    expect(store.read(a)).not.toBeNull();
    expect(store.read(b)).toBeNull();
  });

  it('does not let workspace A read workspace B layout', () => {
    const store = createBrowserLayoutStore(memoryStorage());
    const one: LayoutIdentity = { userId: 'user-a', workspaceId: 'ws-1', surface: 'home' };
    const two: LayoutIdentity = { userId: 'user-a', workspaceId: 'ws-2', surface: 'home' };
    store.write(one, { schemaVersion: LAYOUT_SCHEMA_VERSION, surface: 'home', instances: [] });
    expect(store.read(two)).toBeNull();
  });

  it('does not let Home read the Daily Workbench layout', () => {
    const store = createBrowserLayoutStore(memoryStorage());
    const workbench: LayoutIdentity = { userId: 'user-a', workspaceId: 'ws-1', surface: 'daily-workbench' };
    const home: LayoutIdentity = { ...workbench, surface: 'home' };
    store.write(workbench, defaultLayout('daily-workbench'));
    expect(store.read(home)).toBeNull();
  });
});

describe('nothing business-shaped is ever persisted', () => {
  it('writes only definition id, instance id and size', () => {
    const storage = memoryStorage();
    const store = createBrowserLayoutStore(storage);
    const layout = defaultLayout('daily-workbench');

    // A caller attaching cached server truth to the layout object.
    const polluted = {
      ...layout,
      instances: layout.instances.map((instance) => ({
        ...instance,
        count: 41,
        totalValue: 1234500,
        apiResponse: { rows: [{ id: 'lot-1' }] },
      })),
    } as unknown as WorkbenchLayout;

    store.write(IDENTITY, polluted);
    const written = storage.getItem(layoutStorageKey(IDENTITY))!;

    expect(written).not.toContain('41');
    expect(written).not.toContain('totalValue');
    expect(written).not.toContain('apiResponse');
    expect(written).not.toContain('lot-1');

    for (const entry of JSON.parse(written).instances) {
      expect(Object.keys(entry).sort()).toEqual(['definitionId', 'instanceId', 'size']);
    }
  });

  it('keeps only scalar settings when repairing, so a cached response cannot survive', () => {
    const { layout } = repairLayout(
      {
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        surface: 'home',
        instances: [
          {
            definitionId: 'inventory.record-count',
            instanceId: 'i1',
            size: 'compact',
            settings: { showTrend: true, rows: [{ id: 'x' }], nested: { a: 1 } },
          },
        ],
      },
      'home',
    );
    expect(layout.instances[0].settings).toEqual({ showTrend: true });
  });
});

describe('recovery from corrupt and stale layouts', () => {
  it('resets when the payload is not an object', () => {
    const { layout, repairs } = repairLayout('not a layout', 'home');
    expect(layout.instances.length).toBeGreaterThan(0);
    expect(repairs.length).toBe(1);
  });

  it('resets when the schema version does not match', () => {
    const { layout, repairs } = repairLayout(
      { schemaVersion: LAYOUT_SCHEMA_VERSION + 99, surface: 'home', instances: [] },
      'home',
    );
    expect(layout.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(layout).toEqual(expect.objectContaining({ surface: 'home' }));
    expect(repairs[0]).toMatch(/schema version/i);
    // Reset, not an empty surface: defaults are restored.
    expect(layout.instances.length).toBeGreaterThan(0);
  });

  it('resets when the stored layout belongs to another surface', () => {
    const { repairs } = repairLayout({ schemaVersion: LAYOUT_SCHEMA_VERSION, surface: 'home', instances: [] }, 'daily-workbench');
    expect(repairs[0]).toMatch(/home/);
  });

  it('drops a widget id this build does not have', () => {
    const { layout, repairs } = repairLayout(
      {
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        surface: 'home',
        instances: [
          { definitionId: 'gone.forever', instanceId: 'i1', size: 'compact' },
          { definitionId: 'inventory.record-count', instanceId: 'i2', size: 'compact' },
        ],
      },
      'home',
    );
    expect(layout.instances.map((i) => i.definitionId)).toEqual(['inventory.record-count']);
    expect(repairs.join(' ')).toMatch(/gone\.forever/);
  });

  it('repairs an unsupported size to the widget default rather than dropping the widget', () => {
    const { layout, repairs } = repairLayout(
      {
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        surface: 'home',
        // `full` is not among open-corrections' supported sizes.
        instances: [{ definitionId: 'governance.open-corrections', instanceId: 'i1', size: 'full' }],
      },
      'home',
    );
    expect(layout.instances[0].size).toBe('compact');
    expect(repairs.join(' ')).toMatch(/unsupported size/i);
  });

  it('repairs duplicate single-instance entries deterministically', () => {
    const stored = {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      surface: 'home',
      instances: [
        { definitionId: 'inventory.record-count', instanceId: 'first', size: 'compact' },
        { definitionId: 'inventory.record-count', instanceId: 'second', size: 'standard' },
      ],
    };
    const once = repairLayout(stored, 'home');
    const twice = repairLayout(stored, 'home');
    expect(once.layout.instances).toHaveLength(1);
    // The FIRST occurrence wins, and repairing the same input twice agrees.
    expect(once.layout.instances[0].instanceId).toBe('first');
    expect(twice.layout.instances[0].instanceId).toBe('first');
  });

  it('regenerates a reused instance id', () => {
    const { layout } = repairLayout(
      {
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        surface: 'home',
        instances: [
          { definitionId: 'inventory.record-count', instanceId: 'same', size: 'compact' },
          { definitionId: 'governance.open-corrections', instanceId: 'same', size: 'compact' },
        ],
      },
      'home',
    );
    expect(new Set(layout.instances.map((i) => i.instanceId)).size).toBe(2);
  });

  it('reports nothing when a sound layout needs no repair', () => {
    const sound = defaultLayout('home');
    const { repairs } = repairLayout(JSON.parse(JSON.stringify(sound)), 'home');
    expect(repairs).toEqual([]);
  });
});

describe('storage failure costs durability, never the application', () => {
  it('survives storage being absent entirely', () => {
    const store = createBrowserLayoutStore(null);
    expect(store.read(IDENTITY)).toBeNull();
    expect(() => store.write(IDENTITY, defaultLayout('home'))).not.toThrow();
    expect(() => store.clear(IDENTITY)).not.toThrow();
  });

  it('survives a throwing setItem, as a quota-exceeded browser does', () => {
    const storage = memoryStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const store = createBrowserLayoutStore(storage);
    expect(() => store.write(IDENTITY, defaultLayout('home'))).not.toThrow();
  });

  it('survives a throwing getItem', () => {
    const storage = memoryStorage();
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(createBrowserLayoutStore(storage).read(IDENTITY)).toBeNull();
  });
});

describe('layout mutations', () => {
  const layout: WorkbenchLayout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    surface: 'home',
    instances: [
      { definitionId: 'inventory.record-count', instanceId: 'a', size: 'compact' },
      { definitionId: 'governance.open-corrections', instanceId: 'b', size: 'compact' },
      { definitionId: 'inventory.needs-location', instanceId: 'c', size: 'standard' },
    ],
  };
  const ids = (l: WorkbenchLayout) => l.instances.map((i) => i.instanceId);

  it('moves a widget earlier and later', () => {
    expect(ids(moveInstance(layout, 'c', -1))).toEqual(['a', 'c', 'b']);
    expect(ids(moveInstance(layout, 'a', 1))).toEqual(['b', 'a', 'c']);
  });

  it('refuses to move past the boundaries', () => {
    expect(moveInstance(layout, 'a', -1)).toBe(layout);
    expect(moveInstance(layout, 'c', 1)).toBe(layout);
  });

  // The property that keeps drag and buttons honest.
  it('produces the same order from a drag reorder as from repeated button moves', () => {
    const byDrag = reorderInstances(layout, 2, 0);
    const byButtons = moveInstance(moveInstance(layout, 'c', -1), 'c', -1);
    expect(ids(byDrag)).toEqual(ids(byButtons));
    expect(ids(byDrag)).toEqual(['c', 'a', 'b']);
  });

  it('ignores an out-of-range reorder', () => {
    expect(reorderInstances(layout, 0, 9)).toBe(layout);
    expect(reorderInstances(layout, -1, 0)).toBe(layout);
    expect(reorderInstances(layout, 1, 1)).toBe(layout);
  });

  it('removes an instance', () => {
    expect(ids(removeInstance(layout, 'b'))).toEqual(['a', 'c']);
  });

  it('resizes only to a supported size', () => {
    expect(resizeInstance(layout, 'a', 'standard').instances[0].size).toBe('standard');
    // `full` is unsupported for this widget: the layout is unchanged, so an
    // unsupported size can never be persisted in the first place.
    expect(resizeInstance(layout, 'a', 'full').instances[0].size).toBe('compact');
  });

  it('adds a widget at its default size', () => {
    const next = addInstance(layout, 'utility.quick-actions');
    expect(next.instances).toHaveLength(4);
    expect(next.instances[3].size).toBe('standard');
  });

  it('refuses a second instance of a single-instance widget', () => {
    expect(addInstance(layout, 'inventory.record-count')).toBe(layout);
  });

  it('refuses an unknown widget', () => {
    expect(addInstance(layout, 'nope.not-real')).toBe(layout);
  });

  it('reports whether a definition is present', () => {
    expect(containsDefinition(layout, 'inventory.record-count')).toBe(true);
    expect(containsDefinition(layout, 'utility.quick-actions')).toBe(false);
  });
});

describe('defaults', () => {
  it('gives each surface its own default arrangement', () => {
    const home = defaultLayout('home').instances.map((i) => i.definitionId);
    const workbench = defaultLayout('daily-workbench').instances.map((i) => i.definitionId);
    expect(home).not.toEqual(workbench);
    expect(workbench.length).toBeGreaterThan(home.length);
  });

  it('names only widgets that exist, each at a supported size', () => {
    for (const surface of ['home', 'daily-workbench'] as const) {
      const { layout } = repairLayout(JSON.parse(JSON.stringify(defaultLayout(surface))), surface);
      // A default that needed repairing would be a repository bug.
      expect(layout.instances).toHaveLength(defaultLayout(surface).instances.length);
    }
  });

  it('preserves the Daily Workbench reading order the page has always had', () => {
    expect(defaultLayout('daily-workbench').instances.map((i) => i.definitionId).slice(0, 5)).toEqual([
      'inventory.needs-location',
      'inventory.needs-photos',
      'inventory.unclassified-category',
      'inventory.needs-condition-details',
      'governance.open-corrections',
    ]);
  });
});

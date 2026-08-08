// @vitest-environment jsdom
//
// Rendered acceptance for the Workbench surface: normal vs edit mode, the
// keyboard/button reorder path, semantic sizes, the catalog, and the grid.
//
// Everything is asserted against the rendered DOM and accessibility tree.
//
// WHAT THIS FILE CANNOT PROVE
//
// jsdom performs no layout and produces no real pointer or touch events, so no
// assertion here demonstrates that a drag gesture works. What IS proved is that
// a reorder REPORTED by the interaction adapter drives the same canonical order
// the buttons drive. Real drag/touch proof is S1.6.7's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { WorkbenchSurfaceRegion } from './WorkbenchSurface';
import { useWorkbenchLayout } from './useWorkbenchLayout';
import { createBrowserLayoutStore } from './layout/browserLayoutStore';
import { applyReorder, DND_KIT_REACT_VERSION } from './interaction/WorkbenchInteractionAdapter';
import { reorderInstances, defaultLayout } from './layout/layoutModel';
import type { WidgetAvailabilityContext, WidgetSize } from './registry/widgetDefinition';
import { findDefinition } from './registry/widgetRegistry';

const CONTEXT: WidgetAvailabilityContext = {
  surface: 'daily-workbench',
  satisfiedRequirements: ['governed-backend', 'active-workspace', 'intake-transport'],
  role: 'owner',
};

function memoryStorage(): Storage {
  const map = new Map<string, string>();
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

let store = createBrowserLayoutStore(memoryStorage());

function Harness({ context = CONTEXT }: { context?: WidgetAvailabilityContext } = {}) {
  const controller = useWorkbenchLayout(store, context.surface, 'user-a', 'ws-1');
  return (
    <MemoryRouter>
      <WorkbenchSurfaceRegion
        surface={context.surface}
        controller={controller}
        context={context}
        label="Today's work"
        renderBody={(definitionId: string, size: WidgetSize) => (
          <p data-testid={`body-${definitionId}`} data-size={size}>
            {size === 'compact' ? 'compact body' : size === 'expanded' ? 'expanded body with records' : 'standard body'}
          </p>
        )}
        renderAccessory={(definitionId: string) => <span data-testid={`accessory-${definitionId}`}>7</span>}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  store = createBrowserLayoutStore(memoryStorage());
});
afterEach(cleanup);

const widgetTitles = () =>
  screen.getAllByRole('region').map((section) => section.getAttribute('aria-label')).filter((label) => label !== "Today's work");

const enterEditMode = () => fireEvent.click(screen.getByRole('button', { name: /Customize/i }));

describe('normal mode has no customization furniture', () => {
  it('renders widgets with no drag handle, size control or remove control', () => {
    render(<Harness />);
    expect(document.querySelector('[data-drag-handle]')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove /i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Move .* earlier/i })).toBeNull();
  });

  it('offers Customize but not Done, Reset or the catalog', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /Customize/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Done$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset layout/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Widget catalog/i })).toBeNull();
  });

  it('still renders every widget body', () => {
    render(<Harness />);
    expect(screen.getByTestId('body-inventory.needs-location')).toBeTruthy();
    expect(screen.getByTestId('body-utility.quick-actions')).toBeTruthy();
  });
});

describe('edit mode', () => {
  it('is entered by Customize and left by Done', () => {
    render(<Harness />);
    enterEditMode();
    expect(document.querySelector('[data-drag-handle]')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Widget catalog/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Done$/i }));
    expect(document.querySelector('[data-drag-handle]')).toBeNull();
    expect(screen.getByRole('button', { name: /Customize/i })).toBeTruthy();
  });

  it('says the arrangement is device-local rather than implying it syncs', () => {
    render(<Harness />);
    enterEditMode();
    expect(screen.getByText(/Saved on this device only/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/synced|syncs to your account|all your devices/i);
  });
});

describe('button reorder is first class', () => {
  it('names the widget each control moves', () => {
    render(<Harness />);
    enterEditMode();
    expect(screen.getByRole('button', { name: 'Move Needs location earlier' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Needs location later' })).toBeTruthy();
  });

  it('moves a widget later and the order actually changes', () => {
    render(<Harness />);
    enterEditMode();
    const before = widgetTitles();
    fireEvent.click(screen.getByRole('button', { name: `Move ${before[0]} later` }));
    const after = widgetTitles();
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  it('moves a widget earlier', () => {
    render(<Harness />);
    enterEditMode();
    const before = widgetTitles();
    fireEvent.click(screen.getByRole('button', { name: `Move ${before[2]} earlier` }));
    expect(widgetTitles()[1]).toBe(before[2]);
  });

  it('disables the controls at the boundaries', () => {
    render(<Harness />);
    enterEditMode();
    const titles = widgetTitles();
    expect((screen.getByRole('button', { name: `Move ${titles[0]} earlier` }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: `Move ${titles[titles.length - 1]} later` }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('announces the movement, because a silent reposition is imperceptible', () => {
    render(<Harness />);
    enterEditMode();
    const titles = widgetTitles();
    fireEvent.click(screen.getByRole('button', { name: `Move ${titles[0]} later` }));
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toMatch(new RegExp(`${titles[0]} moved to position 2 of ${titles.length}`));
  });

  it('survives without any drag package involvement at all', () => {
    // The buttons are not a fallback for a failing sensor: they drive the model
    // directly, which is why this assertion needs nothing from @dnd-kit.
    render(<Harness />);
    enterEditMode();
    const titles = widgetTitles();
    fireEvent.click(screen.getByRole('button', { name: `Move ${titles[1]} earlier` }));
    expect(widgetTitles()[0]).toBe(titles[1]);
  });
});

describe('semantic sizes', () => {
  it('offers only the sizes the definition supports', () => {
    render(<Harness />);
    enterEditMode();
    const select = screen.getByRole('combobox', { name: 'Size for Open corrections' }) as HTMLSelectElement;
    const options = [...select.options].map((option) => option.value);
    expect(options).toEqual(['compact', 'standard']);
    expect(options).not.toContain('full');
  });

  it('changes the information hierarchy, not merely the width', () => {
    render(<Harness />);
    enterEditMode();
    const select = screen.getByRole('combobox', { name: 'Size for Needs location' });
    expect(screen.getByTestId('body-inventory.needs-location').textContent).toBe('standard body');
    fireEvent.change(select, { target: { value: 'expanded' } });
    expect(screen.getByTestId('body-inventory.needs-location').textContent).toBe('expanded body with records');
    fireEvent.change(select, { target: { value: 'compact' } });
    expect(screen.getByTestId('body-inventory.needs-location').textContent).toBe('compact body');
  });

  it('carries the chosen size onto the frame and the grid span', () => {
    render(<Harness />);
    enterEditMode();
    fireEvent.change(screen.getByRole('combobox', { name: 'Size for Needs location' }), {
      target: { value: 'expanded' },
    });
    const frame = document.querySelector('[data-widget-id="inventory.needs-location"]')!;
    expect(frame.getAttribute('data-widget-size')).toBe('expanded');
    expect(frame.closest('[data-instance-id]')!.className).toContain('lg:col-span-6');
  });

  it('returns to the default size after a reset', () => {
    render(<Harness />);
    enterEditMode();
    fireEvent.change(screen.getByRole('combobox', { name: 'Size for Needs location' }), {
      target: { value: 'compact' },
    });
    expect(document.querySelector('[data-widget-id="inventory.needs-location"]')!.getAttribute('data-widget-size')).toBe(
      'compact',
    );
    fireEvent.click(screen.getByRole('button', { name: /Reset layout/i }));
    expect(document.querySelector('[data-widget-id="inventory.needs-location"]')!.getAttribute('data-widget-size')).toBe(
      findDefinition('inventory.needs-location')!.presentation.defaultSize,
    );
  });
});

describe('presentation family is carried on the frame', () => {
  it('marks each widget with its declared family, independent of any state', () => {
    render(<Harness />);
    expect(document.querySelector('[data-widget-id="governance.open-corrections"]')!.getAttribute('data-widget-family')).toBe(
      'metric',
    );
    expect(document.querySelector('[data-widget-id="inventory.needs-location"]')!.getAttribute('data-widget-family')).toBe(
      'instrument',
    );
  });
});

describe('the responsive grid', () => {
  it('collapses columns without changing the persisted order', () => {
    render(<Harness />);
    const grid = document.querySelector('[data-workbench-grid]')!;
    // One order, many geometries: column COUNT is breakpointed, order is not.
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('sm:grid-cols-6');
    expect(grid.className).toContain('lg:grid-cols-12');
    expect(grid.className).not.toMatch(/order-/);
  });

  it('gives every widget a full-width span on the narrowest breakpoint', () => {
    render(<Harness />);
    for (const holder of document.querySelectorAll('[data-instance-id]')) {
      expect(holder.className).toContain('col-span-2');
    }
  });

  it('keeps one semantic order across every breakpoint', () => {
    render(<Harness />);
    enterEditMode();
    const titles = widgetTitles();
    fireEvent.click(screen.getByRole('button', { name: `Move ${titles[0]} later` }));
    // The DOM order IS the order. There is no second per-breakpoint arrangement
    // that could drift away from it.
    const domOrder = [...document.querySelectorAll('[data-instance-id] [data-widget-id]')].map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(domOrder[0]).toBe(titles[1]);
  });
});

describe('the interaction adapter shares one order model with the buttons', () => {
  it('pins the reviewed package version', () => {
    expect(DND_KIT_REACT_VERSION).toBe('0.5.0');
  });

  it('computes the same result the layout model does', () => {
    const layout = defaultLayout('daily-workbench');
    const ids = layout.instances.map((i) => i.instanceId);
    // The adapter's reorder and the layout model's reorder are the same
    // operation — this is what stops drag and buttons drifting apart.
    expect(applyReorder(ids, 4, 1)).toEqual(reorderInstances(layout, 4, 1).instances.map((i) => i.instanceId));
    expect(applyReorder(ids, 0, 3)).toEqual(reorderInstances(layout, 0, 3).instances.map((i) => i.instanceId));
  });

  it('ignores an out-of-range or no-op reorder exactly as the model does', () => {
    const ids = ['a', 'b', 'c'];
    expect(applyReorder(ids, 1, 1)).toBe(ids);
    expect(applyReorder(ids, -1, 0)).toBe(ids);
    expect(applyReorder(ids, 0, 9)).toBe(ids);
  });

  it('drives the rendered surface when a reorder is reported', () => {
    // Standing in for the drag the adapter would report, since jsdom cannot
    // produce the pointer sequence that would generate it.
    function ReorderHarness() {
      const controller = useWorkbenchLayout(store, 'daily-workbench', 'user-a', 'ws-1');
      const [fired, setFired] = useState(false);
      return (
        <MemoryRouter>
          <button
            type="button"
            onClick={() => {
              controller.reorder(2, 0);
              setFired(true);
            }}
          >
            simulate drag
          </button>
          <span data-testid="fired">{String(fired)}</span>
          <WorkbenchSurfaceRegion
            surface="daily-workbench"
            controller={controller}
            context={CONTEXT}
            label="Today's work"
            renderBody={() => null}
          />
        </MemoryRouter>
      );
    }
    render(<ReorderHarness />);
    const before = widgetTitles();
    fireEvent.click(screen.getByRole('button', { name: 'simulate drag' }));
    expect(widgetTitles()[0]).toBe(before[2]);
  });
});

describe('the widget catalog', () => {
  const openCatalog = () => {
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /Widget catalog/i }));
  };

  it('opens as a modal dialog and closes again', () => {
    render(<Harness />);
    openCatalog();
    expect(screen.getByRole('dialog', { name: 'Widget catalog' })).toBeTruthy();
    // Named distinctly from the surface's own Done, which leaves edit mode.
    fireEvent.click(screen.getByRole('button', { name: 'Close catalog' }));
    expect(screen.queryByRole('dialog', { name: 'Widget catalog' })).toBeNull();
  });

  it('lists only usable widgets and never a planned placeholder', () => {
    render(<Harness />);
    openCatalog();
    const dialog = screen.getByRole('dialog', { name: 'Widget catalog' });
    expect(within(dialog).queryByText(/coming soon/i)).toBeNull();
    expect(within(dialog).queryByText(/planned/i)).toBeNull();
    // And no monetization language from the rejected prototype.
    expect(dialog.textContent).not.toMatch(/free|pro\b|team plan|collector tier|upgrade|purchase|entitle/i);
  });

  it('searches by title and description', () => {
    render(<Harness />);
    openCatalog();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search widgets' }), { target: { value: 'photos' } });
    const list = screen.getByRole('list', { name: 'Available widgets' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Needs photos')).toBeTruthy();
  });

  it('filters by domain', () => {
    render(<Harness />);
    openCatalog();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by domain' }), { target: { value: 'governance' } });
    const list = screen.getByRole('list', { name: 'Available widgets' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Open corrections')).toBeTruthy();
  });

  it('cannot add a second instance of a single-instance widget', () => {
    render(<Harness />);
    openCatalog();
    const add = screen.getByRole('button', { name: 'Add Needs location to this surface' }) as HTMLButtonElement;
    // Already on the surface by default, so the control is disabled and says so.
    expect(add.disabled).toBe(true);
    expect(add.textContent).toBe('Added');
  });

  it('removes and re-adds a widget without closing', () => {
    render(<Harness />);
    openCatalog();
    expect(screen.getByTestId('body-governance.open-corrections')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Open corrections from this surface' }));
    expect(screen.queryByTestId('body-governance.open-corrections')).toBeNull();
    // Still open: several operations in one visit.
    expect(screen.getByRole('dialog', { name: 'Widget catalog' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add Open corrections to this surface' }));
    expect(screen.getByTestId('body-governance.open-corrections')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Widget catalog' })).toBeTruthy();
  });

  it('hides a widget whose requirement this deployment does not satisfy', () => {
    render(<Harness context={{ ...CONTEXT, satisfiedRequirements: ['governed-backend', 'active-workspace'] }} />);
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /Widget catalog/i }));
    const list = screen.getByRole('list', { name: 'Available widgets' });
    expect(within(list).queryByText('Open intake sessions')).toBeNull();
    expect(within(list).getByText('Needs location')).toBeTruthy();
  });
});

describe('removal and reset from the surface', () => {
  it('removes a widget from the frame control and announces it', () => {
    render(<Harness />);
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Open corrections' }));
    expect(screen.queryByTestId('body-governance.open-corrections')).toBeNull();
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toMatch(/Open corrections removed/);
  });

  it('restores the default arrangement on reset', () => {
    render(<Harness />);
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Open corrections' }));
    fireEvent.click(screen.getByRole('button', { name: /Reset layout/i }));
    expect(screen.getByTestId('body-governance.open-corrections')).toBeTruthy();
  });
});

describe('persistence through the store port', () => {
  it('keeps an arrangement across a remount', () => {
    const { unmount } = render(<Harness />);
    enterEditMode();
    const titles = widgetTitles();
    fireEvent.click(screen.getByRole('button', { name: `Move ${titles[0]} later` }));
    unmount();

    render(<Harness />);
    expect(widgetTitles()[0]).toBe(titles[1]);
  });

  it("does not carry one workspace's arrangement into another", () => {
    function Switchable({ workspaceId }: { workspaceId: string }) {
      const controller = useWorkbenchLayout(store, 'daily-workbench', 'user-a', workspaceId);
      return (
        <MemoryRouter>
          <WorkbenchSurfaceRegion
            surface="daily-workbench"
            controller={controller}
            context={CONTEXT}
            label="Today's work"
            renderBody={() => null}
          />
        </MemoryRouter>
      );
    }
    const { rerender } = render(<Switchable workspaceId="ws-1" />);
    enterEditMode();
    const titles = widgetTitles();
    fireEvent.click(screen.getByRole('button', { name: `Move ${titles[0]} later` }));
    expect(widgetTitles()[0]).toBe(titles[1]);

    rerender(<Switchable workspaceId="ws-2" />);
    // The second workspace gets its own defaults, not the first's arrangement.
    expect(widgetTitles()[0]).toBe(titles[0]);
  });

  it('never writes a business value, whatever the surface rendered', () => {
    const storage = memoryStorage();
    store = createBrowserLayoutStore(storage);
    render(<Harness />);
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: `Move ${widgetTitles()[0]} later` }));

    const written = storage.getItem(storage.key(0)!)!;
    // The accessory rendered "7" on every widget; none of it may be persisted.
    for (const entry of JSON.parse(written).instances) {
      expect(Object.keys(entry).sort()).toEqual(['definitionId', 'instanceId', 'size']);
    }
  });
});

describe('a corrupt saved layout does not break the surface', () => {
  it('renders defaults and says the layout was repaired', () => {
    const storage = memoryStorage();
    storage.setItem('rv.workbench.v1.user-a.ws-1.daily-workbench', '{not json');
    store = createBrowserLayoutStore(storage);
    render(<Harness />);
    expect(screen.getByText(/Your saved layout was repaired/i)).toBeTruthy();
    expect(screen.getByTestId('body-inventory.needs-location')).toBeTruthy();
  });

  it('drops an unknown widget id without losing the rest', () => {
    const storage = memoryStorage();
    storage.setItem(
      'rv.workbench.v1.user-a.ws-1.daily-workbench',
      JSON.stringify({
        schemaVersion: 1,
        surface: 'daily-workbench',
        instances: [
          { definitionId: 'ghost.widget', instanceId: 'g', size: 'compact' },
          { definitionId: 'inventory.needs-photos', instanceId: 'p', size: 'standard' },
        ],
      }),
    );
    store = createBrowserLayoutStore(storage);
    render(<Harness />);
    expect(screen.getByTestId('body-inventory.needs-photos')).toBeTruthy();
    expect(screen.getByText(/ghost\.widget/)).toBeTruthy();
  });
});

describe('storage exceptions never reach the operator', () => {
  it('renders normally when every write throws', () => {
    const storage = memoryStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    store = createBrowserLayoutStore(storage);
    render(<Harness />);
    enterEditMode();
    const titles = widgetTitles();
    expect(() => fireEvent.click(screen.getByRole('button', { name: `Move ${titles[0]} later` }))).not.toThrow();
    // The move still applies in memory; only durability is lost.
    expect(widgetTitles()[0]).toBe(titles[1]);
  });
});

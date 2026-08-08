// @vitest-environment jsdom
//
// Presentation family and truth state are ORTHOGONAL.
//
// A Metric that could not load is still a Metric. It does not become an "error
// family", and an unavailable Instrument does not quietly demote itself. The
// family governs visual weight; the truth state governs what is claimed. These
// tests prove the two axes stay independent, because collapsing them is the
// mistake that produces a dashboard where a failure looks like a design choice.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WidgetFrame } from './WidgetFrame';
import { gridSpanClass, LOGICAL_COLUMNS, WORKBENCH_GRID_CLASS } from './grid';
import { DependencyState, EmptyState, LoadingState, failed, unavailable } from '../../design-system';
import { WIDGET_SIZES, type PresentationFamily } from '../registry/widgetDefinition';
import { findDefinition } from '../registry/widgetRegistry';

afterEach(cleanup);

const METRIC = findDefinition('governance.open-corrections')!;
const INSTRUMENT = findDefinition('inventory.needs-location')!;

describe('presentation families', () => {
  it('marks the declared family on the rendered frame', () => {
    render(
      <WidgetFrame definition={METRIC} size="compact">
        <p>body</p>
      </WidgetFrame>,
    );
    expect(screen.getByRole('region', { name: 'Open corrections' }).getAttribute('data-widget-family')).toBe('metric');
  });

  it('gives each family a distinct frame treatment', () => {
    const classes = new Map<PresentationFamily, string>();
    for (const [family, definition] of [
      ['metric', METRIC],
      ['instrument', INSTRUMENT],
    ] as const) {
      render(
        <WidgetFrame definition={definition} size="compact">
          <p>body</p>
        </WidgetFrame>,
      );
      classes.set(family, screen.getByRole('region', { name: definition.title }).className);
      cleanup();
    }
    expect(classes.get('metric')).not.toBe(classes.get('instrument'));
  });

  // The orthogonality proof.
  it('keeps the family constant across every truth state', () => {
    for (const body of [
      <LoadingState key="l" />,
      <EmptyState key="e" title="Nothing waiting here." />,
      <DependencyState key="u" state={unavailable('The service did not respond.')} />,
      <DependencyState key="f" state={failed('X_FAILED', 'It broke.')} />,
    ]) {
      render(
        <WidgetFrame definition={METRIC} size="compact">
          {body}
        </WidgetFrame>,
      );
      const region = screen.getByRole('region', { name: 'Open corrections' });
      // Still a metric, whatever it does or does not know.
      expect(region.getAttribute('data-widget-family')).toBe('metric');
      cleanup();
    }
  });

  it('renders the truth state the caller supplies without reinterpreting it', () => {
    render(
      <WidgetFrame definition={METRIC} size="compact">
        <DependencyState state={failed('CORRECTION_COUNT_FAILED', 'unreadable')} />
      </WidgetFrame>,
    );
    const region = screen.getByRole('region', { name: 'Open corrections' });
    expect(region.textContent).toMatch(/request failed/i);
    // No fabricated zero anywhere in the frame.
    expect(region.textContent).not.toMatch(/\b0\b/);
  });
});

describe('edit furniture appears only in edit mode', () => {
  it('renders no handle or controls by default', () => {
    render(
      <WidgetFrame definition={INSTRUMENT} size="standard">
        <p>body</p>
      </WidgetFrame>,
    );
    expect(document.querySelector('[data-drag-handle]')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('renders handle, move, size and remove controls in edit mode', () => {
    render(
      <WidgetFrame
        definition={INSTRUMENT}
        size="standard"
        editing
        position={{ index: 1, total: 3 }}
        onMoveEarlier={() => {}}
        onMoveLater={() => {}}
        onResize={() => {}}
        onRemove={() => {}}
      >
        <p>body</p>
      </WidgetFrame>,
    );
    expect(document.querySelector('[data-drag-handle]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Needs location earlier' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Needs location later' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Size for Needs location' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Needs location' })).toBeTruthy();
  });

  it('hides the decorative grip from assistive technology', () => {
    render(
      <WidgetFrame definition={INSTRUMENT} size="standard" editing position={{ index: 0, total: 1 }}>
        <p>body</p>
      </WidgetFrame>,
    );
    // The grip is a pointer affordance; the accessible path is the buttons.
    expect(document.querySelector('[data-drag-handle]')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the grid', () => {
  it('breakpoints the column count, never the order', () => {
    expect(WORKBENCH_GRID_CLASS).toContain('grid-cols-2');
    expect(WORKBENCH_GRID_CLASS).toContain('sm:grid-cols-6');
    expect(WORKBENCH_GRID_CLASS).toContain('lg:grid-cols-12');
    expect(WORKBENCH_GRID_CLASS).not.toMatch(/order-/);
  });

  it('gives every size a full-width span on the narrowest breakpoint', () => {
    for (const size of WIDGET_SIZES) {
      // A "compact" widget in half a 390px screen is unreadable, not compact.
      expect(gridSpanClass(size)).toContain('col-span-2');
    }
  });

  it('makes a larger semantic size occupy more logical columns', () => {
    const widths = WIDGET_SIZES.map((size) => LOGICAL_COLUMNS[size]);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(new Set(widths).size).toBe(widths.length);
    expect(LOGICAL_COLUMNS.full).toBe(12);
  });

  it('gives each size a distinct wide-viewport span', () => {
    const spans = WIDGET_SIZES.map((size) => gridSpanClass(size).split(/\s+/).find((c) => c.startsWith('lg:')));
    expect(new Set(spans).size).toBe(WIDGET_SIZES.length);
  });
});

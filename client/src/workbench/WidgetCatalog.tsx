import { useMemo, useState } from 'react';
import { Dialog, Button, StatusPill } from '../design-system';
import {
  WIDGET_DOMAIN_LABELS,
  WIDGET_SIZE_LABELS,
  allowsMultiple,
  type WidgetAvailabilityContext,
  type WidgetDefinition,
  type WidgetDomain,
} from './registry/widgetDefinition';
import { availableDefinitions } from './registry/widgetRegistry';
import { containsDefinition, type WorkbenchLayout } from './layout/layoutModel';

/**
 * The Widget Catalog.
 *
 * WHAT IT SHOWS
 *
 * Only definitions that are genuinely usable here and now: offerable lifecycle,
 * mounted on this surface, permitted for this role, and with every declared
 * requirement satisfied. `planned` and `retired` widgets are absent — not
 * greyed out, not listed as "coming soon". A roadmap entry rendered as a card
 * is an advertisement, and an operator cannot tell one from a broken feature.
 *
 * WHAT IT IS NOT
 *
 * There is no tier, no entitlement, no purchase, no upsell and no marketplace.
 * The old prototype had all of those; they were rejected. A widget is available
 * or it is not, and the reason is always a capability of this deployment.
 */

export interface WidgetCatalogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly context: WidgetAvailabilityContext;
  readonly layout: WorkbenchLayout;
  readonly onAdd: (definitionId: string) => void;
  readonly onRemove: (definitionId: string) => void;
}

export function WidgetCatalog({ open, onClose, context, layout, onAdd, onRemove }: WidgetCatalogProps) {
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState<WidgetDomain | 'all'>('all');

  const offerable = useMemo(() => availableDefinitions(context), [context]);

  const domains = useMemo(() => {
    const present = new Set(offerable.map((definition) => definition.domain));
    return [...present].sort();
  }, [offerable]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return offerable.filter((definition) => {
      if (domain !== 'all' && definition.domain !== domain) return false;
      if (needle === '') return true;
      return (
        definition.title.toLowerCase().includes(needle) || definition.description.toLowerCase().includes(needle)
      );
    });
  }, [offerable, search, domain]);

  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      title="Widget catalog"
      description="Choose what this surface shows. Your arrangement is saved on this device only."
      size="wide"
      // "Close catalog", not "Done": the surface behind this dialog has its own
      // Done control that leaves edit mode, and two identically-named commands
      // doing different things is how an operator exits the wrong one.
      footer={<Button onClick={onClose}>Close catalog</Button>}
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <label className="min-w-[200px] flex-1">
            <span className="sr-only">Search widgets</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search widgets…"
              aria-label="Search widgets"
              className="min-h-11 w-full rounded-control border border-subtle bg-surface-base px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Filter by domain</span>
            <select
              aria-label="Filter by domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value as WidgetDomain | 'all')}
              className="min-h-11 rounded-control border border-subtle bg-surface-base px-2 py-2 text-sm"
            >
              <option value="all">All domains</option>
              {domains.map((value) => (
                <option key={value} value={value}>
                  {WIDGET_DOMAIN_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {visible.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-ink-secondary">
            No widget matches that search on this surface.
          </p>
        ) : (
          <ul aria-label="Available widgets" className="grid gap-2">
            {visible.map((definition) => (
              <CatalogRow
                key={definition.id}
                definition={definition}
                inLayout={containsDefinition(layout, definition.id)}
                onAdd={() => onAdd(definition.id)}
                onRemove={() => onRemove(definition.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

function CatalogRow({
  definition,
  inLayout,
  onAdd,
  onRemove,
}: {
  readonly definition: WidgetDefinition;
  readonly inLayout: boolean;
  readonly onAdd: () => void;
  readonly onRemove: () => void;
}) {
  // A single-instance widget already in the layout cannot be added again. The
  // control is disabled rather than absent, so the operator can see WHY nothing
  // happens instead of clicking a button that silently does nothing.
  const canAdd = !inLayout || allowsMultiple(definition);

  return (
    <li
      data-catalog-widget={definition.id}
      className="flex flex-wrap items-start justify-between gap-3 rounded-instrument border border-subtle bg-surface-base p-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">{definition.title}</h3>
          <StatusPill tone="neutral">{WIDGET_DOMAIN_LABELS[definition.domain]}</StatusPill>
          {inLayout && <StatusPill tone="success">On this surface</StatusPill>}
          {definition.lifecycle === 'experimental' && <StatusPill tone="warning">Experimental</StatusPill>}
        </div>
        <p className="mt-1 text-sm text-ink-secondary">{definition.description}</p>
        <p className="mt-1 text-xs text-ink-muted">
          Sizes: {definition.presentation.supportedSizes.map((size) => WIDGET_SIZE_LABELS[size]).join(', ')}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {inLayout && (
          <Button size="small" onClick={onRemove} aria-label={`Remove ${definition.title} from this surface`}>
            Remove
          </Button>
        )}
        <Button
          size="small"
          variant={inLayout ? 'secondary' : 'primary'}
          onClick={onAdd}
          disabled={!canAdd}
          aria-label={`Add ${definition.title} to this surface`}
        >
          {canAdd ? 'Add' : 'Added'}
        </Button>
      </div>
    </li>
  );
}

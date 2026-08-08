import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PackagePlus } from 'lucide-react';
import {
  DependencyState,
  EmptyState,
  LoadingState,
  PartialState,
  StaleState,
  hasValue,
  isIndeterminate,
  type TruthState,
} from '../../design-system';
import { READINESS_LABELS, type PrepSummary } from '../../lib/listingPrepApi';
import type { WidgetDefinition, WidgetSize } from '../registry/widgetDefinition';
import type { QueueFacts, IntakeFacts, WorkbenchFacts } from '../data/workbenchFacts';

/**
 * The widget bodies.
 *
 * Each renderer receives a `TruthState` the domain layer established and turns
 * it into presentation. None of them fetches, counts, aggregates, or decides
 * what a number means — a renderer that computed its own total would be a
 * second, quieter source of truth sitting next to the governed one.
 *
 * SIZE CHANGES INFORMATION, NOT SCALE
 *
 * Every renderer branches on size to show genuinely more at a larger size, per
 * the hierarchy its definition declares. Stretching the same three words across
 * six columns is not an Expanded widget; it is a Compact widget wasting space.
 */

/** Renders whatever the state is, delegating the value to the caller. */
function StateBody<T>({
  state,
  emptyTitle,
  emptyDescription,
  children,
}: {
  readonly state: TruthState<T>;
  readonly emptyTitle: string;
  readonly emptyDescription?: string;
  readonly children: (value: T) => ReactNode;
}) {
  if (state.kind === 'loading') return <LoadingState label="Reading…" />;
  if (state.kind === 'empty') return <EmptyState title={emptyTitle} description={emptyDescription} />;
  if (isIndeterminate(state)) return <DependencyState state={state} />;
  return (
    <>
      {state.kind === 'partial' && <PartialState coverage={state.coverage} />}
      {state.kind === 'stale' && (
        <StaleState label={state.label} lastRefreshedAt={state.lastRefreshedAt} canRefresh={state.canRefresh} />
      )}
      {hasValue(state) && children(state.value)}
    </>
  );
}

/** The count shown beside a widget's title. Never a substitute for the body. */
export function CountAccessory({ state }: { readonly state: TruthState<{ count: number } | QueueFacts | IntakeFacts> }) {
  // An em dash where the count is not established. It is not "0", and the
  // widget body says which of the several not-established states applies.
  if (state.kind === 'empty') return <span className="tabular-nums text-sm font-semibold text-ink">0</span>;
  if (!hasValue(state)) return <span className="text-sm font-semibold text-ink-muted">—</span>;
  const value = state.value;
  const count = 'count' in value ? value.count : value.total;
  return <span className="tabular-nums text-sm font-semibold text-ink">{count.toLocaleString()}</span>;
}

function QueueWidget({
  definition,
  size,
  state,
}: {
  readonly definition: WidgetDefinition;
  readonly size: WidgetSize;
  readonly state: TruthState<QueueFacts>;
}) {
  const destination = definition.interaction.destination ?? '/inventory/current';
  return (
    <StateBody state={state} emptyTitle="Nothing waiting here." emptyDescription={definition.data.genuineEmpty}>
      {(facts) => (
        <div className="grid gap-2">
          {/* Compact stops at the figure. Standard adds the explanation and the
              way in. Expanded adds the records themselves. */}
          {size !== 'compact' && <p className="text-xs text-ink-muted">{definition.description}</p>}

          {size === 'expanded' && facts.records.length > 0 && (
            <ul className="grid gap-1">
              {facts.records.map((record) => (
                <li key={`${record.kind}-${record.id}`}>
                  <Link
                    to={record.kind === 'item' ? `/inventory/current/${record.id}` : `/inventory/lots/${record.id}`}
                    className="flex items-center justify-between gap-2 rounded-control border border-subtle px-3 py-2 text-sm hover:bg-surface-inset"
                  >
                    <span className="min-w-0 truncate">{record.displayName}</span>
                    <span className="shrink-0 text-xs text-accent-strong">Open</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {size !== 'compact' && (
            <Link to={destination} className="text-xs font-semibold text-accent-strong underline underline-offset-2">
              {facts.count > facts.records.length || size !== 'expanded'
                ? `View all ${facts.count.toLocaleString()} in inventory`
                : 'View in inventory'}
            </Link>
          )}
        </div>
      )}
    </StateBody>
  );
}

function MetricWidget({
  definition,
  size,
  state,
  unit,
}: {
  readonly definition: WidgetDefinition;
  readonly size: WidgetSize;
  readonly state: TruthState<{ count: number }>;
  readonly unit: string;
}) {
  return (
    <StateBody state={state} emptyTitle={definition.data.genuineEmpty}>
      {(value) => (
        <div className="grid gap-1">
          <p className="text-2xl font-semibold tabular-nums text-ink">{value.count.toLocaleString()}</p>
          <p className="text-xs text-ink-muted">{unit}</p>
          {size === 'standard' && definition.interaction.destination && (
            <Link
              to={definition.interaction.destination}
              className="text-xs font-semibold text-accent-strong underline underline-offset-2"
            >
              {definition.title}
            </Link>
          )}
        </div>
      )}
    </StateBody>
  );
}

function ListingPrepWidget({
  size,
  state,
}: {
  readonly size: WidgetSize;
  readonly state: TruthState<PrepSummary>;
}) {
  return (
    <StateBody state={state} emptyTitle="No record is currently in listing preparation.">
      {(summary) => {
        // Exactly the rows the page has always shown, from the same fields.
        const rows: Array<[string, number, string]> = [
          ['Ready to list', summary.by_status.ready_to_list ?? 0, '?tab=ready'],
          ['Waiting on your review', summary.by_readiness.needs_owner_review ?? 0, '?readiness=needs_owner_review'],
          [READINESS_LABELS.needs_photos, summary.by_readiness.needs_photos ?? 0, '?readiness=needs_photos'],
          [READINESS_LABELS.blocked, summary.by_readiness.blocked ?? 0, '?readiness=blocked'],
          ['No active preparation', summary.no_active_preparation, '?tab=candidates'],
        ];
        if (size === 'standard') {
          return (
            <div className="grid gap-1">
              <p className="text-2xl font-semibold tabular-nums text-ink">
                {(summary.by_readiness.ready ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-ink-muted">ready by live readiness</p>
              <Link to="/listing-prep" className="text-xs font-semibold text-accent-strong underline underline-offset-2">
                Open Listing Prep
              </Link>
            </div>
          );
        }
        return (
          <ul className="grid gap-1">
            {rows.map(([label, count, query]) => (
              <li key={label}>
                <Link
                  to={`/listing-prep${query}`}
                  className="flex items-center justify-between rounded-control px-1 py-0.5 text-sm hover:bg-surface-inset"
                >
                  <span>{label}</span>
                  <span className="font-semibold tabular-nums">{count.toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        );
      }}
    </StateBody>
  );
}

function IntakeSessionsWidget({
  size,
  state,
}: {
  readonly size: WidgetSize;
  readonly state: TruthState<IntakeFacts>;
}) {
  return (
    <StateBody state={state} emptyTitle="Nothing waiting here." emptyDescription="No intake session is currently open.">
      {(facts) => (
        <div className="grid gap-2">
          {size !== 'compact' && <p className="text-xs text-ink-muted">Sessions you started but have not finished.</p>}
          {size === 'expanded' && facts.sessions.length > 0 && (
            <ul className="grid gap-1">
              {facts.sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    to="/intake-sessions"
                    className="flex items-center justify-between gap-2 rounded-control border border-subtle px-3 py-2 text-sm hover:bg-surface-inset"
                  >
                    <span className="min-w-0 truncate">{session.label || 'Untitled session'}</span>
                    <span className="shrink-0 text-xs text-accent-strong">Resume</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {size !== 'compact' && (
            <Link
              to="/intake-sessions"
              className="text-xs font-semibold text-accent-strong underline underline-offset-2"
            >
              Open intake sessions
            </Link>
          )}
        </div>
      )}
    </StateBody>
  );
}

/**
 * Quick actions.
 *
 * Navigation only, to routes that already exist. It reads nothing, so it keeps
 * working when every governed source is down — which is exactly when an
 * operator most wants a way out of the screen.
 */
function QuickActionsWidget({ size }: { readonly size: WidgetSize }) {
  return (
    <div className={`flex flex-wrap gap-2 ${size === 'full' ? 'justify-start' : ''}`}>
      <LinkButton to="/quick-add" primary>
        <PackagePlus className="h-4 w-4" aria-hidden="true" /> Add inventory
      </LinkButton>
      <LinkButton to="/scan">Scan or find</LinkButton>
      <LinkButton to="/inventory/current">View inventory</LinkButton>
      <LinkButton to="/locations">Manage locations</LinkButton>
    </div>
  );
}

/**
 * A navigation destination that looks like a button.
 *
 * A real `<a>`, not a `<button>` with an onClick: these go somewhere, so
 * middle-click, open-in-new-tab and the status bar all have to work.
 */
function LinkButton({
  to,
  primary = false,
  children,
}: {
  readonly to: string;
  readonly primary?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
        primary
          ? 'bg-accent text-on-accent hover:opacity-90'
          : 'border border-strong bg-surface-raised text-ink hover:bg-surface-inset'
      }`}
    >
      {children}
    </Link>
  );
}

/** Pick the body for a definition. Unknown ids render nothing, never a stub. */
export function renderWidgetBody(
  definition: WidgetDefinition,
  size: WidgetSize,
  facts: WorkbenchFacts,
): ReactNode {
  switch (definition.id) {
    case 'inventory.needs-location':
    case 'inventory.needs-photos':
    case 'inventory.unclassified-category':
    case 'inventory.needs-condition-details':
      return <QueueWidget definition={definition} size={size} state={facts[definition.id]} />;
    case 'governance.open-corrections':
      return (
        <MetricWidget definition={definition} size={size} state={facts[definition.id]} unit="open correction requests" />
      );
    case 'inventory.record-count':
      return (
        <MetricWidget definition={definition} size={size} state={facts[definition.id]} unit="governed inventory records" />
      );
    case 'sell.listing-prep-backlog':
      return <ListingPrepWidget size={size} state={facts[definition.id]} />;
    case 'intake.open-sessions':
      return <IntakeSessionsWidget size={size} state={facts[definition.id]} />;
    case 'utility.quick-actions':
      return <QuickActionsWidget size={size} />;
    default:
      return null;
  }
}

/** The header accessory for a definition, where a count belongs there. */
export function renderWidgetAccessory(definition: WidgetDefinition, facts: WorkbenchFacts): ReactNode {
  switch (definition.id) {
    case 'inventory.needs-location':
    case 'inventory.needs-photos':
    case 'inventory.unclassified-category':
    case 'inventory.needs-condition-details':
    case 'governance.open-corrections':
    case 'inventory.record-count':
    case 'intake.open-sessions':
      return <CountAccessory state={facts[definition.id]} />;
    default:
      return null;
  }
}

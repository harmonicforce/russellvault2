import { Field, Button, hasValue, type TruthState } from '../../design-system';
import type { AcquisitionFacets } from '../../lib/acquisitionLinesApi';
import {
  CLASSIFICATION_METHODS,
  METHOD_LABELS,
  activeFilters,
  type AcquisitionsListState,
} from './listState';

/**
 * The governed filter surface.
 *
 * Every control carries a real, programmatically associated label. The previous
 * row relied on the first `<option>` to say what each select meant, which works
 * only while an operator can see all five at once and never works for a screen
 * reader reading one control in isolation.
 *
 * TRUTHFUL UNDER FACET FAILURE
 *
 * The dynamic selects take their suggestions from the facets dependency. When
 * facets fail, the suggestions are gone but the operator's CURRENT selection is
 * not: it stays in the list and stays selected, so the control keeps telling the
 * truth about what is being filtered. An empty option list would say "there are
 * no sellers", which is a different and false claim.
 */

const SELECT_CLASS =
  'min-h-11 w-full rounded-control border border-subtle bg-surface-base px-2 py-2 text-sm text-ink ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

interface Option {
  readonly value: string;
  readonly label: string;
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly allLabel: string;
  readonly value: string | null;
  readonly options: readonly Option[];
  readonly onChange: (value: string) => void;
}) {
  // The current selection is always present, even when the suggestion list
  // could not be read. A select that dropped its own value would silently
  // display "All sellers" while the URL still filtered by one.
  const withCurrent =
    value && !options.some((option) => option.value === value) ? [...options, { value, label: value }] : options;

  return (
    <Field label={label}>
      {(control) => (
        <select {...control} value={value ?? ''} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
          <option value="">{allLabel}</option>
          {withCurrent.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export interface AcquisitionsFiltersProps {
  readonly state: AcquisitionsListState;
  readonly facets: TruthState<AcquisitionFacets>;
  readonly onFilterChange: (key: string, value: string) => void;
  readonly onSearchSubmit: (query: string) => void;
  readonly onClearFilters: () => void;
}

export function AcquisitionsFilters({
  state,
  facets,
  onFilterChange,
  onSearchSubmit,
  onClearFilters,
}: AcquisitionsFiltersProps) {
  const facetValues = hasValue(facets) ? facets.value : null;
  const active = activeFilters(state);
  // The search box has its own way to be emptied, so "Clear filters" counts
  // only the filters it will actually clear.
  const clearableActive = active.filter((key) => key !== 'query');

  const classificationOptions: Option[] = [
    { value: 'unclassified', label: 'Unclassified' },
    ...(facetValues?.classificationOptions ?? []).map((option) => ({ value: option.key, label: option.label })),
  ];

  return (
    <section aria-label="Search and filters" className="grid gap-3 rounded-instrument border border-subtle bg-surface-base p-4">
      <form
        // Submitted deliberately, exactly as before. Search is a governed
        // database predicate, not a keystroke-by-keystroke suggestion box, and
        // firing it per character would issue a governed query per letter.
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit(String(new FormData(event.currentTarget).get('query') ?? ''));
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <Field label="Search acquisitions" className="min-w-[240px] flex-1">
          {(control) => (
            <input
              {...control}
              // `key` on the URL value so browser navigation and a workspace
              // switch both reset the field to what the URL actually holds.
              key={state.query ?? ''}
              name="query"
              type="search"
              defaultValue={state.query ?? ''}
              placeholder="Search acquisitions"
              className="min-h-11 w-full rounded-control border border-subtle bg-surface-base px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            />
          )}
        </Field>
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FilterSelect
          label="Classification"
          allLabel="All classifications"
          value={state.classification}
          options={classificationOptions}
          onChange={(value) => onFilterChange('classification', value)}
        />
        <FilterSelect
          label="Seller"
          allLabel="All sellers"
          value={state.seller}
          options={(facetValues?.sellers ?? []).map((facet) => ({ value: facet.value, label: facet.value }))}
          onChange={(value) => onFilterChange('seller', value)}
        />
        <FilterSelect
          label="Business vertical"
          allLabel="All verticals"
          value={state.businessVertical}
          options={(facetValues?.businessVerticals ?? []).map((facet) => ({ value: facet.value, label: facet.value }))}
          onChange={(value) => onFilterChange('businessVertical', value)}
        />
        <FilterSelect
          label="Review state"
          allLabel="All review states"
          value={state.classificationState}
          options={[
            { value: 'classified', label: 'Classified' },
            { value: 'needs_review', label: 'Needs review' },
            { value: 'unclassified', label: 'Unclassified' },
          ]}
          onChange={(value) => onFilterChange('classificationState', value)}
        />
        <FilterSelect
          label="Eligibility"
          allLabel="All eligibility states"
          value={state.exclusionState}
          options={[
            { value: 'included', label: 'Included' },
            { value: 'excluded', label: 'Excluded' },
          ]}
          onChange={(value) => onFilterChange('exclusionState', value)}
        />
        <FilterSelect
          // A closed vocabulary the SERVER already validates and the transport
          // already carried. Surfacing it exposes an existing capability; it
          // invents no rule.
          label="Classification method"
          allLabel="All classification methods"
          value={state.method}
          options={CLASSIFICATION_METHODS.map((method) => ({ value: method, label: METHOD_LABELS[method] }))}
          onChange={(value) => onFilterChange('method', value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-ink-muted">
          {clearableActive.length === 0
            ? 'No filters applied.'
            : `${clearableActive.length} ${clearableActive.length === 1 ? 'filter' : 'filters'} applied.`}
        </p>
        {clearableActive.length > 0 && (
          <Button size="small" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
        {state.query && <p className="text-xs text-ink-muted">Search term “{state.query}” is kept when filters are cleared.</p>}
      </div>
    </section>
  );
}

'use client';

/**
 * Narrowing a Cards block that draws from a collection.
 *
 * WHY THIS IS NOT A REGISTRY FIELD. Every other control on this pane is declared
 * in lib/content/blocks.ts and drawn generically, which works because its options
 * are the same on every site. These are not: the fields on offer are whatever THIS
 * collection declares, and a choice field's values are whatever the client typed
 * into it. A static select cannot say that.
 *
 * The facts control next door carries a comment saying a picker would have to
 * guess at the schema or fetch it on every keystroke, which is why that one counts
 * facts rather than naming them. That is no longer true. listCollectionsAction
 * already returns every collection WITH its declared fields, so one call gives the
 * pane the field list and each choice field's own options, and the client picks
 * "Board basis is Half board" from two dropdowns rather than typing a key.
 *
 * The one fetch lives in useCollectionFields (fetched once for the whole editor,
 * shared with the loop card's token inserter), so a page carrying both makes one
 * request rather than one per pane.
 */

import {
  canFilter,
  canSort,
  OPS_FOR_KIND,
  type FilterOp,
} from '../../lib/content/collection-filter';
import type { FieldDef } from '../../lib/content/collection-fields';
import { useCollectionFields } from './useCollectionFields';

/** What each operator is called in front of a client. */
const OP_LABEL: Record<FilterOp, string> = {
  is: 'is',
  isNot: 'is not',
  atLeast: 'is at least',
  atMost: 'is at most',
  before: 'is before',
  after: 'is after',
};

export function ListingFilterFields({
  collectionKey,
  props,
  onChange,
}: {
  collectionKey: string;
  props: Record<string, unknown>;
  /** One prop at a time, so each edit is its own undo step. */
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { fields, ready } = useCollectionFields(collectionKey);

  const str = (key: string) => (typeof props[key] === 'string' ? (props[key] as string) : '');
  const filterField = str('filterField');
  const filterOp = str('filterOp');
  const filterValue = str('filterValue');
  const sortField = str('sortField');

  const filterable = fields.filter((f) => canFilter(f.kind));
  const sortable = fields.filter((f) => canSort(f.kind));
  const chosen = filterable.find((f) => f.key === filterField) ?? null;
  const ops = chosen ? OPS_FOR_KIND[chosen.kind] : [];

  if (!ready) {
    return <p className="ed-help">Reading the collection…</p>;
  }

  if (filterable.length === 0 && sortable.length === 0) {
    return (
      <p className="ed-help">
        {collectionKey
          ? 'This collection has no fields to narrow by yet. Add some on the Collections screen and they will appear here.'
          : 'Choose a collection above, and the fields it declares will appear here.'}
      </p>
    );
  }

  /*
   * CHANGING THE FIELD CLEARS THE REST, because an operator and a value chosen
   * for a price mean nothing on a board basis. Leaving them would store a filter
   * the engine refuses, and the grid would silently show everything while the
   * pane showed a filter, which is the worst of both.
   */
  const pickField = (key: string) => {
    const next = filterable.find((f) => f.key === key);
    onChange({
      filterField: key,
      filterOp: next ? (OPS_FOR_KIND[next.kind][0] ?? '') : '',
      filterValue: '',
    });
  };

  return (
    <>
      {filterable.length > 0 && (
        <div className="ed-field">
          <label className="ed-label" htmlFor="ed-filter-field">
            Only show
          </label>
          <select
            id="ed-filter-field"
            className="ed-select"
            value={filterField}
            onChange={(event) => pickField(event.target.value)}
          >
            <option value="">Everything</option>
            {filterable.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {chosen && (
        <div className="ed-field">
          <label className="ed-label" htmlFor="ed-filter-op">
            That
          </label>
          <select
            id="ed-filter-op"
            className="ed-select"
            value={filterOp}
            onChange={(event) => onChange({ filterOp: event.target.value })}
          >
            {ops.map((op) => (
              <option key={op} value={op}>
                {OP_LABEL[op]}
              </option>
            ))}
          </select>
        </div>
      )}

      {chosen && <FilterValue field={chosen} value={filterValue} onChange={onChange} />}

      {sortable.length > 0 && (
        <div className="ed-field">
          <label className="ed-label" htmlFor="ed-sort-field">
            In order of
          </label>
          <select
            id="ed-sort-field"
            className="ed-select"
            value={sortField}
            onChange={(event) => onChange({ sortField: event.target.value })}
          >
            <option value="">Newest first</option>
            {sortable.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {sortField && (
        <div className="ed-field">
          <label className="ed-label" htmlFor="ed-sort-dir">
            Starting with
          </label>
          <select
            id="ed-sort-dir"
            className="ed-select"
            value={str('sortDir') === 'desc' ? 'desc' : 'asc'}
            onChange={(event) => onChange({ sortDir: event.target.value })}
          >
            <option value="asc">Lowest first</option>
            <option value="desc">Highest first</option>
          </select>
        </div>
      )}
    </>
  );
}

/**
 * The value control, which is the field's OWN kind rather than a text box.
 *
 * A choice offers its options, so a client cannot mistype one and get a grid that
 * silently matches nothing. A toggle is yes or no. A number is a number input and
 * a date is a date picker, so the value is already in the shape the engine
 * compares before it is stored.
 */
function FilterValue({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const set = (next: string) => onChange({ filterValue: next });

  if (field.kind === 'choice') {
    return (
      <div className="ed-field">
        <label className="ed-label" htmlFor="ed-filter-value">
          {field.label}
        </label>
        <select
          id="ed-filter-value"
          className="ed-select"
          value={value}
          onChange={(event) => set(event.target.value)}
        >
          <option value="">Choose one</option>
          {field.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.kind === 'toggle') {
    return (
      <div className="ed-field">
        <label className="ed-label" htmlFor="ed-filter-value">
          {field.label}
        </label>
        <select
          id="ed-filter-value"
          className="ed-select"
          value={value}
          onChange={(event) => set(event.target.value)}
        >
          <option value="">Choose one</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
    );
  }

  return (
    <div className="ed-field">
      <label className="ed-label" htmlFor="ed-filter-value">
        {field.label}
      </label>
      <input
        id="ed-filter-value"
        className="ed-input"
        type={field.kind === 'date' ? 'date' : 'number'}
        value={value}
        onChange={(event) => set(event.target.value)}
      />
    </div>
  );
}

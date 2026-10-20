'use client';

import { useState } from 'react';
import type { FieldDefinition } from '@opvaryn/contracts';

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

interface Row {
  [column: string]: string;
}

/**
 * TableField is a repeating table: one row per line of work, with a typed cell per column
 * (ADR 0032). The rows travel as one JSON value, because a form has no other way to carry
 * a list of objects.
 */
export function TableField({
  field,
  defaultValue,
  onChange,
}: {
  field: FieldDefinition;
  defaultValue?: unknown;
  /** The rows the person has entered, so a condition can read them. */
  onChange?: (rows: unknown) => void;
}) {
  const columns = field.columns ?? [];
  const [rows, setRows] = useState<Row[]>(() => rowsFromValue(defaultValue));

  // The rows are reported upwards, so a condition can read them (ADR 0032).
  function apply(next: Row[]) {
    setRows(next);
    onChange?.(next);
  }

  function update(rowIndex: number, columnKey: string, value: string) {
    apply(rows.map((row, index) => (index === rowIndex ? { ...row, [columnKey]: value } : row)));
  }

  function addRow() {
    apply([...rows, {}]);
  }

  function removeRow(rowIndex: number) {
    apply(rows.filter((_, index) => index !== rowIndex));
  }

  return (
    <div className="mt-1.5">
      <input type="hidden" name={field.key} value={JSON.stringify(rows)} />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs text-on-surface-muted">
          Chưa có dòng nào.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-left text-xs tracking-wide text-on-surface-muted uppercase">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} scope="col" className="px-2 py-1.5 font-medium">
                    {column.label}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 font-medium">
                  <span className="sr-only">Bỏ dòng</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((column) => (
                    <td key={column.key} className="px-2 py-1.5">
                      <input
                        type={inputTypeFor(column.type)}
                        value={row[column.key] ?? ''}
                        onChange={(event) => update(rowIndex, column.key, event.target.value)}
                        className={INPUT_CLASS}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(rowIndex)}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-surface-overlay"
                    >
                      Bỏ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        onClick={addRow}
        className="mt-2 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-overlay"
      >
        Thêm dòng
      </button>
    </div>
  );
}

/**
 * inputTypeFor picks the control of a cell from the kind of its column (ADR 0036): a
 * number column asks for a number, a date column for a date, a text column for text.
 */
function inputTypeFor(type: string): 'text' | 'number' | 'date' {
  switch (type) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

/** rowsFromValue reads the stored rows of a table field. */
function rowsFromValue(value: unknown): Row[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const row: Row = {};
    if (item && typeof item === 'object') {
      for (const [key, cell] of Object.entries(item as Record<string, unknown>)) {
        row[key] = cell === null || cell === undefined ? '' : String(cell);
      }
    }
    return row;
  });
}

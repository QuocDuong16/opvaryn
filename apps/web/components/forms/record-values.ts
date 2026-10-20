import type { BusinessObject } from '@opvaryn/contracts';

/**
 * recordValuesFromForm converts submitted form strings into the shapes the API
 * expects, following the object's field definitions.
 *
 * Blank inputs are omitted so the server decides whether a field is required; a
 * non-numeric number is passed through as text so the API names the problem
 * instead of the form silently dropping it. Lives outside the server-action
 * module so it stays unit-testable.
 */
export function recordValuesFromForm(
  object: BusinessObject,
  formData: FormData,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const field of object.fields) {
    const raw = formData.get(field.key);
    if (typeof raw !== 'string') {
      continue;
    }
    const text = raw.trim();
    if (text === '') {
      continue;
    }

    switch (field.type) {
      case 'number': {
        const parsed = Number(text);
        values[field.key] = Number.isFinite(parsed) ? parsed : text;
        break;
      }
      case 'rows': {
        values[field.key] = text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '');
        break;
      }
      case 'table': {
        // The rows of a table travel as one JSON value (ADR 0032). A number cell
        // travels as a number and a date cell as a date string, so the server reads
        // the kind the column declares (ADR 0036).
        try {
          const rows: unknown = JSON.parse(text);
          if (Array.isArray(rows)) {
            values[field.key] = rows.map((row) => {
              if (!row || typeof row !== 'object') {
                return row;
              }
              const cells: Record<string, unknown> = { ...(row as Record<string, unknown>) };
              for (const column of field.columns ?? []) {
                const cell = cells[column.key];
                if (typeof cell !== 'string') {
                  continue;
                }
                if (column.type === 'number') {
                  const parsed = Number(cell);
                  if (Number.isFinite(parsed)) {
                    cells[column.key] = parsed;
                  }
                } else if (column.type === 'date') {
                  cells[column.key] = cell.trim();
                } else {
                  cells[column.key] = cell.trim();
                }
              }
              return cells;
            });
          }
        } catch {
          // A table that is not JSON is left out; the server refuses the record anyway
          // if the rows do not fit the columns.
        }
        break;
      }
      default:
        values[field.key] = text;
    }
  }

  return values;
}

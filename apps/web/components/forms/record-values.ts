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
      default:
        values[field.key] = text;
    }
  }

  return values;
}

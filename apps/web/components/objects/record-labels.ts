import type { BusinessObjectVersion, ObjectRecord } from '@opvaryn/contracts';

import { fieldsForVersionNumber } from '@/components/objects/record-grouping';
import { primaryFieldValue } from '@/lib/format';

/**
 * recordLabels maps a record id to the label that identifies it, using the schema of
 * the definition version that record was created under (ADR 0006). Screens that only
 * hold an instance — the workflow detail page, a task — use it to say which record a
 * process is running on, the same way the record table labels a row.
 */
export function recordLabels(
  records: readonly ObjectRecord[],
  versions: readonly BusinessObjectVersion[],
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const record of records) {
    labels[record.id] = primaryFieldValue(
      fieldsForVersionNumber(versions, record.objectVersion),
      record,
    );
  }
  return labels;
}

import type { BusinessObjectVersion, ObjectRecord } from '@opvaryn/contracts';

/**
 * RecordGroup is the records of one definition version, newest version first.
 * Grouping matters because a record is read with the schema it was created under:
 * an edit does not rewrite existing data (playbook invariant 1).
 */
export interface RecordGroup {
  /** The published version, or null for records whose version is missing. */
  version: BusinessObjectVersion | null;
  versionNumber: number;
  records: ObjectRecord[];
}

/**
 * groupRecordsByVersion buckets records by the version they are bound to. Groups
 * follow the version list (newest first). A record whose version cannot be found is
 * kept in a trailing group with `version: null` instead of being dropped — losing
 * data silently would be worse than showing it without labels.
 */
export function groupRecordsByVersion(
  records: readonly ObjectRecord[],
  versions: readonly BusinessObjectVersion[],
): RecordGroup[] {
  const byNumber = new Map<number, BusinessObjectVersion>();
  for (const version of versions) {
    if (!byNumber.has(version.version)) {
      byNumber.set(version.version, version);
    }
  }

  const groups = new Map<number | null, ObjectRecord[]>();
  for (const record of records) {
    const key = byNumber.has(record.objectVersion) ? record.objectVersion : null;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const ordered: RecordGroup[] = [];
  for (const version of versions) {
    const bucket = groups.get(version.version);
    if (bucket && bucket.length > 0) {
      ordered.push({ version, versionNumber: version.version, records: bucket });
      groups.delete(version.version);
    }
  }

  const orphaned = groups.get(null);
  if (orphaned && orphaned.length > 0) {
    ordered.push({ version: null, versionNumber: 0, records: orphaned });
  }

  return ordered;
}

/** fieldsForVersion returns the schema to read a record group with. */
export function fieldsForVersion(group: RecordGroup): BusinessObjectVersion['fields'] {
  return group.version?.fields ?? [];
}

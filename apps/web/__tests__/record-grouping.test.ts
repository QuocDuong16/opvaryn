import { describe, expect, it } from 'vitest';
import type { BusinessObjectVersion, ObjectRecord } from '@opvaryn/contracts';

import { fieldsForVersion, groupRecordsByVersion } from '@/components/objects/record-grouping';

function version(number: number, id = `v${number}-id`): BusinessObjectVersion {
  return {
    id,
    version: number,
    name: `Định nghĩa v${number}`,
    fields: [{ key: `field_v${number}`, label: `Field v${number}`, type: 'text', required: false }],
    publishedAt: '2026-10-13T12:00:00Z',
    publishedBy: 'system',
  };
}

function record(objectVersion: number, id = `r-${objectVersion}-${Math.random()}`): ObjectRecord {
  return {
    id,
    objectKey: 'purchase_request',
    objectVersion,
    values: { [`field_v${objectVersion}`]: `giá trị v${objectVersion}` },
    canEdit: false,
    createdAt: '2026-10-13T12:00:00Z',
    updatedAt: '2026-10-13T12:00:00Z',
  };
}

describe('groupRecordsByVersion', () => {
  it('groups records under the version they were created with, newest first', () => {
    const versions = [version(3), version(2), version(1)];
    const records = [record(1, 'a'), record(3, 'b'), record(1, 'c')];

    const groups = groupRecordsByVersion(records, versions);

    expect(groups.map((group) => group.versionNumber)).toEqual([3, 1]);
    expect(groups[0]?.records.map((item) => item.id)).toEqual(['b']);
    expect(groups[1]?.records.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('skips versions that have no records', () => {
    const groups = groupRecordsByVersion([record(1, 'a')], [version(2), version(1)]);

    expect(groups.map((group) => group.versionNumber)).toEqual([1]);
  });

  it('keeps records whose version is missing instead of dropping them', () => {
    const groups = groupRecordsByVersion([record(9, 'orphan')], [version(1)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.version).toBeNull();
    expect(groups[0]?.records.map((item) => item.id)).toEqual(['orphan']);
  });

  it('returns nothing for an empty record list', () => {
    expect(groupRecordsByVersion([], [version(1)])).toEqual([]);
  });

  it('reads each group with its own schema', () => {
    const versions = [version(2), version(1)];
    const groups = groupRecordsByVersion([record(2, 'b'), record(1, 'a')], versions);

    expect(fieldsForVersion(groups[0]!).map((field) => field.key)).toEqual(['field_v2']);
    expect(fieldsForVersion(groups[1]!).map((field) => field.key)).toEqual(['field_v1']);
  });
});

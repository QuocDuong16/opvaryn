import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { MAX_EXPORT_ROWS } from '@/lib/export';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '@/lib/import';

/**
 * The browser repeats three limits the API owns, so a file or a download is refused with a
 * fast answer before it is sent. If one side moves, the other must move with it — this test
 * reads the Go source and pins the two together.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');

function goSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('mirrored limits', () => {
  it('keeps the export row ceiling equal to the API', () => {
    const source = goSource('apps/api/internal/service/recordcsv.go');
    expect(source).toMatch(/const MaxExportRows = ([\d_]+)/);
    const goRows = Number(source.match(/const MaxExportRows = ([\d_]+)/)![1].replace(/_/g, ''));
    expect(MAX_EXPORT_ROWS).toBe(goRows);
  });

  it('keeps the import row ceiling equal to the API', () => {
    const source = goSource('apps/api/internal/service/recordimport.go');
    expect(source).toMatch(/MaxImportRows = (\d+)/);
    const goRows = Number(source.match(/MaxImportRows = (\d+)/)![1]);
    expect(MAX_IMPORT_ROWS).toBe(goRows);
  });

  it('keeps the import byte ceiling equal to the API', () => {
    const source = goSource('apps/api/internal/service/recordimport.go');
    expect(source).toMatch(/MaxImportBytes = (\d+) << (\d+)/);
    const [, value, shift] = source.match(/MaxImportBytes = (\d+) << (\d+)/)!;
    expect(MAX_IMPORT_BYTES).toBe(Number(value) * 2 ** Number(shift));
  });

  it('keeps the attachment byte ceiling equal to the API', () => {
    const source = goSource('apps/api/internal/domain/attachment.go');
    expect(source).toMatch(/const MaxAttachmentBytes = (\d+) << (\d+)/);
    const [, value, shift] = source.match(/const MaxAttachmentBytes = (\d+) << (\d+)/)!;
    expect(MAX_ATTACHMENT_BYTES).toBe(Number(value) * 2 ** Number(shift));
  });
});

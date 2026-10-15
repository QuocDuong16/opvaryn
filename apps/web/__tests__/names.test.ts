import { describe, expect, it } from 'vitest';

import { joinLabels, labelOrKey, nameLabels, roleLabels } from '@/lib/names';

describe('labelOrKey', () => {
  it('prefers the name and falls back to the key', () => {
    expect(labelOrKey('Trưởng bộ phận', 'truong_bo_phan')).toBe('Trưởng bộ phận');
    expect(labelOrKey('', 'truong_bo_phan')).toBe('truong_bo_phan');
    expect(labelOrKey('   ', 'truong_bo_phan')).toBe('truong_bo_phan');
    expect(labelOrKey(undefined, 'ky_thuat')).toBe('ky_thuat');
  });
});

describe('roleLabels', () => {
  it('indexes the catalogue and joins several roles for one line', () => {
    const labels = roleLabels([
      { key: 'process_designer', label: 'Người thiết kế quy trình' },
      { key: 'truong_bo_phan', label: 'Trưởng bộ phận' },
      { key: 'ke_toan', label: '' },
    ]);

    expect(joinLabels(['process_designer', 'truong_bo_phan'], labels)).toBe(
      'Người thiết kế quy trình, Trưởng bộ phận',
    );
    // A role nobody has named keeps its key instead of disappearing.
    expect(joinLabels(['ke_toan', 'chua_dat_ten'], labels)).toBe('ke_toan, chua_dat_ten');
  });
});

describe('nameLabels', () => {
  it('names objects and definitions, falling back to the key', () => {
    const names = nameLabels([
      { key: 'purchase_request', name: 'Đề nghị mua hàng' },
      { key: 'it_incident', name: '' },
    ]);

    expect(labelOrKey(names.get('purchase_request'), 'purchase_request')).toBe('Đề nghị mua hàng');
    expect(labelOrKey(names.get('it_incident'), 'it_incident')).toBe('it_incident');
    expect(labelOrKey(names.get('missing'), 'missing')).toBe('missing');
  });
});

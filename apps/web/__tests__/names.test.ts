import { describe, expect, it } from 'vitest';

import {
  designerRoleName,
  fieldNames,
  joinLabels,
  keyFromLabel,
  labelOrKey,
  nameLabels,
  optionValueNames,
  roleLabels,
} from '@/lib/names';

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

describe('fieldNames', () => {
  it('names the fields of a definition, so a condition reads in words', () => {
    const names = fieldNames({
      fields: [
        { key: 'estimated_amount', label: 'Giá trị dự kiến (VND)' },
        { key: 'department', label: 'Bộ phận' },
      ],
    });

    expect(names.get('estimated_amount')).toBe('Giá trị dự kiến (VND)');
    expect(labelOrKey(names.get('nope'), 'nope')).toBe('nope');
  });
});

describe('optionValueNames', () => {
  it('names the value a select field stores, so a breakdown reads in words', () => {
    const names = optionValueNames({
      fields: [
        {
          key: 'department',
          type: 'select',
          options: [
            { value: 'ky_thuat', label: 'Kỹ thuật' },
            { value: 'ke_toan', label: '' },
          ],
        },
        { key: 'title', type: 'text' },
        { key: 'severity', type: 'select', options: [] },
      ],
    });

    const department = names.get('department');
    expect(labelOrKey(department?.get('ky_thuat'), 'ky_thuat')).toBe('Kỹ thuật');
    // An option nobody has named keeps its value instead of disappearing.
    expect(labelOrKey(department?.get('ke_toan'), 'ke_toan')).toBe('ke_toan');
    expect(names.has('title')).toBe(false);
    expect(names.has('severity')).toBe(false);
  });
});

describe('designerRoleName', () => {
  it('uses the name the catalogue has for the role', () => {
    expect(designerRoleName([{ key: 'process_designer', label: 'Người thiết kế quy trình' }])).toBe(
      'Người thiết kế quy trình',
    );
  });

  it('reads as prose, never as a key, when nobody has named the role', () => {
    expect(designerRoleName([])).toBe('vai trò thiết kế quy trình');
    expect(designerRoleName([{ key: 'process_designer', label: '' }])).toBe(
      'vai trò thiết kế quy trình',
    );
  });
});

describe('keyFromLabel', () => {
  it('turns a Vietnamese label into the key the system stores', () => {
    expect(keyFromLabel('Họ tên nhân viên')).toBe('ho_ten_nhan_vien');
    expect(keyFromLabel('Giá trị dự kiến (VND)')).toBe('gia_tri_du_kien_vnd');
    expect(keyFromLabel('Đề nghị mua hàng')).toBe('de_nghi_mua_hang');
  });

  it('keeps the result usable as a key: letters first, no leading or repeated separators', () => {
    expect(keyFromLabel('  Nhiều   khoảng trắng  ')).toBe('nhieu_khoang_trang');
    expect(keyFromLabel('2026 kế hoạch')).toBe('k_2026_ke_hoach');
    expect(keyFromLabel('!!!')).toBe('');
  });
});

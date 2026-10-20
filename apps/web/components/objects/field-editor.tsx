'use client';

import { useState } from 'react';
import type { FieldDefinition, FieldType } from '@opvaryn/contracts';

import {
  definitionsToDrafts,
  EMPTY_FIELD_DRAFT,
  fieldDraftsToDefinitions,
  type ColumnDraft,
  type FieldDraft,
} from '@/components/objects/field-draft';
import { FIELD_TYPE_LABELS } from '@/lib/format';
import { keyFromLabel } from '@/lib/names';

const FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as FieldType[];

/** COLUMN_TYPES are the kinds a table column can hold (ADR 0036). */
const COLUMN_TYPES = [
  { value: 'text', label: 'Chữ' },
  { value: 'number', label: 'Số' },
  { value: 'date', label: 'Ngày' },
] as const;

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

interface FieldRow extends FieldDraft {
  id: string;
}

/**
 * FieldEditor edits a field schema: empty for a new object, prefilled with an
 * existing definition when publishing the next version of one. Rows live in React
 * state and are submitted as one JSON hidden input; the Go service remains the
 * validation gate, so every rule is enforced in one place.
 */
export function FieldEditor({
  initialFields = [],
}: {
  /** Definition the editor opens on; defaults to an empty schema. */
  initialFields?: readonly FieldDefinition[];
}) {
  const [rows, setRows] = useState<FieldRow[]>(() =>
    definitionsToDrafts(initialFields).map((draft) => ({ ...draft, id: crypto.randomUUID() })),
  );

  function addRow() {
    setRows((current) => [...current, { ...EMPTY_FIELD_DRAFT, id: crypto.randomUUID() }]);
  }

  function updateRow(id: string, patch: Partial<FieldDraft>) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) {
          return row;
        }
        const next = { ...row, ...patch };
        // The key follows the name while the designer has not typed one of their own:
        // nobody should have to know what snake_case means (ADR 0018).
        if (patch.label !== undefined && (row.key === '' || row.key === keyFromLabel(row.label))) {
          next.key = keyFromLabel(patch.label);
        }
        return next;
      }),
    );
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  /** addColumn appends an empty column to a table field. */
  function addColumn(id: string) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, columns: [...row.columns, { key: '', label: '', type: 'text' }] }
          : row,
      ),
    );
  }

  /** updateColumn changes one column of a table field. */
  function updateColumn(id: string, index: number, patch: Partial<ColumnDraft>) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              columns: row.columns.map((column, columnIndex) =>
                columnIndex === index ? { ...column, ...patch } : column,
              ),
            }
          : row,
      ),
    );
  }

  /** removeColumn drops one column of a table field. */
  function removeColumn(id: string, index: number) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, columns: row.columns.filter((_, columnIndex) => columnIndex !== index) }
          : row,
      ),
    );
  }

  const definitions = fieldDraftsToDefinitions(rows);

  return (
    <fieldset>
      <div className="flex items-center justify-between gap-3">
        <legend className="text-xs font-medium tracking-wide uppercase">Các trường dữ liệu</legend>
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-overlay"
        >
          + Thêm trường
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs leading-relaxed text-on-surface-muted">
          Chưa có trường nào. Có thể tạo loại dữ liệu trước rồi bổ sung trường sau; màn nhập liệu
          được sinh từ chính định nghĩa này.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row, index) => (
            <li key={row.id} className="rounded-lg border border-border bg-surface/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-on-surface-muted">{`Trường ${index + 1}`}</span>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="rounded px-1.5 py-0.5 text-xs text-danger hover:bg-danger/10"
                >
                  Xoá
                </button>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] text-on-surface-muted">Mã trường</span>
                  <input
                    value={row.key}
                    onChange={(event) => updateRow(row.id, { key: event.target.value })}
                    placeholder="gia_tri_du_kien"
                    autoComplete="off"
                    className={`${INPUT_CLASS} mt-0.5 font-mono`}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-on-surface-muted">Tên hiển thị</span>
                  <input
                    value={row.label}
                    onChange={(event) => updateRow(row.id, { label: event.target.value })}
                    placeholder="Giá trị dự kiến (VND)"
                    className={`${INPUT_CLASS} mt-0.5`}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-on-surface-muted">Kiểu</span>
                  <select
                    value={row.type}
                    onChange={(event) =>
                      updateRow(row.id, { type: event.target.value as FieldType })
                    }
                    className={`${INPUT_CLASS} mt-0.5`}
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {FIELD_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-4 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.required}
                    onChange={(event) => updateRow(row.id, { required: event.target.checked })}
                    className="size-4 accent-[var(--accent)]"
                  />
                  Bắt buộc nhập
                </label>
              </div>

              {row.type === 'select' ? (
                <label className="mt-2 block">
                  <span className="text-[11px] text-on-surface-muted">
                    Lựa chọn — mỗi dòng một mục, dạng <code>mã = Tên</code>
                  </span>
                  <textarea
                    value={row.options}
                    onChange={(event) => updateRow(row.id, { options: event.target.value })}
                    rows={3}
                    placeholder={'kinh_doanh = Kinh doanh\nky_thuat = Kỹ thuật'}
                    className={`${INPUT_CLASS} mt-0.5 font-mono text-xs`}
                  />
                </label>
              ) : null}

              {row.type === 'formula' ? (
                <label className="mt-2 block">
                  <span className="text-[11px] text-on-surface-muted">
                    Công thức — hệ thống tự tính, người dùng không nhập
                  </span>
                  <input
                    value={row.formula}
                    onChange={(event) => updateRow(row.id, { formula: event.target.value })}
                    placeholder="so_luong * don_gia"
                    className={`${INPUT_CLASS} mt-0.5 font-mono text-xs`}
                  />
                  <span className="mt-1 block text-[11px] text-on-surface-muted">
                    Dùng các trường số của mẫu này. Có: + − × ÷, ngoặc, so sánh, ROUND, ABS, MIN,
                    MAX.
                  </span>
                </label>
              ) : null}

              {row.type === 'table' ? (
                <div className="mt-2">
                  <span className="text-[11px] text-on-surface-muted">
                    Cột của bảng — mỗi dòng một cột, và kiểu dữ liệu của cột
                  </span>
                  {row.columns.length === 0 ? (
                    <p className="mt-1 rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs text-on-surface-muted">
                      Chưa có cột nào. Bảng cần ít nhất một cột để nhập được dữ liệu.
                    </p>
                  ) : (
                    <ul className="mt-1.5 space-y-2">
                      {row.columns.map((column, columnIndex) => (
                        <li
                          key={`${columnIndex}-${column.key}`}
                          className="grid gap-2 rounded-lg border border-border bg-surface/40 p-2 sm:grid-cols-[1fr_1fr_8rem_auto]"
                        >
                          <label className="block">
                            <span className="text-[11px] text-on-surface-muted">Mã cột</span>
                            <input
                              value={column.key}
                              onChange={(event) =>
                                updateColumn(row.id, columnIndex, {
                                  key: event.target.value,
                                })
                              }
                              placeholder="ten_mon"
                              autoComplete="off"
                              className={`${INPUT_CLASS} mt-0.5 font-mono`}
                            />
                          </label>
                          <label className="block">
                            <span className="text-[11px] text-on-surface-muted">Tên hiển thị</span>
                            <input
                              value={column.label}
                              onChange={(event) =>
                                updateColumn(row.id, columnIndex, {
                                  label: event.target.value,
                                })
                              }
                              placeholder="Tên món"
                              className={`${INPUT_CLASS} mt-0.5`}
                            />
                          </label>
                          <label className="block">
                            <span className="text-[11px] text-on-surface-muted">Kiểu</span>
                            <select
                              value={column.type}
                              onChange={(event) =>
                                updateColumn(row.id, columnIndex, {
                                  type: event.target.value as ColumnDraft['type'],
                                })
                              }
                              className={`${INPUT_CLASS} mt-0.5`}
                            >
                              {COLUMN_TYPES.map((type) => (
                                <option key={type.value} value={type.value}>
                                  {type.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => removeColumn(row.id, columnIndex)}
                              className="rounded px-1.5 py-1 text-xs text-danger hover:bg-danger/10"
                            >
                              Xoá
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => addColumn(row.id)}
                    className="mt-2 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-overlay"
                  >
                    + Thêm cột
                  </button>
                </div>
              ) : null}

              {row.type !== 'formula' && row.type !== 'table' ? (
                <label className="mt-2 block">
                  <span className="text-[11px] text-on-surface-muted">
                    Chỉ hiện khi — <code>trường phép so sánh giá trị</code>, ví dụ{' '}
                    <code>so_luong &gt; 10</code>
                  </span>
                  <input
                    value={row.visibleWhen}
                    onChange={(event) => updateRow(row.id, { visibleWhen: event.target.value })}
                    placeholder="so_luong > 10"
                    className={`${INPUT_CLASS} mt-0.5 font-mono text-xs`}
                  />
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <input type="hidden" name="fields" value={JSON.stringify(definitions)} />
    </fieldset>
  );
}

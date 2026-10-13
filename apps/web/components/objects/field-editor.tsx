'use client';

import { useState } from 'react';
import type { FieldType } from '@opvaryn/contracts';

import {
  EMPTY_FIELD_DRAFT,
  fieldDraftsToDefinitions,
  type FieldDraft,
} from '@/components/objects/field-draft';
import { FIELD_TYPE_LABELS } from '@/lib/format';

const FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as FieldType[];

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

interface FieldRow extends FieldDraft {
  id: string;
}

/**
 * FieldEditor edits the field schema as part of the create form. Rows live in
 * React state and are submitted as one JSON hidden input; the Go service remains
 * the validation gate, so every rule is enforced in one place.
 */
export function FieldEditor() {
  const [rows, setRows] = useState<FieldRow[]>([]);

  function addRow() {
    setRows((current) => [...current, { ...EMPTY_FIELD_DRAFT, id: crypto.randomUUID() }]);
  }

  function updateRow(id: string, patch: Partial<FieldDraft>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  const definitions = fieldDraftsToDefinitions(rows);

  return (
    <fieldset>
      <div className="flex items-center justify-between gap-3">
        <legend className="text-xs font-medium tracking-wide uppercase">Field schema</legend>
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-overlay"
        >
          + Thêm field
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs leading-relaxed text-on-surface-muted">
          Chưa có field nào. Có thể tạo object trước rồi bổ sung field sau; form nhập liệu được sinh
          từ chính schema này.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row, index) => (
            <li key={row.id} className="rounded-lg border border-border bg-surface/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-on-surface-muted">fields[{index}]</span>
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
                  <span className="text-[11px] text-on-surface-muted">Key (snake_case)</span>
                  <input
                    value={row.key}
                    onChange={(event) => updateRow(row.id, { key: event.target.value })}
                    placeholder="estimated_amount"
                    autoComplete="off"
                    className={`${INPUT_CLASS} mt-0.5 font-mono`}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-on-surface-muted">Nhãn hiển thị</span>
                  <input
                    value={row.label}
                    onChange={(event) => updateRow(row.id, { label: event.target.value })}
                    placeholder="Số tiền dự kiến"
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
                    Lựa chọn — mỗi dòng một mục, dạng <code>value = Nhãn</code>
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
            </li>
          ))}
        </ul>
      )}

      <input type="hidden" name="fields" value={JSON.stringify(definitions)} />
    </fieldset>
  );
}

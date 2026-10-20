'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { BusinessObject, FieldDefinition, ObjectRecord } from '@opvaryn/contracts';

import {
  createObjectRecordAction,
  updateObjectRecordAction,
} from '@/app/(workspace)/objects/actions';
import { FileField } from '@/components/forms/file-field';
import { INITIAL_CREATE_RECORD_STATE } from '@/components/forms/object-form-state';
import { TableField } from '@/components/forms/table-field';
import { evaluateCondition } from '@/lib/conditions';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

/**
 * ObjectForm is the data-entry form generated from a business object schema. It is
 * the same component behind the object detail screen, the Forms preview and the record
 * edit page, so what the Form Builder shows is exactly what a user fills in.
 *
 * Pass `record` to edit an existing record: the fields come from the version that record
 * was created under, and the values are prefilled from it.
 */
export function ObjectForm({ object, record }: { object: BusinessObject; record?: ObjectRecord }) {
  const [state, formAction] = useActionState(
    record ? updateObjectRecordAction : createObjectRecordAction,
    INITIAL_CREATE_RECORD_STATE,
  );
  // The values the person has entered so far. A field whose condition does not hold is not
  // shown, and a computed field is filled in by the server (ADR 0032).
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialValues(object, record),
  );

  return (
    <form
      key={record?.id ?? state.recordId ?? 'initial'}
      action={formAction}
      className="space-y-4"
      aria-label={record ? `Sửa bản ghi ${object.name}` : `Nhập bản ghi ${object.name}`}
    >
      <input type="hidden" name="objectKey" value={object.key} />
      {record ? <input type="hidden" name="recordId" value={record.id} /> : null}

      {object.fields.map((field) => (
        <FieldControl
          key={field.key}
          field={field}
          objectKey={object.key}
          defaultValue={record?.values[field.key]}
          attachmentNames={record?.attachmentNames}
          visible={evaluateCondition(field.visibleWhen, values)}
          onValueChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
        />
      ))}

      {object.fields.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-on-surface-muted">
          Loại dữ liệu này chưa có trường nào nên chưa có gì để nhập. Thêm trường trong phần định
          nghĩa ở cột bên.
        </p>
      ) : null}

      <SubmitButton
        disabled={object.fields.length === 0}
        label={record ? 'Lưu thay đổi' : 'Lưu bản ghi'}
      />

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === 'success' && state.message ? (
        <p
          role="status"
          className="rounded-lg border border-success/40 px-3 py-2 text-sm text-success"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function FieldControl({
  field,
  objectKey,
  defaultValue,
  attachmentNames,
  visible,
  onValueChange,
}: {
  field: FieldDefinition;
  objectKey: string;
  defaultValue?: unknown;
  attachmentNames?: Record<string, string>;
  /** False when the field's condition does not hold (ADR 0032). */
  visible: boolean;
  onValueChange: (value: unknown) => void;
}) {
  const controlId = `field-${field.key}`;
  const describedBy = `field-${field.key}-hint`;
  const attachmentId = typeof defaultValue === 'string' ? defaultValue : '';

  if (!visible) {
    return null;
  }

  if (field.type === 'formula') {
    return (
      <div>
        <span className="text-xs font-medium tracking-wide uppercase">{field.label}</span>
        <p className="mt-1.5 rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-on-surface-muted">
          Tính tự động khi lưu: <span className="font-mono text-xs">{field.formula}</span>
        </p>
      </div>
    );
  }

  if (field.type === 'table') {
    return (
      <div>
        <label className="text-xs font-medium tracking-wide uppercase">{field.label}</label>
        <TableField field={field} defaultValue={defaultValue} />
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={controlId} className="text-xs font-medium tracking-wide uppercase">
        {field.label}
        {field.required ? (
          <span className="ml-1 text-danger" aria-label="bắt buộc">
            *
          </span>
        ) : null}
      </label>

      {field.type === 'file' ? (
        <div className="mt-1.5">
          <FileField
            objectKey={objectKey}
            field={field}
            initial={
              attachmentId
                ? { id: attachmentId, fileName: attachmentNames?.[field.key] ?? 'Tệp đính kèm' }
                : undefined
            }
          />
        </div>
      ) : (
        renderControl(field, controlId, describedBy, defaultValue)
      )}

      {/* The key stays in the API payload; a person filling the form needs the rule, not
          the column name (ADR 0016). Only hints that change what they type are shown. */}
      {fieldHint(field) ? (
        <p id={describedBy} className="mt-1 text-xs text-on-surface-muted">
          {fieldHint(field)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * initialValues reads the values a form starts with: the ones of the record being edited,
 * or nothing for a new one.
 */
function initialValues(object: BusinessObject, record?: ObjectRecord): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of object.fields) {
    const value = record?.values?.[field.key];
    if (value !== undefined && value !== null) {
      values[field.key] = value;
    }
  }
  return values;
}

/**
 * fieldHint is the plain-language rule of a field, and nothing else: what to type, or how a
 * choice behaves. An empty string means the label and the control already say it all.
 */
function fieldHint(field: FieldDefinition): string {
  switch (field.type) {
    case 'select':
      return field.options && field.options.length > 0 ? 'Chọn một mục trong danh sách.' : '';
    case 'rows':
      return 'Mỗi dòng một mục.';
    case 'number':
      return 'Chỉ nhập số.';
    case 'date':
      return 'Chọn ngày.';
    case 'file':
      return 'Tối đa 10 MB. Tệp luôn được tải về, không mở trực tiếp trong trình duyệt.';
    default:
      return '';
  }
}

/**
 * defaultValue renders a stored value back into the control it came from: a select gets
 * the stored option value, a rows field one item per line, everything else its text form.
 */
function defaultValueFor(field: FieldDefinition, value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (field.type === 'rows' && Array.isArray(value)) {
    return value.map((item) => String(item)).join('\n');
  }
  return String(value);
}

function renderControl(
  field: FieldDefinition,
  controlId: string,
  describedBy: string,
  defaultValue?: unknown,
) {
  const initial = defaultValueFor(field, defaultValue);

  switch (field.type) {
    case 'number':
      return (
        <input
          id={controlId}
          name={field.key}
          type="number"
          step="any"
          defaultValue={initial}
          aria-describedby={describedBy}
          className={INPUT_CLASS}
        />
      );

    case 'date':
      return (
        <input
          id={controlId}
          name={field.key}
          type="date"
          defaultValue={initial}
          aria-describedby={describedBy}
          className={INPUT_CLASS}
        />
      );

    case 'select':
      return (
        <select
          id={controlId}
          name={field.key}
          defaultValue={initial}
          aria-describedby={describedBy}
          className={INPUT_CLASS}
        >
          <option value="">— Chọn —</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case 'rows':
      return (
        <textarea
          id={controlId}
          name={field.key}
          rows={3}
          defaultValue={initial}
          placeholder={'Mỗi dòng một mục'}
          aria-describedby={describedBy}
          className={`${INPUT_CLASS} font-mono text-xs`}
        />
      );

    default:
      return (
        <textarea
          id={controlId}
          name={field.key}
          rows={2}
          defaultValue={initial}
          aria-describedby={describedBy}
          className={INPUT_CLASS}
        />
      );
  }
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang lưu…' : label}
    </button>
  );
}

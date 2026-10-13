'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { BusinessObject, FieldDefinition } from '@opvaryn/contracts';

import { createObjectRecordAction } from '@/app/objects/actions';
import { INITIAL_CREATE_RECORD_STATE } from '@/components/forms/object-form-state';
import { FIELD_TYPE_LABELS } from '@/lib/format';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

/**
 * ObjectForm is the data-entry form generated from a business object schema. It is
 * the same component behind the object detail screen and the Forms preview, so
 * what the Form Builder shows is exactly what a user fills in.
 */
export function ObjectForm({ object }: { object: BusinessObject }) {
  const [state, formAction] = useActionState(createObjectRecordAction, INITIAL_CREATE_RECORD_STATE);

  return (
    <form
      key={state.recordId ?? 'initial'}
      action={formAction}
      className="space-y-4"
      aria-label={`Nhập bản ghi ${object.name}`}
    >
      <input type="hidden" name="objectKey" value={object.key} />

      {object.fields.map((field) => (
        <FieldControl key={field.key} field={field} />
      ))}

      {object.fields.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-on-surface-muted">
          Object chưa có field nào nên chưa có gì để nhập. Bổ sung field trong schema ở cột bên.
        </p>
      ) : null}

      <SubmitButton disabled={object.fields.length === 0} />

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

function FieldControl({ field }: { field: FieldDefinition }) {
  const controlId = `field-${field.key}`;
  const describedBy = `field-${field.key}-hint`;

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

      {renderControl(field, controlId, describedBy)}

      <p id={describedBy} className="mt-1 text-xs text-on-surface-muted">
        <code className="font-mono">{field.key}</code> · {FIELD_TYPE_LABELS[field.type]}
        {field.required ? ' · bắt buộc' : ''}
      </p>
    </div>
  );
}

function renderControl(field: FieldDefinition, controlId: string, describedBy: string) {
  switch (field.type) {
    case 'number':
      return (
        <input
          id={controlId}
          name={field.key}
          type="number"
          step="any"
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
          aria-describedby={describedBy}
          className={INPUT_CLASS}
        />
      );

    case 'select':
      return (
        <select
          id={controlId}
          name={field.key}
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
          placeholder={'Mỗi dòng một mục'}
          aria-describedby={describedBy}
          className={`${INPUT_CLASS} font-mono text-xs`}
        />
      );

    case 'file':
      return (
        <div>
          <input
            id={controlId}
            type="text"
            disabled
            placeholder="Tải tệp thuộc phạm vi MVP"
            aria-describedby={describedBy}
            className={`${INPUT_CLASS} cursor-not-allowed opacity-60`}
          />
          <p className="mt-1 text-xs text-warning">
            Trường tệp chưa có trong demo — bỏ trống khi nhập bản ghi.
          </p>
        </div>
      );

    default:
      return (
        <textarea
          id={controlId}
          name={field.key}
          rows={2}
          aria-describedby={describedBy}
          className={INPUT_CLASS}
        />
      );
  }
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang lưu…' : 'Lưu bản ghi'}
    </button>
  );
}

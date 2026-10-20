'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { BusinessObject } from '@opvaryn/contracts';

import { OPERATOR_LABELS } from '@/lib/names';
import { createMetricAction } from '@/app/(workspace)/analytics/actions';
import { INITIAL_CREATE_METRIC_STATE } from '@/components/analytics/create-metric-state';
import { cn } from '@/lib/utils';

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

const AGGREGATIONS = [
  { value: 'count', label: 'Đếm bản ghi' },
  { value: 'sum', label: 'Tổng một trường số' },
  { value: 'avg', label: 'Trung bình một trường số' },
] as const;

const OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const;

/**
 * MeasureChoice is one thing a metric can measure: a number field, a computed field or
 * a number column of a table (ADR 0036). The value names the choice in the form; the
 * field and the column are what the API receives.
 */
interface MeasureChoice {
  value: string;
  label: string;
  field: string;
  column?: string;
}

/**
 * CreateMetricForm builds a metric from the object's own fields: the aggregation, an
 * optional numeric measure, an optional filter (the same shape process branches use) and
 * an optional grouping. Field choices come from the definition, never a hard-coded list,
 * and every rule about what is legal is enforced by the Go service — its message is what
 * this form shows.
 */
export function CreateMetricForm({ objects }: { objects: readonly BusinessObject[] }) {
  const [state, formAction] = useActionState(createMetricAction, INITIAL_CREATE_METRIC_STATE);
  const [objectKey, setObjectKey] = useState(objects[0]?.key ?? '');
  const [aggregation, setAggregation] = useState<(typeof AGGREGATIONS)[number]['value']>('count');
  const [measure, setMeasure] = useState('');

  const object = objects.find((candidate) => candidate.key === objectKey);
  // `rows` carries no scalar value, so it is not projected and cannot be measured.
  // A computed field holds a number, so it is measured like a number field (ADR 0036).
  const scalarFields = (object?.fields ?? []).filter(
    (field) => field.type !== 'rows' && field.type !== 'table',
  );
  const groupableFields = scalarFields.filter(
    (field) => field.type !== 'number' && field.type !== 'formula',
  );

  // What a metric can measure: a number field, a computed field, or a number column of
  // a table (ADR 0036). Each choice names the field and, for a column, the column.
  const measures: MeasureChoice[] = [];
  for (const field of object?.fields ?? []) {
    if (field.type === 'number' || field.type === 'formula') {
      measures.push({ value: field.key, label: field.label, field: field.key });
    }
    if (field.type === 'table') {
      for (const column of field.columns ?? []) {
        if (column.type !== 'number') {
          continue;
        }
        measures.push({
          value: `${field.key}.${column.key}`,
          label: `${column.label} (${field.label})`,
          field: field.key,
          column: column.key,
        });
      }
    }
  }
  const selectedMeasure = measures.find((choice) => choice.value === measure);

  if (objects.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-on-surface-muted">
        Chưa có loại dữ liệu nào để đo. Tạo một loại dữ liệu và nhập bản ghi trước.
      </p>
    );
  }

  return (
    <form
      key={state.createdKey ?? 'initial'}
      action={formAction}
      className="space-y-3"
      aria-label="Tạo chỉ số mới"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Mã chỉ số</span>
          <input
            name="key"
            required
            placeholder="purchase_amount_by_department"
            className={cn(INPUT_CLASS, 'mt-1.5 font-mono')}
          />
        </label>
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Tên chỉ số</span>
          <input
            name="name"
            required
            placeholder="Giá trị đề nghị theo bộ phận"
            className={cn(INPUT_CLASS, 'mt-1.5')}
          />
        </label>
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Loại dữ liệu</span>
          <select
            name="objectKey"
            value={objectKey}
            onChange={(event) => setObjectKey(event.target.value)}
            className={cn(INPUT_CLASS, 'mt-1.5')}
          >
            {objects.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Cách tính</span>
          <select
            name="aggregation"
            value={aggregation}
            onChange={(event) =>
              setAggregation(event.target.value as (typeof AGGREGATIONS)[number]['value'])
            }
            className={cn(INPUT_CLASS, 'mt-1.5')}
          >
            {AGGREGATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {aggregation === 'count' ? null : (
          <label className="text-xs">
            <span className="font-medium tracking-wide uppercase">Đo trường nào (trường số)</span>
            <select
              name="field"
              value={measure}
              onChange={(event) => setMeasure(event.target.value)}
              className={cn(INPUT_CLASS, 'mt-1.5 font-mono')}
            >
              {measures.length === 0 ? (
                <option value="">— loại dữ liệu này không có trường số —</option>
              ) : null}
              {measures.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {`${choice.label} (${choice.field})`}
                </option>
              ))}
            </select>
            {/* The column of a table is named apart from the field, so the API knows
                which cells to measure (ADR 0036). */}
            <input type="hidden" name="column" value={selectedMeasure?.column ?? ''} />
          </label>
        )}
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Nhóm theo (tuỳ chọn)</span>
          <select name="groupBy" className={cn(INPUT_CLASS, 'mt-1.5 font-mono')}>
            <option value="">— không nhóm —</option>
            {groupableFields.map((field) => (
              <option key={field.key} value={field.key}>
                {`${field.label} (${field.key})`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="grid gap-3 rounded-lg border border-border bg-surface-raised/40 p-3 sm:grid-cols-3">
        <legend className="px-1 text-[11px] tracking-wide text-on-surface-muted uppercase">
          Bộ lọc (tuỳ chọn)
        </legend>
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Trường</span>
          <select name="filterField" className={cn(INPUT_CLASS, 'mt-1.5 font-mono')}>
            <option value="">— không lọc —</option>
            {scalarFields.map((field) => (
              <option key={field.key} value={field.key}>
                {`${field.label} (${field.key})`}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Điều kiện</span>
          <select name="filterOp" className={cn(INPUT_CLASS, 'mt-1.5 font-mono')}>
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Giá trị</span>
          <input
            name="filterValue"
            placeholder="1000000"
            className={cn(INPUT_CLASS, 'mt-1.5 font-mono')}
          />
        </label>
      </fieldset>

      <label className="block text-xs">
        <span className="font-medium tracking-wide uppercase">Mô tả</span>
        <input
          name="description"
          placeholder="Tổng giá trị các đề nghị từ 1 triệu, theo bộ phận đề nghị."
          className={cn(INPUT_CLASS, 'mt-1.5')}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <p className="text-xs text-on-surface-muted">
          Con số chỉ tính trên dữ liệu bạn được đọc: hai người có thể thấy hai con số khác nhau, và
          đó là đúng thiết kế.
        </p>
      </div>

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

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang tạo…' : 'Tạo chỉ số'}
    </button>
  );
}

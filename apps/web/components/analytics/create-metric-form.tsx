'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { BusinessObject } from '@opvaryn/contracts';

import { createMetricAction } from '@/app/analytics/actions';
import { INITIAL_CREATE_METRIC_STATE } from '@/components/analytics/create-metric-state';
import { cn } from '@/lib/utils';

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

const AGGREGATIONS = [
  { value: 'count', label: 'Đếm bản ghi' },
  { value: 'sum', label: 'Tổng một field số' },
  { value: 'avg', label: 'Trung bình một field số' },
] as const;

const OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const;

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

  const object = objects.find((candidate) => candidate.key === objectKey);
  // `rows` carries no scalar value, so it is not projected and cannot be measured.
  const scalarFields = (object?.fields ?? []).filter((field) => field.type !== 'rows');
  const numberFields = scalarFields.filter((field) => field.type === 'number');
  const groupableFields = scalarFields.filter((field) => field.type !== 'number');

  if (objects.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-on-surface-muted">
        Chưa có business object nào để đo. Tạo object và bản ghi trước.
      </p>
    );
  }

  return (
    <form
      key={state.createdKey ?? 'initial'}
      action={formAction}
      className="space-y-3"
      aria-label="Tạo metric mới"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Key</span>
          <input
            name="key"
            required
            placeholder="purchase_amount_by_department"
            className={cn(INPUT_CLASS, 'mt-1.5 font-mono')}
          />
        </label>
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Tên metric</span>
          <input
            name="name"
            required
            placeholder="Giá trị đề nghị theo bộ phận"
            className={cn(INPUT_CLASS, 'mt-1.5')}
          />
        </label>
        <label className="text-xs">
          <span className="font-medium tracking-wide uppercase">Business object</span>
          <select
            name="objectKey"
            value={objectKey}
            onChange={(event) => setObjectKey(event.target.value)}
            className={cn(INPUT_CLASS, 'mt-1.5')}
          >
            {objects.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {`${candidate.name} (${candidate.key})`}
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
            <span className="font-medium tracking-wide uppercase">Field đo (kiểu số)</span>
            <select name="field" className={cn(INPUT_CLASS, 'mt-1.5 font-mono')}>
              {numberFields.length === 0 ? (
                <option value="">— object không có field số —</option>
              ) : null}
              {numberFields.map((field) => (
                <option key={field.key} value={field.key}>
                  {`${field.label} (${field.key})`}
                </option>
              ))}
            </select>
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
          <span className="font-medium tracking-wide uppercase">Field</span>
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
          <span className="font-medium tracking-wide uppercase">Toán tử</span>
          <select name="filterOp" className={cn(INPUT_CLASS, 'mt-1.5 font-mono')}>
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {op}
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
          Metric chạy trên projection có kiểu và theo phạm vi đọc của bạn: hai người có thể thấy hai
          con số khác nhau, và đó là đúng thiết kế.
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
      {pending ? 'Đang tạo…' : 'Tạo metric'}
    </button>
  );
}

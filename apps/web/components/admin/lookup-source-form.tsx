'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { saveLookupSourceAction } from '@/app/(workspace)/admin/actions';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { INITIAL_LOOKUP_STATE } from '@/components/admin/lookup-state';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

/**
 * LookupSourceForm points the select fields of one definition at external catalogues
 * (ADR 0034). An empty address means the field uses the options of the definition.
 */
export function LookupSourceForm({
  objectKey,
  objectName,
  fields,
  sources,
}: {
  objectKey: string;
  objectName: string;
  fields: { key: string; label: string }[];
  sources: Record<string, string>;
}) {
  const [state, formAction] = useActionState(saveLookupSourceAction, INITIAL_LOOKUP_STATE);

  if (fields.length === 0) {
    return (
      <Card>
        <CardTitle>{objectName}</CardTitle>
        <CardDescription>
          Loại dữ liệu này không có trường lựa chọn nào để gắn nguồn.
        </CardDescription>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>{objectName}</CardTitle>
      <CardDescription>
        Nguồn trả về một tài liệu JSON nhỏ: {'{'}&quot;options&quot;: [{'{'}&quot;value&quot;:
        &quot;…&quot;, &quot;label&quot;: &quot;…&quot;{'}'}]{'}'}. Để trống nghĩa là trường dùng
        danh sách khai trong định nghĩa.
      </CardDescription>

      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="objectKey" value={objectKey} />

        {fields.map((field) => (
          <div key={field.key} className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
            <label className="text-sm font-medium" htmlFor={`lookup-${field.key}`}>
              {field.label}
            </label>
            <input
              id={`lookup-${field.key}`}
              name={`url-${field.key}`}
              defaultValue={sources[`${objectKey}.${field.key}`] ?? ''}
              placeholder="https://may-chu-noi/danh-muc"
              className={INPUT_CLASS}
            />
            <input type="hidden" name="field-objectKey" value={field.key} />
          </div>
        ))}

        <Submit />

        {state.message ? (
          <p
            role={state.status === 'error' ? 'alert' : 'status'}
            className={
              state.status === 'error'
                ? 'rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger'
                : 'rounded-lg border border-success/40 px-3 py-2 text-sm text-success'
            }
          >
            {state.message}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang lưu…' : 'Lưu nguồn tra cứu'}
    </button>
  );
}

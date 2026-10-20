'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { saveLookupSourceAction } from '@/app/(workspace)/admin/actions';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { INITIAL_LOOKUP_STATE } from '@/components/admin/lookup-state';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

/** What one field's source looks like: where it reads, and where it writes back. */
export interface LookupSource {
  url: string;
  writeUrl: string;
  writeFields: string[];
}

/**
 * LookupSourceForm points the select fields of one definition at external catalogues
 * (ADR 0034), and says where a record is written back to that system (ADR 0037). An empty
 * address means the field uses the options of the definition.
 */
export function LookupSourceForm({
  objectKey,
  objectName,
  fields,
  allFields,
  sources,
}: {
  objectKey: string;
  objectName: string;
  fields: { key: string; label: string }[];
  allFields: { key: string; label: string }[];
  sources: Record<string, LookupSource>;
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
        Danh sách lựa chọn lấy từ hệ thống khác: nguồn trả về một tài liệu JSON nhỏ {'{'}
        &quot;options&quot;: [{'{'}&quot;value&quot;: &quot;…&quot;, &quot;label&quot;:
        &quot;…&quot;{'}'}]{'}'}. Để trống nghĩa là trường dùng danh sách khai trong định nghĩa.
      </CardDescription>

      <form action={formAction} className="mt-4 space-y-5">
        <input type="hidden" name="objectKey" value={objectKey} />

        {fields.map((field) => {
          const source = sources[`${objectKey}.${field.key}`];
          return (
            <fieldset key={field.key} className="rounded-xl border border-border px-4 py-3">
              <legend className="px-1 text-sm font-medium">{field.label}</legend>

              <div className="mt-1 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-on-surface-muted" htmlFor={`lookup-${field.key}`}>
                  Danh sách lựa chọn lấy từ
                  <input
                    id={`lookup-${field.key}`}
                    name={`url-${field.key}`}
                    defaultValue={source?.url ?? ''}
                    placeholder="https://may-chu-noi/danh-muc"
                    className={INPUT_CLASS}
                  />
                </label>
                <label
                  className="text-xs text-on-surface-muted"
                  htmlFor={`lookup-write-${field.key}`}
                >
                  Ghi bản ghi về hệ thống đó tại
                  <input
                    id={`lookup-write-${field.key}`}
                    name={`writeUrl-${field.key}`}
                    defaultValue={source?.writeUrl ?? ''}
                    placeholder="Để trống nếu chỉ đọc"
                    className={INPUT_CLASS}
                  />
                </label>
              </div>

              <p className="mt-3 text-xs text-on-surface-muted">
                Khi bản ghi được tạo hoặc sửa, những trường được chọn dưới đây sẽ được gửi tới hệ
                thống đó. Hệ thống bên ngoài có thể trả lời kèm giá trị đã sửa; bản sửa chỉ được áp
                dụng khi bản ghi chưa ai sửa trong lúc chờ.
              </p>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {allFields.map((candidate) => (
                  <label
                    key={candidate.key}
                    className="flex items-center gap-2 text-sm text-on-surface-muted"
                  >
                    <input
                      type="checkbox"
                      name={`writeField-${field.key}`}
                      value={candidate.key}
                      defaultChecked={source?.writeFields.includes(candidate.key) ?? false}
                      className="size-4 rounded border-border accent-accent"
                    />
                    {candidate.label}
                  </label>
                ))}
              </div>

              <input type="hidden" name="field-objectKey" value={field.key} />
            </fieldset>
          );
        })}

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

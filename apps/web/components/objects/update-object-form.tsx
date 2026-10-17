'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { BusinessObject } from '@opvaryn/contracts';

import { updateBusinessObjectAction } from '@/app/(workspace)/objects/actions';
import { FieldEditor } from '@/components/objects/field-editor';
import { INITIAL_UPDATE_OBJECT_STATE } from '@/components/objects/update-object-state';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

/**
 * UpdateObjectForm publishes the next version of a definition. The schema editor
 * opens on the current fields, and the record forms keep working because existing
 * records stay bound to the version they were created under.
 */
export function UpdateObjectForm({ object }: { object: BusinessObject }) {
  const [state, formAction] = useActionState(
    updateBusinessObjectAction,
    INITIAL_UPDATE_OBJECT_STATE,
  );

  return (
    <Card>
      <CardTitle>Sửa định nghĩa — phát hành phiên bản v{object.version + 1}</CardTitle>
      <CardDescription>
        Phiên bản đã phát hành là bất biến. Bản ghi cũ giữ nguyên định nghĩa cũ; bản ghi tạo sau khi
        phát hành dùng định nghĩa này. Có thể thêm, đổi tên hoặc bỏ trường mà không viết lại lịch sử
        dữ liệu.
      </CardDescription>

      <form
        key={state.publishedVersion ?? 'initial'}
        action={formAction}
        className="mt-4 space-y-4"
      >
        <input type="hidden" name="key" value={object.key} />

        <div>
          <label htmlFor="update-name" className="text-xs font-medium tracking-wide uppercase">
            Tên hiển thị
          </label>
          <input
            id="update-name"
            name="name"
            required
            maxLength={120}
            defaultValue={object.name}
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label
            htmlFor="update-description"
            className="text-xs font-medium tracking-wide uppercase"
          >
            Mô tả
          </label>
          <textarea
            id="update-description"
            name="description"
            maxLength={500}
            rows={2}
            defaultValue={object.description ?? ''}
            className={INPUT_CLASS}
          />
        </div>

        <FieldEditor initialFields={object.fields} />

        <SubmitButton version={object.version + 1} />

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
    </Card>
  );
}

function SubmitButton({ version }: { version: number }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang phát hành…' : `Phát hành phiên bản v${version}`}
    </button>
  );
}

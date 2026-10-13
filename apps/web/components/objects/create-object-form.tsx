'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { createBusinessObjectAction } from '@/app/objects/actions';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { INITIAL_CREATE_OBJECT_STATE } from '@/components/objects/create-object-state';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

/** CreateObjectForm posts to the API through a server action. */
export function CreateObjectForm() {
  const [state, formAction] = useActionState(
    createBusinessObjectAction,
    INITIAL_CREATE_OBJECT_STATE,
  );

  return (
    <Card>
      <CardTitle>Tạo business object</CardTitle>
      <CardDescription>
        Key không đổi sau khi tạo: form, workflow và báo cáo về sau đều tham chiếu theo key.
      </CardDescription>

      <form action={formAction} className="mt-4 space-y-4">
        <div>
          <label htmlFor="object-key" className="text-xs font-medium tracking-wide uppercase">
            Key
          </label>
          <input
            id="object-key"
            name="key"
            required
            pattern="[a-z][a-z0-9_]{1,63}"
            placeholder="purchase_request"
            autoComplete="off"
            className={`${INPUT_CLASS} font-mono`}
          />
          <p className="mt-1 text-xs text-on-surface-muted">
            Chữ thường, snake_case, 2–64 ký tự, bắt đầu bằng chữ cái.
          </p>
        </div>

        <div>
          <label htmlFor="object-name" className="text-xs font-medium tracking-wide uppercase">
            Tên hiển thị
          </label>
          <input
            id="object-name"
            name="name"
            required
            maxLength={120}
            placeholder="Đề nghị mua hàng"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label
            htmlFor="object-description"
            className="text-xs font-medium tracking-wide uppercase"
          >
            Mô tả
          </label>
          <textarea
            id="object-description"
            name="description"
            maxLength={500}
            rows={3}
            placeholder="Dùng cho quy trình nào, ai là người nhập liệu"
            className={INPUT_CLASS}
          />
        </div>

        <SubmitButton />

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

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang lưu…' : 'Tạo business object'}
    </button>
  );
}

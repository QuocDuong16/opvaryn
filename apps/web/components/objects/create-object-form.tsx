'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { createBusinessObjectAction } from '@/app/(workspace)/objects/actions';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { FieldEditor } from '@/components/objects/field-editor';
import { keyFromLabel } from '@/lib/names';
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
  // The key follows the name until the designer edits it: nobody should have to know what
  // snake_case means (ADR 0018).
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const derived = keyFromLabel(name);
  const effectiveKey = key === '' ? derived : key;

  return (
    <Card>
      <CardTitle>Tạo loại dữ liệu</CardTitle>
      <CardDescription>
        Đặt tên cho loại dữ liệu và mô tả ai sẽ nhập nó. Hệ thống tự sinh mã bên trong; mã đó không
        đổi về sau vì biểu mẫu, quy trình và báo cáo đều tham chiếu theo nó.
      </CardDescription>

      <form action={formAction} className="mt-4 space-y-4">
        <div>
          <label htmlFor="object-key" className="text-xs font-medium tracking-wide uppercase">
            Mã (tự sinh, sửa được)
          </label>
          <input
            id="object-key"
            name="key"
            required
            pattern="[a-z][a-z0-9_]{1,63}"
            value={effectiveKey}
            onChange={(event) => setKey(event.target.value)}
            placeholder="purchase_request"
            autoComplete="off"
            className={`${INPUT_CLASS} font-mono`}
          />
          <p className="mt-1 text-xs text-on-surface-muted">
            {`Mã hiển thị cho hệ thống, sinh từ tên: ${keyFromLabel(name) || 'ho_ten_nhan_vien'}.`}
          </p>
        </div>

        <div>
          <label htmlFor="object-name" className="text-xs font-medium tracking-wide uppercase">
            Tên
          </label>
          <input
            id="object-name"
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
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

        <FieldEditor />

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
          <div
            role="status"
            className="rounded-lg border border-success/40 px-3 py-2 text-sm text-success"
          >
            <p>{state.message}</p>
            {state.createdKey ? (
              <Link
                href={`/objects/${state.createdKey}`}
                className="mt-1 inline-block font-medium underline underline-offset-2"
              >
                Mở loại dữ liệu và nhập bản ghi →
              </Link>
            ) : null}
          </div>
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
      {pending ? 'Đang lưu…' : 'Tạo loại dữ liệu'}
    </button>
  );
}

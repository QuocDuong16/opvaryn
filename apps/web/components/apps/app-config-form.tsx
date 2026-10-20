'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { saveAppConfigAction } from '@/app/(workspace)/apps/actions';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { INITIAL_APP_CONFIG_STATE } from '@/components/apps/app-config-state';
import type { MiniAppData } from '@/components/apps/mini-app';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'placeholder:text-on-surface-muted/50 focus:border-accent-strong focus:outline-none';

/**
 * AppConfigForm saves the configuration of the application view (ADR 0033): the name, the
 * field the kanban groups by, and the columns the list shows. Only an administrator may
 * change it; the API refuses anybody else.
 */
export function AppConfigForm({ app }: { app: MiniAppData }) {
  const [state, formAction] = useActionState(saveAppConfigAction, INITIAL_APP_CONFIG_STATE);
  const selectFields = app.object.fields.filter((field) => field.type === 'select');
  const listFields = app.object.fields.filter((field) => field.type !== 'file');

  return (
    <Card>
      <CardTitle>Cấu hình</CardTitle>
      <CardDescription>
        Những gì màn hình này hiện ra lấy từ định nghĩa dữ liệu; những gì hiện ở đây là lựa chọn của
        người quản trị.
      </CardDescription>

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="objectKey" value={app.object.key} />

        <label className="block text-xs">
          <span className="font-medium tracking-wide uppercase">Tên ứng dụng</span>
          <input
            name="name"
            defaultValue={app.config.name}
            placeholder={app.object.name}
            className={INPUT_CLASS}
          />
        </label>

        <label className="block text-xs">
          <span className="font-medium tracking-wide uppercase">Gom cột kanban theo</span>
          <select name="kanbanField" defaultValue={app.config.kanbanField} className={INPUT_CLASS}>
            <option value="">— chưa gom cột —</option>
            {selectFields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="block">
          <legend className="text-xs font-medium tracking-wide uppercase">Cột của danh sách</legend>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {listFields.map((field) => (
              <label key={field.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="listColumns"
                  value={field.key}
                  defaultChecked={app.config.listColumns.includes(field.key)}
                  className="size-4 accent-[var(--accent)]"
                />
                {field.label}
              </label>
            ))}
          </div>
        </fieldset>

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
      {pending ? 'Đang lưu…' : 'Lưu cấu hình'}
    </button>
  );
}

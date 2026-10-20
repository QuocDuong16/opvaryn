'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { importObjectRecordsAction } from '@/app/(workspace)/objects/actions';
import { MAX_IMPORT_ROWS } from '@/lib/import';

const INITIAL_STATE = { status: 'idle' as const };

/**
 * Imports records from a CSV. "Kiểm tra trước" is a dry run: the API reports every bad row
 * and writes nothing; "Nhập vào hệ thống" stores all rows or none (ADR 0026). The file's
 * first row carries the field labels — an exported CSV is the template.
 */
export function ImportRecordsForm({ objectKey }: { objectKey: string }) {
  const [state, formAction] = useActionState(importObjectRecordsAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="objectKey" value={objectKey} />
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        className="block w-full text-sm text-on-surface-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-on-surface hover:file:bg-surface-overlay"
      />
      <p className="text-xs leading-relaxed text-on-surface-muted">
        {`Dòng đầu là tên trường (dùng file Xuất CSV làm mẫu). Tối đa ${MAX_IMPORT_ROWS} dòng.`}
      </p>

      <div className="flex flex-wrap gap-2">
        <SubmitButton label="Kiểm tra trước" mode="check" secondary />
        <SubmitButton label="Nhập vào hệ thống" mode="import" />
      </div>

      {state.message ? (
        <p
          role={state.status === 'error' ? 'alert' : 'status'}
          className={
            state.status === 'error'
              ? 'rounded-lg border border-danger/40 px-3 py-2 text-xs leading-relaxed text-danger'
              : 'rounded-lg border border-success/40 px-3 py-2 text-xs leading-relaxed text-success'
          }
        >
          {state.message}
        </p>
      ) : null}

      {state.result && state.result.errors.length > 0 ? (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-raised text-left text-on-surface-muted uppercase">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Dòng
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Lỗi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {state.result.errors.map((error, index) => (
                <tr key={`${error.row}-${index}`}>
                  <td className="px-3 py-2 align-top font-mono">{error.row}</td>
                  <td className="px-3 py-2 align-top text-on-surface-muted">{error.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </form>
  );
}

function SubmitButton({
  label,
  mode,
  secondary = false,
}: {
  label: string;
  mode: 'check' | 'import';
  secondary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="mode"
      value={mode}
      disabled={pending}
      className={
        secondary
          ? 'rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-overlay disabled:opacity-60'
          : 'rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-60'
      }
    >
      {pending ? 'Đang xử lý…' : label}
    </button>
  );
}

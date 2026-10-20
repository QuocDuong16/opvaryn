'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { ObjectRecord } from '@opvaryn/contracts';

import { startProcessInstanceAction } from '@/app/(workspace)/objects/actions';
import { INITIAL_START_INSTANCE_STATE } from '@/components/process/start-instance-state';
import { primaryFieldValue } from '@/lib/format';

const SELECT_CLASS =
  'mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm ' +
  'focus:border-accent-strong focus:outline-none';

/**
 * StartInstanceForm runs a process on one stored record. Only definitions bound to
 * this business object are offered, because the engine evaluates conditions against
 * the record's values — a definition for another object would have nothing to read.
 * The rules stay in the Go service: this form just picks two keys.
 */
export function StartInstanceForm({
  definitions,
  records,
  fields,
  recordId,
  query,
  total,
  searchAction,
}: {
  definitions: readonly { key: string; name: string }[];
  records: readonly ObjectRecord[];
  /** The definition fields used to label a record in the picker. */
  fields: Parameters<typeof primaryFieldValue>[0];
  /** The record to preselect: the screen arrived from that record's own row. */
  recordId?: string;
  /** The term the picker is filtered by; the API does the filtering. */
  query: string;
  /** How many records the definition holds, so the picker can say what it does not show. */
  total: number;
  /** Where the search form submits: the same screen, with the term in the address. */
  searchAction: string;
}) {
  const [state, formAction] = useActionState(
    startProcessInstanceAction,
    INITIAL_START_INSTANCE_STATE,
  );

  if (definitions.length === 0 || records.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-on-surface-muted">
        {records.length === 0
          ? 'Chưa có bản ghi nào để chạy quy trình. Lưu một bản ghi trước.'
          : 'Chưa có quy trình nào dùng business object này. Tạo định nghĩa ở màn hình Workflows.'}
      </p>
    );
  }

  return (
    <form
      key={state.instanceId ?? 'initial'}
      action={formAction}
      className="rounded-xl border border-border bg-surface-raised p-5"
      aria-label="Chạy quy trình cho một bản ghi"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="start-definition" className="text-xs font-medium tracking-wide uppercase">
            Quy trình
          </label>
          <select id="start-definition" name="definitionKey" className={SELECT_CLASS}>
            {definitions.map((definition) => (
              <option key={definition.key} value={definition.key}>
                {definition.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="start-record" className="text-xs font-medium tracking-wide uppercase">
            Bản ghi
          </label>
          <select
            id="start-record"
            name="recordId"
            defaultValue={
              recordId && records.some((record) => record.id === recordId) ? recordId : undefined
            }
            className={SELECT_CLASS}
          >
            {records.map((record) => (
              <option key={record.id} value={record.id}>
                {primaryFieldValue(fields, record)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* The picker offers a page of records; the search finds the one that is missing. */}
      <form method="get" action={searchAction} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <label
            htmlFor="start-record-search"
            className="text-xs font-medium tracking-wide uppercase"
          >
            Tìm bản ghi
          </label>
          <input
            id="start-record-search"
            name="run_q"
            type="search"
            defaultValue={query}
            placeholder="Tên hoặc nội dung cần tìm"
            className={SELECT_CLASS}
          />
        </div>
        <button
          type="submit"
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-overlay"
        >
          Tìm
        </button>
      </form>
      <p className="mt-2 text-xs text-on-surface-muted">
        {query === ''
          ? total > records.length
            ? `Danh sách này hiện ${records.length} bản ghi gần nhất trong ${total}. Dùng ô tìm để chọn bản ghi cũ hơn.`
            : `Danh sách này hiện ${records.length} bản ghi.`
          : `Tìm thấy ${records.length} trong ${total} bản ghi theo “${query}”.`}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton />
        <p className="text-xs text-on-surface-muted">
          Lần chạy gắn với phiên bản đang dùng; phát hành phiên bản mới không đổi nó.
        </p>
      </div>

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === 'success' && state.message ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-success/40 px-3 py-2 text-sm text-success"
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
      {pending ? 'Đang chạy…' : 'Chạy quy trình'}
    </button>
  );
}

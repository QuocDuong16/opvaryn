'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { deleteObjectRecordAction } from '@/app/(workspace)/objects/actions';
import { INITIAL_DELETE_RECORD_STATE } from '@/components/forms/record-delete-state';

/**
 * Deletes one record after a confirmation. On success the action redirects to the records
 * list, because the record's own address no longer exists; a refusal is explained in place.
 */
export function DeleteRecordForm({ objectKey, recordId }: { objectKey: string; recordId: string }) {
  const [state, formAction] = useActionState(deleteObjectRecordAction, INITIAL_DELETE_RECORD_STATE);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm('Xoá bản ghi này? Thao tác không hoàn tác được.')) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="objectKey" value={objectKey} />
      <input type="hidden" name="recordId" value={recordId} />
      {/* Marks this form for the no-JavaScript flow replay in smoke-demo-flows. */}
      <input type="hidden" name="deleteRecord" value="1" />
      <DeleteButton />
      {state.status === 'error' && state.message ? (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg border border-danger/40 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
    >
      {pending ? 'Đang xoá…' : 'Xoá bản ghi'}
    </button>
  );
}

'use client';

import { useState, useTransition } from 'react';
import type { FieldDefinition } from '@opvaryn/contracts';

import { deleteAttachmentAction, uploadAttachmentAction } from '@/app/(workspace)/objects/actions';
import { MAX_ATTACHMENT_BYTES, type UploadedAttachment } from '@/lib/attachments';

/**
 * The control for a `file` field. The file is uploaded as soon as it is chosen; the form
 * then carries its identifier in a hidden input, and the API binds it while saving the
 * record. Removing a file clears the value — on save, the record's old file is replaced
 * (ADR 0025).
 */
export function FileField({
  objectKey,
  field,
  initial,
}: {
  objectKey: string;
  field: FieldDefinition;
  /** The file already attached to the record being edited, if any. */
  initial?: UploadedAttachment;
}) {
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function chooseFile(file: File | undefined, input: HTMLInputElement) {
    if (!file) {
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError('Tệp tối đa 10 MB.');
      input.value = '';
      return;
    }

    const body = new FormData();
    body.set('objectKey', objectKey);
    body.set('file', file);

    startTransition(async () => {
      const result = await uploadAttachmentAction(body);
      input.value = '';
      if (result.status === 'error' || !result.attachment) {
        setError(result.message ?? 'Không tải được tệp.');
        return;
      }
      // Picking a new file abandons the previous upload; remove it if it was never saved.
      if (attachment && attachment.id !== initial?.id) {
        void deleteAttachmentAction(attachment.id);
      }
      setAttachment(result.attachment);
      setError(null);
    });
  }

  function removeFile() {
    if (attachment && attachment.id !== initial?.id) {
      void deleteAttachmentAction(attachment.id);
    }
    setAttachment(null);
    setError(null);
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name={field.key} value={attachment?.id ?? ''} />

      {attachment ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
          <a
            href={`/attachments/${attachment.id}`}
            className="text-xs font-medium text-accent-strong hover:underline"
          >
            Tải về
          </a>
          <button
            type="button"
            onClick={removeFile}
            className="text-xs font-medium text-danger hover:underline"
          >
            Bỏ tệp
          </button>
        </div>
      ) : (
        <input
          type="file"
          disabled={pending}
          onChange={(event) => chooseFile(event.target.files?.[0], event.target)}
          className="block w-full text-sm text-on-surface-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-on-surface hover:file:bg-surface-overlay disabled:opacity-60"
        />
      )}

      {pending ? <p className="text-xs text-on-surface-muted">Đang tải tệp lên…</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

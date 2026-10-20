/**
 * The largest file a person may upload. It mirrors `domain.MaxAttachmentBytes` and the
 * database CHECK in the Go API; the browser check is only a faster answer, the API is the
 * one that enforces it.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** One uploaded file as the form holds it. */
export interface UploadedAttachment {
  id: string;
  fileName: string;
}

/** The state the delete-record action answers with. */
export interface DeleteRecordState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

export const INITIAL_DELETE_RECORD_STATE: DeleteRecordState = { status: 'idle' };

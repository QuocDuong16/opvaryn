/** The state the work policy form answers with. */
export interface WorkPolicyState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

export const INITIAL_WORK_POLICY_STATE: WorkPolicyState = { status: 'idle' };

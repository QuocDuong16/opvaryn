'use server';

import { ApiError } from '@opvaryn/contracts';

import type { PasswordState } from '@/components/auth/password-state';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

/**
 * Changes the signed-in person's own password. The API verifies the current password and
 * ends every other session; this action only maps the answer to a sentence a person reads.
 */
export async function changePasswordAction(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');

  if (currentPassword === '' || newPassword === '') {
    return { status: 'error', message: 'Nhập mật khẩu hiện tại và mật khẩu mới.' };
  }

  try {
    await createServerApiClient().changeMyPassword({ currentPassword, newPassword });
    return {
      status: 'success',
      message: 'Đã đổi mật khẩu. Các thiết bị khác của bạn đã được đăng xuất.',
    };
  } catch (cause) {
    return { status: 'error', message: passwordErrorMessage(cause) };
  }
}

/**
 * passwordErrorMessage turns the service's validation sentences into the wording a person
 * reads; anything else falls back to the shared mapping.
 */
function passwordErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === 'invalid_request') {
    if (cause.message.includes('currentPassword')) {
      return 'Mật khẩu hiện tại không đúng.';
    }
    if (cause.message.includes('must be different')) {
      return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
    }
    if (cause.message.includes('at least 10')) {
      return 'Mật khẩu mới phải có ít nhất 10 ký tự.';
    }
  }
  return describeApiError(cause);
}
